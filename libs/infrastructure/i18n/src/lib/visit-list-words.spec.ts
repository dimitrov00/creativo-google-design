import { describe, expect, it } from 'vitest';
import { VisitFilter, VisitGrain, VisitPerspective } from '@core/systems';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import {
  visitFilterWords,
  visitGrainWords,
  visitPerspectiveWords,
} from './visit-list-words';

/*
 * ONE table per visit-list dictionary (UI residue cleanup §2.2): total over
 * its dictionary, the words today's keys, test ids and DOM attributes spell
 * (the five filter words, the two grain words, the two perspective words),
 * and every filter word a key both catalogues hold.
 */
describe('visitFilterWords', () => {
  it('words every VisitFilter as today’s key segment and test-id suffix', () => {
    expect(visitFilterWords).toEqual({
      ALL: 'all',
      UPCOMING: 'upcoming',
      COMPLETED: 'completed',
      CANCELLED: 'cancelled',
      NO_SHOW: 'no_show',
    });
    expect(Object.keys(visitFilterWords).sort()).toEqual(
      Object.values(VisitFilter).sort(),
    );
  });

  it('names a visits.filter key in both catalogues', () => {
    for (const word of Object.values(visitFilterWords)) {
      expect(en.visits.filter).toHaveProperty(word);
      expect(bg.visits.filter).toHaveProperty(word);
    }
  });
});

describe('visitGrainWords', () => {
  it('words every VisitGrain as today’s section test-id segment', () => {
    expect(visitGrainWords).toEqual({ MONTH: 'month', YEAR: 'year' });
    expect(Object.keys(visitGrainWords).sort()).toEqual(
      Object.values(VisitGrain).sort(),
    );
  });
});

describe('visitPerspectiveWords', () => {
  it('words every VisitPerspective as today’s data-perspective value', () => {
    expect(visitPerspectiveWords).toEqual({ CLIENT: 'client', STAFF: 'staff' });
    expect(Object.keys(visitPerspectiveWords).sort()).toEqual(
      Object.values(VisitPerspective).sort(),
    );
  });
});
