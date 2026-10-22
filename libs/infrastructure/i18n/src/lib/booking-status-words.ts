import { CancellationReason } from '@core/components';
import { BookingStatus } from '@core/primitives';

/*
 * The booking dictionaries' lowercase words (Phase 4a 4A-10, the flip-4
 * F4-7 precedent) — what the i18n keys (`appointments.status.<word>`,
 * `staff.day.cancelReasonCode.<word>`), the DOM attributes and the
 * transition refusal's interpolated `from`/`to` have always spelled. The
 * stored tags are SCREAMING; the words are not. ONE table per dictionary,
 * read by every surface that prints one (the feature-local `STATUS_KEY`,
 * `WIRE_STATUS` and `REASON_KEY` copies retire into these).
 */

/** A visit's status as its key segment and wire word. */
export const bookingStatusWords = {
  [BookingStatus.Pending]: 'pending',
  [BookingStatus.Confirmed]: 'confirmed',
  [BookingStatus.Completed]: 'completed',
  [BookingStatus.NoShow]: 'no_show',
  [BookingStatus.Cancelled]: 'cancelled',
} as const satisfies Record<BookingStatus, string>;

/** A cancellation's reason as its `staff.day.cancelReasonCode.<word>` segment. */
export const cancellationReasonWords = {
  [CancellationReason.ClientChangedPlans]: 'client_changed_plans',
  [CancellationReason.ClientUnwell]: 'client_unwell',
  [CancellationReason.StaffBarberAbsence]: 'staff_barber_absence',
  [CancellationReason.StaffShopClosure]: 'staff_shop_closure',
  [CancellationReason.NoShowConverted]: 'no_show_converted',
  [CancellationReason.Unspecified]: 'unspecified',
  [CancellationReason.Other]: 'other',
} as const satisfies Record<CancellationReason, string>;
