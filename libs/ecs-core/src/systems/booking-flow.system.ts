import type { BookingPolicy } from '../components/booking-policy.data';
import { BookingFlowError } from '../components/booking-flow-errors.data';
import {
  BookingFlowState,
  BookingFlowStep,
  type ScheduleSelection,
} from '../components/booking-flow.data';
import { BookingCart } from '../components/cart-line.data';
import type { DayKey } from '../components/day-key.data';
import type { DayWindows } from '../components/day-windows.data';
import { FlexibleWhen } from '../components/flexible-when.data';
import { Party } from '../components/party.data';
import { Result } from '../components/result.data';
import {
  SchedulingError,
  SchedulingErrorCode,
} from '../components/scheduling-errors.data';
import type { ServiceVariantId } from '../components/service-terms.data';
import type { AppointmentId } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { WaitlistRequestId } from '../entities/waitlist-request.entity';
import { BookingCartSystem } from './booking-cart.system';

/** What the booking wizard can be told — the ONLY source of these strings. */
export const BookingFlowEventKind = {
  AddGuest: 'add_guest',
  RemoveGuest: 'remove_guest',
  RenameGuest: 'rename_guest',
  AddLine: 'add_line',
  RemoveLine: 'remove_line',
  SetLineVariant: 'set_line_variant',
  SetLineBarber: 'set_line_barber',
  /** `null` is the "any shop" answer — a choice, not the absence of one. */
  SelectLocation: 'select_location',
  SelectSchedule: 'select_schedule',
  /** Select or deselect a day of the flexible declaration — one tap, one event. */
  ToggleFlexibleDay: 'toggle_flexible_day',
  /** Replace one day's spans — what the per-day window sheet commits. */
  SetDayWindows: 'set_day_windows',
  /** Back to a single-day pick — drops the whole declaration deliberately. */
  ClearFlexible: 'clear_flexible',
  Confirmed: 'confirmed',
  /** The server accepted a standing request. Terminal, like `confirmed`. */
  Waitlisted: 'waitlisted',
  Next: 'next',
  Back: 'back',
} as const;
export type BookingFlowEventKind =
  (typeof BookingFlowEventKind)[keyof typeof BookingFlowEventKind];

const E = BookingFlowEventKind;

/**
 * One event of the booking wizard (`booking-flow.ts:203-260`), discriminated
 * by `kind`. Seats are named by their cart seat key (`'self'`, `'guest-3'`),
 * lines by their `lineId`; a line's barber is `null` for "anyone".
 */
export type BookingFlowEvent =
  | { readonly kind: typeof E.AddGuest; readonly label: string }
  | { readonly kind: typeof E.RemoveGuest; readonly guestId: string }
  | {
      readonly kind: typeof E.RenameGuest;
      readonly guestId: string;
      readonly label: string;
    }
  | {
      readonly kind: typeof E.AddLine;
      readonly seatKey: string;
      readonly line: BookingCart.NewLine;
    }
  | {
      readonly kind: typeof E.RemoveLine;
      readonly seatKey: string;
      readonly lineId: string;
    }
  | {
      readonly kind: typeof E.SetLineVariant;
      readonly seatKey: string;
      readonly lineId: string;
      readonly variantId: ServiceVariantId | null;
    }
  | {
      readonly kind: typeof E.SetLineBarber;
      readonly seatKey: string;
      readonly lineId: string;
      readonly barberId: BarberId | null;
    }
  | {
      readonly kind: typeof E.SelectLocation;
      readonly locationId: LocationId | null;
    }
  | {
      readonly kind: typeof E.SelectSchedule;
      readonly selection: ScheduleSelection;
    }
  | { readonly kind: typeof E.ToggleFlexibleDay; readonly dayKey: DayKey }
  | { readonly kind: typeof E.SetDayWindows; readonly dayWindows: DayWindows }
  | { readonly kind: typeof E.ClearFlexible }
  | {
      readonly kind: typeof E.Confirmed;
      readonly appointmentId: AppointmentId;
    }
  | {
      readonly kind: typeof E.Waitlisted;
      readonly requestId: WaitlistRequestId;
    }
  | { readonly kind: typeof E.Next }
  | { readonly kind: typeof E.Back };

