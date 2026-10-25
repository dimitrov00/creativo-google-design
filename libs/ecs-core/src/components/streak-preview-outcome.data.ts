/** What the rhythm's preview answers — the discriminator `streakPreviewOutcome` of {@link StreakPreview}. */
export const StreakPreviewOutcome = {
  Estimate: 'ESTIMATE',
  /** One of the two rules counts by a list, and the facts cannot say what a visit held. */
  Unavailable: 'UNAVAILABLE',
} as const;
export type StreakPreviewOutcome =
  (typeof StreakPreviewOutcome)[keyof typeof StreakPreviewOutcome];
