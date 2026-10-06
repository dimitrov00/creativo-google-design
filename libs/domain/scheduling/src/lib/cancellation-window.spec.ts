import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingPolicy, type BookingPolicyProps } from './booking-policy';
import {
  CANCELLATION_WINDOW_MAX_HOURS,
  CancellationWindow,
} from './cancellation-window';
import { InvalidCancellationWindowError } from './cancellation-window.errors';

const HOUR = 3_600_000;

const VALID_POLICY: BookingPolicyProps = {
  maxPartySize: 5,
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonMonths: 2,
  cancellationWindowHours: 24,
  maxFlexibleDays: 7,
  autoConfirm: true,
};

function windowOf(hours: number): CancellationWindow {
  const result = CancellationWindow.create(hours);
  if (result.isFailure()) throw new Error(`bad fixture: ${hours}`);
  return result.value;
}

/** Any whole number of hours the type holds, edges weighted in. */
const anyValidHours = fc.oneof(
  fc.integer({ min: 0, max: 8_760 }),
  fc.integer({ min: 0, max: CANCELLATION_WINDOW_MAX_HOURS }),
  fc.constantFrom(0, 1, CANCELLATION_WINDOW_MAX_HOURS),
);

/** Every kind of number a caller or a stored document could hand over. */
const anyNumber = fc.oneof(
  fc.integer({ min: -1_000, max: 1_000 }),
  fc.double(),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    0.5,
    1.5,
    -1,
    CANCELLATION_WINDOW_MAX_HOURS,
    CANCELLATION_WINDOW_MAX_HOURS + 1,
    Number.MAX_SAFE_INTEGER,
    1e300,
  ),
);

/** The instants a visit may start at — around now, either side of 1970 too. */
const anyStartMs = fc.integer({
  min: -4_102_444_800_000,
  max: 4_102_444_800_000,
});

/** `Date`'s range: ±8.64e15 ms around the epoch. */
const TIME_RANGE_MS = 8_640_000_000_000_000;

/**
 * The starts the bound makes its promise for: the epoch onwards, to the end
 * of the time range — edges and this century weighted in.
 */
const anyVisitStartMs = fc.oneof(
  fc.integer({ min: 0, max: 4_102_444_800_000 }),
  fc.integer({ min: 0, max: TIME_RANGE_MS }),
  fc.constantFrom(0, Date.UTC(2026, 8, 25, 10), TIME_RANGE_MS),
);

describe('CancellationWindow.create', () => {
  it('accepts every whole, non-negative number of hours, as given', () => {
    fc.assert(
      fc.property(anyValidHours, (hours) => {
        const result = CancellationWindow.create(hours);
        expect(result.isSuccess()).toBe(true);
        expect(result.isSuccess() && result.value.hours).toBe(hours);
      }),
    );
  });

  it('refuses a negative window with its stable code', () => {
    fc.assert(
      fc.property(fc.integer({ max: -1 }), (hours) => {
        const result = CancellationWindow.create(hours);
        expect(result.isFailure()).toBe(true);
        if (result.isFailure()) {
          expect(result.error).toBeInstanceOf(InvalidCancellationWindowError);
          expect(result.error.code).toBe(
            'scheduling.cancellation_window.invalid',
          );
          expect(result.error.rawValue).toBe(hours);
        }
      }),
    );
  });

  it('refuses anything that is not a whole number — fractions, NaN, infinities', () => {
    fc.assert(
      fc.property(
        fc.double().filter((value) => !Number.isInteger(value)),
        (hours) => {
          expect(CancellationWindow.create(hours).isFailure()).toBe(true);
        },
      ),
    );
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0.5,
      23.999,
    ]) {
      expect(CancellationWindow.create(bad).isFailure()).toBe(true);
    }
  });

  it('refuses a window too long for its deadline to stay a real instant', () => {
    expect(CANCELLATION_WINDOW_MAX_HOURS).toBe(2_400_000_000);
    expect(
      CancellationWindow.create(CANCELLATION_WINDOW_MAX_HOURS).isSuccess(),
    ).toBe(true);
    for (const tooLong of [
      CANCELLATION_WINDOW_MAX_HOURS + 1,
      // The old bound: it kept only `hours × 1 h` a safe integer, and put a
      // 2026 visit's deadline at −9.0e15 ms — outside anything `Date` holds.
      Math.floor(Number.MAX_SAFE_INTEGER / HOUR),
      Number.MAX_SAFE_INTEGER,
      1e300,
    ]) {
      expect(CancellationWindow.create(tooLong).isFailure()).toBe(true);
    }
  });

  it('accepts exactly the numbers it keeps: success ⇔ whole, ≥ 0, within the bound', () => {
    fc.assert(
      fc.property(anyNumber, (hours) => {
        const expected =
          Number.isInteger(hours) &&
          hours >= 0 &&
          hours <= CANCELLATION_WINDOW_MAX_HOURS;
        expect(CancellationWindow.create(hours).isSuccess()).toBe(expected);
      }),
    );
  });

  it('stores negative zero as the zero every reader compares against', () => {
    expect(Object.is(windowOf(-0).hours, 0)).toBe(true);
    expect(windowOf(-0).equals(windowOf(0))).toBe(true);
  });

  it('is equal by its hours, and only by them', () => {
    fc.assert(
      fc.property(anyValidHours, anyValidHours, (a, b) => {
        expect(windowOf(a).equals(windowOf(b))).toBe(a === b);
      }),
    );
  });
});

