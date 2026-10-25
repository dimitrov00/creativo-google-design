/**
 * The repeat page's shortcuts — Apple's Repeat list with Google's and
 * Outlook's «every weekday» (a shop's lunch break). The ONLY source of these
 * strings (moved from `visit-draft.system.ts`, values unchanged). A preset
 * is never STORED: the draft holds the rule, and which row wears the check
 * is read back off it (`VisitDraftSystem.presetOf`).
 */
export const RepeatPreset = {
  Never: 'NEVER',
  Daily: 'DAILY',
  Weekdays: 'WEEKDAYS',
  Weekly: 'WEEKLY',
  Monthly: 'MONTHLY',
  Yearly: 'YEARLY',
} as const;
export type RepeatPreset = (typeof RepeatPreset)[keyof typeof RepeatPreset];
