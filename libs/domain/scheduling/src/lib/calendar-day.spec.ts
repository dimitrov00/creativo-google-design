import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { CalendarDay, DateRange } from './calendar-day';
import { Interval } from './interval';

const zone = 'Europe/Sofia';

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, zone);
  if (result.isFailure()) throw new Error(`bad fixture: ${key}`);
  return result.value;
}

describe('CalendarDay.create', () => {
  it('accepts a real day and round-trips its key', () => {
    expect(day('2026-07-29').key()).toBe('2026-07-29');
  });

  it('rejects a malformed key', () => {
    for (const bad of ['2026-7-29', '29-07-2026', 'today', '']) {
      expect(CalendarDay.create(bad, zone).isFailure()).toBe(true);
    }
  });

  it('rejects a day that does not exist', () => {
    expect(CalendarDay.create('2026-02-30', zone).isFailure()).toBe(true);
    expect(CalendarDay.create('2026-13-01', zone).isFailure()).toBe(true);
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(CalendarDay.create('2028-02-29', zone).isSuccess()).toBe(true);
    expect(CalendarDay.create('2026-02-29', zone).isFailure()).toBe(true);
  });

  it('rejects an unknown zone', () => {
    expect(CalendarDay.create('2026-07-29', 'Not/AZone').isFailure()).toBe(
      true,
    );
  });
});

describe('CalendarDay.fromZonedDateTime', () => {
  it('takes the LOCAL day, not a UTC one', () => {
    // 00:30 in Sofia is still 21:30 UTC the previous day — blueprint §7.1.
    const instant = ZonedDateTime.fromISO('2026-07-29T00:30:00', zone);
    if (instant.isFailure()) throw new Error('bad fixture');
    expect(CalendarDay.fromZonedDateTime(instant.value).key()).toBe(
      '2026-07-29',
    );
  });
});

describe('CalendarDay.bounds — a day is not always 24 hours', () => {
  it('is 24 hours on an ordinary day', () => {
    expect(Interval.durationMinutes(day('2026-07-29').bounds())).toBe(24 * 60);
  });

  it('is 23 hours on the spring-forward day', () => {
    expect(Interval.durationMinutes(day('2026-03-29').bounds())).toBe(23 * 60);
  });

  it('is 25 hours on the fall-back day', () => {
    expect(Interval.durationMinutes(day('2026-10-25').bounds())).toBe(25 * 60);
  });

  it('starts at local midnight', () => {
    expect(day('2026-03-29').startOfDay().hour).toBe(0);
  });

  it('consecutive days abut exactly, with no gap or overlap across a transition', () => {
    const spring = day('2026-03-29');
    expect(spring.bounds().endMs).toBe(spring.next().bounds().startMs);
    const autumn = day('2026-10-25');
    expect(autumn.bounds().endMs).toBe(autumn.next().bounds().startMs);
  });
});

describe('CalendarDay navigation', () => {
  it('steps forward and back across a month boundary', () => {
    expect(day('2026-07-31').next().key()).toBe('2026-08-01');
    expect(day('2026-08-01').previous().key()).toBe('2026-07-31');
  });

  it('steps across a year boundary', () => {
    expect(day('2026-12-31').next().key()).toBe('2027-01-01');
  });

  it('steps across DST transitions without skipping or repeating a day', () => {
    expect(day('2026-03-28').next().key()).toBe('2026-03-29');
    expect(day('2026-03-29').next().key()).toBe('2026-03-30');
    expect(day('2026-10-24').next().key()).toBe('2026-10-25');
    expect(day('2026-10-25').next().key()).toBe('2026-10-26');
  });

  it('reports the ISO weekday the roster pattern keys on', () => {
    // 2026-07-29 is a Wednesday.
    expect(day('2026-07-29').weekday()).toBe(3);
    expect(day('2026-08-02').weekday()).toBe(7); // Sunday
  });
});

describe('DateRange', () => {
  it('enumerates an inclusive span', () => {
    const range = DateRange.create(day('2026-07-29'), day('2026-08-01'));
    if (range.isFailure()) throw new Error('bad fixture');
    expect(range.value.days().map((d) => d.key())).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
  });

  it('a single-day range holds exactly that day', () => {
    const range = DateRange.create(day('2026-07-29'), day('2026-07-29'));
    if (range.isFailure()) throw new Error('bad fixture');
    expect(range.value.dayCount()).toBe(1);
  });

  it('counts a DST week as seven days', () => {
    const range = DateRange.create(day('2026-03-26'), day('2026-04-01'));
    if (range.isFailure()) throw new Error('bad fixture');
    expect(range.value.dayCount()).toBe(7);
  });

  it('rejects a backwards range and a cross-zone one', () => {
    expect(
      DateRange.create(day('2026-08-01'), day('2026-07-29')).isFailure(),
    ).toBe(true);

    const london = CalendarDay.create('2026-07-29', 'Europe/London');
    if (london.isFailure()) throw new Error('bad fixture');
    expect(DateRange.create(day('2026-07-29'), london.value).isFailure()).toBe(
      true,
    );
  });

  it('contains its endpoints and excludes what falls outside', () => {
    const range = DateRange.create(day('2026-07-29'), day('2026-08-01'));
    if (range.isFailure()) throw new Error('bad fixture');
    expect(range.value.contains(day('2026-07-29'))).toBe(true);
    expect(range.value.contains(day('2026-08-01'))).toBe(true);
    expect(range.value.contains(day('2026-08-02'))).toBe(false);
  });
});
