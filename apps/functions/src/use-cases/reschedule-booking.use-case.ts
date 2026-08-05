import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  type AppointmentStatus,
  BookingPolicy,
  canTransition,
} from '@creativo/domain/scheduling';
import type { ClockPort } from '@creativo/application/shared';
import { contactFromDocument } from '@creativo/application/booking';
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
      ownerUserId,
      request,
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
        // puts back the two facts that belong to the appointment's identity
        // rather than to its placement.
        const restored = Appointment.reconstitute({
          id: decided.value.appointment.id.value,
          locationId: decided.value.appointment.locationId.value,
          seats: [...decided.value.appointment.seats],
          status,
          contact: contactFromDocument(current),
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
