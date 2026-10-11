import { describe, expect, it } from 'vitest';
import { localDate } from '../testing';
import { DateRange } from './date-range.data';

/* The successor of the DateRange cases of `day-key.data.spec.ts` (§1.3). */
describe('DateRange — an inclusive span of shop days', () => {
  const range = DateRange.of(localDate('2026-03-01'), localDate('2026-03-31'));

  it('is a flat struct', () => {
    expect(range).toEqual({
      fromLocalDate: '2026-03-01',
      toLocalDate: '2026-03-31',
    });
  });

  it('is valid unless the end precedes the start', () => {
    expect(DateRange.isValid(range)).toBe(true);
    expect(
      DateRange.isValid(
        DateRange.of(localDate('2026-03-01'), localDate('2026-03-01')),
      ),
    ).toBe(true);
    expect(
      DateRange.isValid(
        DateRange.of(localDate('2026-03-02'), localDate('2026-03-01')),
      ),
    ).toBe(false);
  });

  it('contains both ends and nothing outside', () => {
    expect(DateRange.contains(range, localDate('2026-03-01'))).toBe(true);
    expect(DateRange.contains(range, localDate('2026-03-31'))).toBe(true);
    expect(DateRange.contains(range, localDate('2026-02-28'))).toBe(false);
    expect(DateRange.contains(range, localDate('2026-04-01'))).toBe(false);
  });
});
