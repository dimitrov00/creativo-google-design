import { describe, expect, it } from 'vitest';
import { LocationId } from '../entities/location.entity';
import { DayKey } from './day-key.data';
import { ScheduleVersion, ShiftSegment } from './schedule-version.data';
import { Weekday } from './weekday.data';

const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const day = (raw: string): DayKey => DayKey.of(raw);
const seg = (
  weekday: Weekday,
  start: number,
  end: number,
  locationId: LocationId = CENTER,
): ShiftSegment => ShiftSegment.of(weekday, locationId, start, end);

const WEEK = [seg(Weekday.Mon, 540, 1080), seg(Weekday.Tue, 540, 1080)];
const LATER_WEEK = [seg(Weekday.Wed, 600, 1200)];

describe('ShiftSegment.validate — a weekly pattern', () => {
  it('holds SEVERAL ranges on one weekday — the lunch break', () => {
    const result = ShiftSegment.validate(
      [seg(Weekday.Mon, 780, 1080), seg(Weekday.Mon, 540, 720)],
      0,
    );
    expect(result).toEqual({
      ok: true,
      value: [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 780, 1080)],
    });
  });

  it('sorts in week order regardless of authoring order', () => {
    const result = ShiftSegment.validate(
      [
        seg(Weekday.Fri, 540, 600),
        seg(Weekday.Mon, 600, 660),
        seg(Weekday.Mon, 540, 600),
      ],
      0,
    );
    expect(
      result.ok && result.value.map((s) => [s.weekday, s.startMinutes]),
    ).toEqual([
      [1, 540],
      [1, 600],
      [5, 540],
    ]);
  });

  it('REJECTS overlapping ranges rather than merging them', () => {
    const result = ShiftSegment.validate(
      [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 700, 900)],
      0,
    );
    expect(result).toEqual({
      ok: false,
      error: [
        {
          code: 'scheduling.time_range.invalid',
          startMinutes: 700,
          endMinutes: 900,
        },
      ],
    });
  });

  it('accepts ranges that merely touch — half-open, so they abut', () => {
    expect(
      ShiftSegment.validate(
        [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 720, 900)],
        0,
      ).ok,
    ).toBe(true);
  });

  it('rejects a malformed or backwards range, and a segment with no shop', () => {
    const result = ShiftSegment.validate(
      [
        seg(Weekday.Mon, 720, 540),
        seg(Weekday.Tue, 0, 1441),
        seg(Weekday.Wed, 540, 600, LocationId.of('  ')),
      ],
      0,
    );
    expect(!result.ok && result.error.map((error) => error.code)).toEqual([
      'scheduling.time_range.invalid',
      'scheduling.time_range.invalid',
      'scheduling.shift_segment.invalid_location',
    ]);
  });

  it('does not judge overlap on a weekday that already holds a malformed segment', () => {
    const result = ShiftSegment.validate(
      [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 600, 600)],
      0,
    );
    expect(!result.ok && result.error).toHaveLength(1);
  });

  it('refuses a hop between shops faster than the transfer time — same shop needs none', () => {
    const tight = [
      seg(Weekday.Mon, 540, 720, CENTER),
      seg(Weekday.Mon, 730, 900, MLADOST),
    ];
    expect(ShiftSegment.validate(tight, 30)).toEqual({
      ok: false,
      error: [
        {
          code: 'scheduling.shift_segment.impossible_transfer',
          weekday: 1,
          fromLocationId: 'loc-center',
          toLocationId: 'loc-mladost',
          gapMinutes: 10,
          requiredMinutes: 30,
        },
      ],
    });
    expect(ShiftSegment.validate(tight, 10).ok).toBe(true);
    expect(
      ShiftSegment.validate(
        [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 720, 900)],
        30,
      ).ok,
    ).toBe(true);
  });

  it('sums a nominal week and names its shops once each', () => {
    const week = [
      seg(Weekday.Mon, 540, 720, MLADOST),
      seg(Weekday.Tue, 540, 1080, CENTER),
      seg(Weekday.Wed, 540, 600, MLADOST),
    ];
    expect(ShiftSegment.weeklyMinutes(week)).toBe(180 + 540 + 60);
    expect(ShiftSegment.locations(week)).toEqual(['loc-center', 'loc-mladost']);
    expect(ShiftSegment.weeklyMinutes([])).toBe(0);
  });

  it('overlap is per weekday', () => {
    expect(
      ShiftSegment.overlaps(
        seg(Weekday.Mon, 540, 720),
        seg(Weekday.Tue, 540, 720),
      ),
    ).toBe(false);
  });
});

