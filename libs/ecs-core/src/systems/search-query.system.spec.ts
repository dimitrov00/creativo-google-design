import { describe, expect, it } from 'vitest';
import { PhoneReadingKind } from '@core/components';
import { SearchQuerySystem } from './search-query.system';

const CC = '359';
const read = (raw: string) => SearchQuerySystem.read(raw, CC);

describe('SearchQuerySystem.read — what the field was typed as', () => {
  it('reads words as folded terms and no number', () => {
    const query = read('Иван Петров');
    expect(query.queryTerms).toEqual(['иван', 'петров']);
    expect(query.queryPhone.phoneReadingKind).toBe(PhoneReadingKind.None);
  });

  it('reads a bare number as a phone reading and no terms', () => {
    const query = read('088 333');
    expect(query.queryTerms).toEqual([]);
    expect(query.queryPhone).toEqual({
      phoneReadingKind: PhoneReadingKind.International,
      phoneReadingCandidates: ['35988333'],
    });
  });

  it('reads a name beside a number as both', () => {
    const query = read('Иван 088 333');
    expect(query.queryTerms).toEqual(['иван']);
    expect(query.queryPhone.phoneReadingCandidates).toEqual(['35988333']);
    expect(read('088 333 Иван')).toEqual(query);
  });

  it('keeps a figure with too few digits as a word', () => {
    const query = read('Иван 12');
    expect(query.queryTerms).toEqual(['иван', '12']);
    expect(query.queryPhone.phoneReadingKind).toBe(PhoneReadingKind.None);
  });

  it('reads a typed + number as typed, and 00 as +', () => {
    expect(read('+359 88 333').queryPhone.phoneReadingCandidates).toEqual([
      '35988333',
    ]);
    expect(read('00359 88 333').queryPhone.phoneReadingCandidates).toEqual([
      '35988333',
    ]);
  });

  it('keeps a mail fragment as a word, folded', () => {
    expect(read('Maria@Mail.bg').queryTerms).toEqual(['maria@mail.bg']);
    expect(read('Иван ivan@').queryTerms).toEqual(['иван', 'ivan@']);
  });

  it('reads nothing from blanks', () => {
    expect(read('   ')).toEqual({
      queryTerms: [],
      queryPhone: {
        phoneReadingKind: PhoneReadingKind.None,
        phoneReadingCandidates: [],
      },
    });
  });

  it('is pure: same input → same output', () => {
    expect(read('Иван 088 333')).toEqual(read('Иван 088 333'));
  });
});
