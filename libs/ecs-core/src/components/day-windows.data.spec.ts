import { describe, expect, it } from 'vitest';
import { deepFreeze, endMinute, localDate, minute } from '@core/testing';
import { DayWindows } from './day-windows.data';
import { MinuteRange } from './minute-range.data';

const DAY = localDate('2026-08-26');
const r = (start: number, end: number): MinuteRange =>
  MinuteRange.of(minute(start), endMinute(end));

describe('DayWindows', () => {
  it('offers the WHOLE day when no window was declared', () => {
    const windows = DayWindows.wholeDay(DAY);
    expect(DayWindows.isWholeDay(windows)).toBe(true);
    expect(DayWindows.isWholeDay(DayWindows.of(DAY, []))).toBe(true);
  });

  it('merges overlapping and ABUTTING spans into one', () => {
    // 08:00–12:00 + 11:00–13:00 is one morning, and 13:00–15:00 abuts it.
    const windows = DayWindows.of(DAY, [r(480, 720), r(660, 780), r(780, 900)]);
    expect(windows.windows).toEqual([r(480, 900)]);
  });

  it('keeps genuinely separate spans separate, in clock order', () => {
    const windows = DayWindows.of(DAY, [r(900, 990), r(480, 720)]);
    expect(windows.windows).toEqual([r(480, 720), r(900, 990)]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const windows = deepFreeze([r(900, 990), r(480, 720), r(700, 800)]);
    const once = DayWindows.of(DAY, windows);
    expect(DayWindows.of(DAY, windows)).toEqual(once);
    expect(once.windows).toEqual([r(480, 800), r(900, 990)]);
    expect(windows).toEqual([r(900, 990), r(480, 720), r(700, 800)]);
  });
});

describe('DayWindows.is — the edge guard', () => {
  it('takes a stored declaration', () => {
    expect(DayWindows.is({ localDate: '2026-08-26', windows: [] })).toBe(true);
    expect(
      DayWindows.is({
        localDate: '2026-08-26',
        windows: [
          { startMinutes: 480, endMinutes: 720 },
          { startMinutes: 900, endMinutes: 990 },
        ],
      }),
    ).toBe(true);
  });

  it.each([
    null,
    'x',
    { localDate: '2026-02-30', windows: [] },
    { localDate: '2026-08-26' },
    { localDate: '2026-08-26', windows: [null] },
    {
      localDate: '2026-08-26',
      windows: [{ startMinutes: 960, endMinutes: 480 }],
    },
    {
      localDate: '2026-08-26',
      windows: [{ startMinutes: 0, endMinutes: 1441 }],
    },
    {
      localDate: '2026-08-26',
      windows: [{ startMinutes: 1.5, endMinutes: 60 }],
    },
    { localDate: '2026-08-26', windows: [{ from: '08:00', to: '12:00' }] },
    // The pre-flatten key is a stale shape, not a day.
    { dayKey: '2026-08-26', windows: [] },
  ])('refuses %j', (raw) => {
    expect(DayWindows.is(raw)).toBe(false);
  });
});
