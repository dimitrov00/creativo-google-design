import { describe, expect, it } from 'vitest';
import { BirthDate } from './birth-date.data';

// The identity and accounts birth-date.spec.ts calendar cases. Their age
// window cases (16–120, in the future) belong to AgeSystem, which owns
// "today" (blueprint §2.4, §2.8).
describe('BirthDate.fromParts — the form control edge', () => {
  it('accepts a real date and canonicalises to zero-padded ISO', () => {
    expect(BirthDate.fromParts({ day: 3, month: 7, year: 1990 })).toBe(
      '1990-07-03',
    );
  });

  it('rejects an impossible calendar date (Feb 30)', () => {
    expect(BirthDate.fromParts({ day: 30, month: 2, year: 1990 })).toBeNull();
  });

  it('rejects out-of-range segments', () => {
    for (const parts of [
      { day: 0, month: 5, year: 1990 },
      { day: 32, month: 5, year: 1990 },
      { day: 5, month: 13, year: 1990 },
      { day: 5, month: 0, year: 1990 },
      { day: 5.5, month: 5, year: 1990 },
      { day: 5, month: 5.5, year: 1990 },
      { day: 5, month: 5, year: 1990.5 },
      { day: 5, month: 5, year: 0 },
      { day: 5, month: 5, year: 10_000 },
    ]) {
      expect(BirthDate.fromParts(parts)).toBeNull();
    }
  });

  it('knows month lengths and the Gregorian leap rule', () => {
    expect(BirthDate.fromParts({ day: 29, month: 2, year: 2000 })).toBe(
      '2000-02-29',
    );
    expect(BirthDate.fromParts({ day: 29, month: 2, year: 2004 })).toBe(
      '2004-02-29',
    );
    expect(BirthDate.fromParts({ day: 29, month: 2, year: 1900 })).toBeNull();
    expect(BirthDate.fromParts({ day: 29, month: 2, year: 2001 })).toBeNull();
    expect(BirthDate.fromParts({ day: 31, month: 4, year: 1990 })).toBeNull();
    expect(BirthDate.fromParts({ day: 30, month: 4, year: 1990 })).toBe(
      '1990-04-30',
    );
    expect(BirthDate.fromParts({ day: 31, month: 12, year: 1990 })).toBe(
      '1990-12-31',
    );
  });

  it('pads a short year to four digits', () => {
    expect(BirthDate.fromParts({ day: 1, month: 1, year: 999 })).toBe(
      '0999-01-01',
    );
  });
});

describe('BirthDate.parse — the server edge', () => {
  it('accepts a strict YYYY-MM-DD string, trimmed', () => {
    expect(BirthDate.parse('1990-07-03')).toBe('1990-07-03');
    expect(BirthDate.parse(' 1990-07-03 ')).toBe('1990-07-03');
  });

  it('rejects non-ISO shapes outright', () => {
    for (const raw of [
      '03.07.1990',
      '1990-7-3',
      '19900703',
      'yesterday',
      '1990-07-03T00:00',
      '',
    ]) {
      expect(BirthDate.parse(raw)).toBeNull();
    }
  });

  it('rejects a well-shaped string that names no real day', () => {
    expect(BirthDate.parse('2001-02-29')).toBeNull();
    expect(BirthDate.parse('1990-13-01')).toBeNull();
    expect(BirthDate.parse('0000-01-01')).toBeNull();
  });
});

describe('BirthDate.partsOf', () => {
  it('reads the segments back for the form control', () => {
    expect(BirthDate.partsOf(BirthDate.of('1990-07-03'))).toEqual({
      year: 1990,
      month: 7,
      day: 3,
    });
  });

  it('round-trips through fromParts', () => {
    const date = BirthDate.of('2004-02-29');
    expect(BirthDate.fromParts(BirthDate.partsOf(date))).toBe(date);
  });
});

describe('BirthDate.of / equals', () => {
  it('rebuilds a stored value without re-running the guard', () => {
    expect(BirthDate.of('1990-07-03')).toBe('1990-07-03');
  });

  it('equals compares by calendar date', () => {
    const a = BirthDate.of('1990-07-03');
    expect(BirthDate.equals(a, BirthDate.of('1990-07-03'))).toBe(true);
    expect(BirthDate.equals(a, BirthDate.of('1990-07-04'))).toBe(false);
  });

  it('orders by plain string comparison', () => {
    expect(BirthDate.of('1989-12-31') < BirthDate.of('1990-01-01')).toBe(true);
  });

  it('is nominal: a raw string is not a BirthDate', () => {
    // @ts-expect-error — only BirthDate.of / parse / fromParts make one
    const raw: BirthDate = '1990-07-03';
    expect(raw).toBe('1990-07-03');
  });
});

describe('BirthDate.toLocalDate — the calendar day it names (pass E E-8)', () => {
  it('answers the stored day as a LocalDate', () => {
    expect(BirthDate.toLocalDate(BirthDate.of('1990-07-03'))).toBe(
      '1990-07-03',
    );
  });

  it('knows the Gregorian leap rule: 2000-02-29 is a day, 1990-02-29 is none', () => {
    expect(BirthDate.toLocalDate(BirthDate.of('2000-02-29'))).toBe(
      '2000-02-29',
    );
    expect(BirthDate.toLocalDate(BirthDate.of('1990-02-29'))).toBeNull();
  });

  it('answers null for a well-shaped string that names no day, and for a stored non-ISO shape', () => {
    expect(BirthDate.toLocalDate(BirthDate.of('2026-13-01'))).toBeNull();
    expect(BirthDate.toLocalDate(BirthDate.of('2026-04-31'))).toBeNull();
    expect(BirthDate.toLocalDate(BirthDate.of(' 1990-07-03'))).toBeNull();
    expect(BirthDate.toLocalDate(BirthDate.of('1990-7-3'))).toBeNull();
  });

  it('is pure: same input → same output, input untouched', () => {
    const stored = BirthDate.of('2004-02-29');
    const once = BirthDate.toLocalDate(stored);
    expect(BirthDate.toLocalDate(stored)).toBe(once);
    expect(stored).toBe('2004-02-29');
  });
});
