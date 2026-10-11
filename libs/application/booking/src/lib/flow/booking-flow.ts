import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  BarberPref,
  BookingCart,
  BookingCartError,
  BookingParty,
  CalendarDay,
  CartLineId,
  CartLineNotFoundError,
  DayWindows,
  DuplicateGuestLabelError,
  DuplicateServiceForSeatError,
  FlexibleWhen,
  GuestId,
  NewCartLine,
  SeatKey,
  SeatLabel,
  TimeSlot,
  seatKeyValue,
} from '@creativo/domain/scheduling';
import {
  AppointmentId,
  BarberId as EcsBarberId,
  type BookingFlowError as EcsBookingFlowError,
  BookingFlowErrorCode,
  CartLineId as EcsCartLineId,
  EndMinute,
  GuestId as EcsGuestId,
  LocalDate,
  LocationId as EcsLocationId,
  MinuteOfDay,
  SchedulingErrorCode,
  SeatKeyText,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  UserId as EcsUserId,
  UtcEpochMs,
  WaitlistRequestId,
  defect,
} from '@core/primitives';
import {
  type BookingCart as CartData,
  BookingFlowState as EcsBookingFlowState,
  BookingFlowStep as FlowStep,
  DayWindows as DayWindowsData,
  FlexibleWhen as WhenData,
  MinuteRange,
  type Party as PartyData,
  PartyMember,
  PartyRole,
  type ScheduleSelection as SelectionData,
  SeatLabel as EcsSeatLabel,
  type WallTime,
} from '@core/components';
import {
  BookingCartSystem,
  type BookingFlowEvent as FlowEventData,
  BookingFlowEventKind,
  type BookingFlowLimits,
  BookingFlowSystem,
  ZonedTimeSystem,
} from '@core/systems';
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
  FlexibleDaysFullError,
  InvalidGuestError,
  NoFlexibleDaysError,
  PartyFullError,
  SeatWithoutServiceError,
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
// `BookingPolicy.DEFAULT.maxPartySize`; a literal, so loading this module
// evaluates nothing of ecs-core (it is on the eager path).
export const MAX_PARTY_SIZE = 5;

/**
 * How many days one flexible declaration may name.
 *
 * Same story as {@link MAX_PARTY_SIZE}: a constant here rather than a magic
 * number in a template, and it becomes `BookingPolicy.maxFlexibleDays` (which
 * already carries it) once the machine takes a policy. Every consumer reads it
 * from one place, so that change is a signature rather than a hunt.
 */
// `BookingPolicy.DEFAULT.maxFlexibleDays`, literal for the same reason.
export const MAX_FLEXIBLE_DAYS = 7;

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
  | 'location'
  | 'services'
  | 'schedule'
  | 'review'
  | 'confirmed'
  /**
   * The schedule step's OTHER exit: nothing fitted, and the client asked to be
   * told when something does. Terminal like `confirmed`, and deliberately its
   * sibling rather than a sub-state of `schedule` — the flow is over either
   * way, and the two ends are different promises.
   */
  | 'waitlisted';

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

/**
 * What the waitlisted screen renders.
 *
 * Mirrors {@link BookingConfirmation} on purpose: both are receipts for
 * something the SERVER accepted, and both carry what the client agreed to
 * rather than reconstructing it. The difference is what was promised —
 * an appointment, versus a watch on a set of days.
 */
