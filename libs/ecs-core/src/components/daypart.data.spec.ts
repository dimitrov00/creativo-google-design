import { describe, expect, it } from 'vitest';
import { endMinute, minute } from '@core/testing';
import { Daypart } from './daypart.data';
import { MinuteRange } from './minute-range.data';

const clock = (raw: string): number => {
  const [hours, minutes] = raw.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};
const at = (raw: string) => minute(clock(raw));
const range = (from: string, to: string): MinuteRange =>
  MinuteRange.of(minute(clock(from)), endMinute(clock(to)));

describe('Daypart', () => {
  it('runs MORNING, AFTERNOON, EVENING — the order the time sheet heads its runs in', () => {
    expect(Daypart.ALL).toEqual(['MORNING', 'AFTERNOON', 'EVENING']);
    expect([Daypart.Morning, Daypart.Afternoon, Daypart.Evening]).toEqual(
      Daypart.ALL,
    );
  });

  it('files a clock face before 12:00 under the morning, before 17:00 under the afternoon, the rest under the evening', () => {
    expect(Daypart.of(at('00:00'))).toBe('MORNING');
    expect(Daypart.of(at('09:30'))).toBe('MORNING');
    expect(Daypart.of(at('11:59'))).toBe('MORNING');
    expect(Daypart.of(at('12:00'))).toBe('AFTERNOON');
    expect(Daypart.of(at('16:59'))).toBe('AFTERNOON');
    expect(Daypart.of(at('17:00'))).toBe('EVENING');
    expect(Daypart.of(at('23:59'))).toBe('EVENING');
    expect(Daypart.AFTERNOON_STARTS).toBe(720);
    expect(Daypart.EVENING_STARTS).toBe(1020);
  });

  it('names every part a span touches, half-open, in the day’s order', () => {
    expect(Daypart.touchedBy([range('09:00', '12:00')])).toEqual(['MORNING']);
    expect(Daypart.touchedBy([range('11:30', '12:30')])).toEqual([
      'MORNING',
      'AFTERNOON',
    ]);
    expect(Daypart.touchedBy([range('12:00', '17:00')])).toEqual(['AFTERNOON']);
    expect(Daypart.touchedBy([range('16:00', '23:59')])).toEqual([
      'AFTERNOON',
      'EVENING',
    ]);
  });

  it('gathers the parts of several spans once each, never in the spans’ order', () => {
    expect(
      Daypart.touchedBy([
        range('18:00', '20:00'),
        range('08:00', '10:00'),
        range('19:00', '21:00'),
      ]),
    ).toEqual(['MORNING', 'EVENING']);
  });

  it('names nothing for no span — "any time" is the caller’s to say', () => {
    expect(Daypart.touchedBy([])).toEqual([]);
  });
});