describe('ScheduleVersion — the roster history', () => {
  const history = ScheduleVersion.startingWith(WEEK, day('2026-01-01'));

  it('an open-ended version covers every later day, and nothing before it began', () => {
    const [first] = history;
    if (first === undefined) throw new Error('bad fixture');
    expect(ScheduleVersion.isOpenEnded(first)).toBe(true);
    expect(ScheduleVersion.coversDay(first, day('2025-12-31'))).toBe(false);
    expect(ScheduleVersion.coversDay(first, day('2026-01-01'))).toBe(true);
    expect(ScheduleVersion.coversDay(first, day('2030-06-01'))).toBe(true);
  });

  it('closes the old version the day before the new one starts', () => {
    const amended = ScheduleVersion.amend(
      history,
      LATER_WEEK,
      day('2026-03-01'),
    );
    expect(amended).toEqual({
      ok: true,
      value: [
        {
          seq: 0,
          effectiveFromDayKey: '2026-01-01',
          effectiveToDayKey: '2026-02-28',
          segments: WEEK,
        },
        {
          seq: 1,
          effectiveFromDayKey: '2026-03-01',
          effectiveToDayKey: null,
          segments: LATER_WEEK,
        },
      ],
    });
  });

  it('leaves the OLD pattern answering for old days — the whole reason for versioning', () => {
    const amended = ScheduleVersion.amend(
      history,
      LATER_WEEK,
      day('2026-03-01'),
    );
    if (!amended.ok) throw new Error('bad fixture');
    const [old, current] = amended.value;
    if (old === undefined || current === undefined)
      throw new Error('bad fixture');
    expect(ScheduleVersion.coversDay(old, day('2026-02-28'))).toBe(true);
    expect(ScheduleVersion.coversDay(old, day('2026-03-01'))).toBe(false);
    expect(ScheduleVersion.coversDay(current, day('2026-03-01'))).toBe(true);
  });

  it('REFUSES a retroactive amendment, and one on the same day the current version began', () => {
    for (const from of ['2025-12-01', '2026-01-01']) {
      expect(ScheduleVersion.amend(history, LATER_WEEK, day(from))).toEqual({
        ok: false,
        error: {
          code: 'scheduling.staff_schedule.retroactive_amendment',
          attemptedFrom: from,
          currentFrom: '2026-01-01',
        },
      });
    }
  });

  it('starts a history when there is none', () => {
    expect(ScheduleVersion.amend([], WEEK, day('2026-05-01'))).toEqual({
      ok: true,
      value: ScheduleVersion.startingWith(WEEK, day('2026-05-01')),
    });
  });

  it('chains several amendments, each answering for its own period', () => {
    let current: readonly ScheduleVersion[] = history;
    for (const from of ['2026-02-01', '2026-03-01', '2026-04-01']) {
      const next = ScheduleVersion.amend(current, LATER_WEEK, day(from));
      if (!next.ok) throw new Error('bad fixture');
      current = next.value;
    }
    expect(
      current.map((v) => [v.seq, v.effectiveFromDayKey, v.effectiveToDayKey]),
    ).toEqual([
      [0, '2026-01-01', '2026-01-31'],
      [1, '2026-02-01', '2026-02-28'],
      [2, '2026-03-01', '2026-03-31'],
      [3, '2026-04-01', null],
    ]);
    expect(ScheduleVersion.history(current).ok).toBe(true);
  });

  it('rejects overlapping versions — exactly one pattern per day', () => {
    const overlapping: readonly ScheduleVersion[] = [
      {
        seq: 0,
        effectiveFromDayKey: day('2026-01-01'),
        effectiveToDayKey: day('2026-02-15'),
        segments: WEEK,
      },
      {
        seq: 1,
        effectiveFromDayKey: day('2026-02-01'),
        effectiveToDayKey: null,
        segments: WEEK,
      },
    ];
    expect(ScheduleVersion.history(overlapping)).toEqual({
      ok: false,
      error: {
        code: 'scheduling.staff_schedule.overlapping_versions',
        earlierFrom: '2026-01-01',
        laterFrom: '2026-02-01',
      },
    });
  });

  it('rejects an open-ended version followed by another', () => {
    const openThenMore: readonly ScheduleVersion[] = [
      {
        seq: 1,
        effectiveFromDayKey: day('2026-03-01'),
        effectiveToDayKey: null,
        segments: WEEK,
      },
      {
        seq: 0,
        effectiveFromDayKey: day('2026-01-01'),
        effectiveToDayKey: null,
        segments: WEEK,
      },
    ];
    expect(ScheduleVersion.history(openThenMore).ok).toBe(false);
  });

  it('accepts adjacent, non-overlapping versions in any input order', () => {
    const adjacent: readonly ScheduleVersion[] = [
      {
        seq: 1,
        effectiveFromDayKey: day('2026-02-01'),
        effectiveToDayKey: null,
        segments: LATER_WEEK,
      },
      {
        seq: 0,
        effectiveFromDayKey: day('2026-01-01'),
        effectiveToDayKey: day('2026-01-31'),
        segments: WEEK,
      },
    ];
    const result = ScheduleVersion.history(adjacent);
    expect(result.ok && result.value.map((v) => v.seq)).toEqual([0, 1]);
  });

  it('names every shop any version rosters the barber at', () => {
    const versions: readonly ScheduleVersion[] = [
      {
        seq: 0,
        effectiveFromDayKey: day('2026-01-01'),
        effectiveToDayKey: day('2026-01-31'),
        segments: [seg(Weekday.Mon, 540, 600, MLADOST)],
      },
      {
        seq: 1,
        effectiveFromDayKey: day('2026-02-01'),
        effectiveToDayKey: null,
        segments: WEEK,
      },
    ];
    expect(ScheduleVersion.locations(versions)).toEqual([
      'loc-center',
      'loc-mladost',
    ]);
  });
});
