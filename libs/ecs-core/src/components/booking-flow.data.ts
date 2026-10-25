import type { LocationId } from '@core/primitives';
import type { BookingConfirmation } from './booking-confirmation.data';
import { BookingCart } from './booking-cart.data';
import { FlexibleWhen } from './flexible-when.data';
import { Party } from './party.data';
import { ScheduleSelection } from './schedule-selection.data';
import type { WaitlistedSummary } from './waitlisted-summary.data';

/**
 * The booking wizard's steps — the ONLY source of these strings, named after
 * the field it types (`bookingFlowStep`, N15): `LOCATION → SERVICES →
 * SCHEDULE → REVIEW → CONFIRMED`, with `WAITLISTED` as the schedule step's
 * OTHER, equally terminal exit.
 */
export const BookingFlowStep = {
  /** WHERE — asked first, and optional: `null` is "any shop", a choice. */
  Location: 'LOCATION',
  Services: 'SERVICES',
  Schedule: 'SCHEDULE',
  Review: 'REVIEW',
  Confirmed: 'CONFIRMED',
  /** Nothing fitted and the client asked to be told when something does. */
  Waitlisted: 'WAITLISTED',
} as const;
export type BookingFlowStep =
  (typeof BookingFlowStep)[keyof typeof BookingFlowStep];

/**
 * Where the booking wizard is, with each step's own bags — the **persisted**
 * draft (§4.2: the draft IS this state, serialised as is; no separate draft
 * shape; stored under the versioned key of `storage.port.ts`, so a draft of
 * the pre-flatten shape is dropped, never mis-read). The party and the cart
 * ride from the first step on, so removing a guest drops that guest's lines
 * and the two never drift; the flexible declaration rides on the schedule
 * state so a step back from review does not cost it. `BookingFlowSystem.next`
 * steps over it; a stale draft fails {@link BookingFlowState.is} and is
 * cleared. In-memory UI state (F-8): only its discriminator is flattened.
 */
export type BookingFlowState =
  | BookingFlowState.Location
  | BookingFlowState.Services
  | BookingFlowState.Schedule
  | BookingFlowState.Review
  | BookingFlowState.Confirmed
  | BookingFlowState.Waitlisted;

/** The ordered wizard spine — drives the stepper and `?step=` rewinding. */
const SPINE: readonly BookingFlowStep[] = [
  BookingFlowStep.Location,
  BookingFlowStep.Services,
  BookingFlowStep.Schedule,
  BookingFlowStep.Review,
];

function isId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0;
}

function isLocationOrNull(raw: unknown): boolean {
  return raw === null || isId(raw);
}

export const BookingFlowState = {
  SPINE,

  /** Where a new booking opens: the location step, an empty bag, any shop. */
  initial(party: Party): BookingFlowState.Location {
    return {
      bookingFlowStep: BookingFlowStep.Location,
      party,
      cart: BookingCart.empty(),
      locationId: null,
    };
  },

  /**
   * THE terminal rule, on a bare step: confirmed or waitlisted — the two
   * steps off the {@link SPINE} (the shell drops its navigation chrome
   * there). `BookingFlowSystem.isTerminal` delegates here (pass D, D-10.8:
   * one spelling of the rule).
   */
  isTerminalStep(step: BookingFlowStep): step is BookingFlowState.TerminalStep {
    return (
      step === BookingFlowStep.Confirmed || step === BookingFlowStep.Waitlisted
    );
  },

  /** The flow is over — confirmed or waitlisted. Narrows to those two states. */
  isTerminal(
    state: BookingFlowState,
  ): state is BookingFlowState.Confirmed | BookingFlowState.Waitlisted {
    return BookingFlowState.isTerminalStep(state.bookingFlowStep);
  },

  /** The step's position on the spine, or `-1` for a terminal step. */
  spineIndex(step: BookingFlowStep): number {
    for (let i = 0; i < SPINE.length; i++) {
      if (SPINE[i] === step) return i;
    }
    return -1;
  },

  /**
   * The edge guard for a persisted draft: a known step and, per step, its
   * bags in their component shapes (`Party.is`, `BookingCart.is`,
   * `FlexibleWhen.is`, `ScheduleSelection.is`).
   */
  is(raw: unknown): raw is BookingFlowState {
    if (raw === null || typeof raw !== 'object') return false;
    const state = raw as Readonly<Record<string, unknown>>;
    switch (state['bookingFlowStep']) {
      case BookingFlowStep.Location:
      case BookingFlowStep.Services:
        return (
          Party.is(state['party']) &&
          BookingCart.is(state['cart']) &&
          isLocationOrNull(state['locationId'])
        );
      case BookingFlowStep.Schedule:
        return (
          Party.is(state['party']) &&
          BookingCart.is(state['cart']) &&
          isLocationOrNull(state['locationId']) &&
          FlexibleWhen.is(state['when'])
        );
      case BookingFlowStep.Review:
        return (
          Party.is(state['party']) &&
          BookingCart.is(state['cart']) &&
          ScheduleSelection.is(state['selection'])
        );
      case BookingFlowStep.Confirmed: {
        const confirmation = state['confirmation'];
        if (confirmation === null || typeof confirmation !== 'object') {
          return false;
        }
        const bags = confirmation as Readonly<Record<string, unknown>>;
        return (
          isId(bags['appointmentId']) &&
          Party.is(bags['party']) &&
          BookingCart.is(bags['cart']) &&
          ScheduleSelection.is(bags['selection'])
        );
      }
      case BookingFlowStep.Waitlisted: {
        const summary = state['summary'];
        if (summary === null || typeof summary !== 'object') return false;
        const bags = summary as Readonly<Record<string, unknown>>;
        return (
          isId(bags['requestId']) &&
          Party.is(bags['party']) &&
          BookingCart.is(bags['cart']) &&
          FlexibleWhen.is(bags['when']) &&
          isLocationOrNull(bags['locationId'])
        );
      }
      default:
        return false;
    }
  },
} as const;

export namespace BookingFlowState {
  export type Location = {
    readonly bookingFlowStep: typeof BookingFlowStep.Location;
    readonly party: Party;
    readonly cart: BookingCart;
    /** `null` ⇒ any shop — chosen, not unanswered. */
    readonly locationId: LocationId | null;
  };
  export type Services = {
    readonly bookingFlowStep: typeof BookingFlowStep.Services;
    readonly party: Party;
    readonly cart: BookingCart;
    readonly locationId: LocationId | null;
  };
  export type Schedule = {
    readonly bookingFlowStep: typeof BookingFlowStep.Schedule;
    readonly party: Party;
    readonly cart: BookingCart;
    readonly locationId: LocationId | null;
    /** The days the client could come; EMPTY for the ordinary single-day pick. */
    readonly when: FlexibleWhen;
  };
  export type Review = {
    readonly bookingFlowStep: typeof BookingFlowStep.Review;
    readonly party: Party;
    readonly cart: BookingCart;
    readonly selection: ScheduleSelection;
  };
  export type Confirmed = {
    readonly bookingFlowStep: typeof BookingFlowStep.Confirmed;
    readonly confirmation: BookingConfirmation;
  };
  export type Waitlisted = {
    readonly bookingFlowStep: typeof BookingFlowStep.Waitlisted;
    readonly summary: WaitlistedSummary;
  };
  /** The two steps the flow ends on. */
  export type TerminalStep =
    typeof BookingFlowStep.Confirmed | typeof BookingFlowStep.Waitlisted;
}
