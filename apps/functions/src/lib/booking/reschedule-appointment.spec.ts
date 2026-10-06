import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { rescheduleAppointment } from './reschedule-appointment';

/**
 * A client's MOVE through the production path: the callable, the real
 * `RescheduleBookingUseCase`, the real `FirestoreBookingStore` and the real
 * audit writer, over an in-memory Firestore. Only the clock is frozen.
 *
 * Pinned here, end to end:
 * - the store hands the visit's own chairs back to the decision
 *   (`BookingSnapshot.release`), so its own seats never block its move —
 *   the rule the booking grid offers times by (`paddedBusy`);
 * - the callable forwards the client's `attemptId`, so the move's own write
 *   stamps it into the visit's ledger;
 * - a retry is logged from what the ledger says, not guessed.
 *
 * The emulator suite covers what a fake cannot: the real transaction.
 */

const fake = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));
vi.mock('../../adapters/system-clock', async () => {
  const { FixedClock } = await import('../../test-support/fixed-clock');
  return {
    // The Sunday before the visit, 08:00.
    SystemClock: class extends FixedClock {
      constructor() {
        super('2030-01-13T08:00:00.000+02:00');
      }
    },
  };
});

const ZONE = 'Europe/Sofia';
const OWNER = 'user-father';
const APPOINTMENT = 'appt-father';
/** 2030-01-15 is a Tuesday. */
const DAY = '2030-01-15';
const MOVE_ATTEMPT = 'attempt-move-0123456789';

function iso(hour: number, minute = 0): string {
  return `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+02:00`;
}

/**
 * Ivan works Center 09:00–18:00 with a 15-minute reset. The father's fade
 * (45 minutes + 10 of cleanup) holds his chair 10:00–10:55; somebody else
 * sits 11:10–11:40, the earliest the reset allowed.
 */
function seeded() {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  return createProjectionFirestore({
    'locations/loc-center': {
      timezone: ZONE,
      status: 'active',
      hours: [
        ...Array.from({ length: 6 }, () => ({
          kind: 'open',
          opens: '09:00',
          closes: '20:00',
        })),
        { kind: 'closed' },
      ],
    },
    'services/svc-fade': {
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 4000,
      currencyCode: 'EUR',
      durationMinutes: 45,
      setupMinutes: 0,
      cleanupMinutes: 10,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [],
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    },
    'barberSchedules/ivan': {
      barberId: 'ivan',
      turnaroundMinutes: 15,
      versions: [
        {
          seq: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern: { monday: day, tuesday: day, wednesday: day },
        },
      ],
    },
    [`barberBusy/ivan__${DAY}`]: {
      barberId: 'ivan',
      dayKey: DAY,
      zone: ZONE,
      busy: [
        { startIso: iso(10), endIso: iso(10, 55), zone: ZONE },
        { startIso: iso(11, 10), endIso: iso(11, 40), zone: ZONE },
      ],
    },
    [`appointments/${APPOINTMENT}`]: {
      locationId: 'loc-center',
      ownerUserId: OWNER,
      subjectUserIds: [OWNER],
      barberIds: ['ivan'],
      busyKeys: [`ivan__${DAY}`],
      timeSlot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
      seats: [
        {
          id: 'seat-father',
          serviceId: 'svc-fade',
          variantId: null,
          barberId: 'ivan',
          barberPref: 'specific',
          terms: {
            priceMinorUnits: 4000,
            currencyCode: 'EUR',
            durationMinutes: 45,
            setupMinutes: 0,
            cleanupMinutes: 10,
          },
          slot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
          subject: { kind: 'account', userId: OWNER, relationship: 'self' },
          outcome: { kind: 'scheduled' },
        },
      ],
      status: { kind: 'confirmed' },
      bookedAt: { iso: '2030-01-01T09:00:00.000+02:00', zone: ZONE },
      bookedFromAppointmentId: null,
      arrivedAt: null,
      contact: null,
      revision: 1,
    },
  });
}

let store: ReturnType<typeof seeded>;

beforeEach(() => {
  store = seeded();
  fake.db = store.db;
});

