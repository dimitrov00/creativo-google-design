import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import { DayWindows } from './day-windows';
import { FlexibleWhen } from './flexible-when';
import { LocalTimeRange } from './local-time-of-day';

const ZONE = 'Europe/Sofia';
const MAX = 7;

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

const day = (key: string) => unwrap(CalendarDay.create(key, ZONE));
const range = (from: string, to: string) =>
  unwrap(LocalTimeRange.create(from, to));

describe('FlexibleWhen', () => {
  it('lists days chronologically, never in tap order', () => {
    let when = FlexibleWhen.empty();
    for (const key of ['2026-08-26', '2026-08-24', '2026-08-25']) {
      when = unwrap(when.withDay(day(key), MAX));
    }
    expect(when.days.map((entry) => entry.dayKey)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
    ]);
  });

  it('adds a day as "any time" — narrowing is a second, deliberate act', () => {
    const when = unwrap(FlexibleWhen.empty().withDay(day('2026-08-26'), MAX));
    expect(when.for(day('2026-08-26'))?.isWholeDay()).toBe(true);
  });

  it('re-selecting a held day does NOT discard its windows', () => {
    // The only way to reach this twice for one day is a double-fire, and
    // resetting someone's authored windows is the worst reading of that.
    const withDay = unwrap(
      FlexibleWhen.empty().withDay(day('2026-08-26'), MAX),
    );
    const narrowed = withDay.withWindows(
      DayWindows.of(day('2026-08-26'), [range('08:00', '12:00')]),
    );

    const again = unwrap(narrowed.withDay(day('2026-08-26'), MAX));
    expect(again.for(day('2026-08-26'))?.windows.map(String)).toEqual([
      '08:00–12:00',
    ]);
  });

  it('refuses a day past the tenant cap', () => {
    let when = FlexibleWhen.empty();
    for (let index = 0; index < MAX; index++) {
      when = unwrap(when.withDay(day(`2026-08-${10 + index}`), MAX));
    }
    const result = when.withDay(day('2026-09-01'), MAX);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('scheduling.flexible_when.full');
      expect(result.error.params['max']).toBe(MAX);
    }
  });

  // Days key by their own date, so this is a REPLACE, not the resurrection
  // hazard `BookingParty`'s monotonic counter exists to prevent. The 26th
  // re-added is the same 26th; its old windows must not come back with it.
  it('forgets a removed day’s windows — re-adding starts clean', () => {
    const narrowed = unwrap(
      FlexibleWhen.empty().withDay(day('2026-08-26'), MAX),
    ).withWindows(DayWindows.of(day('2026-08-26'), [range('08:00', '12:00')]));

    const readded = unwrap(
      narrowed.withoutDay(day('2026-08-26')).withDay(day('2026-08-26'), MAX),
    );
    expect(readded.for(day('2026-08-26'))?.isWholeDay()).toBe(true);
  });

  it('ignores windows for a day that is not selected', () => {
    const when = FlexibleWhen.empty().withWindows(
      DayWindows.of(day('2026-08-26'), [range('08:00', '12:00')]),
    );
    expect(when.isEmpty()).toBe(true);
  });

  it('round-trips through props', () => {
    const props = {
      days: [
        { dayKey: '2026-08-25', windows: [] },
        {
          dayKey: '2026-08-26',
          windows: [
            { from: '08:00', to: '12:00' },
            { from: '15:00', to: '16:30' },
          ],
        },
      ],
    };
    expect(unwrap(FlexibleWhen.create(props, ZONE)).toProps()).toEqual(props);
  });
});
