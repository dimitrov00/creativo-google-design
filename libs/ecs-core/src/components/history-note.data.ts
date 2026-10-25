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
