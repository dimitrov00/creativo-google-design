/**
 * The onboarding deep link's words — a URL contract (pass D D-8.2), so the
 * values keep the link's lower-case spelling: the menu's and the account
 * checklist's «finish your profile» rows link to
 * `/onboarding?phase=personalize&step=<step>`, and the onboarding screen
 * reads `?phase=` back.
 *
 * `?phase=personalize` re-enters an ACTIVE account at the personalization
 * phase. `?step=` is a hint only: the screen recomputes the steps still open
 * from the profile on arrival, so a stale hint costs nothing.
 */
export const OnboardingPhase = {
  Personalize: 'personalize',
} as const;
export type OnboardingPhase =
  (typeof OnboardingPhase)[keyof typeof OnboardingPhase];

/** The `?step=` hint — the personalization step's word, as the link spells it. */
export const OnboardingStepHint = {
  Services: 'services',
  Birthday: 'birthday',
  Avatar: 'avatar',
} as const;
export type OnboardingStepHint =
  (typeof OnboardingStepHint)[keyof typeof OnboardingStepHint];
