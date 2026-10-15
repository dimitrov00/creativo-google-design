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
 * Shared by the visit lists, the staff client card and the staff day, so
 * the three never format a day or a price apart.
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
