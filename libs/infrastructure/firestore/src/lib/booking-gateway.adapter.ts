import { Injectable, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type BookingGateway,
  type BookingGatewayFailureCode,
  BookingGatewayError,
  type CancelAppointmentRequest,
  type TransitionAppointmentRequest,
  type RescheduleBookingRequest,
  type CommitBookingRequest,
  type CommittedBooking,
  type RecordSeatTipRequest,
  type StaffEditAppointmentRequest,
  type StaffEditedAppointment,
} from '@creativo/application/booking';
import { FIREBASE_FUNCTIONS } from '@creativo/infrastructure/firebase-app';

/** A client move whose carried seat cannot come along — see below. */
const CARRIED_SEAT_UNPLACEABLE = 'booking.reschedule.carried_seat_unplaceable';

/**
 * Server error `code` → the gateway's own vocabulary.
 *
 * Duck-typed off `details`, not `instanceof FunctionsError` — the same
 * approach `CallableOtpClient` takes, and for the same reason: the SDK's error
 * shape is stable across versions and importing the class for a type guard
 * buys nothing.
 */
function toFailureCode(error: unknown): {
  readonly failure: BookingGatewayFailureCode;
  readonly params: Readonly<Record<string, string>>;
} {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return { failure: 'unknown', params: {} };
  }
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null) {
    return { failure: 'unknown', params: {} };
  }
  const code = (details as { code?: unknown }).code;
  const rawParams = (details as { params?: unknown }).params;
  const params: Record<string, string> =
    typeof rawParams === 'object' && rawParams !== null
      ? { ...(rawParams as Record<string, string>) }
      : {};
  // The server's own domain code rides along so a consumer can translate a
  // SPECIFIC message (the cancellation window has its own copy) while the
  // failure taxonomy below stays coarse.
  if (typeof code === 'string') params['serverCode'] = code;

  // The carried seat's barber is taken at the new time. The grid only offers
  // starts where every carried seat fits (`AvailabilityQuery.riders`), so this
  // is a race the client lost: somebody took that chair between the offer
  // and the confirm. It is answered like any lost slot: back to a freshly
  // computed grid, with the lost-slot copy (owner decision, R2-5).
  if (
    code === CARRIED_SEAT_UNPLACEABLE &&
    params['refusal'] === 'barber_unavailable'
  ) {
    return { failure: 'slot_unavailable', params };
  }

  switch (code) {
    // A barber whose roster changed under a stale tab is the same situation as
    // a lost race from the user's side: the time they were shown is not
    // bookable, and re-picking from a fresh grid is the fix for both.
    case 'booking.commit.slot_unavailable':
    case 'booking.commit.barber_not_rostered':
      return { failure: 'slot_unavailable', params };
    case 'booking.commit.unauthenticated':
    case 'booking.cancel.unauthenticated':
      return { failure: 'unauthenticated', params };
    case 'booking.commit.unknown_service':
    case 'booking.commit.service_not_at_location':
      return { failure: 'catalog_changed', params };
    case 'booking.transition.unauthenticated':
    case 'booking.transition.forbidden':
    case 'booking.arrived.unauthenticated':
    case 'booking.arrived.forbidden':
      return { failure: 'unauthenticated', params };
    // The one staff refusal that is an OFFER: somebody is in the way, and the
    // sheet may relabel its commit «Запази въпреки застъпването» and re-send
    // with `acknowledgedOverlap`. It is `slot_unavailable` because the
    // failure taxonomy already has a word for "the time you were shown is not
    // free" — the `serverCode` riding in `params` is what lets the sheet tell
    // this one apart and offer the override.
    case 'booking.staffEdit.overlaps':
      return { failure: 'slot_unavailable', params };
    case 'booking.staffEdit.unauthenticated':
    case 'booking.staffEdit.forbidden':
      return { failure: 'unauthenticated', params };
    // A request the server would not take AS SENT — a seat missing its
    // variant, a party past the cap, a time outside the horizon. These used
    // to report as `unauthenticated`, which sent a signed-in barber looking
    // for a login problem that did not exist (2026-09-08).
    //
    // A move that would leave behind somebody the shop seated
    // (`booking.reschedule.carried_seat_unplaceable`) is one of these when
    // their service is gone, the time falls outside the window, or only the
    // shop can move them (`params.refusal`). Re-picking cannot fix those, so
    // they stay on review, worded through `serverCode` and `refusal`, with
    // the call beside them. A BUSY chair is the exception, handled above the
    // switch.
    case 'booking.commit.invalid_input':
    case 'booking.commit.invariant_violated':
    case 'booking.commit.conflicting_services':
    case 'booking.commit.party_too_large':
    case 'booking.commit.too_soon':
    case 'booking.commit.beyond_horizon':
    case 'booking.staffEdit.invalid_command':
    case 'booking.staffEdit.before_arrival':
    case 'booking.staffEdit.stale':
    case 'booking.transition.invalid_input':
    case 'booking.transition.not_found':
    case 'booking.transition.not_allowed':
    case 'booking.arrived.invalid_input':
    case 'booking.arrived.not_found':
    case 'booking.arrived.not_allowed':
    case 'booking.cancel.invalid_input':
    case 'booking.cancel.not_found':
    case 'booking.cancel.not_cancellable':
    case 'booking.cancel.window_closed':
    case CARRIED_SEAT_UNPLACEABLE:
      return { failure: 'invalid_request', params };
    case 'booking.commit.store_failed':
      return { failure: 'unavailable', params };
    // The cancellation terms could not be READ, so the server refused rather
    // than guess at the window (`policyForCancel`). Nothing about the visit
    // or the request is wrong: the same tap a moment later is the fix, which
    // is exactly what `unavailable` means — and the page words it from
    // `serverCode` ("try again in a moment"), never "something went wrong".
    case 'booking.cancel.policy_unavailable':
      return { failure: 'unavailable', params };
    default:
      return { failure: 'unknown', params };
  }
}

