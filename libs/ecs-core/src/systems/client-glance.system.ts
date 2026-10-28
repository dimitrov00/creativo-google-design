import {
  AccountLifecycle,
  AccountStatus,
  type ClientStats,
  type Money,
  type PunchCard,
  type ShopNow,
  type StreakState,
  type VisitLeg,
  type WallTime,
} from '@core/components';
import type { GiftVoucher } from '@core/entities';
import type {
  AppointmentId,
  ServiceId,
  ServiceVariantId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import { VoucherSystem } from './voucher.system';

/*
 * THE CLIENT CARD'S GLANCE, IN NUMBERS (client-card revision 3 §2.1, §5.1;
 * `client-card.presenter.ts` `pauseOf`/`sameLegs`/`isInChairToday`,
 * `glance.presenter.ts` `holdingsOf`/`voucherHolding`) — whether booking is
 * paused and until when, whether the visit on screen already holds the
 * last visit's services, whether the client is in the chair today, and the
 * holdings the glance folds: what is left on the vouchers that still pay
 * (one sum per currency), the first stamp card, the run in progress.
 * Numbers, tags and verdicts — the words, the capsules and the rows stay in
 * the presenters.
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

/** The visit on screen as «Пак същото» weighs it — UI read-state handed in as values (D-2.6). */
export type RepeatDraft = {
  /** The card can write: offline, nothing is offered. */
  readonly online: boolean;
  /** The visit on screen is gone (cancelled, no-show) — a finished one is still correctable. */
  readonly gone: boolean;
  /** The visit on screen; `null` when the card is open on none. */
  readonly currentAppointmentId: AppointmentId | null;
  /** The services the visit on screen already holds. */
  readonly legs: readonly GlanceLeg[];
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

/** The holdings line, each `null` (the vouchers: empty) where it is absent. */
export type GlanceHoldings = {
  /**
   * What is left on every voucher that still pays — ONE sum per currency,
   * in the order each is first seen (`VoucherSystem.spendableSums`, OR-17);
   * empty when nothing is left or the vouchers were not read.
   */
  readonly vouchers: readonly Money[];
  /** The first stamp card. */
  readonly stamps: PunchCard | null;
  /** The run in progress; a count of nought is nothing held. */
  readonly rhythm: number | null;
};

/** No voucher money to show — shared, so an empty holding allocates nothing. */
const NO_VOUCHERS: readonly Money[] = [];

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
   * good), or `null` — a temporary pause that has run out is no pause. An
   * ERASED account (Phase 3 WS-D, P3-DEP-17) reads as paused for good: the
   * glance words the pause, never the erasure — the card words the
   * record's erasure tag.
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
   * «Пак същото» is offered (Law 10.2; old spec D-5): the last worked visit
   * is known (its id and its day), the card is online, the visit on screen
   * is not gone and is not that last visit, the last visit had services,
   * the visit on screen does not already hold them ({@link sameLegs}), and
   * one of them is still in the catalogue (`knownServiceIds` — the host
   * catalogue's lookup, made by the caller).
   */
  repeatOffer(
    last: Pick<
      ClientStats,
      'lastVisitAppointmentId' | 'lastVisitLocalDate' | 'lastVisitLegs'
    >,
    draft: RepeatDraft,
    knownServiceIds: ReadonlySet<ServiceId>,
  ): boolean {
    const legs = last.lastVisitLegs;
    if (
      last.lastVisitAppointmentId === null ||
      last.lastVisitLocalDate === null ||
      !draft.online ||
      draft.gone ||
      last.lastVisitAppointmentId === draft.currentAppointmentId ||
      legs.length === 0 ||
      ClientGlanceSystem.sameLegs(legs, draft.legs)
    ) {
      return false;
    }
    for (let i = 0; i < legs.length; i++) {
      if (knownServiceIds.has((legs[i] as VisitLeg).serviceId)) return true;
    }
    return false;
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
   * pay — active, not empty, not past their last day — summed per currency,
   * every currency kept (OR-17, DEP-F12); the first stamp card while
   * `loyalty.achievements` is on; the run in progress while the rhythm is
   * on, the client not paused and the run above nought.
   */
  holdings(input: GlanceHoldingsInput): GlanceHoldings {
    // What can be spent is the voucher's own rule (`VoucherSystem.
    // spendable`), judged on the shop's today.
    const vouchers =
      input.vouchers === null
        ? NO_VOUCHERS
        : VoucherSystem.spendableSums(input.vouchers, input.today);
    const stamps = input.achievements ? (input.punchCards[0] ?? null) : null;
    const rhythm =
      input.rhythmOn &&
      !input.paused &&
      input.rhythm !== null &&
      input.rhythm.current > 0
        ? input.rhythm.current
        : null;
    return { vouchers, stamps, rhythm };
  },
} as const;
