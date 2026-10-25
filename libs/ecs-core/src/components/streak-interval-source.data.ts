/**
 * Where a period's length came from: the rule's one number, the person's
 * habit, or the newcomer's default — the field `source` of the system value
 * `StreakIntervalRule.Period` (and, stored, a state's `periodSource`).
 */
export const StreakIntervalSource = {
  Fixed: 'FIXED',
  Personal: 'PERSONAL',
  Fallback: 'FALLBACK',
} as const;
export type StreakIntervalSource =
  (typeof StreakIntervalSource)[keyof typeof StreakIntervalSource];
