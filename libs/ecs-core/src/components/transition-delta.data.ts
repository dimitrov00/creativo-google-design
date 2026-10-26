import type {
  AttendanceState,
  BookingStatus,
  UtcEpochMs,
} from '@core/primitives';

/**
 * What a staff lifecycle verb moved the visit FROM — the before of a
 * `BOOKING_STAFF_*` transition row (audit-hardening WS-2), intersected into
 * {@link AuditContext.Transition}: the root state it left and that state's
 * entering stamp (`BookingLifecycle.enteredAtUtcMs` — the field the
 * transition deletes, F-20), and — for a ONE-seat act — that seat's prior
 * attendance; `null` for a party act. The after is the act's verb itself.
 */
export type TransitionDelta = {
  readonly transitionFromBookingStatus: BookingStatus;
  readonly transitionFromStatusAtUtcMs: UtcEpochMs;
  readonly transitionFromAttendanceState: AttendanceState | null;
};
