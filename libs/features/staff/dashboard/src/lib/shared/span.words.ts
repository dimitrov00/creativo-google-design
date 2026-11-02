/*
 * A LENGTH OF TIME, in words — "45 мин" / "1 ч" / "6 ч 30 мин", never a bare
 * minute count. The form chosen for the figure (D-2.3); what the figure is
 * (a gap's minutes, the time left) is the caller's.
 */

/** The three forms, from the catalogue (`staff.day.span*`). */
export interface SpanWords {
  readonly minutes: (minutes: number) => string;
  readonly hours: (hours: number) => string;
  readonly hoursMinutes: (hours: number, minutes: number) => string;
}

/** The forms from a host's `translate`, read once. */
export function spanCopyOf(
  translate: (
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ) => string,
): SpanWords {
  return {
    minutes: (minutes) => translate('staff.day.spanMinutes', { minutes }),
    hours: (hours) => translate('staff.day.spanHours', { hours }),
    hoursMinutes: (hours, minutes) =>
      translate('staff.day.spanHoursMinutes', { hours, minutes }),
  };
}

/** A whole number of minutes in its form; a negative length is no time at all. */
export function spanWords(totalMinutes: number, words: SpanWords): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return words.minutes(minutes);
  if (rest === 0) return words.hours(hours);
  return words.hoursMinutes(hours, rest);
}
