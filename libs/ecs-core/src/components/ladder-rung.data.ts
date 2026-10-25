/** Where one level of a detail page's ladder stands — `ladderRung`. */
export const LadderRung = {
  Passed: 'PASSED',
  Next: 'NEXT',
  Later: 'LATER',
} as const;
export type LadderRung = (typeof LadderRung)[keyof typeof LadderRung];
