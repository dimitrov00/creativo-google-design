import { DateRange, DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { Result } from '../components/result.data';
import {
  DateTimeInvalidReason,
  TimeError,
} from '../components/time-errors.data';
import { Weekday } from '../components/weekday.data';
import { ZonedInstant } from '../components/zoned-instant.data';

/**
 * ZonedTimeSystem — the ONE file in the repo that does zone math (§9 D5).
 *
 * Native `Intl` only, no date library: the wall clock of an instant is
 * `Intl.DateTimeFormat(…, { timeZone, hourCycle: 'h23', … }).formatToParts`,
 * the offset at an instant is that wall clock read as UTC minus the instant,
 * and a day whose length is not 24 hours is bisected to its transition
 * minute. Each zone's formatter is built once and kept in the module-level
 * cache below — the one sanctioned module state in any system
 * (`ecs-systems.md`): construction is expensive, the output is pure.
 *
 * Three layers:
 *
 * 1. **The edge** — `checkZone`, `wallClockOf`, `resolve`, `parseIso`: raw
 *    input in, `Result` out, DST handled EXPLICITLY. A wall clock a
 *    spring-forward erased or a fall-back repeated is REJECTED unless the
 *    caller names a {@link DstResolution}: scheduling would rather fail loudly
 *    twice a year than move an appointment by an hour without telling anyone.
 * 2. **The table** — `dayTable` / `dayTableAround` build the `DayOffset` rows
 *    (the only reads of a zone's offsets, and the only writers of the
 *    transition fields). Every pipeline and store calls `dayTableAround`
 *    once per request, before any system runs.
 * 3. **Over the table and over day keys** — `dayKeyOf`, `startOfDayMs`,
 *    `instantOf`, `minuteOfDay`, `addDays`, `daysBetween`, `rangeKeys`, …:
 *    subtraction, binary search and civil integer arithmetic. No `Intl`, no
 *    `Date` — the functions every other system's hot path may lean on.
 */

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1_440;

/**
 * The instants this system reads: years 0001–9999 (the four-digit day keys),
 * minus a two-day margin for the ±1-day offset probes of {@link resolveLocal}.
 */
const MIN_INSTANT_MS = -62_135_596_800_000 + 2 * MS_PER_DAY;
const MAX_INSTANT_MS = 253_402_300_800_000 - 2 * MS_PER_DAY;

/** `MM-DD` of 29 February, and the day its anniversary falls on in a common year. */
const LEAP_DAY = '02-29';
const LAST_OF_COMMON_FEBRUARY = '02-28';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TWO_DIGITS = /^\d{2}$/;
/** 1–9 fraction digits (milli- to nanoseconds); read to the millisecond. */
const FRACTION_DIGITS = /^\d{1,9}$/;
/** `±HH:mm`, `±HHmm` or `±HH` — three flat patterns, no nested quantifier. */
const OFFSET_EXTENDED = /^[+-]\d{2}:\d{2}$/;
const OFFSET_BASIC = /^[+-]\d{4}$/;
const OFFSET_HOURS = /^[+-]\d{2}$/;

/**
 * The longest table one call builds — ten years of days. Tables are built
 * from instants a request carries (§4.1), so the cap is what keeps a hostile
 * `fromMs`/`toMs` pair from costing millions of formatter reads; the 366-day
 * recurrence horizon and a booking horizon sit far inside it. A longer span
 * is a deliberate change here, never a silent one.
 */
const MAX_TABLE_DAYS = 3_660;

/**
 * An IANA zone name starts with a letter (`Europe/Sofia`, `UTC`,
 * `Etc/GMT+3`). Offset ids (`+03:00`) are refused: Node 22 accepts them,
 * not every browser engine does, and a stored zone must mean the same thing
 * on the server and in the SPA.
 */
const IANA_ZONE_SHAPE = /^[A-Za-z]/;

/**
 * What to do with a wall-clock time a DST transition made impossible or
 * ambiguous. There is no safe default, so there is no default at all: every
 * caller of `resolve`/`parseIso` names one, and `Reject` is the one every
 * scheduling path names.
 *
 * - `Reject`       — fail. Every scheduling path uses this.
 * - `ShiftForward` — a skipped time becomes the instant one offset later
 *                    (`03:30` erased → `04:30` on the new clock).
 * - `Earlier`      — a repeated time resolves to its FIRST occurrence.
 * - `Later`        — a repeated time resolves to its SECOND occurrence.
 *
 * `ShiftForward` answers only a gap and `Earlier`/`Later` only a repeat; the
 * other case still fails, exactly as the kernel's `ZonedDateTime.fromParts`.
 */
export const DstResolution = {
  Reject: 'reject',
  ShiftForward: 'shiftForward',
  Earlier: 'earlier',
  Later: 'later',
} as const;
export type DstResolution = (typeof DstResolution)[keyof typeof DstResolution];

/** What an instant reads as on a zone's wall clock. */
export type WallClock = {
  readonly dayKey: DayKey;
  /** 0..1439. */
  readonly minuteOfDay: number;
  /** 0..59. */
  readonly second: number;
  /** The UTC offset in force at the instant (`+180` for Sofia in summer). */
  readonly offsetMinutes: number;
  readonly weekday: Weekday;
};

/* ── The formatter cache — the one module state (§9 D5) ─────────────────── */

/**
 * Keyed ONLY by the engine's canonical zone id (`resolvedOptions().timeZone`),
 * so the map holds at most one entry per zone the engine knows — bounded,
 * whatever spellings callers send. A non-canonical spelling (`europe/sofia`,
 * a link such as `Etc/UTC` → `UTC`) is answered with the canonical entry but
 * never stored under its own key, and an invalid zone is never stored at
 * all: both cost one construction per call, which is why untrusted zone
 * strings go through {@link ZonedTimeSystem.checkZone} once, at the edge,
 * and only its canonical answer is stored and passed on.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's cached formatter, or `null` when `zone` is not an IANA zone. */
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone);
  if (cached !== undefined) return cached;
  if (!IANA_ZONE_SHAPE.test(zone)) return null;
  let built: Intl.DateTimeFormat;
  try {
    built = new Intl.DateTimeFormat('en-US-u-nu-latn', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return null;
  }
  const canonical = built.resolvedOptions().timeZone;
  const existing = formatters.get(canonical);
  if (existing !== undefined) return existing;
  formatters.set(canonical, built);
  return built;
}

