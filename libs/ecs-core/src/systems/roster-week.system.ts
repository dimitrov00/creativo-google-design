import {
  EndMinute,
  LocalDate,
  type LocationId,
  MinuteCount,
  MinuteOfDay,
  Result,
  type Weekday,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import {
  MinuteRange,
  RosterBreak,
  ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import type { BarberSchedule } from '@core/entities';

/**
 * A chair's week as the hours editor holds it — the roster version's two
 * 1-to-N arrays, the shifts and the breaks inside them (owner,
 * 2026-11-06: "weekly hours editor with «＋ Почивка»").
 */
export type RosterWeek = {
  readonly segments: readonly ShiftSegment[];
  readonly breaks: readonly RosterBreak[];
};

/** One weekday of a week: its shifts in time order and its breaks as minute ranges. */
export type RosterDay = {
  readonly shifts: readonly ShiftSegment[];
  readonly breaks: readonly MinuteRange[];
};

const EMPTY_WEEK: RosterWeek = { segments: [], breaks: [] };

const NINE = MinuteOfDay.ofProven(540);
const EIGHTEEN = EndMinute.ofProven(1080);
const THIRTEEN = MinuteOfDay.ofProven(780);
const FOURTEEN = EndMinute.ofProven(840);

/** The first span of a list, or one `gap` after its last end, `length` long, held to the day. */
function nextAfter(
  ranges: readonly MinuteRange[],
  firstStart: MinuteOfDay,
  firstEnd: EndMinute,
  gap: number,
  length: number,
): MinuteRange | null {
  let lastEnd = -1;
  for (let i = 0; i < ranges.length; i++) {
    lastEnd = Math.max(lastEnd, (ranges[i] as MinuteRange).endMinutes);
  }
  if (lastEnd < 0) return MinuteRange.of(firstStart, firstEnd);
  const start = MinuteOfDay.of(lastEnd + gap);
  const end = EndMinute.of(Math.min(lastEnd + gap + length, 1440));
  return start.ok && end.ok ? MinuteRange.of(start.value, end.value) : null;
}

/**
 * The least time between two shifts of one day at DIFFERENT shops — the
 * walk across town (`ShiftSegment.validate`). Half an hour.
 */
const TRANSFER_MINUTES = MinuteCount.span(
  MinuteOfDay.ofProven(0),
  EndMinute.ofProven(30),
);

function onWeekday(
  segments: readonly ShiftSegment[],
  weekday: Weekday,
): readonly ShiftSegment[] {
  const own: ShiftSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as ShiftSegment;
    if (segment.weekday === weekday) own.push(segment);
  }
  return own.sort(ShiftSegment.compare);
}

/**
 * RosterWeekSystem — a chair's weekly hours, read and written WHOLE «from
 * a day on»: the version in force read as a week, a weekday edited or
 * copied to others, the week judged (shifts that do not overlap, every
 * break inside a shift of its weekday), and the history with the week
 * standing from the day on (`ScheduleVersion.replaceFrom`) — ONE roster
 * write, never a document per day.
 */
export const RosterWeekSystem = {
  TRANSFER_MINUTES,

  /**
   * The week in force on `localDate` — or, before the roster begins, the
   * first week it will hold; an empty week when there is none.
   */
  weekOn(
    versions: readonly ScheduleVersion[],
    localDate: LocalDate,
  ): RosterWeek {
    let next: ScheduleVersion | null = null;
    for (let i = 0; i < versions.length; i++) {
      const version = versions[i] as ScheduleVersion;
      if (ScheduleVersion.coversDay(version, localDate)) {
        return { segments: version.segments, breaks: version.breaks };
      }
      if (
        version.effectiveFromLocalDate > localDate &&
        (next === null ||
          version.effectiveFromLocalDate < next.effectiveFromLocalDate)
      ) {
        next = version;
      }
    }
    return next === null
      ? EMPTY_WEEK
      : { segments: next.segments, breaks: next.breaks };
  },

  /** One weekday of the week. */
  dayOf(week: RosterWeek, weekday: Weekday): RosterDay {
    return {
      shifts: onWeekday(week.segments, weekday),
      breaks: RosterBreak.rangesOn(week.breaks, weekday),
    };
  },

  /**
   * The week with one weekday's shifts and breaks replaced. Each shift
   * keeps the shop of the one it stands in for (the same place in the
   * day's order); a new one is worked at the day's first shop, or at
   * `homeId`. `shifts` empty: the chair is off that weekday.
   */
  withDay(
    week: RosterWeek,
    weekday: Weekday,
    shifts: readonly MinuteRange[],
    breaks: readonly MinuteRange[],
    homeId: LocationId,
  ): RosterWeek {
    const before = onWeekday(week.segments, weekday);
    const segments: ShiftSegment[] = [];
    for (let i = 0; i < week.segments.length; i++) {
      const segment = week.segments[i] as ShiftSegment;
      if (segment.weekday !== weekday) segments.push(segment);
    }
    const sorted = [...shifts].sort((a, b) => a.startMinutes - b.startMinutes);
    for (let i = 0; i < sorted.length; i++) {
      const range = sorted[i] as MinuteRange;
      const shop = before[i]?.locationId ?? before[0]?.locationId ?? homeId;
      segments.push(
        ShiftSegment.of(weekday, shop, range.startMinutes, range.endMinutes),
      );
    }
    const kept: RosterBreak[] = [];
    for (let i = 0; i < week.breaks.length; i++) {
      const entry = week.breaks[i] as RosterBreak;
      if (entry.weekday !== weekday) kept.push(entry);
    }
    const own = MinuteRange.normalize(breaks);
    for (let i = 0; i < own.length; i++) {
      kept.push(RosterBreak.of(weekday, own[i] as MinuteRange));
    }
    return {
      segments: segments.sort(ShiftSegment.compare),
      breaks: kept.sort(RosterBreak.compare),
    };
  },

  /** The week with `from`'s shifts (their shops kept) and breaks copied onto every weekday of `to`. */
  copyDay(week: RosterWeek, from: Weekday, to: readonly Weekday[]): RosterWeek {
    const day = RosterWeekSystem.dayOf(week, from);
    const segments: ShiftSegment[] = [];
    for (let i = 0; i < week.segments.length; i++) {
      const segment = week.segments[i] as ShiftSegment;
      if (!to.includes(segment.weekday) || segment.weekday === from) {
        segments.push(segment);
      }
    }
    const breaks: RosterBreak[] = [];
    for (let i = 0; i < week.breaks.length; i++) {
      const entry = week.breaks[i] as RosterBreak;
      if (!to.includes(entry.weekday) || entry.weekday === from) {
        breaks.push(entry);
      }
    }
    for (let k = 0; k < to.length; k++) {
      const weekday = to[k] as Weekday;
      if (weekday === from) continue;
      for (let i = 0; i < day.shifts.length; i++) {
        const shift = day.shifts[i] as ShiftSegment;
        segments.push({ ...shift, weekday });
      }
      for (let i = 0; i < day.breaks.length; i++) {
        breaks.push(RosterBreak.of(weekday, day.breaks[i] as MinuteRange));
      }
    }
    return {
      segments: segments.sort(ShiftSegment.compare),
      breaks: breaks.sort(RosterBreak.compare),
    };
  },

  /**
   * The week judged, the first refusal said: every shift a real span that
   * overlaps no other of its weekday, with time to walk between two shops
   * (`ShiftSegment.validate`); every break inside one shift of its weekday
   * (`SCHEDULING_ROSTER_BREAK_OUTSIDE_SHIFT`). Answers the week sorted.
   */
  validate(week: RosterWeek): Result<RosterWeek, SchedulingError> {
    const segments = ShiftSegment.validate(week.segments, TRANSFER_MINUTES);
    if (!segments.ok) {
      return Result.err(segments.error[0] as SchedulingError);
    }
    for (let i = 0; i < week.breaks.length; i++) {
      const entry = week.breaks[i] as RosterBreak;
      const range = MinuteRange.of(entry.startMinutes, entry.endMinutes);
      const shifts = onWeekday(segments.value, entry.weekday);
      let inside = false;
      for (let k = 0; k < shifts.length && !inside; k++) {
        const shift = shifts[k] as ShiftSegment;
        inside = MinuteRange.contains(
          MinuteRange.of(shift.startMinutes, shift.endMinutes),
          range,
        );
      }
      if (!inside || entry.startMinutes >= entry.endMinutes) {
        return Result.err(
          SchedulingError.rosterBreakOutsideShift(
            entry.weekday,
            entry.startMinutes,
            entry.endMinutes,
          ),
        );
      }
    }
    return Result.ok({
      segments: segments.value,
      breaks: [...week.breaks].sort(RosterBreak.compare),
    });
  },

  /**
   * The roster's history with `week` standing from `fromLocalDate` on —
   * refused from a day before the shop's `today`
   * (`SCHEDULING_ROSTER_BREAK_IN_PAST`: past weeks are the record) and for
   * a week {@link validate} refuses. A chair with no roster yet starts one.
   */
  setFrom(
    schedule: BarberSchedule | null,
    week: RosterWeek,
    fromLocalDate: LocalDate,
    today: LocalDate,
  ): Result<readonly ScheduleVersion[], SchedulingError> {
    if (fromLocalDate < today) {
      return Result.err(
        SchedulingError.rosterBreakInPast(fromLocalDate, today),
      );
    }
    const judged = RosterWeekSystem.validate(week);
    if (!judged.ok) return judged;
    const history = ScheduleVersion.history(schedule?.versions ?? []);
    if (!history.ok) return history;
    return Result.ok(
      ScheduleVersion.replaceFrom(
        history.value,
        fromLocalDate,
        judged.value.segments,
        judged.value.breaks,
      ),
    );
  },

  /**
   * The span a «＋ Добави часове» adds to a day: 09:00–18:00 on a day off;
   * else an hour after the last shift, four hours long, held to the day —
   * `null` when the day has no room left.
   */
  nextShift(shifts: readonly MinuteRange[]): MinuteRange | null {
    return nextAfter(shifts, NINE, EIGHTEEN, 60, 240);
  },

  /**
   * The span a «＋ Почивка» adds: the 13:00 lunch hour first; else a quarter
   * of an hour an hour after the last break — `null` when the day has no
   * room left.
   */
  nextBreak(breaks: readonly MinuteRange[]): MinuteRange | null {
    return nextAfter(breaks, THIRTEEN, FOURTEEN, 60, 15);
  },

  /**
   * The editor's `'HH:mm'` as an exclusive end — `'00:00'` read as the
   * closing midnight (a shift that runs to it) — or `null`.
   */
  endOf(clock: string): EndMinute | null {
    const minute = MinuteOfDay.parseClock(clock);
    if (!minute.ok) return null;
    const end = EndMinute.of(minute.value === 0 ? 1440 : minute.value);
    return end.ok ? end.value : null;
  },
} as const;
