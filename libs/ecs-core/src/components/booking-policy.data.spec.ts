import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy } from './booking-policy.data';
import { DayKey } from './day-key.data';
import type { SchedulingError } from './scheduling-errors.data';

const VALID: BookingPolicy = {
  maxPartySize: 5,
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonMonths: 2,
  cancellationWindowHours: 24,
  maxFlexibleDays: 7,
  autoConfirm: true,
};

function fieldsOf(errors: readonly SchedulingError[]): readonly string[] {
  return errors
    .map((error) => ('field' in error ? error.field : error.code))
    .sort();
}

describe('BookingPolicy.DEFAULT', () => {
  it('is the shipping defaults — auto-confirm on (owner ruling 2026-08-07)', () => {
    expect(BookingPolicy.DEFAULT).toEqual(VALID);
    expect(BookingPolicy.create(BookingPolicy.DEFAULT).ok).toBe(true);
  });
});

describe('BookingPolicy.create', () => {
  it('allows zero lead time and a zero cancellation window', () => {
    const result = BookingPolicy.create({
      ...VALID,
      minLeadMinutes: 0,
      cancellationWindowHours: 0,
    });
    expect(result.ok).toBe(true);
  });

  it('stores a negative zero as the zero every reader compares against', () => {
    const result = BookingPolicy.create({
      ...VALID,
      minLeadMinutes: -0,
      cancellationWindowHours: -0,
    });
    if (!result.ok) throw new Error('expected a policy');
    expect(Object.is(result.value.minLeadMinutes, 0)).toBe(true);
    expect(Object.is(result.value.cancellationWindowHours, 0)).toBe(true);
  });

  it('rejects a step that does not divide the hour', () => {
    for (const slotStepMinutes of [7, 25, 45]) {
      expect(BookingPolicy.create({ ...VALID, slotStepMinutes }).ok).toBe(
        false,
      );
    }
    for (const slotStepMinutes of [5, 10, 15, 20, 30, 60]) {
      expect(BookingPolicy.create({ ...VALID, slotStepMinutes }).ok).toBe(true);
    }
  });

  it('rejects non-positive and non-integer values', () => {
    expect(BookingPolicy.create({ ...VALID, maxPartySize: 0 }).ok).toBe(false);
    expect(BookingPolicy.create({ ...VALID, horizonMonths: -1 }).ok).toBe(
      false,
    );
    expect(BookingPolicy.create({ ...VALID, slotStepMinutes: 7.5 }).ok).toBe(
      false,
    );
    expect(BookingPolicy.create({ ...VALID, minLeadMinutes: -30 }).ok).toBe(
      false,
    );
    expect(
      BookingPolicy.create({ ...VALID, cancellationWindowHours: 1.5 }).ok,
    ).toBe(false);
  });

  it('collects every invalid field at once', () => {
    const result = BookingPolicy.create({
      maxPartySize: 0,
      slotStepMinutes: 0,
      minLeadMinutes: -1,
      horizonMonths: 0,
      cancellationWindowHours: -1,
      maxFlexibleDays: 0,
      autoConfirm: true,
    });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toHaveLength(6);
    expect(fieldsOf(result.error)).toEqual([
      'cancellationWindowHours',
      'horizonMonths',
      'maxFlexibleDays',
      'maxPartySize',
      'minLeadMinutes',
      'slotStepMinutes',
    ]);
    for (const error of result.error) {
      expect(error.code).toBe('scheduling.booking_policy.invalid');
    }
  });
});

describe('BookingPolicy.equals — autoConfirm counts (the legacy defect)', () => {
  it('is field-wise over all seven fields', () => {
    expect(BookingPolicy.equals(VALID, { ...VALID })).toBe(true);
    expect(BookingPolicy.equals(VALID, { ...VALID, slotStepMinutes: 30 })).toBe(
      false,
    );
  });

  it('a flipped autoConfirm alone IS a policy change', () => {
    expect(BookingPolicy.equals(VALID, { ...VALID, autoConfirm: false })).toBe(
      false,
    );
  });

  it('differs on any single field (property)', () => {
    const changes: readonly BookingPolicy[] = [
      { ...VALID, maxPartySize: VALID.maxPartySize + 1 },
      { ...VALID, slotStepMinutes: VALID.slotStepMinutes + 1 },
      { ...VALID, minLeadMinutes: VALID.minLeadMinutes + 1 },
      { ...VALID, horizonMonths: VALID.horizonMonths + 1 },
      { ...VALID, cancellationWindowHours: VALID.cancellationWindowHours + 1 },
      { ...VALID, maxFlexibleDays: VALID.maxFlexibleDays + 1 },
      { ...VALID, autoConfirm: !VALID.autoConfirm },
    ];
    expect(changes).toHaveLength(Object.keys(VALID).length);
    fc.assert(
      fc.property(fc.constantFrom(...changes), (changed) => {
        return (
          !BookingPolicy.equals(VALID, changed) &&
          !BookingPolicy.equals(changed, VALID)
        );
      }),
    );
  });
});