/** The engine's canonical id of the formatter's zone (`europe/sofia` → `Europe/Sofia`). */
function canonicalZoneOf(formatter: Intl.DateTimeFormat): string {
  return formatter.resolvedOptions().timeZone;
}

/* ── Instant ↔ local milliseconds (the only Intl reads) ─────────────────── */

/**
 * The wall clock `epochMs` reads in the formatter's zone, expressed as
 * milliseconds as if that wall clock were UTC ("local ms"). `local − epochMs`
 * is the offset in force at the instant.
 */
function localMsAt(epochMs: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(epochMs);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as Intl.DateTimeFormatPart;
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'second') second = Number(part.value);
  }
  const msOfSecond =
    epochMs - Math.floor(epochMs / MS_PER_SECOND) * MS_PER_SECOND;
  return (
    DayKey.epochDayOf(year, month, day) * MS_PER_DAY +
    // `% 24` guards the engines that still print midnight as `24` despite h23.
    (hour % 24) * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    msOfSecond
  );
}

function offsetMsAt(epochMs: number, formatter: Intl.DateTimeFormat): number {
  return localMsAt(epochMs, formatter) - epochMs;
}

function isSupportedInstant(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_INSTANT_MS && ms <= MAX_INSTANT_MS;
}

/** How a local wall clock maps to instants. */
const LocalFit = { Exact: 'exact', Gap: 'gap', Overlap: 'overlap' } as const;
type LocalFit = (typeof LocalFit)[keyof typeof LocalFit];

type LocalResolution = {
  readonly fit: LocalFit;
  /** Exact: the instant. Overlap: the first occurrence. Gap: the instant read with the offset AFTER the gap (before the transition). */
  readonly earlierMs: number;
  /** Exact: the instant. Overlap: the second occurrence. Gap: the instant read with the offset BEFORE the gap (one offset later — "shift forward"). */
  readonly laterMs: number;
};

/**
 * Every instant whose wall clock reads `localMs`. The candidate offsets are
 * the ones in force a day before and a day after (zones change offset at
 * most once in any such window); a candidate is real when the zone, asked
 * at that instant, agrees with the offset it was built from.
 */
