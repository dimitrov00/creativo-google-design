import {
  AccountLifecycle,
  AccountStatus,
} from '../components/account-status.data';
import type { PunchCard } from '../components/punch-card.data';
import type { ShopNow } from '../components/shop-now.data';
import type { StreakState } from '../components/streak-state.data';
import type { WallTime } from '../components/wall-time.data';
import type { GiftVoucher } from '../entities/gift-voucher.entity';
import type { Currency } from '../primitives/currency.primitive';
import type { ServiceId, ServiceVariantId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { PriceCents } from '../primitives/price-cents.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { VoucherSystem } from './voucher.system';

/*
 * THE CLIENT CARD'S GLANCE, IN NUMBERS (client-card revision 3 §2.1, §5.1;
 * `client-card.presenter.ts` `pauseOf`/`sameLegs`/`isInChairToday`,
 * `glance.presenter.ts` `holdingsOf`/`voucherHolding`) — whether booking is
 * paused and until when, whether the visit on screen already holds the
 * last visit's services, whether the client is in the chair today, and the
 * holdings the glance folds: what is left on the vouchers that still pay,
 * the first stamp card, the run in progress. Numbers, tags and verdicts —
 * the words, the capsules and the rows stay in the presenters.
 *
 * Zone-blind (Law 7): "today" arrives as the shop's `LocalDate` / `ShopNow`,
 * a leg's start as the shop wall clock (`WallTime`, converted at the
 * boundary — T6), a voucher's last day as its stored `expiresLocalDate`
 * (T5). The pause is a lifecycle comparison of two instants (T2).
 */

/** One service of a visit: what «Пак същото» compares. */
export type GlanceLeg = {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
};

/** The glance's inputs beside the account. */
export type GlanceHoldingsInput = {
  /** The vouchers issued to the person, any state; `null` = not read. */
  readonly vouchers: readonly GiftVoucher[] | null;
  readonly punchCards: readonly PunchCard[];
  /** `loyalty.achievements`: the stamp card follows it. */
  readonly achievements: boolean;
  /** `loyalty.streaks` on and the rule in force on: the rhythm follows it. */
  readonly rhythmOn: boolean;
  /** The account's state of the rule in force's rhythm (its count is all that is read); `null` when it holds none. */
  readonly rhythm: Pick<StreakState, 'current'> | null;
  /** A paused client's rhythm is frozen: the glance says nothing of it. */
  readonly paused: boolean;
  /** The shop's today: a voucher's last day is read on its calendar. */
  readonly today: LocalDate;
};

/** The holdings line, each `null` where it is absent. */
export type GlanceHoldings = {
  /** What is left on every voucher that still pays, as ONE sum in the first one's currency. */
  readonly voucherCents: PriceCents | null;
  /** The currency of {@link voucherCents}; `null` together with it. */
  readonly voucherCurrency: Currency | null;
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

export const ClientGlanceSystem = {
  /**
   * Online booking paused AS OF `nowUtcMs`: `{ untilUtcMs }` (`null` = for
   * good), or `null` — a temporary pause that has run out is no pause.
   */
  pauseOf(
    lifecycle: AccountLifecycle | null,
    nowUtcMs: UtcEpochMs,
  ): { readonly untilUtcMs: UtcEpochMs | null } | null {
    if (
      lifecycle === null ||
      !AccountLifecycle.isBlockedAt(lifecycle, nowUtcMs)
    ) {
      return null;
    }
    return {
      untilUtcMs:
        lifecycle.accountStatus === AccountStatus.Blocked
          ? lifecycle.blockedUntilUtcMs
          : null,
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
    legs: readonly WallTime[],
    now: ShopNow,
  ): boolean {
    if (!open) return false;
    for (let i = 0; i < legs.length; i++) {
      if ((legs[i] as WallTime).localDate === now.localDate) return true;
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
    let voucherCents: PriceCents | null = null;
    let voucherCurrency: Currency | null = null;
    const vouchers = input.vouchers;
    if (vouchers !== null) {
      // What can be spent is the voucher's own rule (`VoucherSystem.
      // spendable`), judged on the shop's today.
      for (let i = 0; i < vouchers.length && voucherCurrency === null; i++) {
        const held = vouchers[i] as GiftVoucher;
        if (VoucherSystem.spendable(held, input.today)) {
          voucherCurrency = held.currency;
        }
      }
      if (voucherCurrency !== null) {
        voucherCents = VoucherSystem.spendableSum(
          vouchers,
          input.today,
          voucherCurrency,
        ).amountCents;
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
    return { voucherCents, voucherCurrency, stamps, rhythm };
  },
} as const;
