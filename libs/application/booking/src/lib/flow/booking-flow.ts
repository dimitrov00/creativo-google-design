import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  BarberPref,
  BookingCart,
  BookingCartError,
  BookingParty,
  CartLineId,
  GuestId,
  NewCartLine,
  SeatKey,
  TimeSlot,
} from '@creativo/domain/scheduling';
import {
  BarberId,
  LocationId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import {
  BookingFlowError,
  EmptyCartError,
  GuestNotFoundInFlowError,
  InvalidBookingFlowTransitionError,
  InvalidCartOperationError,
  InvalidGuestError,
  PartyFullError,
} from './booking-flow.errors';

/**
 * How many people one booking can seat, the booker included.
 *
 * A constant here rather than a magic number in a template because the cap
 * is a rule, and a rule enforced only by a hidden button is not enforced.
 * It becomes a `BookingPolicy` field (tenant-configurable, loaded through a
 * port) when the availability engine lands and the machine starts taking a
 * policy; every consumer already reads it from one place, so that change is
 * a signature, not a hunt.
 */
export const MAX_PARTY_SIZE = 5;

/**
 * Pure port of v2's `booking.machine.ts` (`docs/migration-blueprint.md`
 * §5.3) — the booking wizard shell: `guests → services → schedule →
 * review → confirmed`. Like `AuthFlow`, this machine never performs IO;
 * `confirmed` is an event the wrapping feature store dispatches once
 * `CreateBookingUseCase` settles.
 *
 * Two structural corrections over the first pass, both forced by the
 * product shape (owner rulings 2026-07-29):
 *
 * 1. **The selection is a `BookingCart`, not a flat `serviceIds` list.**
 *    A party books per person — each line is (service, variant, barber
 *    preference) belonging to one seat — so a global service list cannot
 *    express it. The cart rides from `guests` onward rather than starting
 *    at `services`, because removing a guest has to drop that guest's
 *    lines (`dropSeat`) and the two structures must not be able to drift.
 * 2. **The party may be unclaimed.** `/book` is browsable anonymously; the
 *    machine is indifferent to who owns the party, and only
 *    `CreateBookingUseCase` insists on an owner.
 *
 * `waitlist`/`waitlisted` (the schedule-step fork) and the availability
 * engine's per-seat barber assignments land in later phases; `review`
 * carries a {@link ScheduleSelection} that widens to hold them.
 */
export type BookingFlowStep =
  'location' | 'services' | 'schedule' | 'review' | 'confirmed';

/**
 * One cart line, placed: who serves it and exactly when.
 *
 * The barber is RESOLVED here even when the line asked for `any`. A
 * preference is an input to scheduling; an assignment is a fact about the
 * appointment, and review has to be able to name the person.
 */
export interface SeatAssignment {
  readonly lineId: CartLineId;
  readonly barberId: BarberId;
  readonly slot: TimeSlot;
}

/**
 * What the schedule step hands to review: WHERE, WHEN, and BY WHOM the party
 * is served.
 *
 * `timeSlot` is the ENVELOPE — first start to last end. For a party served
 * in parallel that is the longest single seat; served sequentially it spans
 * the chain. It is derived from `assignments` and never authored separately,
 * so the summary the client agrees to and the seats that get written cannot
 * describe different appointments.
 */
export interface ScheduleSelection {
  readonly locationId: LocationId;
  readonly timeSlot: TimeSlot;
  readonly assignments: readonly SeatAssignment[];
}

/**
 * What the confirmation screen renders.
 *
 * Deliberately NOT an `Appointment`. The client does not build the aggregate —
 * `commitBooking` does, server-side, from server-resolved terms — and having
 * the browser reconstruct one from its own inputs would be a confirmation that
 * describes what was REQUESTED rather than what was written. The server's
 * `appointmentId` is the receipt; everything else here is what the user
 * already agreed to on the review step.
 */
export interface BookingConfirmation {
  readonly appointmentId: string;
  readonly party: BookingParty;
  readonly cart: BookingCart;
  readonly selection: ScheduleSelection;
}

export type BookingFlowState =
  | {
      /**
       * WHERE — asked first, and OPTIONAL.
       *
       * First because it changes everything after it: which barbers exist,
       * which services are offered, which hours apply. Optional because "any
       * shop" is a real answer — a client optimising for the soonest time
       * rather than the nearest chair should not be made to pick one, and with
       * multi-location rosters that genuinely widens what is on offer.
       */
      readonly kind: 'location';
      readonly party: BookingParty;
      readonly cart: BookingCart;
      /** `null` ⇒ any shop. Not "unanswered" — chosen. */
      readonly locationId: LocationId | null;
    }
  | {
      readonly kind: 'services';
      readonly party: BookingParty;
      readonly cart: BookingCart;
      readonly locationId: LocationId | null;
    }
  | {
      readonly kind: 'schedule';
      readonly party: BookingParty;
      readonly cart: BookingCart;
      readonly locationId: LocationId | null;
    }
  | {
      readonly kind: 'review';
      readonly party: BookingParty;
      readonly cart: BookingCart;
      readonly selection: ScheduleSelection;
    }
  | {
      readonly kind: 'confirmed';
      readonly confirmation: BookingConfirmation;
    };

export type BookingFlowEvent =
  | { readonly type: 'add_guest'; readonly label: string }
  | { readonly type: 'remove_guest'; readonly guestId: GuestId }
  | {
      readonly type: 'rename_guest';
      readonly guestId: GuestId;
      readonly label: string;
    }
  | {
      readonly type: 'add_line';
      readonly seatKey: SeatKey;
      readonly line: NewCartLine;
    }
  | {
      readonly type: 'remove_line';
      readonly seatKey: SeatKey;
      readonly lineId: CartLineId;
    }
  | {
      readonly type: 'set_line_variant';
      readonly seatKey: SeatKey;
      readonly lineId: CartLineId;
      readonly variantId: ServiceVariantId | null;
    }
  | {
      readonly type: 'set_line_barber';
      readonly seatKey: SeatKey;
      readonly lineId: CartLineId;
      readonly barberPref: BarberPref;
    }
  /** `null` is the "any shop" answer — a choice, not the absence of one. */
  | {
      readonly type: 'select_location';
      readonly locationId: LocationId | null;
    }
  | { readonly type: 'select_schedule'; readonly selection: ScheduleSelection }
  | {
      readonly type: 'confirmed';
      readonly appointmentId: string;
    }
  | { readonly type: 'next' }
  | { readonly type: 'back' };

/** The ordered wizard spine — drives both the stepper and `?step=` rewinding. */
export const BOOKING_FLOW_STEPS: readonly BookingFlowStep[] = [
  'location',
  'services',
  'schedule',
  'review',
] as const;

export function initialBookingFlowState(
  party: BookingParty = BookingParty.createAnonymous(),
): BookingFlowState {
  return {
    kind: 'location',
    party,
    cart: BookingCart.empty(),
    locationId: null,
  };
}

/** The states where the party and the cart are still being assembled. */
type AssemblingState = Extract<
  BookingFlowState,
  { kind: 'location' | 'services' }
>;

/**
 * Guest edits are legal from `guests` AND `services` — the person scope on
 * the services step lets you add someone you forgot without losing the bag,
 * which is half the reason the cart is keyed by seat. Returns `null` when
 * the event isn't a party edit, so the caller can keep matching.
 */
function advanceParty(
  state: AssemblingState,
  event: BookingFlowEvent,
): Result<BookingFlowState, BookingFlowError> | null {
  if (event.type === 'add_guest') {
    // +1 for the booker, who is never on the guest roster.
    if (state.party.guests.length + 1 >= MAX_PARTY_SIZE) {
      return fail(new PartyFullError(MAX_PARTY_SIZE));
    }
    const result = state.party.addGuest(event.label);
    if (result.isFailure()) {
      return fail(new InvalidGuestError(result.error));
    }
    return ok({ ...state, party: result.value });
  }

  if (event.type === 'remove_guest') {
    const result = state.party.removeGuest(event.guestId);
    if (result.isFailure()) {
      return fail(new GuestNotFoundInFlowError(event.guestId.toString()));
    }
    // The guest's lines leave with them — a cart line pointing at a seat
    // nobody occupies would otherwise survive to the confirm write.
    return ok({
      ...state,
      party: result.value,
      cart: state.cart.dropSeat(SeatKey.guest(event.guestId)),
    });
  }

  if (event.type === 'rename_guest') {
    const result = state.party.renameGuest(event.guestId, event.label);
    if (result.isFailure()) {
      // `renameGuest` fails two ways: an array of label errors, or a single
      // not-found. The array check is the discriminator the domain gives us.
      return Array.isArray(result.error)
        ? fail(new InvalidGuestError(result.error))
        : fail(new GuestNotFoundInFlowError(event.guestId.toString()));
    }
    return ok({ ...state, party: result.value });
  }

  return null;
}

function mapCart(
  state: AssemblingState,
  result: Result<BookingCart, BookingCartError>,
): Result<BookingFlowState, BookingFlowError> {
  if (result.isFailure()) {
    return fail(new InvalidCartOperationError(result.error));
  }
  return ok({ ...state, cart: result.value });
}

/** Cart edits, legal wherever the cart is still being assembled. */
function advanceCart(
  state: AssemblingState,
  event: BookingFlowEvent,
): Result<BookingFlowState, BookingFlowError> | null {
  switch (event.type) {
    case 'add_line':
      // A duplicate is now a REFUSAL, not a silently appended second haircut.
      return mapCart(state, state.cart.addLine(event.seatKey, event.line));
    case 'remove_line':
      return mapCart(state, state.cart.removeLine(event.seatKey, event.lineId));
    case 'set_line_variant':
      return mapCart(
        state,
        state.cart.setVariant(event.seatKey, event.lineId, event.variantId),
      );
    case 'set_line_barber':
      return mapCart(
        state,
        state.cart.setBarberPref(event.seatKey, event.lineId, event.barberPref),
      );
    default:
      return null;
  }
}

export function advanceBookingFlow(
  state: BookingFlowState,
  event: BookingFlowEvent,
): Result<BookingFlowState, BookingFlowError> {
  switch (state.kind) {
    case 'location': {
      const partyAtLocation = advanceParty(state, event);
      if (partyAtLocation) return partyAtLocation;
      if (event.type === 'select_location') {
        return ok({ ...state, locationId: event.locationId });
      }
      // `next` needs no precondition: `null` already means "any shop", so
      // there is nothing left unanswered to block on.
      // The party is assembled ON the services step now — a screen whose only
      // job was "add a guest?" asked a question most bookings answer by
      // walking past it (owner ruling 2026-07-31).
      if (event.type === 'next') {
        return ok({
          kind: 'services',
          party: state.party,
          cart: state.cart,
          locationId: state.locationId,
        });
      }
      break;
    }

    case 'services': {
      const party = advanceParty(state, event);
      if (party) return party;
      const cart = advanceCart(state, event);
      if (cart) return cart;
      if (event.type === 'back') {
        return ok({
          kind: 'location',
          party: state.party,
          cart: state.cart,
          locationId: state.locationId,
        });
      }
      if (event.type === 'next') {
        if (state.cart.isEmpty()) {
          return fail(new EmptyCartError());
        }
        return ok({
          kind: 'schedule',
          party: state.party,
          cart: state.cart,
          locationId: state.locationId,
        });
      }
      break;
    }

    case 'schedule': {
      if (event.type === 'select_location') {
        return ok({ ...state, locationId: event.locationId });
      }
      if (event.type === 'select_schedule') {
        return ok({
          kind: 'review',
          party: state.party,
          cart: state.cart,
          selection: event.selection,
        });
      }
      if (event.type === 'back') {
        return ok({
          kind: 'services',
          party: state.party,
          cart: state.cart,
          locationId: state.locationId,
        });
      }
      break;
    }

    case 'review': {
      if (event.type === 'confirmed') {
        return ok({
          kind: 'confirmed',
          confirmation: {
            appointmentId: event.appointmentId,
            party: state.party,
            cart: state.cart,
            selection: state.selection,
          },
        });
      }
      if (event.type === 'back') {
        // The location the user already picked survives the step back —
        // re-asking "which shop?" after a glance at the summary is exactly
        // the friction that makes a wizard feel like a form.
        return ok({
          kind: 'schedule',
          party: state.party,
          cart: state.cart,
          locationId: state.selection.locationId,
        });
      }
      break;
    }

    case 'confirmed':
      // Terminal — no outgoing transitions (mirrors v2's terminal states).
      break;
  }

  return fail(new InvalidBookingFlowTransitionError(state.kind, event.type));
}
