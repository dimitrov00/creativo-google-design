/**
 * Why a rhythm preview cannot be made — the unavailable answer's `reason`
 * ({@link StreakPreview}). A decision reason the page words, not an error:
 * nothing is refused by it (pass D, D-9.2).
 */
export const StreakPreviewUnavailable = {
  Qualifier: 'QUALIFIER',
} as const;
export type StreakPreviewUnavailable =
  (typeof StreakPreviewUnavailable)[keyof typeof StreakPreviewUnavailable];
