import { Result, fail, ok } from '@creativo/domain/kernel';
import { UtcEpochMs, defect } from '@core/primitives';
import { CancellationPolicySystem } from '@core/systems';
import { InvalidCancellationWindowError } from './cancellation-window.errors';

/*
 * THIN SHIM (ECS migration Phase 2). The window's rule (whole hours, zero or
 * more, within the time-range bound) and its one deadline formula
 * (`start − hours × 1 h`, free AT the deadline) are
 * `CancellationPolicySystem`. This class keeps the legacy nominal value its
 * callers hold (`BookingPolicy.cancellationWindow`, the seat stamp) and only
 * converts.
 *
 * The legacy deadline takes any number of milliseconds — the property specs
 * draw starts across `Date`'s whole range, far past the years `UtcEpochMs`
 * holds — so the system's formula is read as an OFFSET from the epoch (an
 * instant every window reaches) and laid onto the legacy start. The
 * arithmetic is the system's, the value bit-for-bit the legacy one.
 */

/** The epoch as the brand — the anchor the window's offset is drawn from. */
function epoch(): UtcEpochMs {
  const zero = UtcEpochMs.of(0);
  // Unreachable: the epoch is inside every instant range.
  if (!zero.ok) defect('unreachable: the epoch');
  return zero.value;
}

/**
 * The longest window the type holds: 2,400,000,000 hours, exactly the time
 * range's half-width — so for every visit at or after the epoch the deadline
 * is a real, `Date`-representable instant. An arithmetic bound, not a
 * product one.
 */
// `CancellationPolicySystem.MAX_WINDOW_HOURS`, as a literal so loading this
// module evaluates nothing of the system (the eager bundle); both specs pin it.
export const CANCELLATION_WINDOW_MAX_HOURS = 2_400_000_000;

/**
 * How long before a visit's start a client may still cancel it for free —
 * the booking policy's free-cancellation window, as a value: the tenant's
 * setting, the stamp a cancelled seat carries, and the line the stats judge
 * "late" by. "Unknown" is not a window, so it is not an instance (`null`).
 */
export class CancellationWindow {
  // A PRIVATE field, not just a private constructor: it makes the class
  // nominal, so no object literal shaped like a window can pass for one.
  private constructor(private readonly _hours: number) {}

  static create(
    hours: number,
  ): Result<CancellationWindow, InvalidCancellationWindowError> {
    // The struct `Result` → the kernel's; the hours as validated (a
    // negative zero folded to the zero every reader compares against).
    const window = CancellationPolicySystem.windowOf(hours);
    return window.ok
      ? ok(new CancellationWindow(window.value))
      : fail(new InvalidCancellationWindowError(hours));
  }

  /** Whole hours, zero or more — what the settings and the stamp store. */
  get hours(): number {
    return this._hours;
  }

  /** The last instant a cancellation is still free — the start minus the window. */
  deadlineMs(appointmentStartMs: number): number {
    // `start − hours × 1 h`: the system's deadline for a visit AT the epoch
    // is exactly that offset.
    const offsetMs = CancellationPolicySystem.deadlineUtcMs(
      this._hours,
      epoch(),
    );
    return appointmentStartMs + offsetMs;
  }

  /** Free at `atMs`: at the deadline itself still is, a millisecond past is not. */
  allowsFreeCancelAt(appointmentStartMs: number, atMs: number): boolean {
    return atMs <= this.deadlineMs(appointmentStartMs);
  }

  equals(other: CancellationWindow): boolean {
    return this._hours === other._hours;
  }
}
