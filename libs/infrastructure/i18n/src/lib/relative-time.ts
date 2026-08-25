/**
 * "in 20 minutes", "tomorrow", "3 weeks ago" — in the active language.
 *
 * `Intl.RelativeTimeFormat` with `numeric: 'auto'` is what turns "in 1 day"
 * into "tomorrow" and "1 day ago" into "yesterday", in every language it
 * knows — which is the whole reason to reach for the platform here rather
 * than write a ladder of translation keys that would need "вчера"/"утре"
 * spelled out per locale and would still be wrong in the ones we have not
 * shipped yet.
 *
 * The unit is chosen the way a person would say it: minutes up to an hour,
 * hours up to a day, then days, weeks, months. Deliberately NOT seconds — a
 * schedule that counts down the last minute is a schedule that repaints
 * every second to tell you nothing.
 *
 * `style` is the platform's own, and it exists here for one reason: this
 * phrase shares a single clipped line with a client's service, and Bulgarian
 * spells "in 40 minutes" as "след 40 минути". At 390px that is the whole
 * line. `'short'` gives "след 40 мин" from the same locale data rather than
 * from an abbreviation table we would have to keep per language.
 */
const FORMATTERS = new Map<string, Intl.RelativeTimeFormat>();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** The average Gregorian month, which is what `Intl` means by "month" too. */
const MONTH = 30.436_875 * DAY;

export function relativeTime(
  targetMs: number,
  nowMs: number,
  lang: string,
  style: Intl.RelativeTimeFormatStyle = 'long',
): string {
  const key = `${lang}:${style}`;
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style });
    FORMATTERS.set(key, formatter);
  }
  const delta = targetMs - nowMs;
  const magnitude = Math.abs(delta);

  // `Math.round` on the way out, `Math.trunc`-like thresholds on the way in:
  // 59 minutes reads as "in 59 minutes", 61 as "in an hour", and nothing
  // ever reads as "in 0 minutes".
  if (magnitude < HOUR) {
    const minutes = Math.round(delta / MINUTE);
    return formatter.format(minutes === 0 ? 0 : minutes, 'minute');
  }
  if (magnitude < DAY)
    return formatter.format(Math.round(delta / HOUR), 'hour');
  if (magnitude < WEEK) return formatter.format(Math.round(delta / DAY), 'day');
  if (magnitude < MONTH) {
    return formatter.format(Math.round(delta / WEEK), 'week');
  }
  return formatter.format(Math.round(delta / MONTH), 'month');
}
