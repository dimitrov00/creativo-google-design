import type { BookingCall, CancellationReason } from '@core/components';
import type { AppointmentId, BookingStatus, SeatId } from '@core/primitives';

/**
 * One lifecycle move as the call carries it — the whole party (`seatId`
 * `null`) or one seat; a reason only on a cancellation, and a CODE only
 * (D23): what the barber typed beside «Друго…» is the visit's note, written
 * once the cancel has landed (`confirmCancel`), never the call's. The
 * INTENT only: the store names each act (`operationId`, WS-4.1).
 *
 * Beside the page since staff-analytics-v2 PR 1, which the page's line cap
 * had no room for.
 */
export function transitionOf(
  appointmentId: AppointmentId,
  toBookingStatus: BookingStatus,
  cancellationReason: CancellationReason | null,
  seatId: SeatId | null,
): BookingCall.TransitionIntent {
  return { appointmentId, toBookingStatus, cancellationReason, seatId };
}
