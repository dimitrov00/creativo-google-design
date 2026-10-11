import type { LocalizedText, Points, RewardGrantRule } from '@core/components';
import type { RewardId, LocalDate } from '@core/primitives';

/**
 * The reward's identity slice. `availableFrom` / `availableUntil` were
 * `available { from; until }` (shop-calendar days, both ends inclusive,
 * `null` = open-ended); `perClientLimitCount` + `perClientLimitWindowDays`
 * were `limits.perClient` (`null` together = no per-client limit) and
 * `totalLimit` was `limits.total` (`null` = unlimited).
 */
export type RewardCatalogItemMeta = {
  readonly id: RewardId;
  readonly name: LocalizedText;
  readonly cost: Points;
  readonly enabled: boolean;
  readonly order: number;
  readonly availableFrom: LocalDate | null;
  readonly availableUntil: LocalDate | null;
  /** At most `perClientLimitCount` redemptions per client in `perClientLimitWindowDays`. */
  readonly perClientLimitCount: number | null;
  readonly perClientLimitWindowDays: number | null;
  /** At most this many in all. */
  readonly totalLimit: number | null;
  readonly redeemedCount: number;
};

/**
 * `rewardsCatalog/{id}` — what points buy (§9 D21's `RewardCatalogItem`).
 * `cost` is whole points, positive; `redeemedCount` is kept inside the
 * redemption transaction. RewardSystem decides `offered`/`affordable` and
 * why a reward cannot be redeemed. The archetype (Law 6): the identity
 * slice and what a redemption mints (the `RewardGrantRule` variant slice,
 * was `grants`).
 */
export type RewardCatalogItem = RewardCatalogItemMeta & RewardGrantRule;