function resolveLocal(
  localMs: number,
  formatter: Intl.DateTimeFormat,
): LocalResolution {
  const offsetBefore = offsetMsAt(localMs - MS_PER_DAY, formatter);
  const offsetAfter = offsetMsAt(localMs + MS_PER_DAY, formatter);
  const withBefore = localMs - offsetBefore;
  const withAfter = localMs - offsetAfter;
  const beforeFits = offsetMsAt(withBefore, formatter) === offsetBefore;
  const afterFits =
    withAfter === withBefore
      ? beforeFits
      : offsetMsAt(withAfter, formatter) === offsetAfter;
  if (beforeFits && afterFits && withBefore !== withAfter) {
    return {
      fit: LocalFit.Overlap,
      earlierMs: Math.min(withBefore, withAfter),
      laterMs: Math.max(withBefore, withAfter),
    };
  }
  if (beforeFits) {
    return { fit: LocalFit.Exact, earlierMs: withBefore, laterMs: withBefore };
  }
  if (afterFits) {
    return { fit: LocalFit.Exact, earlierMs: withAfter, laterMs: withAfter };
  }
  return { fit: LocalFit.Gap, earlierMs: withAfter, laterMs: withBefore };
}

/**
 * The first whole minute after `loMs` at which the offset differs from the
 * one in force at `loMs` — bisection, given that it differs at `hiMs`.
 * About eleven formatter reads for a day; run only on transition days.
 */
function firstOffsetChangeMs(
  loMs: number,
  hiMs: number,
  formatter: Intl.DateTimeFormat,
): number {
  const loOffset = offsetMsAt(loMs, formatter);
  let lo = 0;
  let hi = Math.ceil((hiMs - loMs) / MS_PER_MINUTE);
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (offsetMsAt(loMs + mid * MS_PER_MINUTE, formatter) === loOffset)
      lo = mid;
    else hi = mid;
  }
  return loMs + hi * MS_PER_MINUTE;
}

/**
 * The first instant of a local day: its midnight, the FIRST midnight when a
 * fall-back repeats it, or — when a spring-forward erases midnight itself
 * (America/Sao_Paulo 2018-11-04, 00:00 → 01:00) — the transition instant.
 */
function firstInstantOfLocalDay(
  epochDay: number,
  formatter: Intl.DateTimeFormat,
): number {
  const resolution = resolveLocal(epochDay * MS_PER_DAY, formatter);
  return resolution.fit === LocalFit.Gap
    ? firstOffsetChangeMs(resolution.earlierMs, resolution.laterMs, formatter)
    : resolution.earlierMs;
}

/**
 * Can a table cover `firstEpochDay … lastEpochDay`? Not inverted, at most
 * {@link MAX_TABLE_DAYS} long, and inside the instants this system reads
 * (whose two-day margin covers the ±1-day probes of {@link resolveLocal}) —
 * so year 0000, whose instants the formatter prints without their era, never
 * reaches it.
 */
function isTableSpan(firstEpochDay: number, lastEpochDay: number): boolean {
  return (
    firstEpochDay <= lastEpochDay &&
    lastEpochDay - firstEpochDay < MAX_TABLE_DAYS &&
    firstEpochDay * MS_PER_DAY >= MIN_INSTANT_MS &&
    (lastEpochDay + 1) * MS_PER_DAY <= MAX_INSTANT_MS
  );
}

/**
 * Rows for the local days `firstEpochDay … lastEpochDay`, inclusive — or no
 * rows at all (fail closed) when the span is not a table span, or when the
 * zone's offset on any of those days is not a whole number of minutes (local
 * mean time before a zone adopted standard time — Sofia before 1894,
 * Monrovia until 1972): every row field is an integer of minutes, and a
 * table that cannot honour that is refused rather than rounded.
 */
