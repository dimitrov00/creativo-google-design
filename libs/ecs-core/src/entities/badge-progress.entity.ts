import type { EarnedLevel } from '../components/badge-level.data';
import type { SeriesId } from './badge-series.entity';

/**
 * `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` — one family's progress
 * for one client; absent = not started (`loyalty-document.ts:597-604`).
 * `value` is on the family's metric as of today (a windowed count falls);
 * `earned` lists each level once, lowest first (`earnedAt` → `earnedAtMs`).
 * The id is the family's `SeriesId`; the client is in the path.
 */
export type BadgeProgressEntity = {
  readonly id: SeriesId;
  readonly value: number;
  readonly earned: readonly EarnedLevel[];
};
