import type { BookingStatus, UtcEpochMs } from '@core/primitives';

/**
 * What a client's own cancel moved the visit FROM — the before of a
 * `BOOKING_CANCELLED` row (audit-hardening WS-2, RU-11), intersected into
 * {@link AuditContext.Cancelled}: the root state it left and that state's
 * entering stamp (`BookingLifecycle.enteredAtUtcMs`), which the cancel
 * deletes from the appointment (F-20) — so the row is where it survives.
 */
export type CancellationDelta = {
  readonly cancellationFromBookingStatus: BookingStatus;
  readonly cancellationFromStatusAtUtcMs: UtcEpochMs;
};
