import { AwardKind } from '@core/primitives';
import type { LocalizedText } from './localized-text.data';

/**
 * The perks a level can pay — the {@link AwardSummary.Perk} field
 * `awardPerkId`. Stable catalogue identifiers that keep their stored
 * strings (flatten-spec §0.4).
 */
export const PerkId = {
  PriorityWaitlist: 'perk.priorityWaitlist',
  BookFurtherAhead: 'perk.bookFurtherAhead',
  FreeReschedule: 'perk.freeReschedule',
} as const;
export type PerkId = (typeof PerkId)[keyof typeof PerkId];

/**
 * What a level paid, for «донесе …» — an element of a level's `awards`
 * array, a union of FLAT variants on `awardKind`: a summary of its rule's
 * awards, so the card never reads a rule. Every figure is a positive whole
 * number; a perk's `awardPerkForDays: null` is for good.
 */
export type AwardSummary =
  | AwardSummary.Points
  | AwardSummary.Coupon
  | AwardSummary.Freeze
  | AwardSummary.Perk;

function positiveWhole(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

export const AwardSummary = {
  points(awardPoints: number): AwardSummary.Points {
    return { awardKind: AwardKind.Points, awardPoints };
  },
  coupon(awardCouponTitle: LocalizedText): AwardSummary.Coupon {
    return { awardKind: AwardKind.Coupon, awardCouponTitle };
  },
  freeze(awardFreezeCount: number): AwardSummary.Freeze {
    return { awardKind: AwardKind.Freeze, awardFreezeCount };
  },
  /** `awardPerkForDays: null` is for good. */
  perk(
    awardPerkId: PerkId,
    awardPerkForDays: number | null,
  ): AwardSummary.Perk {
    return { awardKind: AwardKind.Perk, awardPerkId, awardPerkForDays };
  },

  /**
   * A paid award is a positive whole number of what it pays — a perk for
   * good (`awardPerkForDays: null`) or for a positive number of days; a
   * coupon's title is judged by its own text guard. The `awardOf` check of
   * `badge-series.ts` (was `Gamification.isAwardPositive`).
   */
  isPositive(award: AwardSummary): boolean {
    switch (award.awardKind) {
      case AwardKind.Points:
        return positiveWhole(award.awardPoints);
      case AwardKind.Freeze:
        return positiveWhole(award.awardFreezeCount);
      case AwardKind.Perk:
        return (
          award.awardPerkForDays === null ||
          positiveWhole(award.awardPerkForDays)
        );
      default:
        return true;
    }
  },
} as const;

export namespace AwardSummary {
  export type Points = {
    readonly awardKind: typeof AwardKind.Points;
    readonly awardPoints: number;
  };
  export type Coupon = {
    readonly awardKind: typeof AwardKind.Coupon;
    readonly awardCouponTitle: LocalizedText;
  };
  export type Freeze = {
    readonly awardKind: typeof AwardKind.Freeze;
    readonly awardFreezeCount: number;
  };
  export type Perk = {
    readonly awardKind: typeof AwardKind.Perk;
    readonly awardPerkId: PerkId;
    /** `null` = for good. */
    readonly awardPerkForDays: number | null;
  };
}