/** The two policy numbers the wizard enforces — a whole `BookingPolicy` passes straight in. */
export type BookingFlowLimits = Pick<
  BookingPolicy,
  'maxPartySize' | 'maxFlexibleDays'
>;

type Assembling = BookingFlowState.Location | BookingFlowState.Services;
type FlowResult = Result<BookingFlowState, BookingFlowError>;

/** A label the party refused, as the flow reports it: somebody else's label in its OWN words. */
function guestLabelRefusal(error: SchedulingError): BookingFlowError {
  return error.code === SchedulingErrorCode.PartyDuplicateLabel
    ? error
    : BookingFlowError.invalidGuest(error.code);
}

/**
 * Guest edits, legal from `location` AND `services` — the person scope on the
 * services step adds someone forgotten without losing the bag. `null` when
 * the event is not a party edit.
 */
function advanceParty(
  state: Assembling,
  event: BookingFlowEvent,
  limits: BookingFlowLimits,
): FlowResult | null {
  switch (event.kind) {
    case E.AddGuest: {
      // Every member is one seat — the booker included.
      if (state.party.members.length >= limits.maxPartySize) {
        return Result.err(BookingFlowError.partyFull(limits.maxPartySize));
      }
      const added = Party.addGuest(state.party, event.label);
      if (!added.ok) return Result.err(guestLabelRefusal(added.error));
      return Result.ok({ ...state, party: added.value });
    }
    case E.RemoveGuest: {
      const removed = Party.removeGuest(state.party, event.guestId);
      if (!removed.ok) {
        return Result.err(BookingFlowError.guestNotFound(event.guestId));
      }
      // The guest's lines leave with them — a line pointing at a seat nobody
      // occupies would otherwise survive to the confirm write.
      return Result.ok({
        ...state,
        party: removed.value,
        cart: BookingCart.dropSeat(state.cart, event.guestId),
      });
    }
    case E.RenameGuest: {
      const renamed = Party.renameGuest(
        state.party,
        event.guestId,
        event.label,
      );
      if (!renamed.ok) {
        return Result.err(
          renamed.error.code === SchedulingErrorCode.PartyGuestNotFound
            ? BookingFlowError.guestNotFound(event.guestId)
            : guestLabelRefusal(renamed.error),
        );
      }
      return Result.ok({ ...state, party: renamed.value });
    }
    default:
      return null;
  }
}

function withCart(
  state: Assembling,
  cart: Result<BookingCart, SchedulingError>,
): FlowResult {
  if (!cart.ok) {
    return Result.err(BookingFlowError.invalidCartOperation(cart.error.code));
  }
  return Result.ok({ ...state, cart: cart.value });
}

/** Cart edits, legal wherever the cart is still being assembled; `null` otherwise. */
function advanceCart(
  state: Assembling,
  event: BookingFlowEvent,
): FlowResult | null {
  switch (event.kind) {
    case E.AddLine:
      // A duplicate is a REFUSAL, not a silently appended second haircut.
      return withCart(
        state,
        BookingCart.addLine(state.cart, event.seatKey, event.line),
      );
    case E.RemoveLine:
      return withCart(
        state,
        BookingCart.removeLine(state.cart, event.seatKey, event.lineId),
      );
    case E.SetLineVariant:
      return withCart(
        state,
        BookingCart.setVariant(
          state.cart,
          event.seatKey,
          event.lineId,
          event.variantId,
        ),
      );
    case E.SetLineBarber:
      return withCart(
        state,
        BookingCart.setBarber(
          state.cart,
          event.seatKey,
          event.lineId,
          event.barberId,
        ),
      );
    default:
      return null;
  }
}

