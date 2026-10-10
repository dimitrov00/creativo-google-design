import { AccountState, AccountStatus } from '../components/account-status.data';
import type { DayKey } from '../components/day-key.data';
import type { Money } from '../components/money.data';
import type { PunchCard } from '../components/punch-card.data';
import type { StreakState } from '../components/streak-state.data';
import type { GiftVoucherEntity } from '../entities/gift-voucher.entity';
import { VoucherSystem } from './voucher.system';
import { DstResolution, ZonedTimeSystem } from './zoned-time.system';

/*
 * THE CLIENT CARD'S GLANCE, IN NUMBERS (client-card revision 3 §2.1, §5.1;
 * `client-card.presenter.ts` `pauseOf`/`sameLegs`/`isInChairToday`,
 * `glance.presenter.ts` `holdingsOf`/`voucherHolding`) — whether booking is
 * paused and until when, whether the visit on screen already holds the
 * last visit's services, whether the client is in the chair today, and the
 * holdings the glance folds: what is left on the vouchers that still pay,
 * the first stamp card, the run in progress. Numbers, tags and verdicts —
 * the words, the capsules and the rows stay in the presenters.
 */

/** One service of a visit: what «Пак същото» compares. */
export type GlanceLeg = {
  readonly serviceId: string;
  readonly variantId: string | null;
};

/** The glance's inputs beside the account. */
export type GlanceHoldingsInput = {
  /** The vouchers issued to the person, any state; `null` = not read. */
  readonly vouchers: readonly GiftVoucherEntity[] | null;
  readonly punchCards: readonly PunchCard[];
  /** `loyalty.achievements`: the stamp card follows it. */
  readonly achievements: boolean;
  /** `loyalty.streaks` on and the rule in force on: the rhythm follows it. */
  readonly rhythmOn: boolean;
  /** The account's state of the rule in force's rhythm (its count is all that is read); `null` when it holds none. */
  readonly rhythm: Pick<StreakState, 'current'> | null;
  /** A paused client's rhythm is frozen: the glance says nothing of it. */
  readonly paused: boolean;
  readonly today: DayKey;
  /** The shop's zone: a voucher's last day is read on its calendar. */
  readonly zone: string;
};

/** The holdings line, each `null` where it is absent. */
export type GlanceHoldings = {
  /** What is left on every voucher that still pays, as ONE sum in the first one's currency. */
  readonly voucher: Money | null;
  /** The first stamp card. */
  readonly stamps: PunchCard | null;
  /** The run in progress; a count of nought is nothing held. */
  readonly rhythm: number | null;
};

const LEG_JOINT = '\u0000';
const KEY_JOINT = '\u0001';

function keysOf(legs: readonly GlanceLeg[]): string {
  const keys: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as GlanceLeg;
    keys.push(`${leg.serviceId}${LEG_JOINT}${leg.variantId ?? ''}`);
  }
  return keys.sort().join(KEY_JOINT);
}

/** The shop day an instant falls on, or `null` where the zone cannot place it. */
function dayOf(epochMs: number, zone: string): DayKey | null {
  const clock = ZonedTimeSystem.wallClockOf(epochMs, zone);
  return clock.ok ? clock.value.dayKey : null;
}

export const ClientGlanceSystem = {
  /**
   * Online booking paused AS OF `nowMs`: `{ untilMs }` (`null` = for good),
   * or `null` — a temporary pause that has run out is no pause.
   */
  pauseOf(
    status: AccountStatus | null,
    nowMs: number,
  ): { readonly untilMs: number | null } | null {
    if (status === null || !AccountStatus.isBlockedAt(status, nowMs)) {
      return null;
    }
    return {
      untilMs: status.kind === AccountState.Blocked ? status.untilMs : null,
    };
  },

  /** The same services, each as often, whatever the order: what «Пак същото» would add is already there. */
  sameLegs(a: readonly GlanceLeg[], b: readonly GlanceLeg[]): boolean {
    return keysOf(a) === keysOf(b);
  },

  /**
   * The client is in the chair today: the visit on screen is open (not
   * settled) and one of its services starts on the shop's today.
   */
  isInChairToday(
    open: boolean,
    legStartsMs: readonly number[],
    nowMs: number,
    zone: string,
  ): boolean {
    if (!open) return false;
    const today = dayOf(nowMs, zone);
    if (today === null) return false;
    for (let i = 0; i < legStartsMs.length; i++) {
      const start = legStartsMs[i] as number;
      if (Number.isFinite(start) && dayOf(start, zone) === today) return true;
    }
    return false;
  },

  /**
   * The holdings the glance folds, in its order: the vouchers that still
   * pay — active, not empty, not past their last day — summed in the first
   * one's currency; the first stamp card while `loyalty.achievements` is
   * on; the run in progress while the rhythm is on, the client not paused
   * and the run above nought.
   */
  holdings(input: GlanceHoldingsInput): GlanceHoldings {
    let voucher: Money | null = null;
    const vouchers = input.vouchers;
    if (vouchers !== null) {
      // What can be spent is the voucher's own rule (`VoucherSystem.
      // spendable`), judged from the first instant of the shop's today.
      const start = ZonedTimeSystem.resolve(
        input.today,
        0,
        input.zone,
        DstResolution.ShiftForward,
      );
      if (start.ok) {
        const todayStartMs = start.value.epochMs;
        let currency: string | null = null;
        for (let i = 0; i < vouchers.length && currency === null; i++) {
          const held = vouchers[i] as GiftVoucherEntity;
          if (VoucherSystem.spendable(held, todayStartMs)) {
            currency = held.balance.currencyCode;
          }
        }
        if (currency !== null) {
          voucher = VoucherSystem.spendableSum(
            vouchers,
            todayStartMs,
            currency,
          );
        }
      }
    }
    const stamps = input.achievements ? (input.punchCards[0] ?? null) : null;
    const rhythm =
      input.rhythmOn &&
      !input.paused &&
      input.rhythm !== null &&
      input.rhythm.current > 0
        ? input.rhythm.current
        : null;
    return { voucher, stamps, rhythm };
  },
} as const;
