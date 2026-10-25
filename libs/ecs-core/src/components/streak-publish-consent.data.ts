/**
 * What «Запази» owes the admin before a change goes out, by its direction
 * (client-card revision 3 §2.6.4) — the field `streakPublishConsent`,
 * answered by `StreakRuleSystem.publishConsent`: `AT_ONCE` for a looser or
 * neutral change (saved straight away), `ASK` for a stricter or mixed one,
 * `ASK_SWITCH` for the rule going on or off. Which words the question
 * prints is the page's.
 */
export const StreakPublishConsent = {
  AtOnce: 'AT_ONCE',
  Ask: 'ASK',
  AskSwitch: 'ASK_SWITCH',
} as const;
export type StreakPublishConsent =
  (typeof StreakPublishConsent)[keyof typeof StreakPublishConsent];
