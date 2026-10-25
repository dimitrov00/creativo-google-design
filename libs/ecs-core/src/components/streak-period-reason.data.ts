import type { FreezeReason } from './streak-phase-state.data';
import type { StreakExcuse } from './streak-rule.data';

/** What covered a `PROTECTED` period: a protection, an excuse by name, or a pause — read from the two dictionaries, never a third. */
export type StreakPeriodReason =
  | typeof FreezeReason.Freeze
  | StreakExcuse
  | typeof FreezeReason.Pause
  | typeof FreezeReason.ClientPause;
