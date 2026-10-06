import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { UserId } from '@creativo/domain/accounts';
import {
  type ClientMoneyStats,
  type ClientStats,
} from '@creativo/domain/scheduling';
import {
  type PolicyPass,
  clientMoneyToDocument,
  clientStatsToDocument,
} from '@creativo/application/booking';
import {
  affectedSubjects,
  canonicalJson,
  judgePolicyPass,
  placementsFrom,
  planClientStatsWrite,
  projectionClock,
  statsInputChanged,
} from './client-stats-projection';

const seat = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  serviceId: 'cut',
  variantId: null,
  barberId: 'ivan',
  barberPref: 'specific',
  terms: {
    priceMinorUnits: 2500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    setupMinutes: 0,
    cleanupMinutes: 0,
    catalogPriceMinorUnits: null,
    catalogDurationMinutes: null,
  },
  slot: {
    startIso: '2026-09-01T10:00:00.000+03:00',
    endIso: '2026-09-01T10:30:00.000+03:00',
    zone: 'Europe/Sofia',
  },
  subject: { kind: 'account', userId: 'ana', relationship: 'self' },
  outcome: { kind: 'scheduled' },
  tipMinorUnits: null,
  ...overrides,
});

const visit = <S>(seats: S[], overrides: Record<string, unknown> = {}) => ({
  locationId: 'shop-1',
  ownerUserId: 'ana',
  status: { kind: 'confirmed' },
  bookedAt: { iso: '2026-08-20T09:00:00.000+03:00', zone: 'Europe/Sofia' },
  arrivedAt: null,
  contact: null,
  discounts: [],
  voucherRedemptions: [],
  seats,
  ...overrides,
});