/** The father asks to move his fade to `hour:minute`, as the web flow does. */
function move(hour: number, minute = 0, attemptId?: string) {
  return rescheduleAppointment.run({
    data: {
      appointmentId: APPOINTMENT,
      locationId: 'loc-center',
      seats: [
        {
          lineId: 'line-1',
          serviceId: 'svc-fade',
          variantId: null,
          barberId: 'ivan',
          barberPref: 'specific',
          startIso: iso(hour, minute),
          subject: { kind: 'self' },
        },
      ],
      ...(attemptId === undefined ? {} : { attemptId }),
    },
    auth: { uid: OWNER, token: { roles: ['client'] } },
  } as unknown as CallableRequest);
}

function visit(): Record<string, unknown> {
  return store.docs.get(`appointments/${APPOINTMENT}`) ?? {};
}

function startOf(stored: Record<string, unknown>): unknown {
  const [seat] = stored['seats'] as Record<string, unknown>[];
  return (seat?.['slot'] as Record<string, unknown>)['startIso'];
}

function auditRows(): Record<string, unknown>[] {
  return [...store.docs.entries()]
    .filter(([path]) => path.startsWith('auditLog/'))
    .map(([, row]) => row);
}

/** A thrown `HttpsError`'s domain code. */
async function refusal(call: Promise<unknown>): Promise<unknown> {
  const error: unknown = await call.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  return (error as { details?: { code?: unknown } } | null)?.details?.code;
}

describe('rescheduleAppointment — the moved visit’s own chairs never block its move', () => {
  it('moves a quarter of an hour earlier, over the visit’s own old chair', async () => {
    // 09:45–10:40 overlaps the visit's own 10:00–10:55. Kept, that chair
    // (padded to 09:45–11:10) would refuse the move as `slot_unavailable`.
    await expect(move(9, 45)).resolves.toEqual({ appointmentId: APPOINTMENT });

    expect(startOf(visit())).toBe(iso(9, 45));
    expect(visit()['revision']).toBe(2);
  });

  it('hands back only the visit’s own chair: the neighbour keeps the reset it is owed', async () => {
    // 10:15–11:10 is free of the visit itself, but runs into the reset the
    // neighbour at 11:10 is owed (10:55–11:10).
    expect(await refusal(move(10, 15))).toBe('booking.commit.slot_unavailable');
    // …and the neighbour's own chair stays taken.
    expect(await refusal(move(11))).toBe('booking.commit.slot_unavailable');
    expect(startOf(visit())).toBe(iso(10));
  });
});

describe('rescheduleAppointment — the move’s name, from the wire to the ledger', () => {
  it('stamps the client’s attempt into the visit’s ledger, by the same write that moves it', async () => {
    await move(14, 0, MOVE_ATTEMPT);

    expect(startOf(visit())).toBe(iso(14));
    expect(visit()['appliedOperations']).toEqual([
      expect.objectContaining({ id: `move:${MOVE_ATTEMPT}`, revision: 2 }),
    ]);
    expect(auditRows().map((row) => row['context'])).toEqual([
      { revision: '2' },
    ]);
  });

  it('answers a retry from the ledger: nothing moves twice, and lost rows come back naming the ORIGINAL revision', async () => {
    await move(14, 0, MOVE_ATTEMPT);
    // The first call's rows were lost, and a staff note has bumped the
    // visit since: its revision is no longer the move's.
    for (const path of [...store.docs.keys()]) {
      if (path.startsWith('auditLog/')) store.docs.delete(path);
    }
    store.docs.set(`appointments/${APPOINTMENT}`, {
      ...visit(),
      revision: 3,
      staffNote: 'идва с малкия',
    });

    await expect(move(14, 0, MOVE_ATTEMPT)).resolves.toEqual({
      appointmentId: APPOINTMENT,
    });

    expect(visit()['revision']).toBe(3);
    expect(visit()['staffNote']).toBe('идва с малкия');
    expect(auditRows().map((row) => row['context'])).toEqual([
      { loggedOn: 'retry', revision: '2' },
    ]);

    // Every later retry finds the row there and writes nothing more.
    await move(14, 0, MOVE_ATTEMPT);
    expect(auditRows()).toHaveLength(1);
  });

  it('logs no move for a first call that asks for where the visit already is', async () => {
    // Named, but the ledger has never heard of it: nothing was ever moved.
    await expect(move(10, 0, MOVE_ATTEMPT)).resolves.toEqual({
      appointmentId: APPOINTMENT,
    });

    expect(visit()['revision']).toBe(1);
    expect(visit()['appliedOperations']).toBeUndefined();
    expect(auditRows()).toEqual([]);
  });
});
