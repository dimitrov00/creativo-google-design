/**
 * The date presets the schedule search offers — the field `searchWhenPreset`,
 * the ONLY source of these strings. `THIS_WEEK` is today through the next six
 * days (`SearchFilterSystem.whenOf`), not the calendar week.
 */
export const SearchWhenPreset = {
  Today: 'TODAY',
  Tomorrow: 'TOMORROW',
  ThisWeek: 'THIS_WEEK',
} as const;
export type SearchWhenPreset =
  (typeof SearchWhenPreset)[keyof typeof SearchWhenPreset];
