import type { EarnedLevel } from '@core/components';
import type { BadgeSeriesId } from '@core/primitives';

/**
 * `loyaltyAccounts/{customerId}/badgeProgress/{badgeSeriesId}` — one
 * family's progress for one client record; absent = not started. `value`
 * is on the family's metric as of today (a windowed count falls); `earned`
 * lists each level once, lowest first — each element stamped with its
 * instant and its shop day, written together (T5: «Последни» and a day's
 * scope read the stored `earnedLocalDate`, never re-bucket the instant).
 * The id is the family's `BadgeSeriesId`; the client record is in the path.
 */
export type BadgeProgress = {
  readonly id: BadgeSeriesId;
  readonly value: number;
  readonly earned: readonly EarnedLevel[];
};