function invalid(state: BookingFlowState, event: BookingFlowEvent): FlowResult {
  return Result.err(BookingFlowError.invalidTransition(state.kind, event.kind));
}

/**
 * The booking wizard as a total function over tagged unions
 * (`application/booking/src/lib/flow/booking-flow.ts:404-600`):
 * `location → services → schedule → review → confirmed`, with `waitlisted`
 * as the schedule step's other, equally terminal exit. Never performs I/O —
 * `confirmed` and `waitlisted` are events the wrapping store dispatches once
 * the server has answered.
 */
export const BookingFlowSystem = {
  /**
   * One step of the wizard: the next state, or the refusal. An event the
   * current step has no arm for is `booking.flow.invalid_transition`;
   * terminal states take none.
   */
  next(
    state: BookingFlowState,
    event: BookingFlowEvent,
    limits: BookingFlowLimits,
  ): FlowResult {
    switch (state.kind) {
      case BookingFlowStep.Location: {
        const party = advanceParty(state, event, limits);
        if (party !== null) return party;
        if (event.kind === E.SelectLocation) {
          return Result.ok({ ...state, locationId: event.locationId });
        }
        // No precondition: `null` already means "any shop".
        if (event.kind === E.Next) {
          return Result.ok({
            kind: BookingFlowStep.Services,
            party: state.party,
            cart: state.cart,
            locationId: state.locationId,
          });
        }
        return invalid(state, event);
      }

      case BookingFlowStep.Services: {
        const party = advanceParty(state, event, limits);
        if (party !== null) return party;
        const cart = advanceCart(state, event);
        if (cart !== null) return cart;
        if (event.kind === E.Back) {
          return Result.ok({
            kind: BookingFlowStep.Location,
            party: state.party,
            cart: state.cart,
            locationId: state.locationId,
          });
        }
        if (event.kind === E.Next) {
          // An empty bag first: «pick a service» is the truer message than
          // naming the booker as the one holding nothing.
          if (BookingCart.isEmpty(state.cart)) {
            return Result.err(BookingFlowError.emptyCart());
          }
          // Everyone coming has to be booking something — a seat with no
          // line reappears nowhere: not on the schedule, not in the commit.
          const bare = BookingCartSystem.firstSeatWithoutService(
            state.party,
            state.cart,
          );
          if (bare !== null) {
            return Result.err(BookingFlowError.seatWithoutService(bare));
          }
          // One label, one guest: only a restored draft can still hold a
          // shared one, and one rename, here, is the fix.
          const shared = Party.sharedLabel(state.party);
          if (shared !== null) {
            return Result.err(SchedulingError.partyDuplicateLabel(shared));
          }
          return Result.ok({
            kind: BookingFlowStep.Schedule,
            party: state.party,
            cart: state.cart,
            locationId: state.locationId,
            when: FlexibleWhen.empty(),
          });
        }
        return invalid(state, event);
      }

      case BookingFlowStep.Schedule: {
        switch (event.kind) {
          case E.SelectLocation:
            return Result.ok({ ...state, locationId: event.locationId });
          case E.SelectSchedule:
            return Result.ok({
              kind: BookingFlowStep.Review,
              party: state.party,
              cart: state.cart,
              selection: event.selection,
            });
          case E.ToggleFlexibleDay: {
            if (FlexibleWhen.has(state.when, event.dayKey)) {
              return Result.ok({
                ...state,
                when: FlexibleWhen.withoutDay(state.when, event.dayKey),
              });
            }
            const added = FlexibleWhen.withDay(
              state.when,
              event.dayKey,
              limits.maxFlexibleDays,
            );
            if (!added.ok) {
              return Result.err(
                BookingFlowError.flexibleDaysFull(limits.maxFlexibleDays),
              );
            }
            return Result.ok({ ...state, when: added.value });
          }
          case E.SetDayWindows:
            // An unselected day is ignored, so a sheet that outlives its day
            // cannot resurrect it as a windows-only entry.
            return Result.ok({
              ...state,
              when: FlexibleWhen.withWindows(state.when, event.dayWindows),
            });
          case E.ClearFlexible:
            return Result.ok({ ...state, when: FlexibleWhen.empty() });
          case E.Waitlisted:
            // A request naming no days is not a request.
            if (FlexibleWhen.isEmpty(state.when)) {
              return Result.err(BookingFlowError.noFlexibleDays());
            }
            return Result.ok({
              kind: BookingFlowStep.Waitlisted,
              summary: {
                requestId: event.requestId,
                party: state.party,
                cart: state.cart,
                when: state.when,
                locationId: state.locationId,
              },
            });
          case E.Back:
            return Result.ok({
              kind: BookingFlowStep.Services,
              party: state.party,
              cart: state.cart,
              locationId: state.locationId,
            });
          default:
            return invalid(state, event);
        }
      }

      case BookingFlowStep.Review: {
        if (event.kind === E.Confirmed) {
          return Result.ok({
            kind: BookingFlowStep.Confirmed,
            confirmation: {
              appointmentId: event.appointmentId,
              party: state.party,
              cart: state.cart,
              selection: state.selection,
            },
          });
        }
        if (event.kind === E.Back) {
          // The shop survives the step back; the flexible declaration does
          // not — reaching review means something concrete was chosen.
          return Result.ok({
            kind: BookingFlowStep.Schedule,
            party: state.party,
            cart: state.cart,
            locationId: state.selection.locationId,
            when: FlexibleWhen.empty(),
          });
        }
        return invalid(state, event);
      }

      case BookingFlowStep.Confirmed:
      case BookingFlowStep.Waitlisted:
        // Terminal — no outgoing transitions.
        return invalid(state, event);
    }
  },

  /**
   * The flow is OVER at this step — confirmed or waitlisted, the states off
   * the spine (the shell drops its navigation chrome there). Takes the step
   * (`state.kind`), so a view can ask without the whole state.
   */
  isTerminal(step: BookingFlowStep): boolean {
    return BookingFlowState.spineIndex(step) === -1;
  },

  /** 1-based position on the wizard spine; terminal steps report the end. */
  currentStep(step: BookingFlowStep): number {
    const index = BookingFlowState.spineIndex(step);
    return index === -1 ? BookingFlowState.SPINE.length : index + 1;
  },

  /**
   * A back control would do something: on the spine, past its first step —
   * a terminal step reports the end of the spine but has no way back.
   */
  canGoBack(step: BookingFlowStep): boolean {
    return (
      !BookingFlowSystem.isTerminal(step) &&
      BookingFlowSystem.currentStep(step) > 1
    );
  },

  /** Is there room for one more person? Every member is one seat. */
  canAddGuest(party: Party, limits: BookingFlowLimits): boolean {
    return party.members.length < limits.maxPartySize;
  },

  /**
   * Move BACKWARD to `step` when the URL says the flow is behind where the
   * machine is (`rewindTo`, `booking-flow.store.ts:873-891`) — the browser-
   * Back contract. Forward jumps are ignored (every forward move has a
   * precondition a URL cannot satisfy), and so is an unknown step. Walks
   * `back` through {@link next} — the machine stays the only thing that
   * knows how to step backwards — bounded by the spine's length, stopping at
   * the first refusal.
   */
  rewindTo(
    state: BookingFlowState,
    step: BookingFlowStep,
    limits: BookingFlowLimits,
  ): BookingFlowState {
    if (step === state.kind) return state;
    const target = BookingFlowState.spineIndex(step);
    if (
      target === -1 ||
      target + 1 >= BookingFlowSystem.currentStep(state.kind)
    ) {
      return state;
    }
    let current = state;
    for (
      let guard = 0;
      guard < BookingFlowState.SPINE.length && current.kind !== step;
      guard++
    ) {
      const back = BookingFlowSystem.next(current, { kind: E.Back }, limits);
      if (!back.ok) break;
      current = back.value;
    }
    return current;
  },
} as const;
