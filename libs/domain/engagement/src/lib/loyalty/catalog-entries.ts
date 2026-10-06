import type { LocalizedText } from '@creativo/domain/catalog';
import type { Metric, PerkId } from './badge-vocabulary';
import type { IsoDate } from './loyalty-calendar';

/**
 * The catalogue's plain entries — tiers, the rewards points buy — as
 * readonly values (model.ts's shapes). They have no behaviour of their own
 * worth a class: what holds across them (tiers rising, costs positive, ids
 * unique) is checked where they meet, by `LoyaltyCatalog.create`, and what
 * the card derives from them are the pure services in `standing.ts`.
 *
 * The rhythm is not one of them: a rule an admin edits needs invariants,
 * so it is the class `StreakDefinition` of `streak-definition.ts`
 * (client-card revision 3 §4.1), resolved by date from
 * `LoyaltyCatalog.streakInForce`.
 */

/**
 * `tierDefinitions/{id}` — Бронз · Сребро · Злато · Платина. Qualifying is
 * counted in VISITS in a rolling window, never mixed with points.
 */
export interface TierDefinition {
  readonly id: string;
  readonly name: LocalizedText;
  /** 0 = the entry tier; the track draws tiers by rank. */
  readonly rank: number;
  readonly benefits: readonly PerkId[];
  readonly version: number;
  readonly effectiveFrom: Date;
  readonly qualify: {
    readonly metric: Metric;
    readonly atLeast: number;
    readonly window: { readonly lastDays: number };
  };
}

/** What a redeemed reward mints. */
export type RewardGrant =
  | { readonly kind: 'coupon'; readonly couponId: string }
  | {
      readonly kind: 'voucher';
      readonly amountMinor: number;
      readonly expiresInDays: number;
    }
  | {
      readonly kind: 'perk';
      readonly perkId: PerkId;
      readonly forDays: number | null;
    };

/** `rewardsCatalog/{id}` — what points buy. `redeemedCount` is kept inside the redemption transaction. */
export interface RewardCatalogItem {
  readonly id: string;
  readonly name: LocalizedText;
  /** Whole points, positive. */
  readonly cost: number;
  readonly enabled: boolean;
  readonly order: number;
  readonly grants: RewardGrant;
  /** Europe/Sofia, inclusive; `null` = open-ended. */
  readonly available: {
    readonly from: IsoDate | null;
    readonly until: IsoDate | null;
  };
  readonly limits: {
    readonly perClient: {
      readonly count: number;
      readonly windowDays: number;
    } | null;
    readonly total: number | null;
  };
  readonly redeemedCount: number;
}

/** Why a reward cannot be redeemed now — the one gate, shared by the callable and the lock line. */
export type RedeemProblem =
  | 'disabled'
  | 'notYetAvailable'
  | 'ended'
  | 'soldOut'
  | 'paused'
  | 'insufficientPoints'
  | 'perClientLimit';

/** One of the client's non-reversed redemptions, as the per-client limit counts it. */
export interface RedemptionRecord {
  readonly rewardId: string;
  readonly on: IsoDate;
}

/**
 * The rhythm's excuses moved to the rule that owns them, where they gained
 * `closedDays`; they are handed on from here so every import of this file
 * keeps resolving.
 */
export { STREAK_EXCUSES } from './streak-definition';
export type { StreakExcuse } from './streak-definition';
