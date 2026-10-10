import type { DayKey } from '../components/day-key.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { Points } from '../components/points.data';
import type { RewardGrant } from '../components/reward-grant.data';

export type RewardId = string & { readonly __brand: unique symbol };
export const RewardId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): RewardId => raw as RewardId,
} as const;

/**
 * `rewardsCatalog/{id}` — what points buy (§9 D21's `RewardCatalogItem`).
 * `cost` is whole points, positive; `redeemedCount` is kept inside the
 * redemption transaction. RewardSystem decides `offered`/`affordable` and
 * why a reward cannot be redeemed. The stored body as is (the availability
 * window is shop-calendar days), save the voucher grant's `Money` (see
 * `RewardGrant`).
 */
export type RewardCatalogItemEntity = {
  readonly id: RewardId;
  readonly name: LocalizedText;
  readonly cost: Points;
  readonly enabled: boolean;
  readonly order: number;
  readonly grants: RewardGrant;
  readonly available: RewardCatalogItemEntity.Availability;
  readonly limits: RewardCatalogItemEntity.Limits;
  readonly redeemedCount: number;
};

export namespace RewardCatalogItemEntity {
  /** Both ends inclusive; `null` = open-ended. */
  export type Availability = {
    readonly from: DayKey | null;
    readonly until: DayKey | null;
  };
  export type Limits = {
    /** At most `count` redemptions per client in `windowDays`; `null` = no per-client limit. */
    readonly perClient: {
      readonly count: number;
      readonly windowDays: number;
    } | null;
    /** At most this many in all; `null` = unlimited. */
    readonly total: number | null;
  };
}
