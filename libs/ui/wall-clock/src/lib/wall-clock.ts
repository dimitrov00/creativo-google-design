import {
  type Currency,
  type DurationMinutes,
  type EndMinute,
  LocalDate,
  type MinuteOfDay,
  type PriceCents,
  type TimeZone,
  type TrackMinute,
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
 * format a day, an instant, a price, a span of minutes or a count here, so
 * no two of them ever format one apart.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

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
 * not an instant (so no brand: it is never stored, compared or stamped).
 * Module-private: only ever handed to this file's `timeZone: 'UTC'`
 * formatters. No minute reads as the day's midnight.
 */
function civilMs(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute | null = null,
): number {
  return (
    LocalDate.toEpochDay(localDate) * MS_PER_DAY + (minute ?? 0) * MS_PER_MINUTE
  );
}

/**
 * A shop day (and, optionally, a minute of it) in the locale's form —
 * «4 септември», «пт», «10:00». The reading is the shop's own wall clock,
 * printed as stored.
 */
export function formatWallClock(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute | null,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormat(locale, 'UTC', options).format(civilMs(localDate, minute));
}

/**
 * The PARTS of a wall-clock reading (`formatToParts`, cached formatter) —
 * for a face that reads the locale's own order or touches one part: the
 * day pill's shared month said once on the side the locale puts it, the
 * dashboard's title-cased month. The reading is {@link formatWallClock}'s,
 * on the UTC axis.
 */
export function wallClockParts(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute | null,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] {
  return dateFormat(locale, 'UTC', options).formatToParts(
    civilMs(localDate, minute),
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
  minute: MinuteOfDay | EndMinute | null,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return wallClockParts(localDate, minute, locale, options)
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

/**
 * «10:00» — a minute of the shop's day, or its exclusive end (1440 reads as
 * the closing midnight, «00:00»).
 */
export function formatMinute(
  minute: MinuteOfDay | EndMinute,
  locale: string,
): string {
  return dateFormat(locale, 'UTC', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(minute * MS_PER_MINUTE);
}

/**
 * How the 24-hour clock face prints the closing midnight (1440) and an
 * anchored minute past it — a UI dictionary homed with its one function
 * ({@link formatClock}); internal values, printed nowhere.
 */
export const ClockClosing = {
  /**
   * `00:00` — the minute wraps onto the next day's clock (`t mod 1440`):
   * a late cut on the anchored axis that ends at 1455 ends at «00:15». The
   * editors', the block editor's and the time grid's face.
   */
  Wrap: 'WRAP',
  /**
   * `24:00` — the hours run on past 23 (no wrap): a window closing at
   * midnight closes at «24:00». The waitlisted step's and the landing's
   * face (neither hands a minute past 1440).
   */
  EndOfDay: 'END_OF_DAY',
} as const;
export type ClockClosing = (typeof ClockClosing)[keyof typeof ClockClosing];

/**
 * «09:05» — a minute of the shop's day (or of a frame's anchored axis) as
 * the zero-padded 24-hour `HH:MM` face, whatever the locale: Bulgaria
 * writes times that way, and a grid read at arm's length cannot spend two
 * characters on am/pm. No `Intl` call — the input is already a wall-clock
 * offset, never an instant. `closing` says how 1440 and the minutes past it
 * print ({@link ClockClosing}); a locale-worded time stays
 * {@link formatMinute}/{@link formatWallClock}. Reads back to itself
 * through `MinuteOfDay.parseClock` for every minute of the day.
 */
export function formatClock(t: TrackMinute, closing: ClockClosing): string {
  const minute = closing === ClockClosing.Wrap ? t % MINUTES_PER_DAY : t;
  const hours = Math.floor(minute / MINUTES_PER_HOUR);
  const minutes = minute - hours * MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * The zone's short name at an instant, in the locale's form — «EEST» in a
 * Sofia summer, «EET» in its winter («GMT+9» where the locale names none):
 * resolved at the instant rather than hard-coded, so it stays true across
 * the changeover. Cached per locale + zone (never a fresh `Intl` per read);
 * the zone itself when the platform answers no name.
 */
export function formatZoneName(
  utcEpochMs: UtcEpochMs,
  timeZone: TimeZone,
  locale: string,
): string {
  return (
    dateFormat(locale, timeZone, { timeZoneName: 'short' })
      .formatToParts(utcEpochMs)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  );
}

/** An instant in the locale's form, on the SHOP's calendar (`timeZone` is the location's). */
export function formatInstant(
  utcEpochMs: UtcEpochMs,
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
  amountCents: PriceCents,
  currency: Currency,
  locale: string,
): string {
  const format = moneyFormat(locale, currency);
  return format.format(amountCents / 10 ** exponentOf(format));
}

/** The ONE cached currency formatter per locale + currency. */
function moneyFormat(locale: string, currency: Currency): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let format = MONEY_FORMATS.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency });
    MONEY_FORMATS.set(key, format);
  }
  return format;
}

/**
 * A currency's own exponent — its minor-unit digits, read from `Intl`
 * (`2` for EUR and every other stored `Currency`), never a hard-coded `/100`.
 */
function exponentOf(format: Intl.NumberFormat): number {
  return format.resolvedOptions().maximumFractionDigits ?? 2;
}

const FIGURE_FORMATS = new Map<string, Intl.NumberFormat>();

/**
 * An amount as a bare FIGURE, without its symbol — «18,00» — for a unit
 * field whose unit is its own word (the staff sheet's typed money). The
 * figure is {@link formatCents}' in every other respect: the currency's own
 * fraction digits (its exponent, never a hard-coded `/100`), the locale's
 * separators. Cached per locale + exponent.
 */
export function formatCentsFigure(
  amountCents: PriceCents,
  currency: Currency,
  locale: string,
): string {
  const exponent = exponentOf(moneyFormat(locale, currency));
  const key = `${locale}|${exponent}`;
  let format = FIGURE_FORMATS.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    });
    FIGURE_FORMATS.set(key, format);
  }
  return format.format(amountCents / 10 ** exponent);
}

