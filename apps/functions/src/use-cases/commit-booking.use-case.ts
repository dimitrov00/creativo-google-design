import { Result, fail, ok } from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { ClockPort, IdGenerator } from '@creativo/application/shared';
import {
  type CommitBookingError,
  CommitBookingStoreError,
  CommitBookingUnauthenticatedError,
} from './commit-booking.errors';
import {
  type BookingDecision,
  type CommitOutcome,
  type BookingSnapshot,
  type DecideBookingRequest,
  decideBooking,
} from './decide-booking';

/**
 * The transactional boundary. Loads a snapshot, hands it to a decision, and
 * writes whatever the decision returns — all inside one transaction.
 */
export interface BookingStore {
  commit(
    request: DecideBookingRequest,
    decide: (
      snapshot: BookingSnapshot,
    ) => Result<BookingDecision, CommitBookingError>,
  ): Promise<Result<CommitOutcome, CommitBookingError>>;
}

export interface CommitBookingInput extends DecideBookingRequest {
  /**
   * The uid from the VERIFIED auth token. `null` when the caller is
   * unauthenticated, which is a refusal and not a guest booking: the party may
   * be assembled anonymously, but somebody has to own the appointment (owner
   * ruling 2026-07-29 — anonymous until confirm).
   */
  readonly ownerUserId: string | null;
  /**
   * The shop placing its own book (owner ruling 2026-08-07 #3): the owner
   * may be a named client or nobody (a walk-in of guest seats), lead time
   * and roster containment do not apply, and the booking is CONFIRMED on
   * creation — the desk that made it has already accepted it.
   */
  readonly staffPlacement?: boolean;
}

/**
 * `commitBooking` — the ONLY way an appointment comes into existence.
 *
 * The client's grid is an offer computed from a projection that may be seconds
 * stale. This is the authority: it re-derives the price, the duration, the
 * roster and the collision set from server state inside a transaction, and the
 * client's numbers are never consulted. `firestore.rules` backs that up by
 * refusing `create` on `appointments` to everyone but staff, so there is no
 * second door.
 *
 * The zone comes from the location document rather than from the caller,
 * because "now" has to be evaluated in the zone the appointment is scheduled
 * against — a UTC server and a travelling client must still land on the shop's
 * own calendar day.
 */
export class CommitBookingUseCase {
  constructor(
    private readonly store: BookingStore,
    private readonly clock: ClockPort,
    private readonly idGenerator: IdGenerator,
    private readonly policy: BookingPolicy = BookingPolicy.default(),
  ) {}

  async execute(
    input: CommitBookingInput,
  ): Promise<Result<{ appointmentId: string }, CommitBookingError>> {
    if (!input.ownerUserId && !input.staffPlacement) {
      return fail(new CommitBookingUnauthenticatedError());
    }
    const ownerUserId = input.ownerUserId;

    const request: DecideBookingRequest = {
      locationId: input.locationId,
      seats: input.seats,
      attemptId: input.attemptId,
      contact: input.contact,
      bookedFromAppointmentId: input.bookedFromAppointmentId,
    };

    const result = await this.store.commit(request, (snapshot) => {
      const now = this.clock.now(snapshot.zone);
      if (now.isFailure()) {
        return fail(new CommitBookingStoreError(now.error));
      }
      return decideBooking(request, snapshot, {
        now: now.value,
        policy: this.policy,
        nextId: () => this.idGenerator.next(),
        ownerUserId,
        allowOutsideWindow: input.staffPlacement === true,
      });
    });

    if (result.isFailure()) return fail(result.error);
    // A replay IS a success — it is this very attempt's original answer,
    // re-delivered after the response was lost in transit.
    return ok({
      appointmentId:
        result.value.kind === 'replayed'
          ? result.value.appointmentId
          : result.value.decision.appointment.id.value,
    });
  }
}
