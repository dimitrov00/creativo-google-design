import { describe, expect, it } from 'vitest';
import {
  MinuteRange,
  RecurrenceEndRule,
  RecurrencePattern,
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
import {
  type RosterBreakChange,
  RosterBreakSystem,
} from './roster-break.system';

/*
 * A chair's standing breaks, revised «from this day on» as ONE roster
 * write: the weekday's break swapped, added or removed, every version from
 * the day on carrying it, every earlier day keeping what it was worked
 * under.
 */

const IVAN = BarberId.of('ivan');
const CENTER = LocationId.of('loc-center');
const span = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
const LUNCH = span(780, 840);
const LATE_LUNCH = span(840, 900);
const WEEKDAYS = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
];

const schedule = (versions: readonly ScheduleVersion[]): BarberSchedule => ({
  id: IVAN,
  turnaroundMinutes: MinuteCount.ZERO,
  versions,
  writeOperationId: null,
});
const week = WEEKDAYS.map((weekday) =>
  ShiftSegment.of(weekday, CENTER, minute(540), endMinute(1080)),
);
const lunches = WEEKDAYS.map((weekday) => RosterBreak.of(weekday, LUNCH));

const change = (over: Partial<RosterBreakChange>): RosterBreakChange => ({
  fromLocalDate: localDate('2026-11-16'),
  weekdays: [Weekday.Mon],
  before: null,
  after: null,
  ...over,
});

describe('RosterBreakSystem.revise', () => {
  it('adds a lunch on every chosen weekday', () => {
    const added = RosterBreakSystem.revise([], {
      weekdays: WEEKDAYS,
      before: null,
      after: LUNCH,
    });
    expect(added).toEqual(lunches);
  });

  it("moves one weekday's break and leaves the others", () => {
    const moved = RosterBreakSystem.revise(lunches, {
      weekdays: [Weekday.Wed],
      before: LUNCH,
      after: LATE_LUNCH,
    });
    expect(RosterBreak.rangesOn(moved, Weekday.Wed)).toEqual([LATE_LUNCH]);
    expect(RosterBreak.rangesOn(moved, Weekday.Tue)).toEqual([LUNCH]);
    expect(moved).toHaveLength(5);
  });

  it('removes a break, and merges one that touches another', () => {
    expect(
      RosterBreakSystem.revise(lunches, {
        weekdays: [Weekday.Mon],
        before: LUNCH,
        after: null,
      }),
    ).toHaveLength(4);
    const joined = RosterBreakSystem.revise(lunches, {
      weekdays: [Weekday.Mon],
      before: null,
      after: LATE_LUNCH,
    });
    expect(RosterBreak.rangesOn(joined, Weekday.Mon)).toEqual([span(780, 900)]);
  });
});

