import type { BookingPolicy } from '../components/booking-policy.data';
import { BookingFlowError } from '../components/booking-flow-errors.data';
import {
  BookingFlowState,
  BookingFlowStep,
  type ScheduleSelection,
} from '../components/booking-flow.data';
import { BookingCart, SeatKey } from '../components/cart-line.data';
import type { DayWindows } from '../components/day-windows.data';
import { FlexibleWhen } from '../components/flexible-when.data';
import { Party } from '../components/party.data';
import { Result } from '../components/result.data';
import {
  SchedulingError,
  SchedulingErrorCode,
} from '../components/scheduling-errors.data';
import type {
  AppointmentId,
  BarberId,
  CartLineId,
  GuestId,
  LocationId,
  SeatKeyText,
  ServiceVariantId,
  WaitlistRequestId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import { BookingCartSystem } from './booking-cart.system';

/**
 * What the booking wizard can be told — the ONLY source of these strings.
 * The union is `BookingFlowEvent`, so the field takes the dictionary's name
 * (`bookingFlowEventKind`, N15).
 */
export const BookingFlowEventKind = {
  AddGuest: 'ADD_GUEST',
  RemoveGuest: 'REMOVE_GUEST',
  RenameGuest: 'RENAME_GUEST',
  AddLine: 'ADD_LINE',
  RemoveLine: 'REMOVE_LINE',
  SetLineVariant: 'SET_LINE_VARIANT',
  SetLineBarber: 'SET_LINE_BARBER',
  /** `null` is the "any shop" answer — a choice, not the absence of one. */
  SelectLocation: 'SELECT_LOCATION',
  SelectSchedule: 'SELECT_SCHEDULE',
  /** Select or deselect a day of the flexible declaration — one tap, one event. */
  ToggleFlexibleDay: 'TOGGLE_FLEXIBLE_DAY',
  /** Replace one day's spans — what the per-day window sheet commits. */
  SetDayWindows: 'SET_DAY_WINDOWS',
  /** Back to a single-day pick — drops the whole declaration deliberately. */
  ClearFlexible: 'CLEAR_FLEXIBLE',
  Confirmed: 'CONFIRMED',
  /** The server accepted a standing request. Terminal, like `CONFIRMED`. */
  Waitlisted: 'WAITLISTED',
  Next: 'NEXT',
  Back: 'BACK',
} as const;
export type BookingFlowEventKind =
  (typeof BookingFlowEventKind)[keyof typeof BookingFlowEventKind];

const E = BookingFlowEventKind;

/**
 * One event of the booking wizard (`booking-flow.ts:203-260`), discriminated
 * by `bookingFlowEventKind`. Seats are named by their cart seat key
 * (`'self'`, `'guest-3'`), lines by their `lineId`; a line's barber is `null`
 * for "anyone".
 */
export type BookingFlowEvent =
  | { readonly bookingFlowEventKind: typeof E.AddGuest; readonly label: string }
  | {
      readonly bookingFlowEventKind: typeof E.RemoveGuest;
      readonly guestId: GuestId;
    }
  | {
      readonly bookingFlowEventKind: typeof E.RenameGuest;
      readonly guestId: GuestId;
      readonly label: string;
    }
  | {
      readonly bookingFlowEventKind: typeof E.AddLine;
      readonly seatKey: SeatKeyText;
      readonly line: BookingCart.NewLine;
    }
  | {
      readonly bookingFlowEventKind: typeof E.RemoveLine;
      readonly seatKey: SeatKeyText;
      readonly lineId: CartLineId;
    }
  | {
      readonly bookingFlowEventKind: typeof E.SetLineVariant;
      readonly seatKey: SeatKeyText;
      readonly lineId: CartLineId;
      readonly variantId: ServiceVariantId | null;
    }
  | {
      readonly bookingFlowEventKind: typeof E.SetLineBarber;
      readonly seatKey: SeatKeyText;
      readonly lineId: CartLineId;
      readonly barberId: BarberId | null;
    }
  | {
      readonly bookingFlowEventKind: typeof E.SelectLocation;
      readonly locationId: LocationId | null;
    }
  | {
      readonly bookingFlowEventKind: typeof E.SelectSchedule;
      readonly selection: ScheduleSelection;
    }
  | {
      readonly bookingFlowEventKind: typeof E.ToggleFlexibleDay;
      readonly localDate: LocalDate;
    }
  | {
      readonly bookingFlowEventKind: typeof E.SetDayWindows;
      readonly dayWindows: DayWindows;
    }
  | { readonly bookingFlowEventKind: typeof E.ClearFlexible }
  | {
      readonly bookingFlowEventKind: typeof E.Confirmed;
      readonly appointmentId: AppointmentId;
    }
  | {
      readonly bookingFlowEventKind: typeof E.Waitlisted;
      readonly requestId: WaitlistRequestId;
    }
  | { readonly bookingFlowEventKind: typeof E.Next }
  | { readonly bookingFlowEventKind: typeof E.Back };

/** The two policy numbers the wizard enforces — a whole `BookingPolicy` passes straight in. */
export type BookingFlowLimits = Pick<
  BookingPolicy,
  'maxPartySize' | 'maxFlexibleDays'
>;

type Assembling = BookingFlowState.Location | BookingFlowState.Services;
type FlowResult = Result<BookingFlowState, BookingFlowError>;

/** A label the party refused, as the flow reports it: somebody else's label in its OWN words. */
function guestLabelRefusal(error: SchedulingError): BookingFlowError {
  return error.errorCode === SchedulingErrorCode.PartyDuplicateLabel
    ? error
    : BookingFlowError.invalidGuest(error.errorCode);
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
  switch (event.bookingFlowEventKind) {
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
        cart: BookingCart.dropSeat(
          state.cart,
          SeatKey.text(SeatKey.guest(event.guestId)),
        ),
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
          renamed.error.errorCode === SchedulingErrorCode.PartyGuestNotFound
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
    return Result.err(
      BookingFlowError.invalidCartOperation(cart.error.errorCode),
    );
  }
  return Result.ok({ ...state, cart: cart.value });
}

/** Cart edits, legal wherever the cart is still being assembled; `null` otherwise. */
function advanceCart(
  state: Assembling,
  event: BookingFlowEvent,
): FlowResult | null {
  switch (event.bookingFlowEventKind) {
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
  return Result.err(
    BookingFlowError.invalidTransition(
      state.bookingFlowStep,
      event.bookingFlowEventKind,
    ),
  );
}

/**
 * The booking wizard as a total function over tagged unions
 * (`application/booking/src/lib/flow/booking-flow.ts:404-600`):
 * `LOCATION → SERVICES → SCHEDULE → REVIEW → CONFIRMED`, with `WAITLISTED`
 * as the schedule step's other, equally terminal exit. Never performs I/O —
 * `CONFIRMED` and `WAITLISTED` are events the wrapping store dispatches once
 * the server has answered.
 */
export const BookingFlowSystem = {
  /**
   * One step of the wizard: the next state, or the refusal. An event the
   * current step has no arm for is `BOOKING_FLOW_INVALID_TRANSITION`;
   * terminal states take none.
   */
  next(
    state: BookingFlowState,
    event: BookingFlowEvent,
    limits: BookingFlowLimits,
  ): FlowResult {
    switch (state.bookingFlowStep) {
      case BookingFlowStep.Location: {
        const party = advanceParty(state, event, limits);
        if (party !== null) return party;
        if (event.bookingFlowEventKind === E.SelectLocation) {
          return Result.ok({ ...state, locationId: event.locationId });
        }
        // No precondition: `null` already means "any shop".
        if (event.bookingFlowEventKind === E.Next) {
          return Result.ok({
            bookingFlowStep: BookingFlowStep.Services,
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
        if (event.bookingFlowEventKind === E.Back) {
          return Result.ok({
            bookingFlowStep: BookingFlowStep.Location,
            party: state.party,
            cart: state.cart,
            locationId: state.locationId,
          });
        }
        if (event.bookingFlowEventKind === E.Next) {
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
            bookingFlowStep: BookingFlowStep.Schedule,
            party: state.party,
            cart: state.cart,
            locationId: state.locationId,
            when: FlexibleWhen.empty(),
          });
        }
        return invalid(state, event);
      }

      case BookingFlowStep.Schedule: {
        switch (event.bookingFlowEventKind) {
          case E.SelectLocation:
            return Result.ok({ ...state, locationId: event.locationId });
          case E.SelectSchedule:
            return Result.ok({
              bookingFlowStep: BookingFlowStep.Review,
              party: state.party,
              cart: state.cart,
              selection: event.selection,
            });
          case E.ToggleFlexibleDay: {
            if (FlexibleWhen.has(state.when, event.localDate)) {
              return Result.ok({
                ...state,
                when: FlexibleWhen.withoutDay(state.when, event.localDate),
              });
            }
            const added = FlexibleWhen.withDay(
              state.when,
              event.localDate,
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
              bookingFlowStep: BookingFlowStep.Waitlisted,
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
              bookingFlowStep: BookingFlowStep.Services,
              party: state.party,
              cart: state.cart,
              locationId: state.locationId,
            });
          default:
            return invalid(state, event);
        }
      }

      case BookingFlowStep.Review: {
        if (event.bookingFlowEventKind === E.Confirmed) {
          return Result.ok({
            bookingFlowStep: BookingFlowStep.Confirmed,
            confirmation: {
              appointmentId: event.appointmentId,
              party: state.party,
              cart: state.cart,
              selection: state.selection,
            },
          });
        }
        if (event.bookingFlowEventKind === E.Back) {
          // The shop survives the step back; the flexible declaration does
          // not — reaching review means something concrete was chosen.
          return Result.ok({
            bookingFlowStep: BookingFlowStep.Schedule,
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
   * (`state.bookingFlowStep`), so a view can ask without the whole state.
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
    if (step === state.bookingFlowStep) return state;
    const target = BookingFlowState.spineIndex(step);
    if (
      target === -1 ||
      target + 1 >= BookingFlowSystem.currentStep(state.bookingFlowStep)
    ) {
      return state;
    }
    let current = state;
    for (
      let guard = 0;
      guard < BookingFlowState.SPINE.length && current.bookingFlowStep !== step;
      guard++
    ) {
      const back = BookingFlowSystem.next(
        current,
        { bookingFlowEventKind: E.Back },
        limits,
      );
      if (!back.ok) break;
      current = back.value;
    }
    return current;
  },
} as const;