describe('CancellationWindow — the deadline', () => {
  it('draws it exactly `hours` before any visit’s start, as a real instant — exact, safe, and one `Date` holds (property)', () => {
    fc.assert(
      fc.property(anyValidHours, anyVisitStartMs, (hours, startMs) => {
        const deadline = windowOf(hours).deadlineMs(startMs);
        // Exact: what arbitrary-precision arithmetic says, to the ms.
        expect(BigInt(deadline)).toBe(
          BigInt(startMs) - BigInt(hours) * BigInt(HOUR),
        );
        expect(Number.isSafeInteger(deadline)).toBe(true);
        // …and an instant the page can name: `Date` holds it.
        expect(Number.isNaN(new Date(deadline).getTime())).toBe(false);
      }),
    );
  });

  it('meets the edge of the time range exactly at the longest window, from the epoch', () => {
    const deadline = windowOf(CANCELLATION_WINDOW_MAX_HOURS).deadlineMs(0);
    expect(deadline).toBe(-TIME_RANGE_MS);
    expect(new Date(deadline).getTime()).toBe(-TIME_RANGE_MS);
    // One millisecond further is no instant at all.
    expect(Number.isNaN(new Date(deadline - 1).getTime())).toBe(true);
  });

  it('still draws a finite deadline for a start before the epoch — the bound makes no promise there', () => {
    fc.assert(
      fc.property(anyValidHours, anyStartMs, (hours, startMs) => {
        expect(Number.isFinite(windowOf(hours).deadlineMs(startMs))).toBe(true);
      }),
    );
  });

  it('is free AT the deadline and not a millisecond past it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        anyStartMs,
        (hours, startMs) => {
          const window = windowOf(hours);
          const deadline = window.deadlineMs(startMs);
          expect(window.allowsFreeCancelAt(startMs, deadline)).toBe(true);
          expect(window.allowsFreeCancelAt(startMs, deadline - 1)).toBe(true);
          expect(window.allowsFreeCancelAt(startMs, deadline + 1)).toBe(false);
        },
      ),
    );
  });

  it('a longer window never frees a cancel a shorter one refused', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        fc.integer({ min: 0, max: 8_760 }),
        anyStartMs,
        fc.integer({ min: -8_760 * HOUR, max: 8_760 * HOUR }),
        (a, b, startMs, offsetMs) => {
          const [shorter, longer] = a <= b ? [a, b] : [b, a];
          const atMs = startMs + offsetMs;
          if (!windowOf(shorter).allowsFreeCancelAt(startMs, atMs)) {
            expect(windowOf(longer).allowsFreeCancelAt(startMs, atMs)).toBe(
              false,
            );
          }
        },
      ),
    );
  });
});

/*
 * ── ONE RULE FOR THE NUMBER ──────────────────────────────────────────────
 * The policy validates its window through this type, so the setting and the
 * stamp a cancelled seat carries can never disagree about what a window is.
 */
describe('CancellationWindow — the booking policy’s own rule', () => {
  it('a policy accepts a window exactly when the value object does', () => {
    fc.assert(
      fc.property(anyNumber, (hours) => {
        const policy = BookingPolicy.create({
          ...VALID_POLICY,
          cancellationWindowHours: hours,
        });
        expect(policy.isSuccess()).toBe(
          CancellationWindow.create(hours).isSuccess(),
        );
        if (policy.isFailure()) {
          expect(policy.error.map((error) => error.field)).toEqual([
            'cancellationWindowHours',
          ]);
        }
      }),
    );
  });

  it('carries the window it was given, and draws the same deadline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_760 }),
        anyStartMs,
        (hours, startMs) => {
          const policy = BookingPolicy.create({
            ...VALID_POLICY,
            cancellationWindowHours: hours,
          });
          if (policy.isFailure()) throw new Error('unexpected failure');
          expect(policy.value.cancellationWindowHours).toBe(hours);
          expect(policy.value.cancellationWindow.equals(windowOf(hours))).toBe(
            true,
          );
          expect(policy.value.cancellationDeadlineMs(startMs)).toBe(
            windowOf(hours).deadlineMs(startMs),
          );
        },
      ),
    );
  });
});
