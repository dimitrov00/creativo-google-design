import type { TierId, UtcEpochMs } from '@core/primitives';

/**
 * The account's computed tier — from VISITS in the qualifying window, never
 * points (the legacy `loyalty-document.ts`, deleted in flip 3), a flat slice at the account's
 * root, every field prefixed `tier` (`tierSinceUtcMs` was `tier.since`).
 * `nextTierId`/`tierRemaining` are `null` at the top. TierSystem does the
 * math.
 */
export type TierStanding = {
  /** The tier the visits reached (was `current`). */
  readonly tierId: TierId;
  readonly tierDefinitionVersion: number;
  readonly tierSinceUtcMs: UtcEpochMs;
  /** Visits in the qualifying window. */
  readonly tierQualifying: number;
  readonly nextTierId: TierId | null;
  readonly tierRemaining: number | null;
};
