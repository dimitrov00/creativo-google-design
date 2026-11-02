import { describe, expect, it } from 'vitest';
import { spanCopyOf, spanWords } from './span.words';
import { catalogueTranslate } from '../staff-dashboard/catalogue.spec-support';

const BG = spanCopyOf(catalogueTranslate('bg'));
const EN = spanCopyOf(catalogueTranslate('en'));

describe('spanWords — a length of time, never a bare minute count', () => {
  it('says minutes under an hour', () => {
    expect(spanWords(45, BG)).toBe('45 мин');
    expect(spanWords(45, EN)).toBe('45 min');
  });

  it('says whole hours alone', () => {
    expect(spanWords(60, BG)).toBe('1 ч');
    expect(spanWords(60, EN)).toBe('1 h');
  });

  it('says hours and the rest', () => {
    expect(spanWords(390, BG)).toBe('6 ч 30 мин');
    expect(spanWords(390, EN)).toBe('6 h 30 min');
  });

  it('rounds a fraction and floors a negative length at nothing', () => {
    expect(spanWords(29.6, EN)).toBe('30 min');
    expect(spanWords(-5, BG)).toBe('0 мин');
  });
});
