import {
  PassFigure,
  PassState,
  type PointsExpiry,
  type TierStanding,
} from '@core/components';
import type { LoyaltyAccountMeta } from '@core/entities';
import { LocalDate } from '@core/primitives';

/*
 * THE LOYALTY PASS (client-card-revision-3 §2.2.1; `wallet.presenter.ts`
 * `passVm` / `passStateOf`). What the pass's figure counts, the one thing
 * its state line says, and the figures behind both — decided here, worded
 * by the presenter. A paused client's values are never zeroed: the pass is
 * FROZEN, its figure the account's own.
 */

/** What the pass reads of an account: the signed balance, the points' expiry and the visits the tier is judged by. */
export type LoyaltyPassAccount = Pick<LoyaltyAccountMeta, 'balance'> &
  PointsExpiry &
  Pick<TierStanding, 'tierQualifying'>;

/** The card around the pass: whether points run at all, a pause, and the shop's today (parsed at the edge). */
export type LoyaltyPassView = {
  /** `loyalty.points` is on. */
  readonly pointsOn: boolean;
  /** The client is paused: the pass is frozen, its values kept. */
  readonly paused: boolean;
  readonly today: LocalDate;
};

/** The pass, decided: its state, what its figure counts, and the numbers each line words. */
export type LoyaltyPass = {
  /** FROZEN › (points off: CLEAR) › OWES › EXPIRING › CLEAR — first match wins. */
  readonly passState: PassState;
  /** POINTS with points on, VISITS (the tier's count) with them off. */
  readonly passFigure: PassFigure;
  /** The signed balance (POINTS), or the qualifying visits (VISITS). */
  readonly figure: number;
  /** What can be spent: the balance, never below 0 — an account that owes has nothing to spend. */
  readonly spendable: number;
  /** What an account that owes owes (the balance's magnitude); `null` unless OWES. */
  readonly owed: number | null;
  /** What lapses — the whole balance (the projection says WHEN, not how many); `null` unless EXPIRING. */
  readonly lapsing: number | null;
  /** The day the points lapse; `null` unless EXPIRING. */
  readonly lapsesOn: LocalDate | null;
};

/** The state line's precedence (`passStateOf`): paused, points off, owing, inside the notice window. */
function stateOf(
  account: LoyaltyPassAccount,
  view: LoyaltyPassView,
): PassState {
  if (view.paused) return PassState.Frozen;
  if (!view.pointsOn) return PassState.Clear;
  if (account.balance < 0) return PassState.Owes;
  const expiresOn = account.pointsExpireOn;
  const noticeFrom = account.pointsExpiryNoticeFrom;
  if (
    expiresOn !== null &&
    noticeFrom !== null &&
    account.balance > 0 &&
    LocalDate.compare(view.today, noticeFrom) >= 0 &&
    LocalDate.compare(view.today, expiresOn) <= 0
  ) {
    return PassState.Expiring;
  }
  return PassState.Clear;
}

export const LoyaltyPassSystem = {
  /**
   * The pass (`wallet.presenter.ts:194-269`): a paused client's pass is
   * FROZEN whatever it holds; with points off the figure is the visits the
   * tier is judged by and the line says nothing (CLEAR); an account below
   * zero OWES; points still held from the notice day through the expiry
   * day itself are EXPIRING (the whole balance, on `pointsExpireOn`);
   * otherwise CLEAR. Values only — the line, the unit and the name are the
   * presenter's words.
   */
  passOf(account: LoyaltyPassAccount, view: LoyaltyPassView): LoyaltyPass {
    const passState = stateOf(account, view);
    const points = view.pointsOn;
    return {
      passState,
      passFigure: points ? PassFigure.Points : PassFigure.Visits,
      figure: points ? account.balance : account.tierQualifying,
      spendable: Math.max(0, account.balance),
      owed: passState === PassState.Owes ? Math.abs(account.balance) : null,
      lapsing: passState === PassState.Expiring ? account.balance : null,
      lapsesOn:
        passState === PassState.Expiring ? account.pointsExpireOn : null,
    };
  },
} as const;