interface CommitBookingResponse {
  readonly appointmentId?: unknown;
}

/**
 * Calls the `commitBooking` function.
 *
 * Lives beside the appointment repository rather than in an auth lib because
 * this is the WRITE half of the same aggregate the repository reads — even
 * though the transport is a callable rather than a document write. That is the
 * whole point: `firestore.rules` refuses `create` on `appointments` to
 * everyone but staff, so a client's only door is a function that can re-derive
 * the price, the roster and the collision set from server state.
 */
@Injectable()
export class CallableBookingGateway implements BookingGateway {
  private readonly functions = inject(FIREBASE_FUNCTIONS);

  async commit(
    request: CommitBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>> {
    const callable = httpsCallable<CommitBookingRequest, CommitBookingResponse>(
      this.functions,
      'commitBooking',
    );

    try {
      const response = await callable(request);
      const appointmentId = response.data?.appointmentId;
      if (typeof appointmentId !== 'string' || appointmentId.length === 0) {
        // A 200 with nothing usable in it. Treated as unknown rather than as
        // success: reporting a booking that may not exist is the one failure
        // mode worse than reporting none.
        return fail(
          new BookingGatewayError(
            'unknown',
            'commitBooking returned no appointment id',
          ),
        );
      }
      return ok({ appointmentId });
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error ? error.message : 'commitBooking failed',
          params,
        ),
      );
    }
  }

  /**
   * Calls `rescheduleAppointment`. Same failure vocabulary as `commit` —
   * `slot_unavailable` is the one that matters, and it sends the flow back
   * to a freshly computed grid rather than to a dead end.
   */
  async reschedule(
    request: RescheduleBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>> {
    const callable = httpsCallable<
      RescheduleBookingRequest,
      CommitBookingResponse
    >(this.functions, 'rescheduleAppointment');

    try {
      const response = await callable(request);
      const appointmentId = response.data?.appointmentId;
      if (typeof appointmentId !== 'string' || appointmentId.length === 0) {
        return fail(
          new BookingGatewayError(
            'unknown',
            'rescheduleAppointment returned no appointment id',
          ),
        );
      }
      return ok({ appointmentId });
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error
            ? error.message
            : 'rescheduleAppointment failed',
          params,
        ),
      );
    }
  }

  async transition(
    request: TransitionAppointmentRequest,
  ): Promise<Result<void, BookingGatewayError>> {
    const callable = httpsCallable<TransitionAppointmentRequest, unknown>(
      this.functions,
      'transitionAppointment',
    );

    try {
      await callable(request);
      return ok(undefined);
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error ? error.message : 'transition failed',
          params,
        ),
      );
    }
  }

  async markArrived(
    appointmentId: string,
  ): Promise<Result<void, BookingGatewayError>> {
    const callable = httpsCallable<{ appointmentId: string }, unknown>(
      this.functions,
      'markArrived',
    );

    try {
      await callable({ appointmentId });
      return ok(undefined);
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error ? error.message : 'mark arrived failed',
          params,
        ),
      );
    }
  }

  async clearArrival(
    appointmentId: string,
  ): Promise<Result<void, BookingGatewayError>> {
    const callable = httpsCallable<{ appointmentId: string }, unknown>(
      this.functions,
      'clearArrival',
    );

    try {
      await callable({ appointmentId });
      return ok(undefined);
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error ? error.message : 'clear arrival failed',
          params,
        ),
      );
    }
  }

  /**
   * Calls `recordSeatTip` — a stamp, not an edit.
   *
   * Returns nothing: unlike `staffEdit` there is no revision to claim,
   * because a tip changes no geometry that a later save could be stale
   * against.
   */
  async recordTip(
    request: RecordSeatTipRequest,
  ): Promise<Result<void, BookingGatewayError>> {
    const callable = httpsCallable<RecordSeatTipRequest, unknown>(
      this.functions,
      'recordSeatTip',
    );
    try {
      await callable(request);
      return ok(undefined);
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error ? error.message : 'recordSeatTip failed',
          params,
        ),
      );
    }
  }

  /**
   * Calls `staffEditAppointment`.
   *
   * Returns the revision the intent stamped rather than nothing, because
   * the device's next claim is carried forward to it (`expectedVersion`) —
   * a stale refusal that cannot say which revision it is stale against is a
   * refusal that fires forever. The request, `expectedVersion` included,
   * goes on the wire as it is; a stale refusal comes back as
   * `invalid_request` with `serverCode: 'booking.staffEdit.stale'` and the
   * server's `expected`/`actual`.
   */
  async staffEdit(
    request: StaffEditAppointmentRequest,
  ): Promise<Result<StaffEditedAppointment, BookingGatewayError>> {
    const callable = httpsCallable<
      StaffEditAppointmentRequest,
      { appointmentId?: unknown; revision?: unknown }
    >(this.functions, 'staffEditAppointment');

    try {
      const response = await callable(request);
      const appointmentId = response.data?.appointmentId;
      if (typeof appointmentId !== 'string' || appointmentId.length === 0) {
        // A 200 with nothing usable in it. Treated as unknown rather than as
        // success, for the same reason `commit` does: reporting a write that
        // may not have happened is the one failure mode worse than reporting
        // none.
        return fail(
          new BookingGatewayError(
            'unknown',
            'staffEditAppointment returned no appointment id',
          ),
        );
      }
      return ok({
        appointmentId,
        revision:
          typeof response.data?.revision === 'number'
            ? response.data.revision
            : 0,
      });
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error
            ? error.message
            : 'staffEditAppointment failed',
          params,
        ),
      );
    }
  }

  async cancel(
    request: CancelAppointmentRequest,
  ): Promise<Result<void, BookingGatewayError>> {
    const callable = httpsCallable<CancelAppointmentRequest, unknown>(
      this.functions,
      'cancelAppointment',
    );

    try {
      await callable(request);
      return ok(undefined);
    } catch (error) {
      const { failure, params } = toFailureCode(error);
      return fail(
        new BookingGatewayError(
          failure,
          error instanceof Error ? error.message : 'cancelAppointment failed',
          params,
        ),
      );
    }
  }
}
