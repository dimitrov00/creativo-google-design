import type { HourCount } from '@core/primitives';
import type { PreciseInstant } from './precise-instant.data';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). A type-only component: no companion, nothing to put in one.
 */

/** The booking policy as the daily sweep reads it: its line, and when it last changed. */
export type LivePolicyLine = {
  /** The policy document's update time; `null` when there is no document. */
  readonly updatedAt: PreciseInstant | null;
  /** The free-cancellation window in force — the defaults' when there is no document. */
  readonly windowHours: HourCount;
};