function buildTable(
  formatter: Intl.DateTimeFormat,
  firstEpochDay: number,
  lastEpochDay: number,
): readonly DayOffset[] {
  const days: DayOffset[] = [];
  if (!isTableSpan(firstEpochDay, lastEpochDay)) return days;
  let startMs = firstInstantOfLocalDay(firstEpochDay, formatter);
  let startOffsetMs = offsetMsAt(startMs, formatter);
  for (let epochDay = firstEpochDay; epochDay <= lastEpochDay; epochDay++) {
    const midnightLocalMs = epochDay * MS_PER_DAY;
    // Ordinary day: the next midnight is 24 h later on the same offset —
    // one formatter read confirms it. Otherwise resolve it properly.
    let nextStartMs = midnightLocalMs + MS_PER_DAY - startOffsetMs;
    let nextOffsetMs = offsetMsAt(nextStartMs, formatter);
    if (nextOffsetMs !== startOffsetMs) {
      nextStartMs = firstInstantOfLocalDay(epochDay + 1, formatter);
      nextOffsetMs = offsetMsAt(nextStartMs, formatter);
    }
    // The clock that reads 00:00 at `startMs` — the old one when the
    // transition erased midnight itself.
    const midnightOffsetMs = midnightLocalMs - startMs;
    const deltaMinutes =
      MINUTES_PER_DAY - (nextStartMs - startMs) / MS_PER_MINUTE;
    if (
      midnightOffsetMs % MS_PER_MINUTE !== 0 ||
      !Number.isInteger(deltaMinutes)
    ) {
      return [];
    }
    let transitionAtMinutes: number | null = null;
    if (deltaMinutes !== 0) {
      transitionAtMinutes =
        midnightOffsetMs !== startOffsetMs
          ? 0
          : (firstOffsetChangeMs(startMs, nextStartMs, formatter) - startMs) /
            MS_PER_MINUTE;
    }
    days.push({
      dayKey: DayKey.fromEpochDay(epochDay),
      dayStartMs: startMs,
      offsetMinutes: midnightOffsetMs / MS_PER_MINUTE,
      transitionAtMinutes,
      transitionDeltaMinutes: deltaMinutes,
      weekday: Weekday.ofEpochDay(epochDay),
    });
    startMs = nextStartMs;
    startOffsetMs = nextOffsetMs;
  }
  return days;
}

/** The fields of an accepted ISO-8601 string, by position. */
type IsoFields = {
  readonly datePart: string;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
  /** `null` when the string names no offset (a wall clock in the zone). */
  readonly offsetMs: number | null;
};

/**
 * `YYYY-MM-DD`, optionally followed by `THH:mm`, `:ss`, a fraction of 1–9
 * digits after `.` or `,` and an offset (`Z`, `±HH:mm`, `±HHmm`, `±HH`) —
 * the forms the legacy `ZonedDateTime.fromISO` (Luxon) read, so a stored
 * `*Iso` field written by Python (microseconds), Postgres (`+03`) or a
 * comma-decimal tool still parses. The fraction is TRUNCATED to the
 * millisecond, as Luxon truncated it. Read by position with flat patterns,
 * so no backtracking regex sees untrusted input. `null` when the shape is
 * not one of those; ranges (hour ≤ 23, a real date) are the caller's check.
 */
