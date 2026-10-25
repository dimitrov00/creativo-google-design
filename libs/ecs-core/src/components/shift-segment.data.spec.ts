import { describe, expect, it } from 'vitest';
import { endMinute, minute, minuteCount } from '@core/testing';
import { LocationId, Weekday } from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import { ShiftSegment } from './shift-segment.data';

const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const seg = (
  weekday: Weekday,
  start: number,
  end: number,
  locationId: LocationId = CENTER,
): ShiftSegment =>
  ShiftSegment.of(weekday, locationId, minute(start), endMinute(end));

describe('ShiftSegment.validate — a weekly pattern', () => {
  it('holds SEVERAL ranges on one weekday — the lunch break', () => {
    const result = ShiftSegment.validate(
      [seg(Weekday.Mon, 780, 1080), seg(Weekday.Mon, 540, 720)],
      minuteCount(0),
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
      minuteCount(0),
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
      minuteCount(0),
    );
    expect(result).toEqual({
      ok: false,
      error: [
        {
          errorCode: SchedulingErrorCode.TimeRangeInvalid,
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
        minuteCount(0),
      ).ok,
    ).toBe(true);
  });

  it('rejects a backwards or empty range, and a segment with no shop', () => {
    // A range outside the day (0 → 1441) is no longer constructible: the
    // `EndMinute` brand refuses it at its own edge (minute-of-day.primitive).
    const result = ShiftSegment.validate(
      [
        seg(Weekday.Mon, 720, 540),
        seg(Weekday.Tue, 600, 600),
        seg(Weekday.Wed, 540, 600, LocationId.of('  ')),
      ],
      minuteCount(0),
    );
    expect(!result.ok && result.error.map((error) => error.errorCode)).toEqual([
      SchedulingErrorCode.TimeRangeInvalid,
      SchedulingErrorCode.TimeRangeInvalid,
      SchedulingErrorCode.ShiftSegmentInvalidLocation,
    ]);
  });

  it('does not judge overlap on a weekday that already holds a malformed segment', () => {
    const result = ShiftSegment.validate(
      [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 600, 600)],
      minuteCount(0),
    );
    expect(!result.ok && result.error).toHaveLength(1);
  });

  it('refuses a hop between shops faster than the transfer time — same shop needs none', () => {
    const tight = [
      seg(Weekday.Mon, 540, 720, CENTER),
      seg(Weekday.Mon, 730, 900, MLADOST),
    ];
    expect(ShiftSegment.validate(tight, minuteCount(30))).toEqual({
      ok: false,
      error: [
        {
          errorCode: SchedulingErrorCode.ShiftSegmentImpossibleTransfer,
          weekday: 1,
          fromLocationId: 'loc-center',
          toLocationId: 'loc-mladost',
          gapMinutes: 10,
          requiredMinutes: 30,
        },
      ],
    });
    expect(ShiftSegment.validate(tight, minuteCount(10)).ok).toBe(true);
    expect(
      ShiftSegment.validate(
        [seg(Weekday.Mon, 540, 720), seg(Weekday.Mon, 720, 900)],
        minuteCount(30),
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