describe('BookingPolicy.withDefaults — a usable policy, always', () => {
  it('serves the defaults for an absent or non-object document', () => {
    expect(BookingPolicy.withDefaults(null)).toBe(BookingPolicy.DEFAULT);
    expect(BookingPolicy.withDefaults(undefined)).toBe(BookingPolicy.DEFAULT);
    expect(BookingPolicy.withDefaults('policy')).toBe(BookingPolicy.DEFAULT);
  });

  it('reads the stored fields, falling back per field on a non-number', () => {
    expect(
      BookingPolicy.withDefaults({
        slotStepMinutes: 30,
        horizonMonths: '3',
        maxPartySize: 'many',
      }),
    ).toEqual({ ...VALID, slotStepMinutes: 30, horizonMonths: 3 });
  });

  it('auto-confirms a document that never chose (ruling default ON)', () => {
    expect(
      BookingPolicy.withDefaults({ slotStepMinutes: 30 }).autoConfirm,
    ).toBe(true);
    expect(BookingPolicy.withDefaults({ autoConfirm: false }).autoConfirm).toBe(
      false,
    );
    expect(BookingPolicy.withDefaults({ autoConfirm: 'no' }).autoConfirm).toBe(
      true,
    );
  });

  it('falls back to the whole default when a field the domain refuses remains', () => {
    expect(BookingPolicy.withDefaults({ slotStepMinutes: 25 })).toBe(
      BookingPolicy.DEFAULT,
    );
  });
});

describe('BookingPolicy — horizon', () => {
  const withMonths = (horizonMonths: number): BookingPolicy => ({
    ...VALID,
    horizonMonths,
  });
  const end = (months: number, today: string): string =>
    BookingPolicy.horizonEndFrom(withMonths(months), DayKey.of(today));

  it('ends on the LAST day of the final month, not a day count later', () => {
    expect(end(2, '2026-08-03')).toBe('2026-10-31');
  });

  it('does not clamp to a short month when starting on the 31st', () => {
    expect(end(2, '2026-01-31')).toBe('2026-03-31');
  });

  it('handles a leap February', () => {
    expect(end(1, '2028-01-15')).toBe('2028-02-29');
    expect(end(1, '2026-01-15')).toBe('2026-02-28');
  });

  it('opens the current month only at one', () => {
    expect(end(1, '2026-08-03')).toBe('2026-09-30');
  });

  it('crosses the year', () => {
    expect(end(2, '2026-11-20')).toBe('2027-01-31');
    expect(end(14, '2026-11-20')).toBe('2028-01-31');
  });
});

describe('cancellation window', () => {
  const start = Date.UTC(2026, 7, 10, 10, 0);

  it('draws the deadline exactly windowHours before the start', () => {
    expect(BookingPolicy.cancellationDeadlineMs(24, start)).toBe(
      start - 24 * 3_600_000,
    );
  });

  it('permits AT the deadline and refuses one millisecond past it', () => {
    const deadline = BookingPolicy.cancellationDeadlineMs(24, start);
    expect(BookingPolicy.mayCancelAt(VALID, start, deadline)).toBe(true);
    expect(BookingPolicy.mayCancelAt(VALID, start, deadline + 1)).toBe(false);
    expect(BookingPolicy.allowsFreeCancelAt(0, start, start)).toBe(true);
    expect(BookingPolicy.allowsFreeCancelAt(0, start, start + 1)).toBe(false);
  });

  it('accepts exactly the windows the policy could set', () => {
    expect(BookingPolicy.isValidCancellationWindowHours(0)).toBe(true);
    expect(BookingPolicy.isValidCancellationWindowHours(24)).toBe(true);
    expect(
      BookingPolicy.isValidCancellationWindowHours(
        BookingPolicy.CANCELLATION_WINDOW_MAX_HOURS,
      ),
    ).toBe(true);
    for (const hours of [
      -1,
      1.5,
      Number.NaN,
      BookingPolicy.CANCELLATION_WINDOW_MAX_HOURS + 1,
    ]) {
      expect(BookingPolicy.isValidCancellationWindowHours(hours)).toBe(false);
    }
  });

  it('keeps the deadline of the longest window an exact Date-representable instant', () => {
    const deadline = BookingPolicy.cancellationDeadlineMs(
      BookingPolicy.CANCELLATION_WINDOW_MAX_HOURS,
      start,
    );
    expect(Number.isSafeInteger(deadline)).toBe(true);
    expect(Math.abs(deadline)).toBeLessThanOrEqual(8_640_000_000_000_000);
  });
});
