/**
 * The date presets the schedule search offers — the field `searchWhenPreset`,
 * the ONLY source of these strings. `THIS_WEEK` is today through the next six
 * days and `PAST_WEEK` the six days before today through today
 * (`SearchFilterSystem.whenOf`), neither the calendar week.
 */
export const SearchWhenPreset = {
  Today: 'TODAY',
  Tomorrow: 'TOMORROW',
  Yesterday: 'YESTERDAY',
  ThisWeek: 'THIS_WEEK',
  PastWeek: 'PAST_WEEK',
} as const;
export type SearchWhenPreset =
  (typeof SearchWhenPreset)[keyof typeof SearchWhenPreset];
