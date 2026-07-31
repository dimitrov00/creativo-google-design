import {
  LocationId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { AppointmentId, SeatId } from './ids';
import { ScheduleExceptionId } from './schedule-exception';

/** How the booking arrived. An attribute of work, not a kind of work. */
export type BookingOrigin = 'online' | 'staff' | 'walk_in';

/** What became of the booked time. */
export type ServiceOutcome = 'scheduled' | 'worked' | 'no_show';

/** Time a barber is unavailable for reasons other than serving a client. */
export type AbsenceReason =
  | { readonly kind: 'break'; readonly paid: boolean }
  | { readonly kind: 'time_off'; readonly absenceId: ScheduleExceptionId }
  | {
      readonly kind: 'sick';
      readonly absenceId: ScheduleExceptionId;
      readonly paid: boolean;
    }
  | {
      readonly kind: 'training';
      readonly absenceId: ScheduleExceptionId;
      readonly topic: string | null;
    }
  | {
      readonly kind: 'travel';
      readonly absenceId: ScheduleExceptionId;
      readonly toLocationId: LocationId;
    }
  | {
      readonly kind: 'admin';
      readonly absenceId: ScheduleExceptionId;
      readonly note: string;
    };

/**
 * WHY a barber's time is occupied — the owner's "busy from services or else",
 * made a closed union so the question always has an answer.
 *
 * ### Two things that are deliberately NOT arms
 * - **walk-in** is an `origin` on the `service` arm. A walk-in occupies time
 *   and earns revenue identically to an online booking; the only difference is
 *   how it arrived. A separate arm would fork every "productive time" sum for
 *   no analytic gain.
 * - **no-show** is an `outcome` on the `service` arm, for the same reason plus
 *   a stronger one: a `no_show` arm would have to re-carry every field of
 *   `service` (which service, which seat, which client) and would lose the
 *   linkage the no-show report needs.
 *
 * ### And three that are derived, never stored
 * `closed`/`outside hours` and `idle` are both the COMPLEMENT of the day's
 * windows — storing them would re-partition the day on every roster edit.
 * `cancelled` REMOVES a block and appends an event; a cancelled booking that
 * still occupied time would keep blocking the slot forever.
 */
export type OccupancyReason =
  | {
      readonly kind: 'service';
      readonly appointmentId: AppointmentId;
      readonly seatId: SeatId;
      readonly serviceId: ServiceId;
      readonly variantId: ServiceVariantId | null;
      readonly origin: BookingOrigin;
      readonly outcome: ServiceOutcome;
    }
  | {
      readonly kind: 'buffer';
      readonly ofAppointmentId: AppointmentId;
      readonly ofSeatId: SeatId;
    }
  | AbsenceReason;

export type OccupancyReasonKind = OccupancyReason['kind'];
