/**
 * How far an edit of a repeating block reaches (owner, 2026-11-06; Apple
 * Calendar's «This Event Only · All Future Events», Tiimo's «Update this
 * only · Update all future») — named after the field it types
 * (`blockSeriesScope`). There is no «all»: the days already past are the
 * record, and rewriting them changes nothing a barber can use.
 */
export const BlockSeriesScope = {
  /** The one day: it leaves the series (Google's «this event»). */
  ThisDay: 'THIS_DAY',
  /** That day and every later one: the series is cut there. */
  Following: 'FOLLOWING',
} as const;
export type BlockSeriesScope =
  (typeof BlockSeriesScope)[keyof typeof BlockSeriesScope];
