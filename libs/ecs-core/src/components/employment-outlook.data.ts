/**
 * Where a barber's working period stands against the shop's today (team
 * onboarding D10) — the ONLY source of these strings, the field
 * `employmentOutlook`. What the period sheet words before a save, and what
 * the daily close reads: a period that has `ENDED` is closed.
 */
export const EmploymentOutlook = {
  /** No last working day: the barber works on. */
  Open: 'OPEN',
  /** A last day today or ahead: the barber works it through, then leaves. */
  Ends: 'ENDS',
  /** A last day behind today: the barber leaves at once. */
  Ended: 'ENDED',
} as const;
export type EmploymentOutlook =
  (typeof EmploymentOutlook)[keyof typeof EmploymentOutlook];
