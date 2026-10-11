import { describe, expect, it } from 'vitest';
import { LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import { buildDayWindows, shopDayHours } from './roster-window';
import { StaffScheduleHistory } from './staff-schedule';
import { WeeklyPattern } from './weekly-pattern';

/*
 * THE LEGACY DROP RULE on a DST day (Europe/Sofia): a roster segment, a
 * shop's hours or a carve-out whose boundary the transition erased (the
 * spring-forward gap, 2026-03-29 03:00–04:00) or repeats (the fall-back
 * hour, 2026-10-25 03:00–04:00) names no single instant, so it is DROPPED —
 * never resolved forward or to an offset nobody published, and never a
 * window that holds no time. Both days are Sundays.
 */

const ZONE = 'Europe/Sofia';

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, ZONE);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function sunday(ranges: readonly (readonly [string, string])[]) {
  const pattern = WeeklyPattern.create({
    byWeekday: {
      sunday: ranges.map(([start, end]) => ({
        start,
        end,
        locationId: 'loc-center',
      })),
    },
  });
  if (pattern.isFailure()) throw new Error('bad fixture');
  return StaffScheduleHistory.startingWith(pattern.value, day('2026-01-04'));
}

function windows(key: string, ranges: readonly (readonly [string, string])[]) {
  return buildDayWindows({
    day: day(key),
    schedule: sunday(ranges),
    exceptions: [],
  }).map(
    (window) =>
      `${new Date(window.interval.startMs).toISOString()}..${new Date(window.interval.endMs).toISOString()}`,
  );
}

describe('buildDayWindows — a boundary the DST transition erased or repeats is dropped', () => {
  it('drops a segment inside the spring-forward gap, and emits no empty window for it', () => {
    expect(
      windows('2026-03-29', [
        ['03:15', '03:45'],
        ['09:00', '12:00'],
      ]),
    ).toEqual(['2026-03-29T06:00:00.000Z..2026-03-29T09:00:00.000Z']);
  });

  it('drops a segment that starts in the spring-forward gap', () => {
    expect(windows('2026-03-29', [['03:30', '06:00']])).toEqual([]);
  });

  it('drops a segment that starts in the repeated fall-back hour', () => {
    expect(windows('2026-10-25', [['03:30', '06:00']])).toEqual([]);
  });

  it('keeps a segment whose boundaries both exist once', () => {
    expect(windows('2026-10-25', [['09:00', '12:00']])).toEqual([
      '2026-10-25T07:00:00.000Z..2026-10-25T10:00:00.000Z',
    ]);
  });
});

describe('shopDayHours — an opening the transition erased closes the shop that day', () => {
  const center = LocationId.create('loc-center');
  if (center.isFailure()) throw new Error('bad fixture');
  const week = (opens: string) =>
    Array.from({ length: 7 }, () => ({
      kind: 'open' as const,
      opens,
      closes: '12:00',
    }));

  it('is closed, not opened at a time nobody published', () => {
    expect(
      shopDayHours(day('2026-03-29'), center.value, week('03:30'))?.intervals,
    ).toEqual([]);
  });

  it('opens as published on a day whose hours exist once', () => {
    expect(
      shopDayHours(day('2026-03-29'), center.value, week('09:00'))?.intervals,
    ).toHaveLength(1);
  });
});