export interface WaitlistedSummary {
  readonly requestId: string;
  readonly party: BookingParty;
  readonly cart: BookingCart;
  readonly when: FlexibleWhen;
  readonly locationId: LocationId | null;
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
      /**
       * The days the client says they could come, and the spans within them.
       *
       * EMPTY is the ordinary case: someone picking one day and one time never
       * touches this. It fills only when they choose to be flexible, and it is
       * what both the multi-day search and a waitlist request are built from.
       * It rides on the state rather than in the component so a step back from
       * review does not cost the user a declaration they spent time on — the
       * same reason `locationId` lives here.
       */
      readonly when: FlexibleWhen;
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
    }
  | {
      readonly kind: 'waitlisted';
      readonly summary: WaitlistedSummary;
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
  /** Select or deselect a day in the flexible declaration — one tap, one event. */
  | { readonly type: 'toggle_flexible_day'; readonly day: CalendarDay }
  /** Replace one day's spans — what the per-day window sheet commits. */
  | { readonly type: 'set_day_windows'; readonly dayWindows: DayWindows }
  /** Back to a single-day pick — drops the whole declaration deliberately. */
  | { readonly type: 'clear_flexible' }
  | {
      readonly type: 'confirmed';
      readonly appointmentId: string;
    }
  /** The server accepted a standing request. Terminal, like `confirmed`. */
  | {
      readonly type: 'waitlisted';
      readonly requestId: string;
    }
  | { readonly type: 'next' }
  | { readonly type: 'back' };

/** The ordered wizard spine — drives both the stepper and `?step=` rewinding. */
// `BookingFlowState.SPINE`, literal so the draft store's eager import of it
// loads nothing of ecs-core.
export const BOOKING_FLOW_STEPS: readonly BookingFlowStep[] = [
  'location',
  'services',
  'schedule',
  'review',
] as const;

export function initialBookingFlowState(
  party: BookingParty = BookingParty.createAnonymous(),
): BookingFlowState {
  // The opening step is the component's; only the party is the caller's,
  // and the bag starts empty.
  const opening = EcsBookingFlowState.initial(partyDataOf(party));
  return {
    kind: LEGACY_STEP_OF[opening.bookingFlowStep],
    party,
    cart: BookingCart.empty(),
    locationId: null,
  };
}

/**
 * Every seat in the party, booker first, then guests in roster order.
 *
 * The booker is never on the guest roster, so "everyone in the party" is not
 * a list the domain hands over whole — each surface that needs it has to
 * remember to prepend `self`, and one that forgets asks its question about
 * the guests only. Exported for that reason rather than for this file's use.
 */
export function partySeats(party: BookingParty): readonly SeatKey[] {
  return BookingCartSystem.partySeats(partyDataOf(party)).map((seat) =>
    legacySeatKeyOf(party, seat),
  );
}

/**
 * The first person holding nothing, or `null` when everyone has something.
 *
 * Ordered, not just existential: the caller wants to NAME them, and "someone
 * is empty" is not a sentence a button can say.
 */
export function firstSeatWithoutService(
  party: BookingParty,
  cart: BookingCart,
): SeatKey | null {
  const bare = BookingCartSystem.firstSeatWithoutService(
    partyDataOf(party),
    cartDataOf(cart),
  );
  return bare === null ? null : legacySeatKeyOf(party, bare);
}

/**
 * One step of the wizard — `BookingFlowSystem.next` (`@core/systems`)
 * over this module's legacy state: the state and the event are converted to
 * the component structs, the system decides, and the answer comes back as
 * the legacy shapes (every bag the step did not change is the caller's own
 * object; a refusal is the legacy error class).
 */
export function advanceBookingFlow(
  state: BookingFlowState,
  event: BookingFlowEvent,
): Result<BookingFlowState, BookingFlowError> {
  const bridge = bridgeOf(state, event);
  const next = BookingFlowSystem.next(
    bridge.state,
    eventDataOf(event, bridge),
    FLOW_LIMITS,
  );
  return next.ok
    ? ok(legacyStateOf(next.value, bridge))
    : fail(legacyErrorOf(next.error, state, event));
}

/* ── The bridge: legacy classes ↔ ecs-core structs (Phase 4 deletes it) ── */

/** The legacy lowercase step ↔ the SCREAMING tag — the ONE table each way. */
const STEP_OF = {
  location: FlowStep.Location,
  services: FlowStep.Services,
  schedule: FlowStep.Schedule,
  review: FlowStep.Review,
  confirmed: FlowStep.Confirmed,
  waitlisted: FlowStep.Waitlisted,
} as const satisfies Record<BookingFlowStep, FlowStep>;
const LEGACY_STEP_OF = {
  [FlowStep.Location]: 'location',
  [FlowStep.Services]: 'services',
  [FlowStep.Schedule]: 'schedule',
  [FlowStep.Review]: 'review',
  [FlowStep.Confirmed]: 'confirmed',
  [FlowStep.Waitlisted]: 'waitlisted',
} as const satisfies Record<FlowStep, BookingFlowStep>;

/** The wizard's two policy numbers, as this module has always read them. */
const FLOW_LIMITS: BookingFlowLimits = {
  maxPartySize: MAX_PARTY_SIZE,
  maxFlexibleDays: MAX_FLEXIBLE_DAYS,
};

function partyDataOf(party: BookingParty): PartyData {
  return {
    ownerUserId:
      party.ownerId === null ? null : EcsUserId.of(party.ownerId.value),
    members: [
      PartyMember.owner(),
      ...party.guests.map((guest) =>
        PartyMember.guest(
          EcsGuestId.of(guest.id.value),
          EcsSeatLabel.of(guest.label.value),
        ),
      ),
    ],
    nextGuestSequence: party.nextGuestSequence,
  };
}

function legacyPartyOf(party: PartyData): BookingParty {
  const restored = BookingParty.reconstitute({
    ownerId: party.ownerUserId,
    guests: party.members.flatMap((member) =>
      member.partyRole === PartyRole.Guest
        ? [{ id: member.guestId, label: member.guestLabel as string }]
        : [],
    ),
    nextSequence: party.nextGuestSequence,
  });
  // Unreachable: the system only ever hands back parties its own commands built.
  if (restored.isFailure()) defect('unreachable: party refused');
  return restored.value;
}

function cartDataOf(cart: BookingCart): CartData {
  return {
    cartSeats: cart.entries().map(([rawSeatKey, lines]) => {
      const seatKey = SeatKeyText.of(rawSeatKey);
      return {
        seatKey,
        lines: lines.map((line) => ({
          lineId: EcsCartLineId.of(line.id.value),
          seatKey,
          serviceId: EcsServiceId.of(line.serviceId.value),
          variantId:
            line.variantId === null
              ? null
              : EcsServiceVariantId.of(line.variantId.value),
          barberId:
            line.barberPref.kind === 'specific'
              ? EcsBarberId.of(line.barberPref.barberId.value)
              : null,
          locationId: null,
        })),
      };
    }),
    cartNextSequence: cart.nextLineSequence,
  };
}

function legacyCartOf(cart: CartData): BookingCart {
  const restored = BookingCart.reconstitute({
    seats: cart.cartSeats.map((seat) => ({
      seatKey: seat.seatKey,
      lines: seat.lines.map((line) => ({
        id: line.lineId,
        serviceId: line.serviceId,
        variantId: line.variantId,
        barberId: line.barberId,
      })),
    })),
    nextSequence: cart.cartNextSequence,
  });
  // Unreachable: the system only ever hands back carts its own commands built.
  if (restored.isFailure()) defect('unreachable: cart refused');
  return restored.value;
}

/** Unreachable refusals of values that are valid by construction. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** A calendar day's key — a real day by construction (`CalendarDay`). */
function localDateOf(key: string): LocalDate {
  return sure(LocalDate.parse(key), `a CalendarDay key ${key}`);
}

function dayWindowsDataOf(day: DayWindows): DayWindowsData {
  return DayWindowsData.of(
    localDateOf(day.dayKey),
    day.windows.map((window) =>
      MinuteRange.of(
        sure(MinuteOfDay.of(window.start.minutesFromMidnight()), 'a start'),
        sure(EndMinute.of(window.end.minutesFromMidnight()), 'an end'),
      ),
    ),
  );
}

function whenDataOf(when: FlexibleWhen): WhenData {
  return WhenData.of(when.days.map(dayWindowsDataOf));
}

/** A slot's instant on the shop's wall clock — the slot's own zone (`TimeSlot` is zoned). */
function wallOf(instant: TimeSlot['start']): WallTime {
  return ZonedTimeSystem.toLocal(
    sure(UtcEpochMs.of(instant.toMillis()), 'an instant'),
    sure(ZonedTimeSystem.checkZone(instant.zoneName), 'a zone'),
  );
}

/**
 * A slot as minutes of `day` — the selection's shop day (T7: a visit never
 * crosses midnight; an end AT the next midnight is the day's closing 1440).
 */
function minutesOf(
  slot: TimeSlot,
  day: LocalDate,
): { readonly startMinutes: MinuteOfDay; readonly endMinutes: EndMinute } {
  const start = wallOf(slot.start);
  const end = wallOf(slot.end);
  const endMinutes =
    end.localDate === day ? end.minute : MINUTES_PER_DAY + end.minute;
  return {
    startMinutes: start.minute,
    endMinutes: sure(EndMinute.of(endMinutes), 'a seat that ends on its day'),
  };
}

const MINUTES_PER_DAY = 1440;

function selectionDataOf(selection: ScheduleSelection): SelectionData {
  const day = wallOf(selection.timeSlot.start).localDate;
  return {
    locationId: EcsLocationId.of(selection.locationId.value),
    localDate: day,
    ...minutesOf(selection.timeSlot, day),
    assignments: selection.assignments.map((assignment) => ({
      lineId: EcsCartLineId.of(assignment.lineId.value),
      barberId: EcsBarberId.of(assignment.barberId.value),
      ...minutesOf(assignment.slot, day),
    })),
  };
}

/**
 * The legacy state as the system reads it, and the way back: each struct
 * built from a legacy bag, mapped to that bag, so a field the step passed
 * through returns as the caller's own object.
 */
type Bridge = {
  readonly state: EcsBookingFlowState;
  readonly parties: ReadonlyMap<PartyData, BookingParty>;
  readonly carts: ReadonlyMap<CartData, BookingCart>;
  readonly whens: ReadonlyMap<WhenData, FlexibleWhen>;
  readonly selections: ReadonlyMap<SelectionData, ScheduleSelection>;
  /** Every legacy shop id in sight, by value. */
  readonly locations: ReadonlyMap<string, LocationId>;
  /** Every legacy day's windows in sight, by day key — the event's first. */
  readonly days: ReadonlyMap<string, DayWindows>;
  /** The day a toggle names, for a day the declaration did not hold. */
  readonly toggled: CalendarDay | null;
};

function bridgeOf(state: BookingFlowState, event: BookingFlowEvent): Bridge {
  const parties = new Map<PartyData, BookingParty>();
  const carts = new Map<CartData, BookingCart>();
  const whens = new Map<WhenData, FlexibleWhen>();
  const selections = new Map<SelectionData, ScheduleSelection>();
  const locations = new Map<string, LocationId>();
  const days = new Map<string, DayWindows>();
  const party = (legacy: BookingParty): PartyData => {
    const data = partyDataOf(legacy);
    parties.set(data, legacy);
    return data;
  };
  const cart = (legacy: BookingCart): CartData => {
    const data = cartDataOf(legacy);
    carts.set(data, legacy);
    return data;
  };
  const when = (legacy: FlexibleWhen): WhenData => {
    const data = whenDataOf(legacy);
    whens.set(data, legacy);
    for (const day of legacy.days) {
      if (!days.has(day.dayKey)) days.set(day.dayKey, day);
    }
    return data;
  };
  const selection = (legacy: ScheduleSelection): SelectionData => {
    const data = selectionDataOf(legacy);
    selections.set(data, legacy);
    locations.set(legacy.locationId.value, legacy.locationId);
    return data;
  };
  const location = (legacy: LocationId | null): EcsLocationId | null => {
    if (legacy === null) return null;
    locations.set(legacy.value, legacy);
    return EcsLocationId.of(legacy.value);
  };

  if (event.type === 'set_day_windows') {
    days.set(event.dayWindows.dayKey, event.dayWindows);
  }
  if (event.type === 'select_location') location(event.locationId);

  let data: EcsBookingFlowState;
  switch (state.kind) {
    case 'location':
    case 'services':
      data = {
        bookingFlowStep: STEP_OF[state.kind],
        party: party(state.party),
        cart: cart(state.cart),
        locationId: location(state.locationId),
      };
      break;
    case 'schedule':
      data = {
        bookingFlowStep: STEP_OF[state.kind],
        party: party(state.party),
        cart: cart(state.cart),
        locationId: location(state.locationId),
        when: when(state.when),
      };
      break;
    case 'review':
      data = {
        bookingFlowStep: STEP_OF[state.kind],
        party: party(state.party),
        cart: cart(state.cart),
        selection: selection(state.selection),
      };
      break;
    case 'confirmed':
      data = {
        bookingFlowStep: STEP_OF[state.kind],
        confirmation: {
          appointmentId: AppointmentId.of(state.confirmation.appointmentId),
          party: party(state.confirmation.party),
          cart: cart(state.confirmation.cart),
          selection: selection(state.confirmation.selection),
        },
      };
      break;
    case 'waitlisted':
      data = {
        bookingFlowStep: STEP_OF[state.kind],
        summary: {
          requestId: WaitlistRequestId.of(state.summary.requestId),
          party: party(state.summary.party),
          cart: cart(state.summary.cart),
          when: when(state.summary.when),
          locationId: location(state.summary.locationId),
        },
      };
      break;
  }
  return {
    state: data,
    parties,
    carts,
    whens,
    selections,
    locations,
    days,
    toggled: event.type === 'toggle_flexible_day' ? event.day : null,
  };
}

/** The event as the system reads it; a picked schedule joins the bridge. */
function eventDataOf(event: BookingFlowEvent, bridge: Bridge): FlowEventData {
  const selections = bridge.selections as Map<SelectionData, ScheduleSelection>;
  switch (event.type) {
    case 'add_guest':
      return {
        bookingFlowEventKind: BookingFlowEventKind.AddGuest,
        label: event.label,
      };
    case 'remove_guest':
      return {
        bookingFlowEventKind: BookingFlowEventKind.RemoveGuest,
        guestId: EcsGuestId.of(event.guestId.value),
      };
    case 'rename_guest':
      return {
        bookingFlowEventKind: BookingFlowEventKind.RenameGuest,
        guestId: EcsGuestId.of(event.guestId.value),
        label: event.label,
      };
    case 'add_line':
      return {
        bookingFlowEventKind: BookingFlowEventKind.AddLine,
        seatKey: SeatKeyText.of(seatKeyValue(event.seatKey)),
        line: {
          serviceId: EcsServiceId.of(event.line.serviceId.value),
          variantId:
            event.line.variantId === null
              ? null
              : EcsServiceVariantId.of(event.line.variantId.value),
          barberId:
            event.line.barberPref.kind === 'specific'
              ? EcsBarberId.of(event.line.barberPref.barberId.value)
              : null,
          locationId: null,
        },
      };
    case 'remove_line':
      return {
        bookingFlowEventKind: BookingFlowEventKind.RemoveLine,
        seatKey: SeatKeyText.of(seatKeyValue(event.seatKey)),
        lineId: EcsCartLineId.of(event.lineId.value),
      };
    case 'set_line_variant':
      return {
        bookingFlowEventKind: BookingFlowEventKind.SetLineVariant,
        seatKey: SeatKeyText.of(seatKeyValue(event.seatKey)),
        lineId: EcsCartLineId.of(event.lineId.value),
        variantId:
          event.variantId === null
            ? null
            : EcsServiceVariantId.of(event.variantId.value),
      };
    case 'set_line_barber':
      return {
        bookingFlowEventKind: BookingFlowEventKind.SetLineBarber,
        seatKey: SeatKeyText.of(seatKeyValue(event.seatKey)),
        lineId: EcsCartLineId.of(event.lineId.value),
        barberId:
          event.barberPref.kind === 'specific'
            ? EcsBarberId.of(event.barberPref.barberId.value)
            : null,
      };
    case 'select_location':
      return {
        bookingFlowEventKind: BookingFlowEventKind.SelectLocation,
        locationId:
          event.locationId === null
            ? null
            : EcsLocationId.of(event.locationId.value),
      };
    case 'select_schedule': {
      const data = selectionDataOf(event.selection);
      selections.set(data, event.selection);
      return {
        bookingFlowEventKind: BookingFlowEventKind.SelectSchedule,
        selection: data,
      };
    }
    case 'toggle_flexible_day':
      return {
        bookingFlowEventKind: BookingFlowEventKind.ToggleFlexibleDay,
        localDate: localDateOf(event.day.key()),
      };
    case 'set_day_windows':
      return {
        bookingFlowEventKind: BookingFlowEventKind.SetDayWindows,
        dayWindows: dayWindowsDataOf(event.dayWindows),
      };
    case 'clear_flexible':
      return { bookingFlowEventKind: BookingFlowEventKind.ClearFlexible };
    case 'confirmed':
      return {
        bookingFlowEventKind: BookingFlowEventKind.Confirmed,
        appointmentId: AppointmentId.of(event.appointmentId),
      };
    case 'waitlisted':
      return {
        bookingFlowEventKind: BookingFlowEventKind.Waitlisted,
        requestId: WaitlistRequestId.of(event.requestId),
      };
    case 'next':
      return { bookingFlowEventKind: BookingFlowEventKind.Next };
    case 'back':
      return { bookingFlowEventKind: BookingFlowEventKind.Back };
  }
}

function legacyPartyFrom(bridge: Bridge, party: PartyData): BookingParty {
  return bridge.parties.get(party) ?? legacyPartyOf(party);
}

function legacyCartFrom(bridge: Bridge, cart: CartData): BookingCart {
  return bridge.carts.get(cart) ?? legacyCartOf(cart);
}

function legacyLocationFrom(
  bridge: Bridge,
  locationId: EcsLocationId | null,
): LocationId | null {
  if (locationId === null) return null;
  return bridge.locations.get(locationId) ?? null;
}

function legacySelectionFrom(
  bridge: Bridge,
  selection: SelectionData,
): ScheduleSelection {
  // The step never builds a selection: it is the state's or the event's.
  return bridge.selections.get(selection) as ScheduleSelection;
}

/** A declaration the step changed, rebuilt from the legacy days in sight. */
function legacyWhenFrom(bridge: Bridge, when: WhenData): FlexibleWhen {
  const own = bridge.whens.get(when);
  if (own !== undefined) return own;
  if (WhenData.isEmpty(when)) return FlexibleWhen.empty();
  return FlexibleWhen.of(
    when.flexibleDays.map(
      (day) =>
        bridge.days.get(day.localDate) ??
        DayWindows.of(bridge.toggled as CalendarDay),
    ),
  );
}

function legacyStateOf(
  next: EcsBookingFlowState,
  bridge: Bridge,
): BookingFlowState {
  switch (next.bookingFlowStep) {
    case FlowStep.Location:
    case FlowStep.Services:
      return {
        kind: LEGACY_STEP_OF[next.bookingFlowStep],
        party: legacyPartyFrom(bridge, next.party),
        cart: legacyCartFrom(bridge, next.cart),
        locationId: legacyLocationFrom(bridge, next.locationId),
      };
    case FlowStep.Schedule:
      return {
        kind: LEGACY_STEP_OF[next.bookingFlowStep],
        party: legacyPartyFrom(bridge, next.party),
        cart: legacyCartFrom(bridge, next.cart),
        locationId: legacyLocationFrom(bridge, next.locationId),
        when: legacyWhenFrom(bridge, next.when),
      };
    case FlowStep.Review:
      return {
        kind: LEGACY_STEP_OF[next.bookingFlowStep],
        party: legacyPartyFrom(bridge, next.party),
        cart: legacyCartFrom(bridge, next.cart),
        selection: legacySelectionFrom(bridge, next.selection),
      };
    case FlowStep.Confirmed:
      return {
        kind: LEGACY_STEP_OF[next.bookingFlowStep],
        confirmation: {
          appointmentId: next.confirmation.appointmentId,
          party: legacyPartyFrom(bridge, next.confirmation.party),
          cart: legacyCartFrom(bridge, next.confirmation.cart),
          selection: legacySelectionFrom(bridge, next.confirmation.selection),
        },
      };
    case FlowStep.Waitlisted:
      return {
        kind: LEGACY_STEP_OF[next.bookingFlowStep],
        summary: {
          requestId: next.summary.requestId,
          party: legacyPartyFrom(bridge, next.summary.party),
          cart: legacyCartFrom(bridge, next.summary.cart),
          when: legacyWhenFrom(bridge, next.summary.when),
          locationId: legacyLocationFrom(bridge, next.summary.locationId),
        },
      };
  }
}

/** A seat key value back as the legacy key — the booker's, or a guest's own id. */
function legacySeatKeyOf(party: BookingParty, seat: SeatKeyText): SeatKey {
  const guest = party.guests.find((candidate) => candidate.id.value === seat);
  return guest === undefined ? SeatKey.self() : SeatKey.guest(guest.id);
}

/** The label a guest event carries, for the label refusals. */
function labelOf(event: BookingFlowEvent): string {
  return event.type === 'add_guest' || event.type === 'rename_guest'
    ? event.label
    : '';
}

/** The system's refusal as the legacy error class, its parameters the event's. */
function legacyErrorOf(
  error: EcsBookingFlowError,
  state: BookingFlowState,
  event: BookingFlowEvent,
): BookingFlowError {
  switch (error.errorCode) {
    case BookingFlowErrorCode.InvalidTransition:
      return new InvalidBookingFlowTransitionError(state.kind, event.type);
    case BookingFlowErrorCode.InvalidGuest: {
      const label = SeatLabel.create(labelOf(event));
      return new InvalidGuestError(label.isFailure() ? [label.error] : []);
    }
    case SchedulingErrorCode.PartyDuplicateLabel:
      return new DuplicateGuestLabelError(error.label);
    case BookingFlowErrorCode.GuestNotFound:
      return new GuestNotFoundInFlowError(error.guestId);
    case BookingFlowErrorCode.PartyFull:
      return new PartyFullError(error.max);
    case BookingFlowErrorCode.EmptyCart:
      return new EmptyCartError();
    case BookingFlowErrorCode.SeatWithoutService:
      return new SeatWithoutServiceError(error.seatKey);
    case BookingFlowErrorCode.FlexibleDaysFull:
      return new FlexibleDaysFullError(error.max);
    case BookingFlowErrorCode.NoFlexibleDays:
      return new NoFlexibleDaysError();
    case BookingFlowErrorCode.InvalidCartOperation:
      return new InvalidCartOperationError(legacyCartErrorOf(error, event));
  }
}

/** The cart refusal underneath, as the legacy class, named by the event. */
function legacyCartErrorOf(
  error: EcsBookingFlowError.InvalidCartOperation,
  event: BookingFlowEvent,
): BookingCartError {
  const seatKey =
    'seatKey' in event ? seatKeyValue(event.seatKey) : SeatKey.self().kind;
  if (
    error.reasonCode === SchedulingErrorCode.CartDuplicateService &&
    event.type === 'add_line'
  ) {
    return new DuplicateServiceForSeatError(
      seatKey,
      event.line.serviceId.value,
    );
  }
  return new CartLineNotFoundError(
    seatKey,
    'lineId' in event ? event.lineId.value : '',
  );
}
