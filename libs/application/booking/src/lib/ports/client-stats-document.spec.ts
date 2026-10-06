import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import {
  AppointmentId,
  type ClientStats,
  SeatId,
} from '@creativo/domain/scheduling';
import {
  POLICY_PASS_FIELD,
  type PolicyPass,
  clientMoneyFromDocument,
  clientMoneyToDocument,
  clientStatsContent,
  clientStatsFromDocument,
  clientStatsToDocument,
  policyPassFields,
  policyPassOf,
} from './client-stats-document';

function id<T>(result: { isFailure(): boolean; value?: T }): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value as T;
}

const T0 = Date.parse('2026-08-01T07:30:00.000Z');
const DAY = 86_400_000;
const appt = (value: string) => id<AppointmentId>(AppointmentId.create(value));

/** Every optional part present, so a round trip exercises every reader. */
const FULL: ClientStats = {
  userId: id<UserId>(UserId.create('ana')),
  lifetime: {
    visitsCompleted: 23,
    noShows: 3,
    lateCancels: 1,
    clientCancels: 2,
  },
  last365: {
    visitsCompleted: [{ appointmentId: appt('a1'), atMs: T0 }],
    noShows: [
      { appointmentId: appt('n1'), atMs: T0 - 40 * DAY },
      { appointmentId: appt('n2'), atMs: T0 - 10 * DAY },
    ],
    lateCancels: [{ appointmentId: appt('c1'), atMs: T0 - 5 * DAY }],
  },
  firstVisitAtMs: T0 - 600 * DAY,
  lastVisit: {
    appointmentId: appt('a1'),
    atMs: T0,
    serviceIds: [id<ServiceId>(ServiceId.create('cut'))],
    barberIds: [id<BarberId>(BarberId.create('ivan'))],
    legs: [
      {
        seatId: id<SeatId>(SeatId.create('a1-s1')),
        serviceId: id<ServiceId>(ServiceId.create('cut')),
        variantId: id<ServiceVariantId>(ServiceVariantId.create('long')),
        barberId: id<BarberId>(BarberId.create('ivan')),
        minutes: 45,
      },
    ],
  },
  nextVisit: null,
  avgCadenceDays: 27.5,
  preferredBarberId: id<BarberId>(BarberId.create('ivan')),
  usualServiceIds: [id<ServiceId>(ServiceId.create('cut'))],
  pauseSuggestion: {
    noShows: 3,
    windowDays: 60,
    basis: [appt('n0'), appt('n1'), appt('n2')],
    raisedAtMs: T0 - 10 * DAY,
  },
};

const META = { version: 7, updatedAtMs: T0 + 1_000 };

describe('clientStats document', () => {
  it('round-trips the whole projection with its bookkeeping', () => {
    const read = clientStatsFromDocument(
      'ana',
      clientStatsToDocument(FULL, META),
    );
    expect(read).toEqual({ ...FULL, ...META });
  });

  it('writes instants as UTC ISO strings and ids as plain strings', () => {
    const written = clientStatsToDocument(FULL, META);
    expect(written['updatedAt']).toBe('2026-08-01T07:30:01.000Z');
    expect(written['firstVisitAt']).toMatch(/Z$/);
    expect(written['preferredBarberId']).toBe('ivan');
  });

  it('holds no money: spend has a document of its own', () => {
    const written = JSON.stringify(clientStatsToDocument(FULL, META));
    expect(written).not.toMatch(/spend|Minor/i);
  });

  it('compares content apart from the bookkeeping', () => {
    expect(clientStatsContent(FULL)).toEqual(clientStatsContent({ ...FULL }));
    const content = Object.fromEntries(
      Object.entries(clientStatsToDocument(FULL, META)).filter(
        ([key]) => key !== 'version' && key !== 'updatedAt',
      ),
    );
    expect(content).toEqual(clientStatsContent(FULL));
  });

  it('is keyed by the document id, not a field inside it', () => {
    const written = { ...clientStatsToDocument(FULL, META), userId: 'mallory' };
    expect(clientStatsFromDocument('ana', written)?.userId.value).toBe('ana');
  });

  it('reads nothing it cannot vouch for as null', () => {
    const written = clientStatsToDocument(FULL, META);
    expect(clientStatsFromDocument('ana', undefined)).toBeNull();
    expect(
      clientStatsFromDocument('ana', { ...written, version: 'seven' }),
    ).toBeNull();
    expect(
      clientStatsFromDocument('ana', {
        ...written,
        lifetime: { visitsCompleted: -1 },
      }),
    ).toBeNull();
  });

  it('drops a list entry that does not parse rather than the document', () => {
    const written = clientStatsToDocument(FULL, META);
    const read = clientStatsFromDocument('ana', {
      ...written,
      last365: {
        visitsCompleted: [{ appointmentId: 'a1', at: 'yesterday' }],
        noShows: [],
        lateCancels: [],
      },
    });
    expect(read?.last365.visitsCompleted).toEqual([]);
    expect(read?.lifetime.visitsCompleted).toBe(23);
  });
});

