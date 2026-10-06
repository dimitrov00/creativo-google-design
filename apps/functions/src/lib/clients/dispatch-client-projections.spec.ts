import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import {
  Appointment,
  BarberPref,
  ClientStatsPolicy,
  COMPLETED,
  Seat,
  SeatId,
  SeatSubject,
  seatNoShow,
  seatWorked,
} from '@creativo/domain/scheduling';
import {
  type PersistedDocument,
  appointmentToDocument,
  clientMoneyFromDocument,
  clientStatsFromDocument,
} from '@creativo/application/booking';
import {
  type AppointmentWriteEvent,
  projectAppointmentWrite,
} from './dispatch-client-projections';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const NOW = Date.parse('2026-09-25T08:00:00.000Z');
const ZONE = 'Europe/Sofia';

/**
 * Just enough of the Admin SDK for the recompute's transaction: documents by
 * path, an `array-contains` query, `getAll`, `set`. Every transaction runs
 * once — contention is the emulator suite's business.
 */
function fakeDb(
  appointments: Record<string, PersistedDocument>,
  /** A subject whose history read rejects with the given error. */
  failing: ReadonlyMap<string, unknown> = new Map(),
) {
  const docs = new Map<string, PersistedDocument>(
    Object.entries(appointments).map(([id, data]) => [
      `appointments/${id}`,
      data,
    ]),
  );
  const writes: string[] = [];
  const ref = (path: string) => ({
    path,
    id: path.split('/').pop() ?? '',
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string) => ({
    doc: (id: string) => ref(`${path}/${id}`),
    where: (field: string, _op: 'array-contains', value: string) => ({
      path,
      field,
      value,
    }),
  });
  const snapshot = (path: string) => ({
    id: path.split('/').pop() ?? '',
    exists: docs.has(path),
    data: () => docs.get(path),
  });
  const tx = {
    async get(query: { path: string; field: string; value: string }) {
      if (failing.has(query.value)) throw failing.get(query.value);
      const matches = [...docs.keys()].filter((path) => {
        if (!path.startsWith(`${query.path}/`)) return false;
        const list = docs.get(path)?.[query.field];
        return Array.isArray(list) && list.includes(query.value);
      });
      return { docs: matches.map(snapshot) };
    },
    async getAll(...refs: { path: string }[]) {
      return refs.map((r) => snapshot(r.path));
    },
    set(target: { path: string }, data: PersistedDocument) {
      docs.set(target.path, data);
      writes.push(target.path);
    },
  };
  const db = {
    collection,
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  return { db: db as unknown as Firestore, docs, writes };
}

function must<T>(result: { isFailure(): boolean; value?: T }): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value as T;
}

function at(ms: number): ZonedDateTime {
  return must<ZonedDateTime>(ZonedDateTime.fromMillis(ms, ZONE));
}

/** A settled party: Ana worked, Bob did not turn up. */
function party(id: string, startMs: number): PersistedDocument {
  const seat = (who: string, barber: string, worked: boolean) =>
    Seat.of({
      id: must<SeatId>(SeatId.create(`${id}-${who}`)),
      subject: SeatSubject.account(
        must<UserId>(UserId.create(who)),
        who === 'ana' ? 'self' : 'companion',
      ),
      serviceId: must<ServiceId>(ServiceId.create('cut')),
      variantId: null,
      barberId: must<BarberId>(BarberId.create(barber)),
      terms: must<ServiceTerms>(
        ServiceTerms.create(
          must<Money>(Money.fromMinorUnitsAndCode(2500, 'EUR')),
          30,
        ),
      ),
      startsAt: at(startMs),
      outcome: worked ? seatWorked(startMs + 1_800_000) : seatNoShow(startMs),
    });
  const appointment = must<Appointment>(
    Appointment.reconstitute({
      id,
      locationId: 'shop-1',
      seats: [seat('ana', 'ivan', true), seat('bob', 'petar', false)],
      status: COMPLETED,
      bookedAt: at(startMs - 86_400_000),
    }),
  );
  return appointmentToDocument(appointment, { placement: 'self' });
}

/** Ana alone, worked, having asked for Ivan by name — placed as given. */
function askedForIvan(
  id: string,
  startMs: number,
  placement: 'self' | 'staff' | null,
): PersistedDocument {
  const barberId = must<BarberId>(BarberId.create('ivan'));
  const appointment = must<Appointment>(
    Appointment.reconstitute({
      id,
      locationId: 'shop-1',
      seats: [
        Seat.of({
          id: must<SeatId>(SeatId.create(`${id}-ana`)),
          subject: SeatSubject.account(
            must<UserId>(UserId.create('ana')),
            'self',
          ),
          serviceId: must<ServiceId>(ServiceId.create('cut')),
          variantId: null,
          barberId,
          pref: BarberPref.specific(barberId),
          terms: must<ServiceTerms>(
            ServiceTerms.create(
              must<Money>(Money.fromMinorUnitsAndCode(2500, 'EUR')),
              30,
            ),
          ),
          startsAt: at(startMs),
          outcome: seatWorked(startMs + 1_800_000),
        }),
      ],
      status: COMPLETED,
      bookedAt: at(startMs - 86_400_000),
    }),
  );
  return appointmentToDocument(appointment, { placement });
}

function event(
  before: PersistedDocument | undefined,
  after: PersistedDocument | undefined,
): AppointmentWriteEvent {
  return {
    id: 'evt-7',
    time: new Date(NOW - 1_500).toISOString(),
    data: { before: { data: () => before }, after: { data: () => after } },
  };
}

const deps = (loadPolicy = async () => ClientStatsPolicy.default()) => ({
  clockMs: () => NOW,
  loadPolicy,
});

describe('projectAppointmentWrite', () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it('recomputes every person on a new visit, each from their own seats', async () => {
    const created = party('a1', NOW - 3 * 86_400_000);
    const { db, docs } = fakeDb({ a1: created });
    await projectAppointmentWrite(event(undefined, created), db, deps());

    const ana = clientStatsFromDocument('ana', docs.get('clientStats/ana'));
    const bob = clientStatsFromDocument('bob', docs.get('clientStats/bob'));
    expect(ana?.lifetime.visitsCompleted).toBe(1);
    expect(ana?.lifetime.noShows).toBe(0);
    expect(bob?.lifetime.noShows).toBe(1);
    expect(bob?.lifetime.visitsCompleted).toBe(0);
    // Spend lands in the admin-only document, at the same version.
    const money = clientMoneyFromDocument(
      'ana',
      docs.get('clientStats/ana/restricted/money'),
    );
    expect(money?.lifetimeSpendMinor).toBe(2500);
    expect(money?.version).toBe(ana?.version);
  });

  it('writes nothing on a redelivery', async () => {
    const created = party('a1', NOW - 3 * 86_400_000);
    const { db, writes } = fakeDb({ a1: created });
    await projectAppointmentWrite(event(undefined, created), db, deps());
    const first = writes.length;
    await projectAppointmentWrite(event(undefined, created), db, deps());
    expect(writes.length).toBe(first);
  });

  it('exits before any read when nothing a stat reads changed', async () => {
    const stored = party('a1', NOW - 3 * 86_400_000);
    const tipped = {
      ...stored,
      seats: (stored['seats'] as Record<string, unknown>[]).map((seat) => ({
        ...seat,
        tipMinorUnits: 500,
      })),
    };
    const loadPolicy = vi.fn(async () => ClientStatsPolicy.default());
    const { db, writes } = fakeDb({ a1: tipped });
    await projectAppointmentWrite(event(stored, tipped), db, deps(loadPolicy));
    expect(loadPolicy).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('rethrows a transient failure after one structured line', async () => {
    const created = party('a1', NOW);
    const { db } = fakeDb({ a1: created });
    await expect(
      projectAppointmentWrite(
        event(undefined, created),
        db,
        deps(async () => Promise.reject({ code: 14 })),
      ),
    ).rejects.toEqual({ code: 14 });
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'dispatchClientProjections',
      eventId: 'evt-7',
      outcome: 'transient',
      code: 'unavailable',
      ageMs: 1_500,
    });
  });

  it('recomputes the rest of the party after one person’s permanent failure', async () => {
    const created = party('a1', NOW - 3 * 86_400_000);
    const { db, docs } = fakeDb(
      { a1: created },
      new Map([['ana', { code: 13 }]]),
    );
    await expect(
      projectAppointmentWrite(event(undefined, created), db, deps()),
    ).resolves.toBeUndefined();

    // Ana's recompute failed; Bob, sorted after her, still gets his.
    expect(docs.has('clientStats/ana')).toBe(false);
    const bob = clientStatsFromDocument('bob', docs.get('clientStats/bob'));
    expect(bob?.lifetime.noShows).toBe(1);
    expect(vi.mocked(logger.error).mock.calls).toHaveLength(1);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'dispatchClientProjections',
      eventId: 'evt-7',
      outcome: 'permanent',
      code: 'internal',
      ageMs: 1_500,
    });
  });

  it('still recomputes everyone before rethrowing a transient failure', async () => {
    const created = party('a1', NOW - 3 * 86_400_000);
    const { db, docs } = fakeDb(
      { a1: created },
      new Map([['ana', { code: 10 }]]),
    );
    await expect(
      projectAppointmentWrite(event(undefined, created), db, deps()),
    ).rejects.toEqual({ code: 10 });
    expect(docs.has('clientStats/bob')).toBe(true);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      outcome: 'transient',
      code: 'aborted',
    });
  });

  // §11.2 #6: the preferred barber reads each visit's placement off the
  // stored row, and a legacy row without one is no evidence.
  it('names the barber asked for only on visits whose placement is known', async () => {
    const placed = {
      v1: askedForIvan('v1', NOW - 20 * 86_400_000, 'self'),
      v2: askedForIvan('v2', NOW - 10 * 86_400_000, 'self'),
    };
    const known = fakeDb(placed);
    await projectAppointmentWrite(
      event(undefined, placed.v2),
      known.db,
      deps(),
    );
    expect(
      clientStatsFromDocument('ana', known.docs.get('clientStats/ana'))
        ?.preferredBarberId?.value,
    ).toBe('ivan');

    const legacy = {
      v1: askedForIvan('v1', NOW - 20 * 86_400_000, null),
      v2: askedForIvan('v2', NOW - 10 * 86_400_000, null),
    };
    const unknown = fakeDb(legacy);
    await projectAppointmentWrite(
      event(undefined, legacy.v2),
      unknown.db,
      deps(),
    );
    const ana = clientStatsFromDocument(
      'ana',
      unknown.docs.get('clientStats/ana'),
    );
    expect(ana?.lifetime.visitsCompleted).toBe(2);
    expect(ana?.preferredBarberId).toBeNull();
  });

  it('drops a permanent failure, which would fail the same way all day', async () => {
    const created = party('a1', NOW);
    const { db } = fakeDb({ a1: created });
    await expect(
      projectAppointmentWrite(
        event(undefined, created),
        db,
        deps(async () => Promise.reject({ code: 9 })),
      ),
    ).resolves.toBeUndefined();
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      outcome: 'permanent',
      code: 'failed-precondition',
    });
  });
});
