import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UserId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { unwrapOk } from '../testing';
import {
  ClientMoneyStats,
  ClientStats,
  PauseSuggestion,
  PolicyPass,
  PolicyPassStamp,
  PreciseInstant,
} from './client-stats.data';

/** An instant literal in epoch ms. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

const instant = (seconds: number, nanos: number): PreciseInstant => {
  const value = PreciseInstant.of(seconds, nanos);
  if (value === null) throw new Error('unexpected failure in test fixture');
  return value;
};

describe('PreciseInstant.of', () => {
  it('accepts integral seconds and nanos in [0, 1e9)', () => {
    expect(PreciseInstant.of(1_760_000_000, 123_456_789)).toEqual({
      seconds: 1_760_000_000,
      nanos: 123_456_789,
    });
    expect(PreciseInstant.of(0, 0)).toEqual({ seconds: 0, nanos: 0 });
    expect(Object.is(PreciseInstant.of(-0, 0)?.seconds, 0)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(PreciseInstant.of(1.5, 0)).toBeNull();
    expect(PreciseInstant.of(1, -1)).toBeNull();
    expect(PreciseInstant.of(1, 1_000_000_000)).toBeNull();
    expect(PreciseInstant.of(1, 0.5)).toBeNull();
    expect(PreciseInstant.of(Number.NaN, 0)).toBeNull();
    expect(PreciseInstant.of(2 ** 53, 0)).toBeNull();
  });
});

describe('PreciseInstant.compare', () => {
  it('orders two changes inside one millisecond — the microseconds count (§9 D17)', () => {
    // 2026-10-10T10:00:00.123456Z vs …123457Z: equal as epoch ms.
    const a = instant(1_760_090_400, 123_456_000);
    const b = instant(1_760_090_400, 123_457_000);
    expect(PreciseInstant.toEpochMs(a)).toBe(PreciseInstant.toEpochMs(b));
    expect(PreciseInstant.compare(a, b)).toBeLessThan(0);
    expect(PreciseInstant.compare(b, a)).toBeGreaterThan(0);
    expect(PreciseInstant.compare(a, a)).toBe(0);
    expect(PreciseInstant.equals(a, instant(1_760_090_400, 123_456_000))).toBe(
      true,
    );
    expect(PreciseInstant.equals(a, b)).toBe(false);
  });

  it('whole seconds decide before the fraction', () => {
    expect(
      PreciseInstant.compare(instant(10, 999_999_999), instant(11, 0)),
    ).toBeLessThan(0);
  });

  it('agrees with the epoch-ms order wherever the milliseconds differ', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e13 }),
        fc.integer({ min: -1e12, max: 1e13 }),
        (x, y) => {
          const order = PreciseInstant.compare(
            PreciseInstant.fromEpochMs(at(x)),
            PreciseInstant.fromEpochMs(at(y)),
          );
          expect(Math.sign(order)).toBe(Math.sign(x - y));
        },
      ),
    );
  });
});

describe('PreciseInstant.fromEpochMs / toEpochMs', () => {
  it('round-trips any integral epoch ms, before 1970 included', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), (ms) => {
        const value = PreciseInstant.fromEpochMs(at(ms));
        expect(value.nanos).toBeGreaterThanOrEqual(0);
        expect(value.nanos).toBeLessThan(1_000_000_000);
        expect(PreciseInstant.toEpochMs(value)).toBe(ms);
      }),
    );
  });

  it('splits a literal instant into seconds and nanos', () => {
    expect(PreciseInstant.fromEpochMs(at(1_760_090_400_123))).toEqual({
      seconds: 1_760_090_400,
      nanos: 123_000_000,
    });
    expect(PreciseInstant.fromEpochMs(at(-1))).toEqual({
      seconds: -1,
      nanos: 999_000_000,
    });
  });

  it('toEpochMs truncates the sub-millisecond part, and is null past the UtcEpochMs window', () => {
    expect(PreciseInstant.toEpochMs(instant(1, 999_999))).toBe(1000);
    expect(PreciseInstant.toEpochMs(instant(2 ** 52, 0))).toBeNull();
  });
});

describe('PolicyPass / ClientStats / ClientMoneyStats', () => {
  it('PolicyPass.of pairs a generation with its change instant', () => {
    const changedAt = instant(1_760_090_400, 5);
    expect(PolicyPass.of('evt-1', changedAt)).toEqual({
      generation: 'evt-1',
      changedAt: { seconds: 1_760_090_400, nanos: 5 },
    });
  });

  it('PolicyPassStamp flattens a pass to its root fields and reads it back, null together for none', () => {
    const pass = PolicyPass.of('evt-1', instant(1_760_090_400, 5));
    expect(PolicyPassStamp.of(pass)).toEqual({
      policyPassGeneration: 'evt-1',
      policyPassChangedAtSeconds: 1_760_090_400,
      policyPassChangedAtNanos: 5,
    });
    expect(PolicyPassStamp.read(PolicyPassStamp.of(pass))).toEqual(pass);
    expect(PolicyPassStamp.of(null)).toEqual(PolicyPassStamp.NONE);
    expect(PolicyPassStamp.NONE).toEqual({
      policyPassGeneration: null,
      policyPassChangedAtSeconds: null,
      policyPassChangedAtNanos: null,
    });
    expect(PolicyPassStamp.read(PolicyPassStamp.NONE)).toBeNull();
    // A stamp missing any field records no pass.
    expect(
      PolicyPassStamp.read({
        ...PolicyPassStamp.of(pass),
        policyPassChangedAtNanos: null,
      }),
    ).toBeNull();
  });

  it('ClientStats.empty is a person with no history, every key present and flat', () => {
    expect(ClientStats.empty(UserId.of('u-1'))).toEqual({
      userId: 'u-1',
      lifetimeVisitsCompleted: 0,
      lifetimeNoShows: 0,
      lifetimeLateCancels: 0,
      lifetimeClientCancels: 0,
      last365VisitsCompleted: [],
      last365NoShows: [],
      last365LateCancels: [],
      firstVisitLocalDate: null,
      firstVisitStartMinutes: null,
      lastVisitAppointmentId: null,
      lastVisitLocalDate: null,
      lastVisitStartMinutes: null,
      lastVisitServiceIds: [],
      lastVisitBarberIds: [],
      lastVisitLegs: [],
      nextVisitAppointmentId: null,
      nextVisitLocalDate: null,
      nextVisitStartMinutes: null,
      nextVisitServiceIds: [],
      nextVisitBarberIds: [],
      nextVisitLegs: [],
      avgCadenceDays: null,
      preferredBarberId: null,
      usualServiceIds: [],
      pauseSuggestedNoShows: null,
      pauseSuggestedWindowDays: null,
      pauseSuggestionBasis: [],
      pauseSuggestedAtUtcMs: null,
    });
    expect(PauseSuggestion.isRaised(ClientStats.empty(UserId.of('u-1')))).toBe(
      false,
    );
  });

  it('ClientMoneyStats.zero is a flat spend of nought cents in EUR', () => {
    expect(ClientMoneyStats.zero(UserId.of('u-1'))).toEqual({
      userId: 'u-1',
      lifetimeSpendCents: 0,
      currency: 'EUR',
    });
  });
});
