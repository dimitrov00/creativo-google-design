import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { BirthDate } from './birth-date';

/**
 * Fixed "today" — never `new Date()`/`Date.now()` anywhere in this file,
 * per the blueprint §7.1 fix this VO exists to enforce.
 */
function today(): ZonedDateTime {
  const result = ZonedDateTime.fromISO('2026-07-22T12:00:00', 'Europe/Sofia');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('BirthDate.create', () => {
  it('accepts someone exactly 16 today', () => {
    const result = BirthDate.create('2010-07-22', today());
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects someone who turns 16 tomorrow (15 today)', () => {
    const result = BirthDate.create('2010-07-23', today());
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe('accounts.birth_date.too_young');
    }
  });

  it('accepts someone exactly 120 today', () => {
    const result = BirthDate.create('1906-07-22', today());
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects someone who is 121', () => {
    const result = BirthDate.create('1905-07-22', today());
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe('accounts.birth_date.too_old');
    }
  });

  it('rejects a malformed calendar date', () => {
    const result = BirthDate.create('not-a-date', today());
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe('accounts.birth_date.invalid');
    }
  });

  it('rejects a birth date in the future', () => {
    const result = BirthDate.create('2030-01-01', today());
    expect(result.isFailure()).toBe(true);
  });
});

describe('BirthDate.reconstitute', () => {
  it('accepts a stored date implying an age above 120 — only the format is re-checked', () => {
    const result = BirthDate.reconstitute('1800-01-01', today());
    expect(result.isSuccess()).toBe(true);
  });

  it('still rejects a malformed calendar date', () => {
    const result = BirthDate.reconstitute('not-a-date', today());
    expect(result.isFailure()).toBe(true);
  });
});

describe('BirthDate.ageAsOf / toISODate / equals', () => {
  it('computes whole-years age against an explicit today', () => {
    const result = BirthDate.create('2000-01-01', today());
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.ageAsOf(today())).toBe(26);
    expect(result.value.toISODate()).toBe('2000-01-01');
  });

  it('equals() compares by calendar day', () => {
    const a = BirthDate.create('2000-01-01', today());
    const b = BirthDate.create('2000-01-01', today());
    if (a.isFailure() || b.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(a.value.equals(b.value)).toBe(true);
  });
});
