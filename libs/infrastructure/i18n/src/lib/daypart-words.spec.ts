import { describe, expect, it } from 'vitest';
import { Daypart } from '@core/components';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import { daypartWords } from './daypart-words';

/*
 * ONE table for the parts of the day (UI residue cleanup, UR-3): total over
 * `Daypart`, the words today's keys spell, and every word a key under both
 * of its prefixes in both catalogues.
 */
describe('daypartWords', () => {
  it('words every Daypart as today’s key segment', () => {
    expect(daypartWords).toEqual({
      MORNING: 'morning',
      AFTERNOON: 'afternoon',
      EVENING: 'evening',
    });
    expect(Object.keys(daypartWords).sort()).toEqual([...Daypart.ALL].sort());
  });

  it('names a booking.schedule.daypart and a clientCard.visits.daypart key in both catalogues', () => {
    for (const word of Object.values(daypartWords)) {
      for (const catalogue of [en, bg]) {
        expect(catalogue.booking.schedule.daypart).toHaveProperty(word);
        expect(catalogue.clientCard.visits.daypart).toHaveProperty(word);
      }
    }
  });
});
