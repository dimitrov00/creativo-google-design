import { describe, expect, it } from 'vitest';
import { endMinute, localDate, minute } from '@core/testing';
import { LocationId, type LocalDate, Weekday } from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import { ScheduleVersion } from './schedule-version.data';
import { ShiftSegment } from './shift-segment.data';

const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const day = (raw: string): LocalDate => localDate(raw);
const seg = (
  weekday: Weekday,
  start: number,
  end: number,
  locationId: LocationId = CENTER,
): ShiftSegment =>
  ShiftSegment.of(weekday, locationId, minute(start), endMinute(end));

const WEEK = [seg(Weekday.Mon, 540, 1080), seg(Weekday.Tue, 540, 1080)];
const LATER_WEEK = [seg(Weekday.Wed, 600, 1200)];

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
          effectiveFromLocalDate: '2026-01-01',
          effectiveToLocalDate: '2026-02-28',
          segments: WEEK,
        },
        {
          seq: 1,
          effectiveFromLocalDate: '2026-03-01',
          effectiveToLocalDate: null,
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
          errorCode: SchedulingErrorCode.StaffScheduleRetroactiveAmendment,
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
      current.map((v) => [
        v.seq,
        v.effectiveFromLocalDate,
        v.effectiveToLocalDate,
      ]),
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
        effectiveFromLocalDate: day('2026-01-01'),
        effectiveToLocalDate: day('2026-02-15'),
        segments: WEEK,
      },
      {
        seq: 1,
        effectiveFromLocalDate: day('2026-02-01'),
        effectiveToLocalDate: null,
        segments: WEEK,
      },
    ];
    expect(ScheduleVersion.history(overlapping)).toEqual({
      ok: false,
      error: {
        errorCode: SchedulingErrorCode.StaffScheduleOverlappingVersions,
        earlierFrom: '2026-01-01',
        laterFrom: '2026-02-01',
      },
    });
  });

  it('rejects an open-ended version followed by another', () => {
    const openThenMore: readonly ScheduleVersion[] = [
      {
        seq: 1,
        effectiveFromLocalDate: day('2026-03-01'),
        effectiveToLocalDate: null,
        segments: WEEK,
      },
      {
        seq: 0,
        effectiveFromLocalDate: day('2026-01-01'),
        effectiveToLocalDate: null,
        segments: WEEK,
      },
    ];
    expect(ScheduleVersion.history(openThenMore).ok).toBe(false);
  });

  it('accepts adjacent, non-overlapping versions in any input order', () => {
    const adjacent: readonly ScheduleVersion[] = [
      {
        seq: 1,
        effectiveFromLocalDate: day('2026-02-01'),
        effectiveToLocalDate: null,
        segments: LATER_WEEK,
      },
      {
        seq: 0,
        effectiveFromLocalDate: day('2026-01-01'),
        effectiveToLocalDate: day('2026-01-31'),
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
        effectiveFromLocalDate: day('2026-01-01'),
        effectiveToLocalDate: day('2026-01-31'),
        segments: [seg(Weekday.Mon, 540, 600, MLADOST)],
      },
      {
        seq: 1,
        effectiveFromLocalDate: day('2026-02-01'),
        effectiveToLocalDate: null,
        segments: WEEK,
      },
    ];
    expect(ScheduleVersion.locations(versions)).toEqual([
      'loc-center',
      'loc-mladost',
    ]);
  });
});
