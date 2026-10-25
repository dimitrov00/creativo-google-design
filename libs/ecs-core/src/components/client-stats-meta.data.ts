import type { UtcEpochMs } from '@core/primitives';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). A type-only component: no companion, nothing to put in one.
 */

/**
 * The bookkeeping BOTH documents carry, bumped together on every change —
 * the revision guard writes only when the answer differs, and a stored pair
 * that disagrees on `version` is rewritten (`ClientStatsSystem.planWrite`).
 */
export type ClientStatsMeta = {
  readonly version: number;
  readonly updatedAtUtcMs: UtcEpochMs;
};
