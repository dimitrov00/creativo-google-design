import type { SeasonId } from '../primitives/ids.primitive';

/**
 * `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` — the season's track at
 * a glance (`loyalty-document.ts:606-610`), unchanged. `trackLevel` is the
 * track's highest earned level; 0 = none yet. The id is the `SeasonId`.
 */
export type SeasonProgress = {
  readonly id: SeasonId;
  readonly trackValue: number;
  readonly trackLevel: number;
};
