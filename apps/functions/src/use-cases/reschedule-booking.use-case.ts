import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  type AppointmentStatus,
  BookingPolicy,
  canTransition,
} from '@creativo/domain/scheduling';
import type { ClockPort } from '@creativo/application/shared';
import {
  arrivedAtFromDocument,
  bookedAtFromDocument,
  contactFromDocument,
} from '@creativo/application/booking';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import {
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingStoreError,
  CommitBookingUnauthenticatedError,
} from './commit-booking.errors';
import { type DecideBookingRequest, decideBooking } from './decide-booking';

export interface RescheduleBookingInput extends DecideBookingRequest {
  readonly appointmentId: string;
  /** From the VERIFIED token. `null` is a refusal, never a guest move. */
  readonly ownerUserId: string | null;
}

/**
 * Has any seat of the stored appointment already been resolved?
 *
 * Read off the raw document rather than the aggregate because this runs
 * before the appointment is rebuilt. A seat with no `outcome` field is a row
 * written before outcomes existed and counts as unresolved — a legacy booking
 * must stay movable.
 */
function hasResolvedSeat(current: Record<string, unknown>): boolean {
  const seats = Array.isArray(current['seats'])
    ? (current['seats'] as readonly Record<string, unknown>[])
    : [];
  return seats.some((seat) => {
    const outcome = seat['outcome'] as Record<string, unknown> | undefined;
    const kind = outcome?.['kind'];
    return typeof kind === 'string' && kind !== 'scheduled';
  });
}

/**
 * `rescheduleAppointment` — move a booking, keeping it the same booking.
 *
 * ### Why this exists rather than "cancel, then book again"
 * A sequential cancel-and-rebook has a window in which the client owns
 * nothing: if the new commit loses a race, the old slot is already gone. It
 * also mints a NEW appointment id, which quietly breaks everything keyed to
 * the old one — the client's own deep links, the notification that told them
 * about it, and any future receipt. This moves the appointment inside ONE
 * transaction: same id, same status, same contact, new time — or nothing.
 *
 * ### The same rules the first booking passed
 * The decision is `decideBooking`, unchanged: terms re-resolved from the
 * catalog, the roster re-read, the collision set re-checked. A client cannot
 * reschedule into a slot they could not have booked in the first place.
 *
 * ### The cancellation window governs moves too
 * Moving a booking two hours out is exactly as disruptive to the shop as
 * cancelling it, so it is refused on the same `BookingPolicy.mayCancelAt`
 * rule — and refused HERE, not merely hidden in the client.
 */
export class RescheduleBookingUseCase {
  constructor(
    private readonly store: FirestoreBookingStore,
    private readonly clock: ClockPort,
    private readonly policy: BookingPolicy = BookingPolicy.default(),
  ) {}

  async execute(
    input: RescheduleBookingInput,
  ): Promise<Result<{ appointmentId: string }, CommitBookingError>> {
    if (!input.ownerUserId) {
      return fail(new CommitBookingUnauthenticatedError());
    }
    const ownerUserId = input.ownerUserId;

    const request: DecideBookingRequest = {
      locationId: input.locationId,
      seats: input.seats,
      // The id is REUSED as the attempt id, which is what keeps the moved
      // appointment the same document — `decideBooking` mints one only when
      // it is not given one.
      attemptId: input.appointmentId,
      contact: input.contact,
    };

    const result = await this.store.reschedule(
      input.appointmentId,
      // The CLIENT's rule: you may move your own booking and nobody else's.
      // Staff have their own use case with its own predicate — see
      // `StaffEditAppointmentUseCase`.
      (current) => current['ownerUserId'] === ownerUserId,
      () => ok(request),
      (snapshot, current) => {
        const now = this.clock.now(snapshot.zone);
        if (now.isFailure()) {
          return fail(new CommitBookingStoreError(now.error));
        }

        const status = (current['status'] ?? {}) as AppointmentStatus;
        // The domain's own lifecycle graph, not a re-encoded copy: a
        // completed, no-showed or already-cancelled visit cannot move.
        if (!canTransition(status, 'cancelled')) {
          return fail(new CommitBookingInvalidInputError('status'));
        }

        // A party MID-SERVICE cannot move. `decideBooking` rebuilds the seats
        // from the request with fresh ids and fresh `scheduled` outcomes, so
        // moving a party where one guest has already been served — or already
        // no-showed — would silently erase that fact and there would be no
        // source left to recover it from. The root status cannot catch this:
        // a partially-resolved party is still `confirmed`.
        if (hasResolvedSeat(current)) {
          return fail(new CommitBookingInvalidInputError('seat_resolved'));
        }

        // The window is read off the CURRENT start — the booking being moved
        // — because that is the commitment the shop planned around.
        const currentStart = String(
          (current['timeSlot'] as Record<string, unknown> | undefined)?.[
            'startIso'
          ] ?? '',
        );
        const startMs = Date.parse(currentStart);
        if (
          Number.isFinite(startMs) &&
          !this.policy.mayCancelAt(startMs, now.value.toMillis())
        ) {
          return fail(new CommitBookingInvalidInputError('window_closed'));
        }

        const decided = decideBooking(request, snapshot, {
          now: now.value,
          policy: this.policy,
          nextId: () => input.appointmentId,
          ownerUserId,
        });
        if (decided.isFailure()) return decided;

        // A move must not silently DOWNGRADE a confirmed booking to pending,
        // and must not lose the contact the shop was given. `decideBooking`
        // builds a fresh pending appointment because that is its job; this
        // puts back the facts that belong to the appointment's IDENTITY
        // rather than to its placement.
        //
        // `bookedAt` is the subtle one. `decideBooking` stamps it with the
        // transaction's own clock, so a move would restate every rescheduled
        // booking as having been made just now — and booking lead time, the
        // metric it exists for, would collapse toward zero for exactly the
        // bookings that were planned furthest ahead. The booking instant
        // belongs to when the client DECIDED, not to when they moved it.
        const restored = Appointment.reconstitute({
          id: decided.value.appointment.id.value,
          locationId: decided.value.appointment.locationId.value,
          seats: [...decided.value.appointment.seats],
          status,
          contact: contactFromDocument(current),
          bookedAt: bookedAtFromDocument(current),
          bookedFromAppointmentId:
            typeof current['bookedFromAppointmentId'] === 'string'
              ? current['bookedFromAppointmentId']
              : null,
          // The arrival stamp is an independent FACT, not part of the
          // placement, and `reconstitute` accepts it without demanding it —
          // so omitting it did not fail, it silently erased. An
          // arrived-but-unfinished visit lost its stamp on every move, and
          // because the sheet's completion verb is gated on `arrived`,
          // FINISHING THE VISIT disappeared from the sheet the moment anyone
          // moved it. It cannot be backfilled: the instant is gone.
          arrivedAt: arrivedAtFromDocument(current),
        });
        if (restored.isFailure()) {
          return fail(new CommitBookingInvariantError(restored.error));
        }

        return ok({
          appointment: restored.value,
          busyWrites: decided.value.busyWrites,
        });
      },
    );

    if (result.isFailure()) return fail(result.error);
    return ok({ appointmentId: input.appointmentId });
  }
}
