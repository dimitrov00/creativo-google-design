import {
  LocalDate,
  MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
  ZonedTimeSystem,
} from '@creativo/ecs-core';

/*
 * THE LEGACY DROP RULE for a span somebody DECLARED on a shop day's wall
 * clock — a roster segment, a shop's hours, a carve-out, a client's window:
 * a boundary the day's DST transition erased (a spring-forward gap) or
 * repeats (a fall-back hour) names no single instant, so the span is
 * dropped rather than placed on an instant nobody said (the legacy
 * roster's `isUnambiguous`, `resolvedIntervalsOf`). Shared by the shims
 * that lay such spans on the absolute timeline (`roster-window.ts`,
 * `day-windows.ts`), so the two can never disagree.
 */

const MINUTES_PER_DAY = 1440;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * The days whose wall clock runs exactly 24 hours — no transition to
 * resolve — by zone and day, read once (two `startOfLocalDay`s) per day a
 * session asks about.
 */
const UNIFORM_DAYS = new Map<string, boolean>();

function isUniformDay(localDate: LocalDate, zone: TimeZone): boolean {
  const key = `${zone}|${localDate}`;
  let uniform = UNIFORM_DAYS.get(key);
  if (uniform === undefined) {
    uniform =
      UtcEpochMs.elapsedMs(
        ZonedTimeSystem.startOfLocalDay(localDate, zone),
        ZonedTimeSystem.startOfLocalDay(LocalDate.addDays(localDate, 1), zone),
      ) === MS_PER_DAY;
    UNIFORM_DAYS.set(key, uniform);
  }
  return uniform;
}

/**
 * The instant of a declared wall-clock minute, or `null` when the day's DST
 * transition erased it (a spring-forward gap) or repeats it (a fall-back
 * hour).
 */
export function unambiguousInstant(
  localDate: LocalDate,
  minutes: number,
  zone: TimeZone,
): UtcEpochMs | null {
  const minute = MinuteOfDay.of(minutes);
  if (!minute.ok) return null;
  const instant = ZonedTimeSystem.toUtc(localDate, minute.value, zone);
  if (!instant.ok) return null;
  if (isUniformDay(localDate, zone)) return instant.value;
  // A fall-back repeat reads the same wall clock one hour later.
  const later = ZonedTimeSystem.toLocal(
    UtcEpochMs.plusMs(instant.value, MS_PER_HOUR),
    zone,
  );
  return later.localDate === localDate && later.minute === minute.value
    ? null
    : instant.value;
}

/**
 * Does `minutes` name exactly ONE instant of the day? Every minute of a day
 * of 24 hours does, and so does `1440` (the next day's first instant);
 * on a transition day, not one the gap erased or the fall-back repeats.
 */
export function isUnambiguousMinute(
  localDate: LocalDate,
  minutes: number,
  zone: TimeZone,
): boolean {
  if (minutes === MINUTES_PER_DAY) return true;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    return false;
  }
  return (
    isUniformDay(localDate, zone) ||
    unambiguousInstant(localDate, minutes, zone) !== null
  );
}