const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();

/** The ONE cached plain-number formatter per locale + options. */
function numberFormat(
  locale: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = NUMBER_FORMATS.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, options);
    NUMBER_FORMATS.set(key, format);
  }
  return format;
}

const MINUTE_UNIT: Intl.NumberFormatOptions = {
  style: 'unit',
  unit: 'minute',
  unitDisplay: 'narrow',
};
const UNGROUPED: Intl.NumberFormatOptions = { useGrouping: false };
const COUNT: Intl.NumberFormatOptions = {};

/**
 * «30 – 50 мин» · «30–50m» — a span of minutes (a service's duration
 * range) in the locale's narrow unit form; one figure when the ends agree
 * («30 мин»). `Intl`'s `formatRange` owns the separator and the unit said
 * once; where the platform lacks it, the bare low end (ungrouped), an en
 * dash and the worded high end. Cached per locale (pass E, E-12; moved from
 * the catalogue presenter's per-call `formatDurationRange`, words
 * byte-identical).
 */
export function formatMinutesRange(
  min: DurationMinutes,
  max: DurationMinutes,
  locale: string,
): string {
  const formatter = numberFormat(locale, MINUTE_UNIT);
  if (min === max) return formatter.format(min);
  // `formatRange` postdates the workspace TS lib — feature-detect at runtime.
  const ranged = formatter as Intl.NumberFormat & {
    formatRange?: (start: number, end: number) => string;
  };
  if (typeof ranged.formatRange === 'function') {
    return ranged.formatRange(min, max);
  }
  return `${numberFormat(locale, UNGROUPED).format(min)}–${formatter.format(max)}`;
}

/**
 * «12 450» · «12,450» — a count or a figure, grouped the locale's way
 * (Bulgarian from five digits, CLDR's minimum grouping: «1000»; English
 * from four: «1,000»). Cached per locale (pass E, E-12; the client card's
 * and the rhythm editor's per-call `Intl.NumberFormat(lang)`, words
 * byte-identical).
 */
export function formatCount(value: number, locale: string): string {
  return numberFormat(locale, COUNT).format(value);
}
