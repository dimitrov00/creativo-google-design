import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import { DayWindows } from './day-windows';
import { Interval } from './interval';
import { LocalTimeRange } from './local-time-of-day';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

const day = (key: string) => unwrap(CalendarDay.create(key, ZONE));
const range = (from: string, to: string) =>
  unwrap(LocalTimeRange.create(from, to));

const hours = (interval: Interval) =>
  (interval.endMs - interval.startMs) / 3_600_000;

describe('DayWindows', () => {
  it('offers the WHOLE day when no window was declared', () => {
    // Empty means "any time", never "no time" — the common answer is "the
    // 26th works" with nothing further, and that must not mask to nothing.
    const windows = DayWindows.of(day('2026-08-26'));
    expect(windows.isWholeDay()).toBe(true);

    const intervals = windows.toIntervals();
    expect(intervals).toHaveLength(1);
    expect(hours(intervals[0]!)).toBe(24);
  });

  it('merges overlapping and ABUTTING spans into one', () => {
    // 08:00–12:00 + 11:00–13:00 is one morning, and 13:00–15:00 abuts it.
    // Two rows describing one continuous stretch is a summary nobody trusts.
    const windows = DayWindows.of(day('2026-08-26'), [
      range('08:00', '12:00'),
      range('11:00', '13:00'),
      range('13:00', '15:00'),
    ]);
    expect(windows.windows.map(String)).toEqual(['08:00–15:00']);
  });

  it('keeps genuinely separate spans separate, in clock order', () => {
    const windows = DayWindows.of(day('2026-08-26'), [
      range('15:00', '16:30'),
      range('08:00', '12:00'),
    ]);
    expect(windows.windows.map(String)).toEqual(['08:00–12:00', '15:00–16:30']);
  });

  it('resolves declared spans to instants on ITS day', () => {
    const windows = DayWindows.of(day('2026-08-26'), [
      range('08:00', '12:00'),
      range('15:00', '16:30'),
    ]);
    const intervals = windows.toIntervals();
    expect(intervals.map(hours)).toEqual([4, 1.5]);
  });

  // A window is a claim about clock faces, so it survives the clocks changing
  // under it — and a spring-forward morning really is an hour shorter.
  it('honours DST: 02:00–05:00 on a spring-forward day is two real hours', () => {
    // Europe/Sofia springs forward at 03:00 on 2026-03-29.
    const windows = DayWindows.of(day('2026-03-29'), [range('02:00', '05:00')]);
    expect(windows.toIntervals().map(hours)).toEqual([2]);
  });

  it('measures a whole transition day as 23 hours, never 24', () => {
    expect(DayWindows.of(day('2026-03-29')).toIntervals().map(hours)).toEqual([
      23,
    ]);
  });

  it('drops a span the day erased rather than failing the request', () => {
    // 03:00–03:30 does not happen in Sofia on 2026-03-29. Losing one span
    // beats refusing a search over the other days in the same request.
    const windows = DayWindows.of(day('2026-03-29'), [range('03:00', '03:30')]);
    expect(windows.windows).toHaveLength(1);
    expect(windows.toIntervals()).toEqual([]);
  });

  it('adds, removes and clears windows', () => {
    const base = DayWindows.of(day('2026-08-26'), [range('08:00', '12:00')]);

    const widened = base.withWindow(range('15:00', '16:30'));
    expect(widened.windows).toHaveLength(2);

    expect(widened.withoutWindow(0).windows.map(String)).toEqual([
      '15:00–16:30',
    ]);
    // Out of range is a no-op, not a throw — the sheet's remove can race a
    // re-normalisation that shortened the list under it.
    expect(widened.withoutWindow(9).windows).toHaveLength(2);
    expect(widened.clearWindows().isWholeDay()).toBe(true);
  });

  it('round-trips through props', () => {
    const props = {
      dayKey: '2026-08-26',
      windows: [
        { from: '08:00', to: '12:00' },
        { from: '15:00', to: '16:30' },
      ],
    };
    const restored = unwrap(DayWindows.create(props, ZONE));
    expect(restored.toProps()).toEqual(props);
  });

  it('refuses a malformed span', () => {
    expect(
      DayWindows.create(
        { dayKey: '2026-08-26', windows: [{ from: '16:00', to: '08:00' }] },
        ZONE,
      ).isFailure(),
    ).toBe(true);
  });
});
