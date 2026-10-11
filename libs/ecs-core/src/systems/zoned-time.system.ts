import {
  Result,
  DateTimeInvalidReason,
  TimeError,
  defect,
  LocalDate,
  MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { ShopNow, WallTime } from '@core/components';

/**
 * ZonedTimeSystem — the ONE file in the repo that does zone math (§9 D5,
 * Law 7), called ONLY at the ingestion boundary (a pipeline or a callable
 * edge) with the shop location's `timeZone`. Every other system is
 * time-zone-blind: it computes on `LocalDate` + `MinuteOfDay` and receives
 * "now" as a {@link ShopNow}.
 *
 * Native `Intl` only, no date library, no `Date`: the wall clock of an
 * instant is `Intl.DateTimeFormat(…, { timeZone, hourCycle: 'h23', … })
 * .formatToParts`, the offset at an instant is that wall clock read as UTC
 * minus the instant. Each zone's formatter is built once and kept in the
 * module-level cache below — the one sanctioned module state in any system
 * (`ecs-systems.md`): construction is expensive, the output is pure.
 *
 * **The ingestion API (flatten-spec §2.1):** `checkZone` (the `TimeZone`
 * smart constructor, F-2), `toUtc` (shop wall clock → instant), `toLocal`
 * (instant → shop wall clock), `shopNow`, `startOfLocalDay`,
 * `parseOffsetIso` and `toIso`. **DST, locked 2026-10-10:** a wall-clock time
 * inside a spring-forward gap is the error `DST_GAP_INVALID_TIME`; a time the
 * fall-back repeats resolves deterministically to the EARLIER offset (its
 * first occurrence).
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

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TWO_DIGITS = /^\d{2}$/;
/** 1–9 fraction digits (milli- to nanoseconds); read to the millisecond. */
const FRACTION_DIGITS = /^\d{1,9}$/;
/** `±HH:mm`, `±HHmm` or `±HH` — three flat patterns, no nested quantifier. */
const OFFSET_EXTENDED = /^[+-]\d{2}:\d{2}$/;
const OFFSET_BASIC = /^[+-]\d{4}$/;
const OFFSET_HOURS = /^[+-]\d{2}$/;

/**
 * An IANA zone name starts with a letter (`Europe/Sofia`, `UTC`,
 * `Etc/GMT+3`). Offset ids (`+03:00`) are refused: Node 22 accepts them,
 * not every browser engine does, and a stored zone must mean the same thing
 * on the server and in the SPA.
 */
const IANA_ZONE_SHAPE = /^[A-Za-z]/;

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
    LocalDate.epochDayOf(year, month, day) * MS_PER_DAY +
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
 * Is the local day `epochDay` inside the instants this system reads (whose
 * two-day margin covers the ±1-day probes of {@link resolveLocal})? So year
 * 0000, whose instants the formatter prints without their era, never
 * reaches it.
 */
function isReadableDay(epochDay: number): boolean {
  return (
    epochDay * MS_PER_DAY >= MIN_INSTANT_MS &&
    (epochDay + 1) * MS_PER_DAY <= MAX_INSTANT_MS
  );
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

/** A resolved local instant as a `UtcEpochMs`, or the out-of-range refusal. */
function instantResult(
  epochMs: number,
  localDate: LocalDate,
  minute: MinuteOfDay,
): Result<UtcEpochMs, TimeError> {
  const instant = UtcEpochMs.of(epochMs);
  return instant.ok
    ? instant
    : Result.err(
        TimeError.invalidDateTime(
          describeWallClock(localDate, minute),
          DateTimeInvalidReason.OutOfRange,
        ),
      );
}

/**
 * `epochMs` spelt as ISO-8601 on the wall clock `localMs` with the offset
 * `localMs − epochMs` — the legacy `ZonedDateTime.toISO()` form
 * (`2026-10-10T14:00:00.000+03:00`).
 */
function isoAt(epochMs: number, localMs: number): string {
  const epochDay = Math.floor(localMs / MS_PER_DAY);
  const msOfDay = localMs - epochDay * MS_PER_DAY;
  const minuteOfDay = Math.floor(msOfDay / MS_PER_MINUTE);
  const second = Math.floor((msOfDay % MS_PER_MINUTE) / MS_PER_SECOND);
  const millisecond =
    ((epochMs % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND;
  const offsetMinutes = (localMs - epochMs) / MS_PER_MINUTE;
  const offset = Math.abs(offsetMinutes);
  const sign = offsetMinutes < 0 ? '-' : '+';
  return (
    `${describeWallClock(LocalDate.fromEpochDay(epochDay), minuteOfDay)}:${pad2(second)}.` +
    `${String(millisecond).padStart(3, '0')}` +
    `${sign}${pad2(Math.floor(offset / 60))}:${pad2(offset % 60)}`
  );
}

export const ZonedTimeSystem = {
  /* ── The ingestion API (flatten-spec §2.1) ───────────────────────────── */

  /**
   * The `TimeZone` smart constructor (decision F-2) — a raw zone string
   * accepted by `Intl.DateTimeFormat`, answered as the engine's CANONICAL id
   * (`europe/sofia` → `Europe/Sofia`, `Etc/UTC` → `UTC`), the spelling to
   * store on `ShopLocation.timeZone`. An offset id (`+03:00`) is refused:
   * Node 22 accepts them, not every browser engine does. Engines may
   * canonicalise a link differently (Node 22's ICU answers `Asia/Calcutta`
   * for `Asia/Kolkata`); both name the same zone everywhere, so a zone is
   * canonicalised once, where it is stored, and read back verbatim.
   */
  checkZone(raw: string): Result<TimeZone, TimeError> {
    // Fast path: the cache is keyed by CANONICAL ids only, so a hit is a
    // zone already checked and canonical — no `resolvedOptions()` per call
    // (the shims check a zone per row, per seat).
    if (formatters.has(raw)) return Result.ok(raw as TimeZone);
    const formatter = formatterFor(raw);
    return formatter === null
      ? Result.err(TimeError.invalidTimeZone(raw))
      : Result.ok(canonicalZoneOf(formatter) as TimeZone);
  },

  /**
   * Shop wall clock → the instant — the one conversion a booking, a block or
   * a move makes at ingestion (Law 7.3). DST is decided here, locked
   * 2026-10-10 (Europe/Sofia):
   *
   * | input | answer |
   * |---|---|
   * | `2026-03-29 03:30` (inside the spring-forward gap) | `DST_GAP_INVALID_TIME` |
   * | `2026-10-25 03:30` (repeated by the fall-back) | the EARLIER offset: `03:30+03:00` |
   *
   * Refused as `TIME_INVALID_TIME_ZONE` for a zone the runtime does not know
   * and `TIME_INVALID_DATE_TIME` (`OUT_OF_RANGE`) within two days of the
   * 0001–9999 window's edges.
   */
  toUtc(
    localDate: LocalDate,
    minute: MinuteOfDay,
    timeZone: TimeZone,
  ): Result<UtcEpochMs, TimeError> {
    const formatter = formatterFor(timeZone);
    if (formatter === null) {
      return Result.err(TimeError.invalidTimeZone(timeZone));
    }
    const localMs =
      LocalDate.toEpochDay(localDate) * MS_PER_DAY + minute * MS_PER_MINUTE;
    if (
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute >= MINUTES_PER_DAY ||
      !isSupportedInstant(localMs)
    ) {
      return Result.err(
        TimeError.invalidDateTime(
          describeWallClock(localDate, minute),
          DateTimeInvalidReason.OutOfRange,
        ),
      );
    }
    const local = resolveLocal(localMs, formatter);
    if (local.fit === LocalFit.Gap) {
      return Result.err(TimeError.dstGap(localDate, minute, timeZone));
    }
    // Exact: the one instant. Overlap: the first occurrence — the earlier offset.
    return instantResult(local.earlierMs, localDate, minute);
  },

  /**
   * The instant → the shop wall clock it reads in `timeZone` — total: every
   * instant has one. Read on the zone's clock, not the runtime's: 22:30 UTC
   * on a summer evening is `{ localDate: next day, minute: 90 }` in Sofia.
   */
  toLocal(utcEpochMs: UtcEpochMs, timeZone: TimeZone): WallTime {
    const formatter = formatterFor(timeZone);
    if (formatter === null) return defect(`unknown TimeZone ${timeZone}`);
    const localMs = localMsAt(utcEpochMs, formatter);
    const epochDay = Math.floor(localMs / MS_PER_DAY);
    const minute = MinuteOfDay.of(
      Math.floor((localMs - epochDay * MS_PER_DAY) / MS_PER_MINUTE),
    );
    if (!minute.ok) return defect(`minute of ${utcEpochMs} out of range`);
    return WallTime.of(LocalDate.fromEpochDay(epochDay), minute.value);
  },

  /**
   * "Now" for systems (Law 7.3, owner-locked) — derived ONCE per request at
   * the boundary from the clock port's instant and the location's zone:
   * `localDate` + `currentMinute` for every comparison, `utcEpochMs` (the
   * same instant) only to stamp lifecycle instants.
   */
  shopNow(utcEpochMs: UtcEpochMs, timeZone: TimeZone): ShopNow {
    const wall = ZonedTimeSystem.toLocal(utcEpochMs, timeZone);
    return ShopNow.of(wall.localDate, wall.minute, utcEpochMs);
  },

  /**
   * The first instant of a shop day: its midnight, the FIRST midnight when a
   * fall-back repeats it, or — when a spring-forward erases midnight itself
   * (America/Sao_Paulo 2018-11-04, 00:00 → 01:00) — the gap's end. For
   * day-boundary lifecycle comparisons (flatten-spec T3) and the
   * `utcEpochMs` of a busy day, an exception or a waitlist request (F-28).
   * Total for every day except the first and last two of the 0001–9999
   * window (a programmer defect).
   */
  startOfLocalDay(localDate: LocalDate, timeZone: TimeZone): UtcEpochMs {
    const formatter = formatterFor(timeZone);
    if (formatter === null) return defect(`unknown TimeZone ${timeZone}`);
    const epochDay = LocalDate.toEpochDay(localDate);
    if (!isReadableDay(epochDay)) {
      return defect(`${localDate} is outside the readable window`);
    }
    const start = UtcEpochMs.of(firstInstantOfLocalDay(epochDay, formatter));
    return start.ok ? start.value : defect(`start of ${localDate} unreadable`);
  },

  /**
   * ISO-8601 WITH an explicit offset (`Z`, `±HH:mm`, `±HHmm`, `±HH`) → the
   * instant — legacy stored and wire strings in the shims, and specs. The
   * string names an instant on its own, so no zone is consulted. No offset →
   * `TIME_INVALID_DATE_TIME` (`UNPARSABLE`): a bare wall clock is ingested
   * with {@link toUtc} and the location's zone, never guessed here. Accepts
   * the forms the legacy `ZonedDateTime.fromISO` read (1–9 fraction digits
   * after `.` or `,`, truncated to the millisecond).
   */
  parseOffsetIso(iso: string): Result<UtcEpochMs, TimeError> {
    const fields = isoFieldsOf(iso);
    if (fields === null || fields.offsetMs === null) {
      return Result.err(
        TimeError.invalidDateTime(iso, DateTimeInvalidReason.Unparsable),
      );
    }
    const day = LocalDate.parse(fields.datePart);
    const localMs = day.ok
      ? LocalDate.toEpochDay(day.value) * MS_PER_DAY +
        fields.hour * MS_PER_HOUR +
        fields.minute * MS_PER_MINUTE +
        fields.second * MS_PER_SECOND +
        fields.millisecond
      : Number.NaN;
    const instant = UtcEpochMs.of(localMs - fields.offsetMs);
    if (
      fields.hour > 23 ||
      fields.minute > 59 ||
      fields.second > 59 ||
      !instant.ok
    ) {
      return Result.err(
        TimeError.invalidDateTime(iso, DateTimeInvalidReason.OutOfRange),
      );
    }
    return instant;
  },

  /**
   * A WIRE start (ISO-8601) → its instant, on the shop's terms — the
   * ingestion boundary's one reading of a client's `startIso` (flatten-spec
   * §2.4). A string WITH an offset names its instant ({@link parseOffsetIso});
   * a bare wall clock (`2026-03-29T10:00`, a date alone is its midnight) is
   * read on `timeZone`'s clock ({@link toUtc}): a time inside the
   * spring-forward gap is `DST_GAP_INVALID_TIME`, a fall-back repeat the
   * EARLIER offset (Law 7.3, locked 2026-10-10), its seconds and
   * milliseconds kept. Anything else is `TIME_INVALID_DATE_TIME`.
   */
  parseIsoIn(iso: string, timeZone: TimeZone): Result<UtcEpochMs, TimeError> {
    const fields = isoFieldsOf(iso);
    if (fields === null || fields.offsetMs !== null) {
      return ZonedTimeSystem.parseOffsetIso(iso);
    }
    const day = LocalDate.parse(fields.datePart);
    const minute = MinuteOfDay.of(fields.hour * 60 + fields.minute);
    if (!day.ok || !minute.ok || fields.minute > 59 || fields.second > 59) {
      return Result.err(
        TimeError.invalidDateTime(iso, DateTimeInvalidReason.OutOfRange),
      );
    }
    const start = ZonedTimeSystem.toUtc(day.value, minute.value, timeZone);
    return start.ok
      ? instantResult(
          start.value + fields.second * MS_PER_SECOND + fields.millisecond,
          day.value,
          minute.value,
        )
      : start;
  },

  /**
   * The instant as ISO-8601 on the zone's wall clock WITH the offset in force
   * — `2026-10-10T14:00:00.000+03:00` in Sofia — byte-identical to the legacy
   * `ZonedDateTime.toISO()` (milliseconds always, `±HH:MM` always; a zero
   * offset prints `+00:00`). For `.ics` and the edge's legacy wire params.
   */
  toIso(utcEpochMs: UtcEpochMs, timeZone: TimeZone): string {
    const formatter = formatterFor(timeZone);
    if (formatter === null) return defect(`unknown TimeZone ${timeZone}`);
    return isoAt(utcEpochMs, localMsAt(utcEpochMs, formatter));
  },
} as const;
