import { describe, expect, it } from 'vitest';
import { BookingPolicy, type BookingPolicyProps } from './booking-policy';

const VALID: BookingPolicyProps = {
  maxPartySize: 5,
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonDays: 60,
  cancellationWindowHours: 24,
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
      BookingPolicy.create({ ...VALID, horizonDays: -1 }).isFailure(),
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
      horizonDays: 0,
      cancellationWindowHours: -1,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBe(5);
      expect(result.error.map((error) => error.field).sort()).toEqual([
        'cancellationWindowHours',
        'horizonDays',
        'maxPartySize',
        'minLeadMinutes',
        'slotStepMinutes',
      ]);
    }
  });
});