describe('statsInputChanged — the early exit (§13 R28)', () => {
  const base = visit([seat()]);

  it('ignores what no stat reads: a tip, an arrival, a contact, a revision', () => {
    expect(
      statsInputChanged(
        base,
        visit([seat({ tipMinorUnits: 500 })], {
          arrivedAt: {
            iso: '2026-09-01T09:58:00.000+03:00',
            zone: 'Europe/Sofia',
          },
          contact: {
            name: 'Ана',
            phone: '+359888000000',
            email: null,
            note: null,
          },
          revision: 4,
          subjectUserIds: ['ana'],
        }),
      ),
    ).toBe(false);
  });

  // The preferred barber counts only visits their commit stamped (§11.2 #6).
  it('wakes on a placement stamped or changed', () => {
    const placed = visit([seat()], { placement: 'self' });
    expect(statsInputChanged(base, placed)).toBe(true);
    expect(
      statsInputChanged(placed, visit([seat()], { placement: 'staff' })),
    ).toBe(true);
    expect(
      statsInputChanged(placed, visit([seat()], { placement: 'self' })),
    ).toBe(false);
  });

  // The backfill's inference is no stat's input, so stamping it on a
  // pre-P0 row moves nobody's stats and wakes no recompute.
  it('sleeps through an inferred placement', () => {
    expect(
      statsInputChanged(base, visit([seat()], { inferredPlacement: 'staff' })),
    ).toBe(false);
  });

  it('wakes on an outcome, a subject, a time or a price', () => {
    const changes = [
      seat({ outcome: { kind: 'no_show', atMs: 1 } }),
      seat({
        subject: { kind: 'account', userId: 'bob', relationship: 'self' },
      }),
      seat({
        slot: {
          startIso: '2026-09-02T10:00:00.000+03:00',
          endIso: '2026-09-02T10:30:00.000+03:00',
          zone: 'Europe/Sofia',
        },
      }),
      seat({
        terms: { ...seat().terms, priceMinorUnits: 1800 },
      }),
    ];
    for (const changed of changes) {
      expect(statsInputChanged(base, visit([changed]))).toBe(true);
    }
  });

  it('wakes on a create and a delete', () => {
    expect(statsInputChanged(undefined, base)).toBe(true);
    expect(statsInputChanged(base, undefined)).toBe(true);
  });

  it('does not mistake a reordered map for a change', () => {
    const reversed = (value: object) =>
      Object.fromEntries(Object.entries(value).reverse());
    const reordered = {
      ...reversed(base),
      bookedAt: reversed(base.bookedAt),
      seats: base.seats.map((entry) => ({
        ...reversed(entry),
        terms: reversed(entry.terms),
      })),
    };
    expect(statsInputChanged(base, reordered)).toBe(false);
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe('affectedSubjects', () => {
  it('is everyone on the visit before and after, once, guests left out', () => {
    const before = visit([
      seat(),
      seat({ id: 's2', subject: { kind: 'account', userId: 'zora' } }),
    ]);
    const after = visit([
      seat(),
      seat({ id: 's3', subject: { kind: 'anonymous', label: 'Гост' } }),
      seat({ id: 's4', subject: { kind: 'account', userId: 'bob' } }),
    ]);
    expect(affectedSubjects(before, after)).toEqual(['ana', 'bob', 'zora']);
    expect(affectedSubjects(undefined, undefined)).toEqual([]);
  });
});

describe('projectionClock', () => {
  it('never runs behind the stored answer', () => {
    const stored = { updatedAt: '2026-09-25T10:00:00.000Z' };
    expect(
      projectionClock(Date.parse('2026-09-25T09:00:00.000Z'), stored),
    ).toBe(Date.parse('2026-09-25T10:00:00.000Z'));
    expect(projectionClock(5, undefined)).toBe(5);
    expect(projectionClock(5, { updatedAt: 'garbage' })).toBe(5);
  });
});

describe('planClientStatsWrite — the revision guard', () => {
  const ana = UserId.create('ana');
  if (ana.isFailure()) throw new Error('bad fixture');
  const NOW = Date.parse('2026-09-25T10:00:00.000Z');
  const stats: ClientStats = {
    userId: ana.value,
    lifetime: {
      visitsCompleted: 1,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: { visitsCompleted: [], noShows: [], lateCancels: [] },
    firstVisitAtMs: null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
  };
  const money: ClientMoneyStats = {
    userId: ana.value,
    lifetimeSpendMinor: 2500,
    currencyCode: 'EUR',
  };
  const stored = (version: number, moneyVersion = version) => ({
    stats: clientStatsToDocument(stats, { version, updatedAtMs: NOW - 1000 }),
    money: clientMoneyToDocument(money, {
      version: moneyVersion,
      updatedAtMs: NOW - 1000,
    }),
  });

  it('writes nothing for a person with no history and nothing stored', () => {
    expect(
      planClientStatsWrite({
        userId: 'ana',
        stored: { stats: undefined, money: undefined },
        stats,
        money,
        hasHistory: false,
        nowMs: NOW,
      }),
    ).toEqual({ kind: 'unchanged' });
  });

  it('writes both documents at version 1 the first time', () => {
    const plan = planClientStatsWrite({
      userId: 'ana',
      stored: { stats: undefined, money: undefined },
      stats,
      money,
      hasHistory: true,
      nowMs: NOW,
    });
    expect(plan.kind).toBe('write');
    if (plan.kind !== 'write') return;
    expect(plan.stats['version']).toBe(1);
    expect(plan.money['version']).toBe(1);
    expect(plan.stats['updatedAt']).toBe('2026-09-25T10:00:00.000Z');
    expect(plan.stats).not.toHaveProperty('lifetimeSpendMinor');
  });

  it('leaves an unchanged answer alone — a redelivery bumps nothing', () => {
    expect(
      planClientStatsWrite({
        userId: 'ana',
        stored: stored(4),
        stats,
        money,
        hasHistory: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: 'unchanged' });
  });

  it('bumps both documents when only the spend moved', () => {
    const plan = planClientStatsWrite({
      userId: 'ana',
      stored: stored(4),
      stats,
      money: { ...money, lifetimeSpendMinor: 3000 },
      hasHistory: true,
      nowMs: NOW,
    });
    expect(plan.kind === 'write' && plan.version).toBe(5);
  });

  it('rewrites a pair whose versions disagree', () => {
    const plan = planClientStatsWrite({
      userId: 'ana',
      stored: stored(4, 3),
      stats,
      money,
      hasHistory: true,
      nowMs: NOW,
    });
    expect(plan.kind === 'write' && plan.version).toBe(5);
  });

  it('empties the stats of somebody who left every visit, rather than keeping stale numbers', () => {
    const plan = planClientStatsWrite({
      userId: 'ana',
      stored: stored(4),
      stats: { ...stats, lifetime: { ...stats.lifetime, visitsCompleted: 0 } },
      money: { ...money, lifetimeSpendMinor: 0 },
      hasHistory: false,
      nowMs: NOW,
    });
    expect(plan.kind === 'write' && plan.version).toBe(5);
  });
});

describe('placementsFrom', () => {
  it('names each stored placement and leaves a legacy row out', () => {
    const docs = [
      { id: 'a1', data: () => visit([seat()], { placement: 'self' }) },
      { id: 'a2', data: () => visit([seat()], { placement: 'staff' }) },
      { id: 'a3', data: () => visit([seat()], { placement: null }) },
      { id: 'a4', data: () => visit([seat()]) },
      { id: 'a5', data: () => visit([seat()], { placement: 'guessed' }) },
    ];
    expect([...placementsFrom(docs)]).toEqual([
      ['a1', 'self'],
      ['a2', 'staff'],
    ]);
  });

  // legacyPref: a pre-P0 row's seats carry the old defaulted `specific`, so
  // what the audit trail says about who placed it is no evidence of a request.
  it('never passes an inferred placement on as evidence', () => {
    const docs = [
      {
        id: 'p1',
        data: () => visit([seat()], { inferredPlacement: 'staff' }),
      },
      {
        id: 'p2',
        data: () =>
          visit([seat()], { placement: null, inferredPlacement: 'self' }),
      },
      {
        id: 'n1',
        data: () =>
          visit([seat()], { placement: 'staff', inferredPlacement: 'self' }),
      },
    ];
    expect([...placementsFrom(docs)]).toEqual([['n1', 'staff']]);
  });
});

describe('the policy pass stamp — a newer pass has the last word', () => {
  const T0 = Date.parse('2026-09-25T08:00:00.000Z');
  const passAt = (generation: string, ms: number): PolicyPass => ({
    generation,
    changedAt: new Date(ms).toISOString(),
  });

  it('refuses a pass older than the stamp, and only that', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -60_000, max: 60_000 }),
        fc.constantFrom('evt-a', 'evt-b'),
        (offsetMs, generation) => {
          const stored = passAt('evt-b', T0);
          const mine = passAt(generation, T0 + offsetMs);
          const verdict = judgePolicyPass(mine, stored);
          if (generation === 'evt-b') {
            // A re-run of the same pass: judged, the stamp left as it is.
            expect(verdict).toEqual({
              kind: 'judge',
              stamp: stored,
              restamp: false,
            });
          } else if (offsetMs < 0) {
            expect(verdict).toEqual({ kind: 'superseded' });
          } else {
            expect(verdict).toEqual({
              kind: 'judge',
              stamp: mine,
              restamp: true,
            });
          }
        },
      ),
    );
  });

  it('orders passes to the microsecond', () => {
    const newer: PolicyPass = {
      generation: 'evt-new',
      changedAt: '2026-09-25T08:00:00.123456Z',
    };
    const older: PolicyPass = {
      generation: 'evt-old',
      changedAt: '2026-09-25T08:00:00.123400Z',
    };
    expect(judgePolicyPass(older, newer)).toEqual({ kind: 'superseded' });
    expect(judgePolicyPass(newer, older).kind).toBe('judge');
  });

  it('stamps a first judgement, carries the stamp for a writer that is not a pass, and never skips on an unreadable instant', () => {
    const stored = passAt('evt-a', T0);
    expect(judgePolicyPass(stored, null)).toEqual({
      kind: 'judge',
      stamp: stored,
      restamp: true,
    });
    expect(judgePolicyPass(null, stored)).toEqual({
      kind: 'judge',
      stamp: stored,
      restamp: false,
    });
    expect(judgePolicyPass(null, null)).toEqual({
      kind: 'judge',
      stamp: null,
      restamp: false,
    });
    const garbled = { generation: 'evt-z', changedAt: 'not an instant' };
    expect(judgePolicyPass(garbled, stored).kind).toBe('judge');
  });
});
