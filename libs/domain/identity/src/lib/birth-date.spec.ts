import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { BirthDate } from './birth-date';
import {
  BirthDateInFutureError,
  BirthDateInvalidError,
  BirthDateTooOldError,
  BirthDateTooYoungError,
} from './birth-date.errors';

const TODAY = ((): ZonedDateTime => {
  const result = ZonedDateTime.fromISO('2026-07-25T12:00:00', 'Europe/Sofia');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
})();

describe('BirthDate', () => {
  describe('create (from segments)', () => {
    it('accepts a real past date inside the age window and canonicalizes to ISO', () => {
      const result = BirthDate.create({ day: 3, month: 7, year: 1990 }, TODAY);
      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.value.toString()).toBe('1990-07-03');
        expect(result.value.toISODate()).toBe('1990-07-03');
        expect(result.value.day).toBe(3);
        expect(result.value.month).toBe(7);
        expect(result.value.year).toBe(1990);
      }
    });

    it('rejects an impossible calendar date (Feb 30) as invalid', () => {
      const result = BirthDate.create({ day: 30, month: 2, year: 1990 }, TODAY);
      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(BirthDateInvalidError);
        expect(result.error.code).toBe('identity.birth_date.invalid');
      }
    });

    it('rejects out-of-range segments without ever building a date', () => {
      for (const parts of [
        { day: 0, month: 5, year: 1990 },
        { day: 32, month: 5, year: 1990 },
        { day: 5, month: 13, year: 1990 },
        { day: 5.5, month: 5, year: 1990 },
        { day: 5, month: 5, year: 0 },
      ]) {
        const result = BirthDate.create(parts, TODAY);
        expect(result.isFailure()).toBe(true);
        if (result.isFailure()) {
          expect(result.error).toBeInstanceOf(BirthDateInvalidError);
        }
      }
    });

    it('rejects a date in the future', () => {
      const result = BirthDate.create({ day: 1, month: 1, year: 2027 }, TODAY);
      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(BirthDateInFutureError);
        expect(result.error.code).toBe('identity.birth_date.in_future');
      }
    });

    it('rejects an age below 16 — counting the birthday only once it has passed', () => {
      // Turns 16 tomorrow (2026-07-26) — still 15 today.
      const tooYoung = BirthDate.create(
        { day: 26, month: 7, year: 2010 },
        TODAY,
      );
      expect(tooYoung.isFailure()).toBe(true);
      if (tooYoung.isFailure()) {
        expect(tooYoung.error).toBeInstanceOf(BirthDateTooYoungError);
        expect(tooYoung.error.code).toBe('identity.birth_date.too_young');
      }

      // Turned 16 today — accepted.
      const justSixteen = BirthDate.create(
        { day: 25, month: 7, year: 2010 },
        TODAY,
      );
      expect(justSixteen.isSuccess()).toBe(true);
    });

    it('rejects an age above 120', () => {
      const result = BirthDate.create({ day: 1, month: 1, year: 1900 }, TODAY);
      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(BirthDateTooOldError);
        expect(result.error.code).toBe('identity.birth_date.too_old');
      }
    });
  });

  describe('createFromISO (the server boundary)', () => {
    it('accepts a strict YYYY-MM-DD string with the same invariants', () => {
      const result = BirthDate.createFromISO('1990-07-03', TODAY);
      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.value.toString()).toBe('1990-07-03');
      }
    });

    it('rejects non-ISO shapes outright', () => {
      for (const raw of ['03.07.1990', '1990-7-3', '19900703', 'yesterday']) {
        const result = BirthDate.createFromISO(raw, TODAY);
        expect(result.isFailure()).toBe(true);
        if (result.isFailure()) {
          expect(result.error).toBeInstanceOf(BirthDateInvalidError);
        }
      }
    });

    it('applies the same age window as create', () => {
      const result = BirthDate.createFromISO('2020-01-01', TODAY);
      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(BirthDateTooYoungError);
      }
    });
  });

  describe('fromPrimitive', () => {
    it('rebuilds a stored value without re-running creation invariants', () => {
      const rebuilt = BirthDate.fromPrimitive('1990-07-03');
      expect(rebuilt.toString()).toBe('1990-07-03');
    });
  });

  it('equals compares by calendar date', () => {
    const a = BirthDate.fromPrimitive('1990-07-03');
    const b = BirthDate.fromPrimitive('1990-07-03');
    const c = BirthDate.fromPrimitive('1990-07-04');
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
