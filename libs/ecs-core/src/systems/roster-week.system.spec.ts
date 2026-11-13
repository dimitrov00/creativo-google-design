import { describe, expect, it } from 'vitest';
import {
  MinuteRange,
  RosterBreak,
  ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import type { BarberSchedule } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import { BarberId, LocationId, MinuteCount, Weekday } from '@core/primitives';
import {
  deepFreeze,
  endMinute,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { type RosterWeek, RosterWeekSystem } from './roster-week.system';

/*
 * A chair's weekly hours, read and written whole «from a day on»: the week
 * in force, one weekday edited or copied to others (their shops kept), the
 * week judged, and the history with the week standing from the day on.
 */

const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const span = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
const shift = (weekday: Weekday, from: number, to: number, at = CENTER) =>
  ShiftSegment.of(weekday, at, minute(from), endMinute(to));
const LUNCH = span(780, 840);

const WEEK: RosterWeek = {
  segments: [
    shift(Weekday.Mon, 540, 1080),
    shift(Weekday.Wed, 540, 1080, MLADOST),
  ],
  breaks: [RosterBreak.of(Weekday.Mon, LUNCH)],
};

describe('RosterWeekSystem — a weekday edited', () => {
  it('reads one weekday: its shifts and its breaks', () => {
    expect(RosterWeekSystem.dayOf(WEEK, Weekday.Mon)).toEqual({
      shifts: [shift(Weekday.Mon, 540, 1080)],
      breaks: [LUNCH],
    });
    expect(RosterWeekSystem.dayOf(WEEK, Weekday.Tue)).toEqual({
      shifts: [],
      breaks: [],
    });
  });

  it('replaces a weekday, keeping its shop, and gives a new day the home shop', () => {
    const split = RosterWeekSystem.withDay(
      WEEK,
      Weekday.Wed,
      [span(540, 720), span(780, 1080)],
      [],
      CENTER,
    );
    expect(RosterWeekSystem.dayOf(split, Weekday.Wed).shifts).toEqual([
      shift(Weekday.Wed, 540, 720, MLADOST),
      shift(Weekday.Wed, 780, 1080, MLADOST),
    ]);
    const tuesday = RosterWeekSystem.withDay(
      WEEK,
      Weekday.Tue,
      [span(600, 960)],
      [LUNCH],
      CENTER,
    );
    expect(RosterWeekSystem.dayOf(tuesday, Weekday.Tue)).toEqual({
      shifts: [shift(Weekday.Tue, 600, 960)],
      breaks: [LUNCH],
    });
    const off = RosterWeekSystem.withDay(WEEK, Weekday.Mon, [], [], CENTER);
    expect(RosterWeekSystem.dayOf(off, Weekday.Mon)).toEqual({
      shifts: [],
      breaks: [],
    });
  });

  it('copies a weekday onto others — shifts, shops and breaks', () => {
    const copied = RosterWeekSystem.copyDay(WEEK, Weekday.Mon, [
      Weekday.Tue,
      Weekday.Wed,
    ]);
    expect(RosterWeekSystem.dayOf(copied, Weekday.Wed)).toEqual({
      shifts: [shift(Weekday.Wed, 540, 1080)],
      breaks: [LUNCH],
    });
    expect(RosterWeekSystem.dayOf(copied, Weekday.Mon)).toEqual(
      RosterWeekSystem.dayOf(WEEK, Weekday.Mon),
    );
  });
});

describe('RosterWeekSystem.validate', () => {
  it('holds a week whose breaks sit inside its shifts', () => {
    expect(unwrapOk(RosterWeekSystem.validate(WEEK))).toEqual(WEEK);
  });

  it('refuses a break outside every shift of its weekday, and overlapping shifts', () => {
    expect(
      unwrapErr(
        RosterWeekSystem.validate({
          ...WEEK,
          breaks: [RosterBreak.of(Weekday.Tue, LUNCH)],
        }),
      ).errorCode,
    ).toBe(SchedulingErrorCode.RosterBreakOutsideShift);
    expect(
      unwrapErr(
        RosterWeekSystem.validate({
          segments: [
            shift(Weekday.Mon, 540, 800),
            shift(Weekday.Mon, 780, 900),
          ],
          breaks: [],
        }),
      ).errorCode,
    ).toBe(SchedulingErrorCode.TimeRangeInvalid);
  });
});

describe('RosterWeekSystem.setFrom — the week from a day on', () => {
  const today = localDate('2026-11-06');
  const schedule = (versions: readonly ScheduleVersion[]): BarberSchedule => ({
    id: BarberId.of('ivan'),
    turnaroundMinutes: MinuteCount.ZERO,
    versions,
    writeOperationId: null,
  });
  const old = ScheduleVersion.startingWith(
    [shift(Weekday.Fri, 540, 1080)],
    localDate('2026-01-01'),
  );

  it('closes the week in force and drops a later one; earlier weeks stay', () => {
    const later = unwrapOk(
      ScheduleVersion.amend(
        old,
        old[0]?.segments ?? [],
        localDate('2026-12-01'),
      ),
    );
    const versions = unwrapOk(
      RosterWeekSystem.setFrom(
        schedule(later),
        WEEK,
        localDate('2026-11-09'),
        today,
      ),
    );
    expect(
      versions.map((v) => [v.effectiveFromLocalDate, v.effectiveToLocalDate]),
    ).toEqual([
      ['2026-01-01', '2026-11-08'],
      ['2026-11-09', null],
    ]);
    expect(versions[1]?.segments).toEqual(WEEK.segments);
    expect(versions[1]?.breaks).toEqual(WEEK.breaks);
  });

  it('starts a roster for a chair with none', () => {
    const versions = unwrapOk(
      RosterWeekSystem.setFrom(null, WEEK, today, today),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]?.effectiveFromLocalDate).toBe('2026-11-06');
  });

  it('refuses a day already past, and a week it cannot hold', () => {
    expect(
      unwrapErr(
        RosterWeekSystem.setFrom(
          schedule(old),
          WEEK,
          localDate('2026-11-05'),
          today,
        ),
      ).errorCode,
    ).toBe(SchedulingErrorCode.RosterBreakInPast);
    expect(
      unwrapErr(
        RosterWeekSystem.setFrom(
          schedule(old),
          { ...WEEK, breaks: [RosterBreak.of(Weekday.Sun, LUNCH)] },
          today,
          today,
        ),
      ).errorCode,
    ).toBe(SchedulingErrorCode.RosterBreakOutsideShift);
  });

  it('reads the week in force, or the first one ahead', () => {
    expect(RosterWeekSystem.weekOn(old, today).segments).toEqual(
      old[0]?.segments,
    );
    const ahead = ScheduleVersion.startingWith(
      WEEK.segments,
      localDate('2026-12-01'),
    );
    expect(RosterWeekSystem.weekOn(ahead, today).segments).toEqual(
      WEEK.segments,
    );
    expect(RosterWeekSystem.weekOn([], today)).toEqual({
      segments: [],
      breaks: [],
    });
  });

  it("reads the editor's clock as an end, midnight as the closing one", () => {
    expect(RosterWeekSystem.endOf('18:30')).toBe(1110);
    expect(RosterWeekSystem.endOf('00:00')).toBe(1440);
    expect(RosterWeekSystem.endOf('late')).toBeNull();
  });

  it('offers the next shift and break a day has room for', () => {
    expect(RosterWeekSystem.nextShift([])).toEqual(span(540, 1080));
    expect(RosterWeekSystem.nextShift([span(540, 780)])).toEqual(
      span(840, 1080),
    );
    expect(RosterWeekSystem.nextShift([span(540, 1400)])).toBeNull();
    expect(RosterWeekSystem.nextBreak([])).toEqual(LUNCH);
    expect(RosterWeekSystem.nextBreak([LUNCH])).toEqual(span(900, 915));
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(schedule(old));
    const week = deepFreeze(WEEK);
    expect(RosterWeekSystem.setFrom(frozen, week, today, today)).toEqual(
      RosterWeekSystem.setFrom(frozen, week, today, today),
    );
  });
});
