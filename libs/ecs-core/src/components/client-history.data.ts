/**
 * What the client card's history says beside its figures — the field
 * `historyNote` (Law 6), `ClientStatsSystem.historyNote`'s answer (Law
 * 10.2: the presenter words it, never decides it). `FIRST_VISIT` before the
 * first worked visit («Първо посещение»); `CLEAN` when neither a no-show nor
 * a cancellation of the client's own stands on the record («Без неявявания
 * и откази от клиента»); `NONE` when there is nothing to say.
 */
export const HistoryNote = {
  FirstVisit: 'FIRST_VISIT',
  Clean: 'CLEAN',
  None: 'NONE',
} as const;
export type HistoryNote = (typeof HistoryNote)[keyof typeof HistoryNote];

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
