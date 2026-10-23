import { describe, expect, it } from 'vitest';
import { PassFigure, PassState } from '@core/components';
import type { LoyaltyAccount } from '@core/entities';
import {
  FIXTURE_TODAY,
  deepFreeze,
  localDate,
  loyaltyAccountFixtures,
} from '@core/testing';
import {
  type LoyaltyPassAccount,
  LoyaltyPassSystem,
  type LoyaltyPassView,
} from './loyalty-pass.system';

/*
 * The decisions of `passVm` in
 * libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts, re-stated
 * as the values and tags the pass is worded from: the state line's
 * precedence (paused › points off › owing › the notice window), what the
 * figure counts, and the numbers behind each line. The words — the unit,
 * the minus, the day — stay with the presenter's spec. Георги holds 358
 * points on 14 qualifying visits; «today» is Monday 28 September 2026.
 */

const GEORGI: LoyaltyAccount = loyaltyAccountFixtures.georgi.account;
const MARTIN: LoyaltyAccount = loyaltyAccountFixtures.martin.account;

const ON: LoyaltyPassView = {
  pointsOn: true,
  paused: false,
  today: FIXTURE_TODAY,
};

const account = (edit: Partial<LoyaltyPassAccount>): LoyaltyPassAccount => ({
  balance: GEORGI.balance,
  tierQualifying: GEORGI.tierQualifying,
  pointsExpireOn: GEORGI.pointsExpireOn,
  pointsExpiryNoticeFrom: GEORGI.pointsExpiryNoticeFrom,
  ...edit,
});

/** Points that lapse on 31.12, told from 15.09. */
const EXPIRING = {
  pointsExpireOn: localDate('2026-12-31'),
  pointsExpiryNoticeFrom: localDate('2026-09-15'),
};

describe('the pass tags', () => {
  it('pins the state and figure tags', () => {
    expect(PassState).toEqual({
      Frozen: 'FROZEN',
      Owes: 'OWES',
      Expiring: 'EXPIRING',
      Clear: 'CLEAR',
    });
    expect(PassFigure).toEqual({ Points: 'POINTS', Visits: 'VISITS' });
  });
});

describe('LoyaltyPassSystem.passOf (wallet.presenter.spec.ts `passVm`)', () => {
  it('counts the balance, with nothing to say on the line', () => {
    expect(LoyaltyPassSystem.passOf(GEORGI, ON)).toEqual({
      passState: PassState.Clear,
      passFigure: PassFigure.Points,
      figure: 358,
      spendable: 358,
      owed: null,
      lapsing: null,
      lapsesOn: null,
    });
    expect(LoyaltyPassSystem.passOf(MARTIN, ON)).toMatchObject({
      passState: PassState.Clear,
      figure: 215,
    });
  });

  it('owes below zero: the figure keeps its sign, nothing is spendable, the line says what is owed', () => {
    expect(LoyaltyPassSystem.passOf(account({ balance: -40 }), ON)).toEqual({
      passState: PassState.Owes,
      passFigure: PassFigure.Points,
      figure: -40,
      spendable: 0,
      owed: 40,
      lapsing: null,
      lapsesOn: null,
    });
    expect(
      LoyaltyPassSystem.passOf(account({ balance: -1 }), ON),
    ).toMatchObject({ passState: PassState.Owes, owed: 1, spendable: 0 });
  });

  it('holds nothing to say at a balance of 0 or 1', () => {
    expect(LoyaltyPassSystem.passOf(account({ balance: 0 }), ON)).toMatchObject(
      { passState: PassState.Clear, figure: 0, spendable: 0, owed: null },
    );
    expect(LoyaltyPassSystem.passOf(account({ balance: 1 }), ON)).toMatchObject(
      { passState: PassState.Clear, figure: 1, spendable: 1 },
    );
  });

  it('says when points lapse only once the notice runs, and until the day itself', () => {
    const on = (today: string) =>
      LoyaltyPassSystem.passOf(account(EXPIRING), {
        ...ON,
        today: localDate(today),
      });
    expect(on('2026-09-28')).toMatchObject({
      passState: PassState.Expiring,
      lapsing: 358,
      lapsesOn: '2026-12-31',
    });
    // The notice's first day, and the expiry day itself, still say it.
    expect(on('2026-09-15').passState).toBe(PassState.Expiring);
    expect(on('2026-12-31').passState).toBe(PassState.Expiring);
    // The day before the notice, and the day after the expiry, do not.
    expect(on('2026-09-14')).toMatchObject({
      passState: PassState.Clear,
      lapsing: null,
      lapsesOn: null,
    });
    expect(on('2027-01-01').passState).toBe(PassState.Clear);
  });

  it('has nothing to lapse at a balance of 0, and owes rather than lapses below it', () => {
    expect(
      LoyaltyPassSystem.passOf(account({ ...EXPIRING, balance: 0 }), ON),
    ).toMatchObject({ passState: PassState.Clear, lapsing: null });
    expect(
      LoyaltyPassSystem.passOf(account({ ...EXPIRING, balance: -40 }), ON),
    ).toMatchObject({ passState: PassState.Owes, owed: 40, lapsing: null });
  });

  it('freezes a paused client’s pass first, and zeroes nothing on it', () => {
    const paused = { ...ON, paused: true };
    expect(LoyaltyPassSystem.passOf(account(EXPIRING), paused)).toEqual({
      passState: PassState.Frozen,
      passFigure: PassFigure.Points,
      figure: 358,
      spendable: 358,
      owed: null,
      lapsing: null,
      lapsesOn: null,
    });
    // Paused wins over owing too.
    expect(
      LoyaltyPassSystem.passOf(account({ balance: -40 }), paused),
    ).toMatchObject({ passState: PassState.Frozen, figure: -40, owed: null });
    // And over the points being off.
    expect(
      LoyaltyPassSystem.passOf(GEORGI, { ...paused, pointsOn: false }),
    ).toMatchObject({ passState: PassState.Frozen, figure: 14 });
  });

  it('counts the visits the tier is judged by where the points are off, and says nothing of points', () => {
    const off = { ...ON, pointsOn: false };
    expect(LoyaltyPassSystem.passOf(GEORGI, off)).toEqual({
      passState: PassState.Clear,
      passFigure: PassFigure.Visits,
      figure: 14,
      spendable: 358,
      owed: null,
      lapsing: null,
      lapsesOn: null,
    });
    // An account that owes says nothing of points while they are off.
    expect(
      LoyaltyPassSystem.passOf(account({ balance: -40 }), off),
    ).toMatchObject({ passState: PassState.Clear, figure: 14, owed: null });
    expect(LoyaltyPassSystem.passOf(account(EXPIRING), off).passState).toBe(
      PassState.Clear,
    );
  });
});

describe('LoyaltyPassSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const held = deepFreeze(account({ ...EXPIRING, balance: 120 }));
    const view = deepFreeze({ ...ON });
    expect(LoyaltyPassSystem.passOf(held, view)).toEqual(
      LoyaltyPassSystem.passOf(held, view),
    );
    expect(held.balance).toBe(120);
  });
});