describe('restricted/money document', () => {
  const money = {
    userId: id<UserId>(UserId.create('ana')),
    lifetimeSpendMinor: 64_000,
    currencyCode: 'EUR' as const,
  };

  it('round-trips at the same version as the stats', () => {
    expect(
      clientMoneyFromDocument('ana', clientMoneyToDocument(money, META)),
    ).toEqual({ ...money, ...META });
  });

  it('refuses a spend in anything but whole euro cents', () => {
    const written = clientMoneyToDocument(money, META);
    expect(
      clientMoneyFromDocument('ana', { ...written, currencyCode: 'BGN' }),
    ).toBeNull();
    expect(
      clientMoneyFromDocument('ana', { ...written, lifetimeSpendMinor: 1.5 }),
    ).toBeNull();
  });
});

/*
 * The policy pass stamp — server bookkeeping on `clientStats/{uid}`, parsed
 * here beside `version` and `updatedAt` (round 4, 2026-09-25: it lived in
 * the functions' writer, a second mapper for one persisted shape).
 */
describe('policy pass stamp', () => {
  const nonEmpty = fc.string({ minLength: 1, maxLength: 40 });

  it('round-trips through its one field', () => {
    fc.assert(
      fc.property(nonEmpty, nonEmpty, (generation, changedAt) => {
        const pass: PolicyPass = { generation, changedAt };
        const fields = policyPassFields(pass);
        expect(Object.keys(fields)).toEqual([POLICY_PASS_FIELD]);
        expect(policyPassOf(fields)).toEqual(pass);
      }),
    );
  });

  it('writes no field for no stamp, and reads anything else as no stamp', () => {
    expect(policyPassFields(null)).toEqual({});
    expect(policyPassOf(undefined)).toBeNull();
    expect(policyPassOf(null)).toBeNull();
    expect(policyPassOf({})).toBeNull();
    expect(policyPassOf({ [POLICY_PASS_FIELD]: 'evt-a' })).toBeNull();
    expect(policyPassOf({ [POLICY_PASS_FIELD]: ['evt-a', 'x'] })).toBeNull();
    expect(
      policyPassOf({ [POLICY_PASS_FIELD]: { generation: 'evt-a' } }),
    ).toBeNull();
    expect(
      policyPassOf({ [POLICY_PASS_FIELD]: { generation: '', changedAt: 'x' } }),
    ).toBeNull();
    expect(
      policyPassOf({ [POLICY_PASS_FIELD]: { generation: 'e', changedAt: 7 } }),
    ).toBeNull();
  });

  it('rides beside the projection without being part of it', () => {
    const pass: PolicyPass = { generation: 'evt-a', changedAt: 'x' };
    const stored = {
      ...clientStatsToDocument(FULL, META),
      ...policyPassFields(pass),
    };
    // The reader of the stats ignores it; the content comparison never sees it.
    expect(clientStatsFromDocument('ana', stored)).toEqual({
      ...FULL,
      ...META,
    });
    expect(policyPassOf(stored)).toEqual(pass);
  });
});
