/**
 * How long the client has come, as the card's hero line tells it — the
 * field `tenureState` (Law 6), `ClientStatsSystem.tenureOf`'s answer.
 * `FIRST_VISIT` before a worked visit with a first day on record; `SINCE`
 * the first day alone (a cadence needs three worked visits, R34);
 * `SINCE_CADENCE` the first day and the usual interval in weeks.
 */
export const TenureState = {
  FirstVisit: 'FIRST_VISIT',
  Since: 'SINCE',
  SinceCadence: 'SINCE_CADENCE',
} as const;
export type TenureState = (typeof TenureState)[keyof typeof TenureState];
