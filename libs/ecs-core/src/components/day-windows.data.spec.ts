import { describe, expect, it } from 'vitest';
import { DayKey } from './day-key.data';
import { DayWindows } from './day-windows.data';
import { MinuteRange } from './minute-range.data';

const DAY = DayKey.of('2026-08-26');
const r = (start: number, end: number): MinuteRange =>
  MinuteRange.of(start, end);

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

  it('adds, removes and clears windows', () => {
    const base = DayWindows.of(DAY, [r(480, 720)]);
    const widened = DayWindows.withWindow(base, r(900, 990));
    expect(widened.windows).toHaveLength(2);
    expect(DayWindows.withoutWindow(widened, 0).windows).toEqual([r(900, 990)]);
    // Out of range is a no-op, not a throw.
    expect(DayWindows.withoutWindow(widened, 9)).toBe(widened);
    expect(DayWindows.withoutWindow(widened, -1)).toBe(widened);
    expect(DayWindows.isWholeDay(DayWindows.clearWindows(widened))).toBe(true);
    expect(base.windows).toEqual([r(480, 720)]);
  });

  it('a window added over an existing one re-normalizes', () => {
    const base = DayWindows.of(DAY, [r(480, 720)]);
    expect(DayWindows.withWindow(base, r(700, 800)).windows).toEqual([
      r(480, 800),
    ]);
  });
});

describe('DayWindows.is — the edge guard', () => {
  it('takes a stored declaration', () => {
    expect(DayWindows.is({ dayKey: '2026-08-26', windows: [] })).toBe(true);
    expect(
      DayWindows.is({
        dayKey: '2026-08-26',
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
    { dayKey: '2026-02-30', windows: [] },
    { dayKey: '2026-08-26' },
    { dayKey: '2026-08-26', windows: [null] },
    { dayKey: '2026-08-26', windows: [{ startMinutes: 960, endMinutes: 480 }] },
    { dayKey: '2026-08-26', windows: [{ startMinutes: 0, endMinutes: 1441 }] },
    { dayKey: '2026-08-26', windows: [{ startMinutes: 1.5, endMinutes: 60 }] },
    { dayKey: '2026-08-26', windows: [{ from: '08:00', to: '12:00' }] },
  ])('refuses %j', (raw) => {
    expect(DayWindows.is(raw)).toBe(false);
  });
});
