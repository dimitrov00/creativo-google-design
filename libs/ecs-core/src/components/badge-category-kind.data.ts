/**
 * A shelf of «Постижения» — the category's field `badgeCategoryKind`.
 * `RECORDS` holds no families: it is the personal-records rail.
 */
export const BadgeCategoryKind = {
  Milestones: 'MILESTONES',
  Mastery: 'MASTERY',
  Barbers: 'BARBERS',
  Rhythm: 'RHYTHM',
  Special: 'SPECIAL',
  Records: 'RECORDS',
} as const;
export type BadgeCategoryKind =
  (typeof BadgeCategoryKind)[keyof typeof BadgeCategoryKind];
