import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidCancellationWindowError } from './cancellation-window.errors';

const MS_PER_HOUR = 3_600_000;

/**
 * The ECMAScript time range: `Date` holds instants up to 100,000,000 days
 * either side of the epoch, 8.64e15 ms, and is Invalid past it — which the
 * appointments page's `Intl.DateTimeFormat` answers with a `RangeError`.
 */
const TIME_RANGE_MS = 8_640_000_000_000_000;

/**
 * The longest window the type holds: 2,400,000,000 hours, exactly the time
 * range's half-width.
 *
 * What it guarantees, and only for this: for every visit that starts at or
 * after the epoch and inside the time range, the deadline
 * (`start − hours × 1 h`) is a REAL instant — an exact, safe integer of
 * milliseconds that `Date` can hold, so the page that names it and the
 * callable that refuses by it read the same millisecond. Proof: the start
 * and the window are both in [0, 8.64e15], so their difference is in
 * [−8.64e15, 8.64e15]; every integer there is safe (8.64e15 < 2⁵³), so the
 * subtraction is exact, and the whole interval is the time range.
 * (The previous bound only kept `hours × 1 h` itself a safe integer: its
 * longest windows put a 2026 start's deadline outside `Date`, at −9.0e15.)
 * A start before 1970 is not a visit this app can hold, and gets no promise.
 *
 * An ARITHMETIC bound, not a product one — it is some 274,000 years. No
 * owner ruling caps the window (a window longer than the booking horizon is
 * a shop that takes no free cancellations online, which is a choice), so
 * none is invented here.
 */
export const CANCELLATION_WINDOW_MAX_HOURS = TIME_RANGE_MS / MS_PER_HOUR;

/**
 * How long before a visit's start a client may still cancel it for free —
 * the booking policy's free-cancellation window, as a value.
 *
 * ### One rule, three readers
 * The same number is (1) the tenant's setting (`BookingPolicy`), (2) the
 * stamp a cancelled seat carries — the window IN FORCE when it was called
 * off (`SeatOutcome` `cancelled`, 2026-09-25) — and (3) the line the stats
 * judge "late" by. A raw number in (2) was the hole: a caller could stamp
 * `NaN`, `-1` or `1.5`, the mapper wrote it, the reader refused it as not a
 * window, and the stats silently judged that cancellation by today's window
 * instead. Every one of the three now holds this type, so a stamp is a
 * window the policy itself could have set, by construction.
 *
 * ### Whole hours
 * Exactly the policy's own rule for the field, since the policy validates
 * through `create` here: an integer, zero or more. Zero is legitimate — a
 * shop with no free-cancellation window.
 *
 * "Unknown" is NOT a window, so it is not an instance: a cancellation
 * recorded before the stamp, or one whose policy read failed, carries
 * `null`, and the stats judge it by the current policy.
 */
export class CancellationWindow {
  // A PRIVATE field, not just a private constructor: it makes the class
  // nominal, so no object literal shaped like a window can pass for one.
  private constructor(private readonly _hours: number) {}

  static create(
    hours: number,
  ): Result<CancellationWindow, InvalidCancellationWindowError> {
    if (
      !Number.isInteger(hours) ||
      hours < 0 ||
      hours > CANCELLATION_WINDOW_MAX_HOURS
    ) {
      return fail(new InvalidCancellationWindowError(hours));
    }
    // `-0` passes `Number.isInteger` and `< 0` both; store the zero every
    // reader compares against.
    return ok(new CancellationWindow(hours === 0 ? 0 : hours));
  }

  /** Whole hours, zero or more — what the settings and the stamp store. */
  get hours(): number {
    return this._hours;
  }

  /**
   * The last instant a cancellation is still free — the start minus the
   * window. The ONE formula: the callable that refuses a late client cancel,
   * the page that names the deadline, and the counter that calls a past
   * cancellation late all draw it here, so they agree to the millisecond.
   */
  deadlineMs(appointmentStartMs: number): number {
    return appointmentStartMs - this._hours * MS_PER_HOUR;
  }

  /** Free at `atMs`: at the deadline itself still is, a millisecond past is not. */
  allowsFreeCancelAt(appointmentStartMs: number, atMs: number): boolean {
    return atMs <= this.deadlineMs(appointmentStartMs);
  }

  equals(other: CancellationWindow): boolean {
    return this._hours === other._hours;
  }
}
