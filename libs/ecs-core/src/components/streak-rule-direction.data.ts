/**
 * A change, by whom it favours — the field `streakRuleDirection`. `LOOSER`
 * and `STRICTER` are the client's view; `MIXED` is both at once; `NEUTRAL`
 * moves nothing for the client (the staff's cue, the name, a figure of a
 * part that is off); `SWITCH` is the rule going on or off, whatever else
 * moved with it.
 */
export const StreakRuleDirection = {
  Looser: 'LOOSER',
  Stricter: 'STRICTER',
  Mixed: 'MIXED',
  Neutral: 'NEUTRAL',
  Switch: 'SWITCH',
} as const;
export type StreakRuleDirection =
  (typeof StreakRuleDirection)[keyof typeof StreakRuleDirection];
