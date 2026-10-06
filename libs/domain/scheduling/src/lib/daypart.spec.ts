import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { DAYPARTS, daypartOf, daypartsTouchedBy } from './daypart';
import { LocalTimeOfDay, LocalTimeRange } from './local-time-of-day';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

const clock = (raw: string) => unwrap(LocalTimeOfDay.create(raw));
const range = (from: string, to: string) =>
  unwrap(LocalTimeRange.create(from, to));

describe('Daypart', () => {
  it('runs morning, afternoon, evening — the order the time sheet heads its runs in', () => {
    expect(DAYPARTS).toEqual(['morning', 'afternoon', 'evening']);
  });

  it('files a clock face before 12:00 under the morning, before 17:00 under the afternoon, the rest under the evening', () => {
    expect(daypartOf(clock('00:00'))).toBe('morning');
    expect(daypartOf(clock('09:30'))).toBe('morning');
    expect(daypartOf(clock('11:59'))).toBe('morning');
    expect(daypartOf(clock('12:00'))).toBe('afternoon');
    expect(daypartOf(clock('16:59'))).toBe('afternoon');
    expect(daypartOf(clock('17:00'))).toBe('evening');
    expect(daypartOf(clock('23:59'))).toBe('evening');
  });

  it('reads an instant on its own calendar — the shop’s clock, never UTC', () => {
    // 11:30 in Sofia is 08:30 UTC in September: still the morning here, and
    // 17:15 Sofia (14:15 UTC) is the evening, whatever the device's zone.
    const morning = unwrap(ZonedDateTime.fromISO('2026-09-28T11:30:00', ZONE));
    const evening = unwrap(ZonedDateTime.fromISO('2026-09-28T17:15:00', ZONE));
    expect(daypartOf(morning)).toBe('morning');
    expect(daypartOf(evening)).toBe('evening');
  });

  it('names every part a span touches, half-open, in the day’s order', () => {
    expect(daypartsTouchedBy([range('09:00', '12:00')])).toEqual(['morning']);
    expect(daypartsTouchedBy([range('11:30', '12:30')])).toEqual([
      'morning',
      'afternoon',
    ]);
    expect(daypartsTouchedBy([range('12:00', '17:00')])).toEqual(['afternoon']);
    expect(daypartsTouchedBy([range('16:00', '23:59')])).toEqual([
      'afternoon',
      'evening',
    ]);
  });

  it('gathers the parts of several spans once each, never in the spans’ order', () => {
    expect(
      daypartsTouchedBy([
        range('18:00', '20:00'),
        range('08:00', '10:00'),
        range('19:00', '21:00'),
      ]),
    ).toEqual(['morning', 'evening']);
  });

  it('names nothing for no span — "any time" is the caller’s to say', () => {
    expect(daypartsTouchedBy([])).toEqual([]);
  });
});
