/**
 * What a rhythm draft comes to — the discriminator `draftAssessment` of the
 * publish system's `StreakDraftAssessment` (a system I/O union: its valid
 * variant names a rule change), the ONLY source of these strings.
 */
export const DraftAssessment = {
  Valid: 'VALID',
  Invalid: 'INVALID',
} as const;
export type DraftAssessment =
  (typeof DraftAssessment)[keyof typeof DraftAssessment];
