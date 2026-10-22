import type { SeasonId } from '@core/primitives';

/**
 * `loyaltyAccounts/{customerId}/seasonProgress/{seasonId}` — the season's
 * track at a glance for one client record. `trackLevel` is the track's
 * highest earned level; 0 = none yet. The id is the `SeasonId`; the client
 * record is in the path.
 */
export type SeasonProgress = {
  readonly id: SeasonId;
  readonly trackValue: number;
  readonly trackLevel: number;
};
