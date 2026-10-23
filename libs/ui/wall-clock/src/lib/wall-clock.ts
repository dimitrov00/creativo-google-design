import {
  type Currency,
  LocalDate,
  type MinuteOfDay,
  type PriceCents,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';

/*
 * THE TEMPLATE LAYER'S CLOCK AND MONEY FACES (angular-ui.md: formatting
 * happens in the template layer, on native `Intl`, formatters cached per
 * locale + zone, never constructed per row).
 *
 * A visit is stored on the SHOP's wall clock — `localDate` + `*Minutes`
 * (Law 7.3) — so a wall-clock reading is formatted AS IT IS: its civil
 * fields laid on the UTC axis by plain arithmetic (`LocalDate.toEpochDay`)
 * and read back with `timeZone: 'UTC'`. No zone is consulted and no `Date`
 * is built: a 10:00 haircut prints «10:00» wherever the reader is. Only an
 * INSTANT (a photo's `takenAtUtcMs`, the clock's "now") needs the shop's
 * zone, and it is read in the location's `timeZone`, never the device's.
 *
 * The ONE set of formatters of the web UI (`@creativo/ui/wall-clock`):
 * the features, the `libs/ui` pickers, the shell and the showcase all
 * format a day, an instant or a price here, so no two of them ever format
 * one apart.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();
const MONEY_FORMATS = new Map<string, Intl.NumberFormat>();

function dateFormat(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = DATE_FORMATS.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    DATE_FORMATS.set(key, format);
  }
  return format;
}

/** A Monday on the civil axis — 2025-01-06, the legacy `weekdayLabels`' reference. */
const REFERENCE_MONDAY = LocalDate.fromEpochDay(20_094);
const WEEKDAY_LABELS = new Map<string, readonly string[]>();

/**
 * The week's short day names in the locale, Monday first — «пн … нд»,
 * «Mon … Sun» (Phase 4a; successor of `ZonedDateTime.weekdayLabels` and of
 * the block editor's and booking steps' private copies). A weekday name is
 * a property of the civil calendar, so no zone is consulted. Cached per
 * locale.
 */
export function formatWeekdayLabels(locale: string): readonly string[] {
  let labels = WEEKDAY_LABELS.get(locale);
  if (labels === undefined) {
    const format = dateFormat(locale, 'UTC', { weekday: 'short' });
    const built: string[] = [];
    for (let i = 0; i < 7; i++) {
      built.push(
        format.format(civilMs(LocalDate.addDays(REFERENCE_MONDAY, i))),
      );
    }
    labels = built;
    WEEKDAY_LABELS.set(locale, labels);
  }
  return labels;
}

/**
 * A shop wall-clock reading as a number on the UTC axis — its civil fields,
 * not an instant. Only ever handed to a `timeZone: 'UTC'` formatter.
 */
export function civilMs(localDate: LocalDate, minute = 0): number {
  return LocalDate.toEpochDay(localDate) * MS_PER_DAY + minute * MS_PER_MINUTE;
}

/**
 * A shop day (and, optionally, a minute of it) in the locale's form —
 * «4 септември», «пт», «10:00». The reading is the shop's own wall clock,
 * printed as stored.
 */
export function formatWallClock(
  localDate: LocalDate,
  minute: MinuteOfDay | number | null,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormat(locale, 'UTC', options).format(
    civilMs(localDate, minute ?? 0),
  );
}

/**
 * The same reading as {@link formatWallClock}, joined from its PARTS
 * (`formatToParts`) — the form a heading takes: ICU keeps the narrow
 * no-break space inside a part («2026\u202fг.» in bg) that the one-string
 * `format` writes as a plain space, so «Септември 2026 г.» never breaks
 * before its «г.».
 */
export function formatWallClockParts(
  localDate: LocalDate,
  minute: MinuteOfDay | number | null,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormat(locale, 'UTC', options)
    .formatToParts(civilMs(localDate, minute ?? 0))
    .map((part) => part.value)
    .join('');
}

/**
 * «4 – 6 септември» — two shop days as ONE range, in the locale's own range
 * form: `Intl`'s `formatRange` owns the separator and the pieces the two
 * ends share, and its output is never post-processed. Both ends take the
 * same `options` and are read, like every face here, on the UTC axis
 * (`timeZone: 'UTC'`, cached formatter) — so no device zone can move a day.
 */
export function formatWallClockRange(
  from: LocalDate,
  to: LocalDate,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormat(locale, 'UTC', options).formatRange(
    civilMs(from),
    civilMs(to),
  );
}

/** «10:00» — a minute of the shop's day. */
export function formatMinute(
  minute: MinuteOfDay | number,
  locale: string,
): string {
  return dateFormat(locale, 'UTC', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(minute * MS_PER_MINUTE);
}

/** An instant in the locale's form, on the SHOP's calendar (`timeZone` is the location's). */
export function formatInstant(
  utcEpochMs: UtcEpochMs | number,
  timeZone: TimeZone,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormat(locale, timeZone, options).format(utcEpochMs);
}

/**
 * The ONE way an amount becomes display text — «28,00 €». Fraction digits
 * are the CURRENCY's (never hand-tuned), so «28,00 €» lines up beside
 * «17,50 €» in a tabular column; the stored integer is minor units, scaled
 * by the currency's own exponent.
 */
export function formatCents(
  amountCents: PriceCents | number,
  currency: Currency | string,
  locale: string,
): string {
  const key = `${locale}|${currency}`;
  let format = MONEY_FORMATS.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency });
    MONEY_FORMATS.set(key, format);
  }
  const exponent = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountCents / 10 ** exponent);
}
