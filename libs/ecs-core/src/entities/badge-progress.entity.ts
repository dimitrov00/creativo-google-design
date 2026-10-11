import type { EarnedLevel } from '@core/components';
import type { BadgeSeriesId } from '@core/primitives';

/**
 * `loyaltyAccounts/{uid}/badgeProgress/{badgeSeriesId}` — one family's
 * progress for one client; absent = not started (`loyalty-document.ts:597-
 * 604`). `value` is on the family's metric as of today (a windowed count
 * falls); `earned` lists each level once, lowest first — each element
 * stamped with its instant and its shop day (T5). The id is the family's
 * `BadgeSeriesId`; the client is in the path.
 */
export type BadgeProgress = {
  readonly id: BadgeSeriesId;
  readonly value: number;
  readonly earned: readonly EarnedLevel[];
};
