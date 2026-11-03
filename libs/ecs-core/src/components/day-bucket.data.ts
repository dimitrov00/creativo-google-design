/**
 * Which day-heading a visit's shop day files under in a day-grouped list —
 * the field `dayBucket`, the ONLY source of these strings. `TODAY` and
 * `TOMORROW` are the shop's own today and the day after; `LATER` is any
 * further day (it keeps its date); `PAST` is every earlier day, one group.
 * The wording of a heading is the presenter's; which bucket a day is in is
 * `VisitListSystem.dayGroups`'s.
 */
export const DayBucket = {
  Today: 'TODAY',
  Tomorrow: 'TOMORROW',
  Later: 'LATER',
  Past: 'PAST',
} as const;
export type DayBucket = (typeof DayBucket)[keyof typeof DayBucket];
