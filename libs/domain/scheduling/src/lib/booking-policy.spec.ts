import { describe, expect, it } from 'vitest';
import { BookingPolicy, type BookingPolicyProps } from './booking-policy';
import { CalendarDay } from './calendar-day';

const VALID: BookingPolicyProps = {
  maxPartySize: 5,
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonMonths: 2,
  cancellationWindowHours: 24,
  maxFlexibleDays: 7,
};

describe('BookingPolicy', () => {
  it('accepts the shipping defaults', () => {
    const policy = BookingPolicy.default();
    expect(policy.slotStepMinutes).toBe(15);
    expect(policy.minLeadMinutes).toBe(120);
    expect(policy.maxPartySize).toBe(5);
  });

  it('allows zero lead time and a zero cancellation window', () => {
    // A shop that takes walk-ups right now, and one with no free-cancel
    // window, are both legitimate configurations — not errors.
    const result = BookingPolicy.create({
      ...VALID,
      minLeadMinutes: 0,
      cancellationWindowHours: 0,
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a step that does not divide the hour', () => {
    // A 25-minute grid drifts against every readable time — 09:00, 09:25,
    // 09:50, 10:15 — which reads as a bug to anyone looking at it.
    for (const slotStepMinutes of [7, 25, 45]) {
      expect(
        BookingPolicy.create({ ...VALID, slotStepMinutes }).isFailure(),
      ).toBe(true);
    }
    for (const slotStepMinutes of [5, 10, 15, 20, 30, 60]) {
      expect(
        BookingPolicy.create({ ...VALID, slotStepMinutes }).isSuccess(),
      ).toBe(true);
    }
  });

  it('rejects non-positive and non-integer values', () => {
    expect(
      BookingPolicy.create({ ...VALID, maxPartySize: 0 }).isFailure(),
    ).toBe(true);
    expect(
      BookingPolicy.create({ ...VALID, horizonMonths: -1 }).isFailure(),
    ).toBe(true);
    expect(
      BookingPolicy.create({ ...VALID, slotStepMinutes: 7.5 }).isFailure(),
    ).toBe(true);
    expect(
      BookingPolicy.create({ ...VALID, minLeadMinutes: -30 }).isFailure(),
    ).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = BookingPolicy.create({
      maxPartySize: 0,
      slotStepMinutes: 0,
      minLeadMinutes: -1,
      horizonMonths: 0,
      cancellationWindowHours: -1,
      maxFlexibleDays: 0,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBe(6);
      expect(result.error.map((error) => error.field).sort()).toEqual([
        'cancellationWindowHours',
        'horizonMonths',
        'maxFlexibleDays',
        'maxPartySize',
        'minLeadMinutes',
        'slotStepMinutes',
      ]);
    }
  });
});

describe('BookingPolicy — horizon', () => {
  const day = (key: string) => {
    const result = CalendarDay.create(key, 'Europe/Sofia');
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  };

  const withMonths = (horizonMonths: number) => {
    const result = BookingPolicy.create({ ...VALID, horizonMonths });
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  };

  it('ends on the LAST day of the final month, not a day count later', () => {
    // The calendar this bounds renders whole months; a 60-day horizon ends
    // mid-March, leaving half a grid that looks like a fully-booked shop
    // rather than the edge of the booking window.
    expect(withMonths(2).horizonEndFrom(day('2026-08-03')).key()).toBe(
      '2026-10-31',
    );
  });

  it('does not clamp to a short month when starting on the 31st', () => {
    // Naive month arithmetic turns 31 Jan + 1 month into 28 Feb and then
    // 28 Feb + 1 into 28 Mar, quietly losing three days of the horizon.
    expect(withMonths(2).horizonEndFrom(day('2026-01-31')).key()).toBe(
      '2026-03-31',
    );
  });

  it('handles a leap February', () => {
    expect(withMonths(1).horizonEndFrom(day('2028-01-15')).key()).toBe(
      '2028-02-29',
    );
  });

  it('opens the current month only at one', () => {
    expect(withMonths(1).horizonEndFrom(day('2026-08-03')).key()).toBe(
      '2026-09-30',
    );
  });
});

describe('cancellation window', () => {
  it('draws the deadline exactly windowHours before the start', () => {
    const policy = BookingPolicy.default(); // 24h window
    const start = Date.UTC(2026, 7, 10, 10, 0);
    expect(policy.cancellationDeadlineMs(start)).toBe(start - 24 * 3_600_000);
  });

  it('permits AT the deadline and refuses one millisecond past it', () => {
    const policy = BookingPolicy.default();
    const start = Date.UTC(2026, 7, 10, 10, 0);
    const deadline = policy.cancellationDeadlineMs(start);
    expect(policy.mayCancelAt(start, deadline)).toBe(true);
    expect(policy.mayCancelAt(start, deadline + 1)).toBe(false);
  });
});