function isoFieldsOf(iso: string): IsoFields | null {
  const datePart = iso.slice(0, 10);
  if (!DATE_SHAPE.test(datePart)) return null;
  if (iso.length === 10) {
    return {
      datePart,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
      offsetMs: null,
    };
  }
  if (iso[10] !== 'T') return null;
  let time = iso.slice(11);
  let offsetMs: number | null = null;
  if (time.endsWith('Z')) {
    offsetMs = 0;
    time = time.slice(0, -1);
  } else {
    const signAt = Math.max(time.indexOf('+'), time.indexOf('-'));
    if (signAt >= 0) {
      const designator = time.slice(signAt);
      if (
        !OFFSET_EXTENDED.test(designator) &&
        !OFFSET_BASIC.test(designator) &&
        !OFFSET_HOURS.test(designator)
      ) {
        return null;
      }
      const digits = designator.replace(':', '');
      const hours = Number(digits.slice(1, 3));
      const minutes = digits.length > 3 ? Number(digits.slice(3, 5)) : 0;
      if (hours > 23 || minutes > 59) return null;
      offsetMs =
        (designator.startsWith('-') ? -1 : 1) *
        (hours * MS_PER_HOUR + minutes * MS_PER_MINUTE);
      time = time.slice(0, signAt);
    }
  }
  if (
    time[2] !== ':' ||
    !TWO_DIGITS.test(time.slice(0, 2)) ||
    !TWO_DIGITS.test(time.slice(3, 5))
  ) {
    return null;
  }
  let second = 0;
  let millisecond = 0;
  if (time.length > 5) {
    if (time[5] !== ':' || !TWO_DIGITS.test(time.slice(6, 8))) return null;
    second = Number(time.slice(6, 8));
    if (time.length > 8) {
      const fraction = time.slice(9);
      if (
        (time[8] !== '.' && time[8] !== ',') ||
        !FRACTION_DIGITS.test(fraction)
      ) {
        return null;
      }
      millisecond = Number(fraction.slice(0, 3).padEnd(3, '0'));
    }
  }
  return {
    datePart,
    hour: Number(time.slice(0, 2)),
    minute: Number(time.slice(3, 5)),
    second,
    millisecond,
    offsetMs,
  };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `2026-03-29T03:30` — the rawValue of a wall-clock error. */
function describeWallClock(dayKey: string, wallMinutes: number): string {
  return `${dayKey}T${pad2(Math.floor(wallMinutes / 60))}:${pad2(wallMinutes % 60)}`;
}

/** Wall clock → instant, with the caller's explicit DST decision. */
function resolveAs(
  localMs: number,
  zone: string,
  formatter: Intl.DateTimeFormat,
  resolution: DstResolution,
  rawValue: string,
): Result<ZonedInstant, TimeError> {
  const local = resolveLocal(localMs, formatter);
  if (local.fit === LocalFit.Exact) {
    return Result.ok(ZonedInstant.of(local.earlierMs, zone));
  }
  if (local.fit === LocalFit.Gap) {
    return resolution === DstResolution.ShiftForward
      ? Result.ok(ZonedInstant.of(local.laterMs, zone))
      : Result.err(TimeError.nonexistentLocalTime(rawValue, zone));
  }
  if (resolution === DstResolution.Earlier) {
    return Result.ok(ZonedInstant.of(local.earlierMs, zone));
  }
  if (resolution === DstResolution.Later) {
    return Result.ok(ZonedInstant.of(local.laterMs, zone));
  }
  return Result.err(TimeError.ambiguousLocalTime(rawValue, zone));
}

export const ZonedTimeSystem = {
  /* ── The edge: raw input → Result ─────────────────────────────────────── */

  /** An IANA zone this runtime knows (`Europe/Sofia`, `UTC`, `Asia/Kolkata`). */
  isValidZone(zone: string): boolean {
    return formatterFor(zone) !== null;
  },

  /**
   * The edge guard for a raw zone string. The zone comes back as the
   * engine's CANONICAL id (`europe/sofia` → `Europe/Sofia`, `Etc/UTC` →
   * `UTC`), the spelling to store: string equality between stored zones
   * holds, and the formatter cache is keyed by it. An offset id (`+03:00`)
   * is refused. Engines may canonicalise a link differently (Node 22's ICU
   * answers `Asia/Calcutta` for `Asia/Kolkata`); both spellings name the
   * same zone everywhere, so a zone is canonicalised once, where it is
   * stored, and read back verbatim.
   */
  checkZone(zone: string): Result<string, TimeError> {
    const formatter = formatterFor(zone);
    return formatter === null
      ? Result.err(TimeError.invalidTimeZone(zone))
      : Result.ok(canonicalZoneOf(formatter));
  },

  /**
   * What `epochMs` reads as on the zone's wall clock — the day key, the
   * minute of the day and the offset in force. Read on the zone's clock, not
   * the runtime's: 22:30 UTC on a summer evening is 01:30 the next morning
   * in Sofia.
   */
  wallClockOf(epochMs: number, zone: string): Result<WallClock, TimeError> {
    const formatter = formatterFor(zone);
    if (formatter === null) return Result.err(TimeError.invalidTimeZone(zone));
    if (!isSupportedInstant(epochMs)) {
      return Result.err(
        TimeError.invalidDateTime(
          String(epochMs),
          DateTimeInvalidReason.OutOfRange,
        ),
      );
    }
    const localMs = localMsAt(epochMs, formatter);
    const epochDay = Math.floor(localMs / MS_PER_DAY);
    const msOfDay = localMs - epochDay * MS_PER_DAY;
    return Result.ok({
      dayKey: DayKey.fromEpochDay(epochDay),
      minuteOfDay: Math.floor(msOfDay / MS_PER_MINUTE),
      second: Math.floor((msOfDay % MS_PER_MINUTE) / MS_PER_SECOND),
      offsetMinutes: (localMs - epochMs) / MS_PER_MINUTE,
      weekday: Weekday.ofEpochDay(epochDay),
    });
  },

  /**
   * `epochMs` as an ISO-8601 instant on the zone's wall clock WITH the
   * offset in force — `2026-10-10T14:00:00.000+03:00` in Sofia — the
   * spelling `ZonedDateTime.toISO()` gave today's `*Iso` wire params in the
   * shop's zone (milliseconds always, `±HH:MM` always; a zero offset prints
   * `+00:00`). Read on the zone's clock, so the string names the same instant
   * `parseIso` reads back.
   */
  isoOf(epochMs: number, zone: string): Result<string, TimeError> {
    const clock = ZonedTimeSystem.wallClockOf(epochMs, zone);
    if (!clock.ok) return clock;
    const { dayKey, minuteOfDay, second, offsetMinutes } = clock.value;
    const millisecond =
      ((epochMs % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND;
    const offset = Math.abs(offsetMinutes);
    const sign = offsetMinutes < 0 ? '-' : '+';
    return Result.ok(
      `${describeWallClock(dayKey, minuteOfDay)}:${pad2(second)}.` +
        `${String(millisecond).padStart(3, '0')}` +
        `${sign}${pad2(Math.floor(offset / 60))}:${pad2(offset % 60)}`,
    );
  },

  /**
   * A wall clock on a calendar day → the instant — the door every typed time
   * and every "Monday 09:00" comes through at the edge. DST is decided here,
   * explicitly (Europe/Sofia):
   *
   * | input | `Reject` | another resolution |
   * |---|---|---|
   * | `2026-03-29 03:30` (erased) | `time.nonexistent_local_time` | `ShiftForward` → 04:30 +03:00 |
   * | `2026-10-25 03:30` (repeated) | `time.ambiguous_local_time` | `Earlier` → +03:00, `Later` → +02:00 |
   *
   * The instant carries the zone's canonical id ({@link checkZone}).
   */
  resolve(
    dayKey: DayKey,
    wallMinutes: number,
    zone: string,
    resolution: DstResolution,
  ): Result<ZonedInstant, TimeError> {
    const formatter = formatterFor(zone);
    if (formatter === null) return Result.err(TimeError.invalidTimeZone(zone));
    const rawValue = describeWallClock(dayKey, wallMinutes);
    const localMs = DayKey.isValid(dayKey)
      ? DayKey.toEpochDay(dayKey) * MS_PER_DAY + wallMinutes * MS_PER_MINUTE
      : Number.NaN;
    if (
      !Number.isInteger(wallMinutes) ||
      wallMinutes < 0 ||
      wallMinutes >= MINUTES_PER_DAY ||
      !isSupportedInstant(localMs)
    ) {
      return Result.err(
        TimeError.invalidDateTime(rawValue, DateTimeInvalidReason.OutOfRange),
      );
    }
    return resolveAs(
      localMs,
      canonicalZoneOf(formatter),
      formatter,
      resolution,
      rawValue,
    );
  },

  /**
   * An ISO-8601 string → the instant, read in `zone`. With an offset (`Z`,
   * `+03:00`) the string IS an instant and only names it; without one it is
   * a wall clock in `zone` (a date alone means its midnight) and goes
   * through the same explicit DST decision as {@link resolve}. The instant
   * carries the zone's canonical id ({@link checkZone}).
   */
  parseIso(
    iso: string,
    zone: string,
    resolution: DstResolution,
  ): Result<ZonedInstant, TimeError> {
    const formatter = formatterFor(zone);
    if (formatter === null) return Result.err(TimeError.invalidTimeZone(zone));
    const fields = isoFieldsOf(iso);
    if (fields === null) {
      return Result.err(
        TimeError.invalidDateTime(iso, DateTimeInvalidReason.Unparsable),
      );
    }
    const localMs = DayKey.isValid(fields.datePart)
      ? DayKey.toEpochDay(DayKey.of(fields.datePart)) * MS_PER_DAY +
        fields.hour * MS_PER_HOUR +
        fields.minute * MS_PER_MINUTE +
        fields.second * MS_PER_SECOND +
        fields.millisecond
      : Number.NaN;
    if (
      fields.hour > 23 ||
      fields.minute > 59 ||
      fields.second > 59 ||
      !isSupportedInstant(localMs)
    ) {
      return Result.err(
        TimeError.invalidDateTime(iso, DateTimeInvalidReason.OutOfRange),
      );
    }
    const canonical = canonicalZoneOf(formatter);
    return fields.offsetMs === null
      ? resolveAs(localMs, canonical, formatter, resolution, iso)
      : Result.ok(ZonedInstant.of(localMs - fields.offsetMs, canonical));
  },

  /* ── The table: the only reads of a zone's offsets ─────────────────────── */

  /**
   * One {@link DayOffset} row per local day `fromDayKey … toDayKey`
   * (inclusive), sorted. The only function besides {@link dayTableAround}
   * that fills `offsetMinutes` / `transitionAtMinutes` /
   * `transitionDeltaMinutes`. An ordinary day costs one formatter read; a
   * transition day adds a bisection to its transition minute.
   *
   * Empty — failing closed: no day, no windows, no availability — for a
   * zone the runtime does not know (the zone was checked at the edge,
   * {@link checkZone}), an inverted range, a span longer than
   * `MAX_TABLE_DAYS` (ten years) or outside the years 0001–9999, and a span
   * on which the zone's offset is not a whole number of minutes (local mean
   * time, before the zone adopted standard time).
   */
  dayTable(
    zone: string,
    fromDayKey: DayKey,
    toDayKey: DayKey,
  ): readonly DayOffset[] {
    const formatter = formatterFor(zone);
    if (formatter === null) return [];
    return buildTable(
      formatter,
      DayKey.toEpochDay(fromDayKey),
      DayKey.toEpochDay(toDayKey),
    );
  },

  /**
   * The table around two instants: every local day from the one holding
   * `fromMs` to the one holding `toMs`, widened by `padDays` on each side.
   * The call a pipeline or store makes once per request — every entry point
   * starts from an instant, and nothing outside this file may turn an
   * instant into the first day key a table needs. Empty in the cases
   * {@link dayTable} is, the padded span included — so instants taken from a
   * request can never make it spin.
   */
  dayTableAround(
    zone: string,
    fromMs: number,
    toMs: number,
    padDays: number,
  ): readonly DayOffset[] {
    const formatter = formatterFor(zone);
    if (
      formatter === null ||
      !isSupportedInstant(fromMs) ||
      !isSupportedInstant(toMs)
    ) {
      return [];
    }
    const pad = padDays > 0 ? Math.floor(padDays) : 0;
    return buildTable(
      formatter,
      Math.floor(localMsAt(fromMs, formatter) / MS_PER_DAY) - pad,
      Math.floor(localMsAt(toMs, formatter) / MS_PER_DAY) + pad,
    );
  },

  /* ── Over the table: subtraction and binary search ────────────────────── */

  /** The local day an instant falls on, or `null` outside the table. */
  dayKeyOf(epochMs: number, days: readonly DayOffset[]): DayKey | null {
    const index = DayOffset.indexAt(epochMs, days);
    return index < 0 ? null : (days[index] as DayOffset).dayKey;
  },

  /** Local midnight of `dayKey` (the grid origin, never the epoch), or `null`. */
  startOfDayMs(dayKey: DayKey, days: readonly DayOffset[]): number | null {
    const day = DayOffset.find(dayKey, days);
    return day === null ? null : day.dayStartMs;
  },

  /**
   * The EXCLUSIVE end of `dayKey` — the next local midnight — or `null`.
   * 23 or 25 hours after the start on a transition day, never assumed 24.
   */
  startOfNextDayMs(dayKey: DayKey, days: readonly DayOffset[]): number | null {
    const day = DayOffset.find(dayKey, days);
    return day === null ? null : DayOffset.endMs(day);
  },

  /**
   * A wall-clock minute of the row's day → the instant. The two-branch
   * subtraction over the transition fields: before `transitionAtMinutes`,
   * `dayStartMs + wall·60 000`; at or after it, the same minus
   * `transitionDeltaMinutes·60 000`. A wall minute inside an erased segment
   * resolves FORWARD to the transition instant (the first minute that
   * exists), so the mapping is monotone and a window spanning the switch
   * keeps its real length; a repeated wall minute resolves to its first
   * occurrence. `1440` is the next day's start. Total — the strict, `Result`
   * form for raw input is {@link resolve}.
   */
  instantOf(day: DayOffset, wallMinutes: number): number {
    const at = day.transitionAtMinutes;
    if (at === null || wallMinutes < at) {
      return day.dayStartMs + wallMinutes * MS_PER_MINUTE;
    }
    const elapsed = wallMinutes - day.transitionDeltaMinutes;
    return day.dayStartMs + (elapsed > at ? elapsed : at) * MS_PER_MINUTE;
  },

  /**
   * An instant → the wall-clock minute of the row's day it falls in (the
   * inverse of {@link instantOf}): elapsed minutes before the transition,
   * elapsed plus `transitionDeltaMinutes` at or after it — so 04:00 follows
   * 02:59 on the Sofia spring day, and the second 03:00 follows 03:59 in
   * autumn. Linear outside the day (a visit running past midnight ends past
   * 1440 on its start day's axis).
   */
  minuteOfDay(epochMs: number, day: DayOffset): number {
    const elapsed = Math.floor((epochMs - day.dayStartMs) / MS_PER_MINUTE);
    const at = day.transitionAtMinutes;
    return at === null || elapsed < at
      ? elapsed
      : elapsed + day.transitionDeltaMinutes;
  },

  /* ── Day keys: civil integer arithmetic (no zone, no DST) ─────────────── */

  /**
   * `n` days away (negative moves back). Civil arithmetic: a day key is a
   * calendar date, one step per day whatever the zone's clocks did.
   */
  addDays(dayKey: DayKey, n: number): DayKey {
    return DayKey.fromEpochDay(DayKey.toEpochDay(dayKey) + n);
  },

  /** Whole calendar days from `from` to `to`, negative when `to` comes first. */
  daysBetween(from: DayKey, to: DayKey): number {
    return DayKey.toEpochDay(to) - DayKey.toEpochDay(from);
  },

  /** Every day of the range, both ends included; empty when inverted. */
  rangeKeys(range: DateRange): readonly DayKey[] {
    const keys: DayKey[] = [];
    const last = DayKey.toEpochDay(range.toDayKey);
    for (let day = DayKey.toEpochDay(range.fromDayKey); day <= last; day++) {
      keys.push(DayKey.fromEpochDay(day));
    }
    return keys;
  },

  /** ISO weekday of a day key — the same value the table row carries. */
  weekdayOf(dayKey: DayKey): Weekday {
    return Weekday.ofEpochDay(DayKey.toEpochDay(dayKey));
  },

  /**
   * `n` calendar months away, the day clamped to the target month's length
   * (`2026-01-31` + 1 month → `2026-02-28`); negative moves back.
   */
  addMonths(dayKey: DayKey, n: number): DayKey {
    const totalMonths =
      Number(dayKey.slice(0, 4)) * 12 + Number(dayKey.slice(5, 7)) - 1 + n;
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths - year * 12 + 1;
    const day = Math.min(
      Number(dayKey.slice(8, 10)),
      DayKey.daysInMonth(year, month),
    );
    return DayKey.fromEpochDay(DayKey.epochDayOf(year, month, day));
  },

  /** The 1st of the day's month. */
  startOfMonth(dayKey: DayKey): DayKey {
    return DayKey.of(`${dayKey.slice(0, 8)}01`);
  },

  /**
   * Whole calendar years from `from` to `to`, counting a year only once its
   * anniversary has come round — an age from a birth date. A 29 February
   * anniversary falls on 28 February in a common year: the legacy
   * `ZonedDateTime.yearsUntil` (Luxon's clamped year diff) completed the
   * year then, and so does a Bulgarian civil year-term with no matching day
   * (ZZD art. 72(2): it ends on the month's last day). Negative (truncated
   * toward zero) when `to` comes first.
   */
  wholeYearsBetween(from: DayKey, to: DayKey): number {
    if (to < from) return -ZonedTimeSystem.wholeYearsBetween(to, from);
    const toYear = Number(to.slice(0, 4));
    const years = toYear - Number(from.slice(0, 4));
    const anniversary =
      from.slice(5) === LEAP_DAY && !DayKey.isLeapYear(toYear)
        ? LAST_OF_COMMON_FEBRUARY
        : from.slice(5);
    return to.slice(5) < anniversary ? years - 1 : years;
  },
} as const;
