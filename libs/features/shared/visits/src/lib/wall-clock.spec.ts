import { describe, expect, it } from 'vitest';
import { formatWeekdayLabels } from './wall-clock';

/*
 * The week's short day names (Phase 4a): the cases of
 * `ZonedDateTime.weekdayLabels` (`libs/domain/kernel`, deleted in 4b), with
 * today's bg and en output pinned character for character (recorded from
 * the Luxon labels before the class was retired).
 */
describe('formatWeekdayLabels', () => {
  it('names the week Monday first in English', () => {
    const labels = formatWeekdayLabels('en');
    expect(labels).toHaveLength(7);
    expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('names the week Monday first in Bulgarian', () => {
    expect(formatWeekdayLabels('bg')).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
  });

  it('answers the same cached list on every call for a locale', () => {
    expect(formatWeekdayLabels('bg')).toBe(formatWeekdayLabels('bg'));
  });
});