describe('RosterBreakSystem.amend', () => {
  const today = localDate('2026-11-06');
  const history = ScheduleVersion.startingWith(
    week,
    localDate('2026-01-01'),
    lunches,
  );

  it('carries the change from its day on and keeps every earlier day', () => {
    const versions = unwrapOk(
      RosterBreakSystem.amend(
        schedule(history),
        IVAN,
        change({ weekdays: [Weekday.Mon], before: LUNCH, after: null }),
        today,
      ),
    );
    expect(versions).toHaveLength(2);
    const [before, after] = versions as [ScheduleVersion, ScheduleVersion];
    expect(before.effectiveToLocalDate).toBe('2026-11-15');
    expect(RosterBreak.rangesOn(before.breaks, Weekday.Mon)).toEqual([LUNCH]);
    expect(after.effectiveFromLocalDate).toBe('2026-11-16');
    expect(after.effectiveToLocalDate).toBeNull();
    expect(after.seq).toBe(1);
    expect(RosterBreak.rangesOn(after.breaks, Weekday.Mon)).toEqual([]);
    expect(after.segments).toEqual(before.segments);
  });

  it('revises a later amendment too, so it keeps the change', () => {
    const amended = unwrapOk(
      ScheduleVersion.amend(history, week, localDate('2026-12-01')),
    );
    const versions = unwrapOk(
      RosterBreakSystem.amend(
        schedule(amended),
        IVAN,
        change({ weekdays: [Weekday.Mon], before: LUNCH, after: LATE_LUNCH }),
        today,
      ),
    );
    expect(versions.map((v) => v.effectiveFromLocalDate)).toEqual([
      '2026-01-01',
      '2026-11-16',
      '2026-12-01',
    ]);
    expect(
      versions.map((v) => RosterBreak.rangesOn(v.breaks, Weekday.Mon)),
    ).toEqual([[LUNCH], [LATE_LUNCH], [LATE_LUNCH]]);
  });

  it('revises in place a version that begins that very day', () => {
    const versions = unwrapOk(
      RosterBreakSystem.amend(
        schedule(history),
        IVAN,
        change({ fromLocalDate: localDate('2026-01-01'), after: LATE_LUNCH }),
        localDate('2026-01-01'),
      ),
    );
    expect(versions).toHaveLength(1);
  });

  it('refuses a day already past, and a chair with no roster', () => {
    expect(
      unwrapErr(
        RosterBreakSystem.amend(
          schedule(history),
          IVAN,
          change({ fromLocalDate: localDate('2026-11-05') }),
          today,
        ),
      ).errorCode,
    ).toBe(SchedulingErrorCode.RosterBreakInPast);
    expect(
      unwrapErr(RosterBreakSystem.amend(null, IVAN, change({}), today))
        .errorCode,
    ).toBe(SchedulingErrorCode.RosterMissing);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(schedule(history));
    const asked = deepFreeze(change({ after: LATE_LUNCH }));
    expect(RosterBreakSystem.amend(frozen, IVAN, asked, today)).toEqual(
      RosterBreakSystem.amend(frozen, IVAN, asked, today),
    );
  });
});

describe("RosterBreakSystem — one day's breaks", () => {
  it('finds the kept break a clipped drawn one stands for', () => {
    expect(RosterBreakSystem.wholeOf([LUNCH], span(810, 840))).toEqual(LUNCH);
    expect(RosterBreakSystem.wholeOf([LUNCH], span(900, 960))).toBeNull();
  });

  it('moves or removes one break of the day, keeping the others', () => {
    const morning = span(600, 615);
    expect(
      RosterBreakSystem.dayWith([morning, LUNCH], LUNCH, LATE_LUNCH),
    ).toEqual([morning, LATE_LUNCH]);
    expect(RosterBreakSystem.dayWith([LUNCH], LUNCH, null)).toEqual([]);
  });
});

describe('RosterBreakSystem.standingWeekdays — which repeats can stand in the weekly roster', () => {
  const rule = (pattern: RecurrencePattern, interval = 1) => ({
    ...pattern,
    recurrenceInterval: interval,
    ...RecurrenceEndRule.count(5),
  });

  it('stands a daily or weekly repeat on its weekdays', () => {
    expect(
      RosterBreakSystem.standingWeekdays(rule(RecurrencePattern.daily())),
    ).toHaveLength(7);
    expect(
      RosterBreakSystem.standingWeekdays(
        rule(RecurrencePattern.weekly([Weekday.Mon, Weekday.Fri])),
      ),
    ).toEqual([Weekday.Mon, Weekday.Fri]);
  });

  it('refuses every other week, and a monthly repeat', () => {
    expect(
      RosterBreakSystem.standingWeekdays(
        rule(RecurrencePattern.weekly([Weekday.Mon]), 2),
      ),
    ).toBeNull();
    expect(
      RosterBreakSystem.standingWeekdays(
        rule(RecurrencePattern.monthlyByDate(1)),
      ),
    ).toBeNull();
  });
});
