import type { AppointmentId } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { WaitlistRequestId } from '../entities/waitlist-request.entity';
import { BookingCart } from './cart-line.data';
import { FlexibleWhen } from './flexible-when.data';
import { Party } from './party.data';
import { TimeInterval } from './time-interval.data';

/**
 * The booking wizard's steps — the ONLY source of these strings
 * (`booking-flow.ts`: `location → services → schedule → review →
 * confirmed`, with `waitlisted` as the schedule step's OTHER, equally
 * terminal exit).
 */
export const BookingFlowStep = {
  /** WHERE — asked first, and optional: `null` is "any shop", a choice. */
  Location: 'location',
  Services: 'services',
  Schedule: 'schedule',
  Review: 'review',
  Confirmed: 'confirmed',
  /** Nothing fitted and the client asked to be told when something does. */
  Waitlisted: 'waitlisted',
} as const;
export type BookingFlowStep =
  (typeof BookingFlowStep)[keyof typeof BookingFlowStep];

/** Why a `?reschedule=` link did not become a move — the ONLY source of these strings. */
export const MoveRefusalKind = {
  /** Only seats the shop must re-seat remain (the server refuses `shop_only`). */
  CompanionsOnly: 'companions_only',
  /** The visit could not be read for this account, or no longer rebuilds into a bag. */
  Unavailable: 'unavailable',
  /** Somebody the move carries can no longer be served anywhere. */
  CarriedOutOfReach: 'carried_out_of_reach',
} as const;
export type MoveRefusalKind =
  (typeof MoveRefusalKind)[keyof typeof MoveRefusalKind];

/** How to reach the shop about a refusal — the i18n keys of the reach phrase. */
const SHOP_REACH = {
  /** There is a number to press: «call the shop». */
  Call: 'booking.reach.call',
  /** The catalogue has no number for this shop: «get in touch». */
  Contact: 'booking.reach.contact',
} as const;

/**
 * Which "reach the shop" phrase a refusal ends with — the `shopReachKey`
 * values (`booking-gateway.port.ts:232`), a shared tag replacing the
 * ~120 bare-literal comparisons of the web client.
 */
export type ShopReach = (typeof SHOP_REACH)[keyof typeof SHOP_REACH];

export const ShopReach = {
  ...SHOP_REACH,

  /** «call» when there is a number to press (`tel:` href), «contact» when there is none. */
  forCallHref(callHref: string | null): ShopReach {
    return callHref === null ? SHOP_REACH.Contact : SHOP_REACH.Call;
  },
} as const;

/**
 * One cart line, placed: who serves it and exactly when. The barber is
 * RESOLVED even when the line asked for anyone — review must name the person.
 */
export type SeatAssignment = {
  readonly lineId: string;
  readonly barberId: BarberId;
  readonly timeInterval: TimeInterval;
};

/**
 * What the schedule step hands to review: WHERE, WHEN and BY WHOM. The
 * `timeInterval` is the ENVELOPE — first start to last end — derived from the
 * assignments ({@link ScheduleSelection.of}) and never authored separately.
 */
export type ScheduleSelection = {
  readonly locationId: LocationId;
  readonly timeInterval: TimeInterval;
  readonly assignments: readonly SeatAssignment[];
};

function isInterval(raw: unknown): raw is TimeInterval {
  if (raw === null || typeof raw !== 'object') return false;
  const interval = raw as Readonly<Record<string, unknown>>;
  const start = interval['startMs'];
  const end = interval['endMs'];
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start < end
  );
}

function isId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0;
}

