/**
 * How a qualifier stands to the one before it: `WIDER` counts every visit
 * the other counted and more, `NARROWER` the reverse, `OTHER` neither (two
 * lists that only overlap, services against categories) — the answer of
 * `StreakQualifierRule.compare`, read by a rule change's direction.
 */
export const QualifierComparison = {
  Same: 'SAME',
  Wider: 'WIDER',
  Narrower: 'NARROWER',
  Other: 'OTHER',
} as const;
export type QualifierComparison =
  (typeof QualifierComparison)[keyof typeof QualifierComparison];
