import type { AppointmentId, UtcEpochMs } from '@core/primitives';

/**
 * Why a client may not cancel (or move) a visit for free, and why the cancel
 * callable refuses a call before the policy is read — the ONLY source of
 * these strings, the field `errorCode` (Law 7.5: every error dictionary
 * lives in the `@core/errors` tier; moved out of
 * `cancellation-policy.system.ts` in Phase 4a 4A-6, out of primitives on
 * 2026-10-23). A move is refused on the same rule as a cancel
 * (`CancellationPolicySystem.mayMove`), so it shares the policy codes.
 *
 * Every field beside `errorCode` is a scalar i18n parameter: the visit's
 * state as its SCREAMING `bookingStatus` value (the errors tier imports only
 * primitives, never a component), the window in whole hours and the deadline as an instant.
 */
export const CancellationRefusalCode = {
  /** The policy could not be read: nobody can say whether it is still free. */
  PolicyUnavailable: 'BOOKING_CANCEL_POLICY_UNAVAILABLE',
  /** Completed, no-showed or already cancelled — the graph refuses. */
  NotCancellable: 'BOOKING_CANCEL_NOT_CANCELLABLE',
  /** Past the free-cancellation deadline — call the shop instead. */
  WindowClosed: 'BOOKING_CANCEL_WINDOW_CLOSED',
  /** Nobody is signed in (was the wire's `booking.cancel.unauthenticated`). */
  Unauthenticated: 'BOOKING_CANCEL_UNAUTHENTICATED',
  /** The call named no visit, or no reason (was `booking.cancel.invalid_input`). */
  InvalidInput: 'BOOKING_CANCEL_INVALID_INPUT',
  /** No such visit, or not the caller's — one answer (was `booking.cancel.not_found`). */
  NotFound: 'BOOKING_CANCEL_NOT_FOUND',
} as const;
export type CancellationRefusalCode =
  (typeof CancellationRefusalCode)[keyof typeof CancellationRefusalCode];

/** What the policy refuses with (`CancellationPolicySystem.mayCancel` / `mayMove`). */
export type CancellationRefusal =
  | CancellationRefusal.PolicyUnavailable
  | CancellationRefusal.NotCancellable
  | CancellationRefusal.WindowClosed;

/** Every refusal the cancel callable can answer with: the policy's and the call's own. */
export type CancelCallRefusal =
  | CancellationRefusal
  | CancellationRefusal.Unauthenticated
  | CancellationRefusal.InvalidInput
  | CancellationRefusal.NotFound;

const C = CancellationRefusalCode;

export const CancellationRefusal = {
  policyUnavailable(): CancellationRefusal.PolicyUnavailable {
    return { errorCode: C.PolicyUnavailable };
  },
  /** `bookingStatus` — the SCREAMING state the visit is in (a `BookingStatus` value). */
  notCancellable(bookingStatus: string): CancellationRefusal.NotCancellable {
    return { errorCode: C.NotCancellable, bookingStatus };
  },
  windowClosed(
    windowHours: number,
    deadlineUtcMs: UtcEpochMs,
  ): CancellationRefusal.WindowClosed {
    return { errorCode: C.WindowClosed, windowHours, deadlineUtcMs };
  },
  unauthenticated(): CancellationRefusal.Unauthenticated {
    return { errorCode: C.Unauthenticated };
  },
  invalidInput(field: string): CancellationRefusal.InvalidInput {
    return { errorCode: C.InvalidInput, field };
  },
  notFound(appointmentId: AppointmentId): CancellationRefusal.NotFound {
    return { errorCode: C.NotFound, appointmentId };
  },

  /** Narrows a refusal to one code. */
  is<K extends CancellationRefusalCode>(
    error: CancelCallRefusal,
    errorCode: K,
  ): error is Extract<CancelCallRefusal, { readonly errorCode: K }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace CancellationRefusal {
  export type PolicyUnavailable = {
    readonly errorCode: typeof CancellationRefusalCode.PolicyUnavailable;
  };
  export type NotCancellable = {
    readonly errorCode: typeof CancellationRefusalCode.NotCancellable;
    /** The state the visit is in — a SCREAMING `BookingStatus` value (was `status`). */
    readonly bookingStatus: string;
  };
  export type WindowClosed = {
    readonly errorCode: typeof CancellationRefusalCode.WindowClosed;
    readonly windowHours: number;
    readonly deadlineUtcMs: UtcEpochMs;
  };
  export type Unauthenticated = {
    readonly errorCode: typeof CancellationRefusalCode.Unauthenticated;
  };
  /** `field` names the payload field that was missing or malformed. */
  export type InvalidInput = {
    readonly errorCode: typeof CancellationRefusalCode.InvalidInput;
    readonly field: string;
  };
  export type NotFound = {
    readonly errorCode: typeof CancellationRefusalCode.NotFound;
    readonly appointmentId: AppointmentId;
  };
}
