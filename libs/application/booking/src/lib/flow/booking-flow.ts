import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  BookingParty,
  GuestId,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { BookingFlowError } from './booking-flow.errors';

/**
 * Pure port of v2's `booking.machine.ts` (`docs/migration-blueprint.md`
 * §5.3) — the booking wizard shell: `guests → services → schedule →
 * review → confirmed`. v2's much richer machine (promo codes, payment
 * sheet, staff client search, waitlist prefs) is out of scope for this
 * pass; those are later feature-slice concerns layered on top once their
 * ports exist. What's preserved here is the part the bug ledger cares
 * about: guest-party management delegates entirely to `BookingParty`
 * (§7.7's monotonic-`GuestId` fix), and — like `AuthFlow` — this machine
 * never performs IO itself; `confirmed` is an event the wrapping feature
 * store dispatches once `CreateBookingUseCase` settles.
 */
export type BookingFlowStep =
  'guests' | 'services' | 'schedule' | 'review' | 'confirmed';

export type BookingFlowState =
  | { readonly kind: 'guests'; readonly party: BookingParty }
  | {
      readonly kind: 'services';
      readonly party: BookingParty;
      readonly serviceIds: readonly ServiceId[];
    }
  | {
      readonly kind: 'schedule';
      readonly party: BookingParty;
      readonly serviceIds: readonly ServiceId[];
    }
  | {
      readonly kind: 'review';
      readonly party: BookingParty;
      readonly serviceIds: readonly ServiceId[];
      readonly barberId: BarberId;
      readonly locationId: LocationId;
      readonly timeSlot: TimeSlot;
    }
  | { readonly kind: 'confirmed'; readonly appointment: Appointment };

export type BookingFlowEvent =
  | { readonly type: 'add_guest'; readonly label: string }
  | { readonly type: 'remove_guest'; readonly guestId: GuestId }
  | { readonly type: 'toggle_service'; readonly serviceId: ServiceId }
  | {
      readonly type: 'select_schedule';
      readonly barberId: BarberId;
      readonly locationId: LocationId;
      readonly timeSlot: TimeSlot;
    }
  | { readonly type: 'confirmed'; readonly appointment: Appointment }
  | { readonly type: 'next' }
  | { readonly type: 'back' };

export function initialBookingFlowState(party: BookingParty): BookingFlowState {
  return { kind: 'guests', party };
}

export function advanceBookingFlow(
  state: BookingFlowState,
  event: BookingFlowEvent,
): Result<BookingFlowState, BookingFlowError> {
  switch (state.kind) {
    case 'guests': {
      if (event.type === 'add_guest') {
        const result = state.party.addGuest(event.label);
        if (result.isFailure()) {
          return fail({ kind: 'invalid_guest', errors: result.error });
        }
        return ok({ kind: 'guests', party: result.value });
      }
      if (event.type === 'remove_guest') {
        const result = state.party.removeGuest(event.guestId);
        if (result.isFailure()) {
          return fail({
            kind: 'guest_not_found',
            guestId: event.guestId.toString(),
          });
        }
        return ok({ kind: 'guests', party: result.value });
      }
      if (event.type === 'next') {
        return ok({ kind: 'services', party: state.party, serviceIds: [] });
      }
      break;
    }

    case 'services': {
      if (event.type === 'toggle_service') {
        const alreadySelected = state.serviceIds.some((id) =>
          id.equals(event.serviceId),
        );
        const serviceIds = alreadySelected
          ? state.serviceIds.filter((id) => !id.equals(event.serviceId))
          : [...state.serviceIds, event.serviceId];
        return ok({ ...state, serviceIds });
      }
      if (event.type === 'back') {
        return ok({ kind: 'guests', party: state.party });
      }
      if (event.type === 'next') {
        if (state.serviceIds.length === 0) {
          return fail({ kind: 'empty_services' });
        }
        return ok({
          kind: 'schedule',
          party: state.party,
          serviceIds: state.serviceIds,
        });
      }
      break;
    }

    case 'schedule': {
      if (event.type === 'select_schedule') {
        return ok({
          kind: 'review',
          party: state.party,
          serviceIds: state.serviceIds,
          barberId: event.barberId,
          locationId: event.locationId,
          timeSlot: event.timeSlot,
        });
      }
      if (event.type === 'back') {
        return ok({
          kind: 'services',
          party: state.party,
          serviceIds: state.serviceIds,
        });
      }
      break;
    }

    case 'review': {
      if (event.type === 'confirmed') {
        return ok({ kind: 'confirmed', appointment: event.appointment });
      }
      if (event.type === 'back') {
        return ok({
          kind: 'schedule',
          party: state.party,
          serviceIds: state.serviceIds,
        });
      }
      break;
    }

    case 'confirmed':
      // Terminal — no outgoing transitions (mirrors v2's terminal states).
      break;
  }

  return fail({
    kind: 'invalid_transition',
    from: state.kind,
    event: event.type,
  });
}
