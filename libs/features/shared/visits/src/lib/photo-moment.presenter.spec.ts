import { describe, expect, it } from 'vitest';
import { ZonedTimeSystem } from '@core/systems';
import { photoMomentOf } from './photo-moment.presenter';
import { VISITS_TIME_ZONE, sofia } from './testing/visit-fixtures';

/*
 * A photo's moment in the active language (OR-5, DEP-F4): the Bulgarian
 * words as they always were, the English ones in `en-GB` — read on the
 * shop's calendar against the shop's own "now", never the device's.
 */

/** Monday 28 September 2026, 12:40 in Sofia — the shop's "now". */
const NOW = ZonedTimeSystem.shopNow(
  sofia('2026-09-28T12:40:00'),
  VISITS_TIME_ZONE,
);

const moment = (iso: string, locale: string, now = NOW) =>
  photoMomentOf(sofia(iso), VISITS_TIME_ZONE, now, locale);

describe('photoMomentOf', () => {
  it('words a picture of this year in Bulgarian: the whole moment, the day, the time', () => {
    expect(moment('2026-09-04T16:21:00', 'bg-BG')).toEqual({
      when: '4.09, 16:21',
      day: '4.09',
      time: '16:21',
    });
  });

  it('words the same picture in British English', () => {
    expect(moment('2026-09-04T16:21:00', 'en-GB')).toEqual({
      when: '4 Sept, 16:21',
      day: '4/09',
      time: '16:21',
    });
  });

  it('gives the day its year only outside the current one (R59)', () => {
    expect(moment('2025-03-06T09:05:00', 'bg-BG')).toEqual({
      when: '6.03, 09:05',
      day: '6.03.2025 г.',
      time: '09:05',
    });
    expect(moment('2025-03-06T09:05:00', 'en-GB')).toEqual({
      when: '6 Mar, 09:05',
      day: '6/03/2025',
      time: '09:05',
    });
  });

  it('judges the year by the shop’s "now", on the shop’s calendar', () => {
    // Ten past midnight on New Year's Day in Sofia — still 31 December in
    // UTC: the shop's year is 2027, so last night's picture is last year's.
    const newYear = ZonedTimeSystem.shopNow(
      sofia('2027-01-01T00:10:00'),
      VISITS_TIME_ZONE,
    );
    expect(moment('2026-12-31T23:50:00', 'bg-BG', newYear).day).toBe(
      '31.12.2026 г.',
    );
    expect(moment('2027-01-01T00:05:00', 'bg-BG', newYear).day).toBe('1.01');
  });

  it('reads the stamp once on the shop’s calendar: the day and the time never straddle midnight', () => {
    // 02:30 in Sofia is 23:30 UTC the day before.
    const lateNight = moment('2026-09-04T02:30:00', 'bg-BG');
    expect(lateNight).toEqual({
      when: '4.09, 02:30',
      day: '4.09',
      time: '02:30',
    });
  });

  it('is pure: same input → same output', () => {
    const at = sofia('2026-09-04T16:21:00');
    const once = photoMomentOf(at, VISITS_TIME_ZONE, NOW, 'bg-BG');
    const twice = photoMomentOf(at, VISITS_TIME_ZONE, NOW, 'bg-BG');
    expect(twice).toEqual(once);
    expect(NOW).toEqual(
      ZonedTimeSystem.shopNow(sofia('2026-09-28T12:40:00'), VISITS_TIME_ZONE),
    );
  });
});