export const ScheduleSelection = {
  /**
   * A selection with its envelope derived from the assignments — `null` when
   * there are none (an empty selection describes no appointment).
   */
  of(
    locationId: LocationId,
    assignments: readonly SeatAssignment[],
  ): ScheduleSelection | null {
    if (assignments.length === 0) return null;
    let startMs = Number.POSITIVE_INFINITY;
    let endMs = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < assignments.length; i++) {
      const interval = (assignments[i] as SeatAssignment).timeInterval;
      if (interval.startMs < startMs) startMs = interval.startMs;
      if (interval.endMs > endMs) endMs = interval.endMs;
    }
    return {
      locationId,
      timeInterval: TimeInterval.of(startMs, endMs),
      assignments,
    };
  },

  /** The edge guard: a shop, a real envelope, and well-formed assignments. */
  is(raw: unknown): raw is ScheduleSelection {
    if (raw === null || typeof raw !== 'object') return false;
    const selection = raw as Readonly<Record<string, unknown>>;
    if (!isId(selection['locationId'])) return false;
    if (!isInterval(selection['timeInterval'])) return false;
    const assignments = selection['assignments'];
    if (!Array.isArray(assignments) || assignments.length === 0) return false;
    for (let i = 0; i < assignments.length; i++) {
      const item: unknown = assignments[i];
      if (item === null || typeof item !== 'object') return false;
      const assignment = item as Readonly<Record<string, unknown>>;
      if (
        !isId(assignment['lineId']) ||
        !isId(assignment['barberId']) ||
        !isInterval(assignment['timeInterval'])
      ) {
        return false;
      }
    }
    return true;
  },
} as const;

/**
 * What the confirmation screen renders — deliberately NOT an appointment:
 * the server builds that from server-resolved terms, and the browser
 * rebuilding one would describe what was REQUESTED. The `appointmentId` is
 * the receipt; the rest is what the client already agreed to.
 */
export type BookingConfirmation = {
  readonly appointmentId: AppointmentId;
  readonly party: Party;
  readonly cart: BookingCart;
  readonly selection: ScheduleSelection;
};

/** What the waitlisted screen renders — the receipt for a watch on a set of days. */
export type WaitlistedSummary = {
  readonly requestId: WaitlistRequestId;
  readonly party: Party;
  readonly cart: BookingCart;
  readonly when: FlexibleWhen;
  readonly locationId: LocationId | null;
};

/** A refused move, and its shop when known — the shell's call button. */
export type MoveRefusal = {
  readonly reason: MoveRefusalKind;
  readonly locationId: LocationId | null;
};

export const MoveRefusal = {
  of(reason: MoveRefusalKind, locationId: LocationId | null): MoveRefusal {
    return { reason, locationId };
  },
} as const;

/**
 * Where the booking wizard is, with each step's own bags — the **persisted**
 * sessionStorage draft (§4.2: the draft IS this state, serialised as is; no
 * separate draft shape). The party and the cart ride from the first step on,
 * so removing a guest drops that guest's lines and the two never drift; the
 * flexible declaration rides on the schedule state so a step back from review
 * does not cost it. `BookingFlowSystem.next` steps over it; a stale draft
 * fails {@link BookingFlowState.is} and is cleared.
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

function isLocationOrNull(raw: unknown): boolean {
  return raw === null || isId(raw);
}

export const BookingFlowState = {
  SPINE,

  /** Where a new booking opens: the location step, an empty bag, any shop. */
  initial(party: Party): BookingFlowState.Location {
    return {
      kind: BookingFlowStep.Location,
      party,
      cart: BookingCart.empty(),
      locationId: null,
    };
  },

  /** The flow is over — confirmed or waitlisted. */
  isTerminal(state: BookingFlowState): boolean {
    return (
      state.kind === BookingFlowStep.Confirmed ||
      state.kind === BookingFlowStep.Waitlisted
    );
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
    switch (state['kind']) {
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
    readonly kind: typeof BookingFlowStep.Location;
    readonly party: Party;
    readonly cart: BookingCart;
    /** `null` ⇒ any shop — chosen, not unanswered. */
    readonly locationId: LocationId | null;
  };
  export type Services = {
    readonly kind: typeof BookingFlowStep.Services;
    readonly party: Party;
    readonly cart: BookingCart;
    readonly locationId: LocationId | null;
  };
  export type Schedule = {
    readonly kind: typeof BookingFlowStep.Schedule;
    readonly party: Party;
    readonly cart: BookingCart;
    readonly locationId: LocationId | null;
    /** The days the client could come; EMPTY for the ordinary single-day pick. */
    readonly when: FlexibleWhen;
  };
  export type Review = {
    readonly kind: typeof BookingFlowStep.Review;
    readonly party: Party;
    readonly cart: BookingCart;
    readonly selection: ScheduleSelection;
  };
  export type Confirmed = {
    readonly kind: typeof BookingFlowStep.Confirmed;
    readonly confirmation: BookingConfirmation;
  };
  export type Waitlisted = {
    readonly kind: typeof BookingFlowStep.Waitlisted;
    readonly summary: WaitlistedSummary;
  };
}
