import {
  type AccountSeat,
  type BarberPreference,
  type BookingCall,
  BookingLifecycle,
  BookingPolicy,
  type ChairTime,
  ClientMove,
  type MoveRider,
  RequestedSubjectRole,
  type SeatAssignment,
  SeatOutcome,
  Seat,
  SeatSubject,
  type ServiceTerms,
} from '@core/components';
import {
  BookingStatus,
  Result,
  MinuteDelta,
  type BarberId,
  CartLineId,
  type LocationId,
  type SeatId,
  type ServiceId,
  type ServiceVariantId,
  type UserId,
  type LocalDate,
  MinuteOfDay,
  type UtcEpochMs,
} from '@core/primitives';
import {
  BookingError,
  BookingErrorCode,
  CarriedSeatRefusal,
  MoveCarriedSeatUnplaceable,
  type MoveError,
  MoveRefusal,
  SchedulingErrorCode,
  ShopUnavailableReason,
} from '@core/errors';
import type {
  Appointment,
  Barber,
  Service,
  ShopLocation,
} from '@core/entities';
import type { CartRider } from './booking-cart.system';
import { CancellationPolicySystem } from './cancellation-policy.system';
import { LocationScopeSystem } from './location-scope.system';

/** The prefix the cart's re-keyed line ids live under. */
const CART_LINE = 'cart-';
/** The prefix the carried seats' line ids live under — never a cart line's. */
const CARRIED_LINE = 'carried-';

/**
 * The client's move: the shop it goes to, the ONE shop day it lands on, and
 * the cart that stands in for their seats.
 */
export type MoveRequestInput = {
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly seats: readonly BookingCall.Seat[];
};

/** A cart seat re-keyed by the server — positional, so no cart line can borrow a carried seat's terms. */
export type MovedCartLine = {
  readonly lineId: CartLineId;
  readonly seat: BookingCall.Seat;
};

/**
 * A seat the move CARRIES, shifted: the stored seat (its identity, service,
 * barber and the terms it was SOLD at — a move is not a re-sale) at its new
 * start on the request's day, under a server-built line id.
 */
export type CarriedLine = {
  readonly lineId: CartLineId;
  readonly seatId: SeatId;
  readonly userId: UserId | null;
  readonly startMinutes: MinuteOfDay;
  readonly terms: ServiceTerms;
  readonly seat: Seat;
};

/**
 * Everything a client move's plan works out before the decision
 * (`reschedule-booking.use-case.ts:437-627`): which stored seats the cart
 * stands in for, the carried ones shifted, the cart re-keyed, whether
 * anything changes at all, and the chair time handed back first.
 */
export type MovePlan = {
  readonly replaced: readonly Seat[];
  readonly cart: readonly MovedCartLine[];
  readonly carried: readonly CarriedLine[];
  /** The stored placement already IS the requested one — a retry, or a no-op. */
  readonly unchanged: boolean;
  /** The visit's own chair time, handed back before it is placed again. */
  readonly release: readonly ChairTime[];
};

/** What a move is decided with, read off the visit: the riders and every chair it holds. */
export type MoveFacts = {
  readonly riders: readonly MoveRider[];
  readonly release: readonly ChairTime[];
};

/**
 * What the reach question reads of a catalogue service — its id, the
 * variants it still sells, and where it is offered (a `Service` is one).
 */
export type MoveCatalogService = {
  readonly id: ServiceId;
  readonly variants: readonly { readonly variantId: ServiceVariantId }[];
  readonly locationIds: readonly LocationId[];
};

/**
 * A rider, and the minute the server will seat it at on the move's day —
 * `null` when its kept distance would take it off that day (one shop day per
 * appointment, F-6), which the plan refuses.
 */
export type PlacedRider = {
  readonly rider: MoveRider;
  readonly startMinutes: MinuteOfDay | null;
};

/**
 * What the client may do about moving one visit ({@link MoveSystem.clientMove}):
 * the verdict, and whether the free window has passed on a visit still
 * cancellable by status — the appointments sheet's three questions, one
 * answer.
 */
export type ClientMoveAnswer = {
  readonly clientMove: ClientMove;
  /** Live by status, but the free-cancellation window has closed. */
  readonly windowClosed: boolean;
};

/** Is `barberId` on the active list? */
function isActiveBarber(
  activeBarbers: readonly Pick<Barber, 'id'>[],
  barberId: BarberId,
): boolean {
  for (let i = 0; i < activeBarbers.length; i++) {
    if ((activeBarbers[i] as Pick<Barber, 'id'>).id === barberId) return true;
  }
  return false;
}

/** Does the catalogue still offer `serviceId`? */
function isOffered(
  offered: readonly Pick<Service, 'id'>[],
  serviceId: ServiceId,
): boolean {
  for (let i = 0; i < offered.length; i++) {
    if ((offered[i] as Pick<Service, 'id'>).id === serviceId) return true;
  }
  return false;
}

function carriedOffsetMinutes(
  seatStart: MinuteOfDay,
  anchor: MinuteOfDay,
): MinuteDelta {
  return MinuteDelta.between(anchor, seatStart);
}

function carriedStartMinutes(
  cartEarliest: MinuteOfDay,
  offsetMinutes: MinuteDelta,
): MinuteOfDay | null {
  const start = MinuteOfDay.of(cartEarliest + offsetMinutes);
  return start.ok ? start.value : null;
}

/**
 * The selection's EARLIEST start — what every rider's kept distance is
 * measured from ({@link MoveSystem.placeRiders}, {@link MoveSystem.partyStarts});
 * `null` for no assignment at all. One linear scan.
 */
function earliestStart(
  assignments: readonly Pick<SeatAssignment, 'startMinutes'>[],
): MinuteOfDay | null {
  let earliest: MinuteOfDay | null = null;
  for (let i = 0; i < assignments.length; i++) {
    const start = (assignments[i] as Pick<SeatAssignment, 'startMinutes'>)
      .startMinutes;
    if (earliest === null || start < earliest) earliest = start;
  }
  return earliest;
}

function anchorOf(
  appointment: { readonly seats: readonly AccountSeat[] },
  ownerUserId: UserId | null,
): MinuteOfDay | null {
  let anchor: MinuteOfDay | null = null;
  for (let i = 0; i < appointment.seats.length; i++) {
    const seat = appointment.seats[i] as AccountSeat;
    if (!Seat.isMovableByBooker(seat, ownerUserId)) continue;
    if (anchor === null || seat.startMinutes < anchor) {
      anchor = seat.startMinutes;
    }
  }
  return anchor;
}

function releaseOf(
  appointment: Pick<Appointment, 'seats'>,
): readonly ChairTime[] {
  const chairs: ChairTime[] = [];
  for (let i = 0; i < appointment.seats.length; i++) {
    const seat = appointment.seats[i] as Seat;
    const chair = Seat.chairTime(seat);
    chairs.push({
      barberId: seat.barberId,
      startMinutes: chair.startMinutes,
      endMinutes: chair.endMinutes,
    });
  }
  return chairs;
}

/** One placement as a comparable key: WHO, WHAT, WITH WHOM, WHEN, and what they asked for. */
function placementKey(
  person: string,
  serviceId: ServiceId,
  variantId: ServiceVariantId | null,
  barberId: BarberId,
  startMinutes: MinuteOfDay,
  barberPreference: BarberPreference | null,
): string {
  return JSON.stringify([
    person,
    serviceId,
    variantId,
    barberId,
    startMinutes,
    barberPreference,
  ]);
}

/** The same keys, in any order — both sorted as copies, the arguments untouched. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

/**
 * A CLIENT's move of a visit — the shift, the carried seats and the plan
 * (`move-shift.ts`, `carried-reach.ts`, `rider-placement.ts`,
 * `Appointment.moveAnchor/chairTimes`, the plan of
 * `reschedule-booking.use-case.ts`). The cart stands in for the seats the
 * booker can name (their own seat and anonymous guests); everybody else is
 * CARRIED, keeping their distance from the move anchor — side by side stays
 * side by side, straight after stays straight after. The shift is wall-clock
 * arithmetic on the ONE shop day the request lands on (T1, F-6). ONE
 * implementation for the server, the availability engine and the review
 * card.
 */
export const MoveSystem = {
  /**
   * Minutes from the move anchor to a carried seat's start on the wall
   * clock — what a move keeps. Negative when the carried seat starts first.
   */
  carriedOffsetMinutes,

  /**
   * Where a carried seat starts once the cart's earliest seat starts at
   * `cartEarliest` — `null` when its kept distance would leave the shop day.
   */
  carriedStartMinutes,

  /** Can the booker move this visit at all? `false` when nothing on it is theirs to name. */
  hasSeatTheBookerCanMove(
    appointment: { readonly seats: readonly AccountSeat[] },
    ownerUserId: UserId | null,
  ): boolean {
    for (let i = 0; i < appointment.seats.length; i++) {
      if (
        Seat.isMovableByBooker(appointment.seats[i] as AccountSeat, ownerUserId)
      ) {
        return true;
      }
    }
    return false;
  },

  /**
   * The minute a move is measured FROM: the earliest start among the seats
   * the booker can move — a companion going first does not move it. `null`
   * when nothing is the booker's (only the shop can move such a visit).
   */
  moveAnchor: anchorOf,

  /**
   * Every chair the visit holds, seat by seat — setup, service, cleanup:
   * what a move hands back before it places the same visit again, so its own
   * seats never block its own move.
   */
  release: releaseOf,

  /**
   * What the booking flow decides a move with (`moveFacts`): the carried
   * seats by their distance from the anchor, on the terms they were sold
   * at, and every chair the visit holds. `null` when nobody is left for the
   * cart to stand in for.
   */
  facts(
    appointment: Pick<Appointment, 'seats'>,
    ownerUserId: UserId | null,
  ): MoveFacts | null {
    const anchor = anchorOf(appointment, ownerUserId);
    if (anchor === null) return null;
    const riders: MoveRider[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (Seat.isMovableByBooker(seat, ownerUserId)) continue;
      riders.push({
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        offsetMinutes: carriedOffsetMinutes(seat.startMinutes, anchor),
        durationMinutes: seat.durationMinutes,
        setupMinutes: seat.setupMinutes,
        cleanupMinutes: seat.cleanupMinutes,
      });
    }
    return { riders, release: releaseOf(appointment) };
  },

  /**
   * Where each rider lands when the selection's assignments are committed
   * as a move: its stored distance after the selection's EARLIEST start.
   * Reads the assignments as they are (Law 3 — a whole `SeatAssignment`
   * passes). Empty when there is nothing to anchor to.
   */
  placeRiders(
    assignments: readonly Pick<SeatAssignment, 'startMinutes'>[],
    riders: readonly MoveRider[],
  ): readonly PlacedRider[] {
    const earliest = earliestStart(assignments);
    if (earliest === null) return [];
    const placed: PlacedRider[] = [];
    for (let i = 0; i < riders.length; i++) {
      const rider = riders[i] as MoveRider;
      placed.push({
        rider,
        startMinutes: carriedStartMinutes(earliest, rider.offsetMinutes),
      });
    }
    return placed;
  },

  /**
   * EVERY START THE PARTY WOULD SIT AT (OR-7): each assignment's own start,
   * in order, then each rider's — its stored distance after the selection's
   * earliest start, the scan {@link placeRiders} makes — `null` for a rider
   * its kept distance takes off the shop day (which the server refuses).
   * What the time sheet frames on the shop's clock, start by start, so it
   * never offers a start the zone erases for a sequential seat or a carried
   * companion either. Reads the assignments as they are (Law 3). Empty when
   * there is nothing to anchor to.
   */
  partyStarts(
    assignments: readonly Pick<SeatAssignment, 'startMinutes'>[],
    riders: readonly MoveRider[],
  ): readonly (MinuteOfDay | null)[] {
    const earliest = earliestStart(assignments);
    if (earliest === null) return [];
    const starts: (MinuteOfDay | null)[] = [];
    for (let i = 0; i < assignments.length; i++) {
      starts.push(
        (assignments[i] as Pick<SeatAssignment, 'startMinutes'>).startMinutes,
      );
    }
    for (let i = 0; i < riders.length; i++) {
      starts.push(
        carriedStartMinutes(earliest, (riders[i] as MoveRider).offsetMinutes),
      );
    }
    return starts;
  },

  /**
   * The riders as the day query takes them (`CartRider`): each carried seat
   * on its own barber, at its distance from the party's start, on its SOLD
   * chair time (setup before, cleanup after) and with the service it is
   * served — what the engine's rider check and the shop check read. One
   * rider out per rider in, in order.
   */
  cartRiders(riders: readonly MoveRider[]): readonly CartRider[] {
    const out: CartRider[] = [];
    for (let i = 0; i < riders.length; i++) {
      const rider = riders[i] as MoveRider;
      out.push({
        serviceId: rider.serviceId,
        barberId: rider.barberId,
        offsetMinutes: rider.offsetMinutes,
        terms: {
          durationMinutes: rider.durationMinutes,
          padBeforeMinutes: rider.setupMinutes,
          padAfterMinutes: rider.cleanupMinutes,
        },
      });
    }
    return out;
  },

  /**
   * Can the live catalogue still serve every carried seat? Each rider's
   * barber must be on the active list, its service offered, and the variant
   * it was sold as (when it had one) still a variant of that service. The
   * carried service ids, in rider order, when so — the caller then asks the
   * SHOP question once about all of them (they move together, to one shop);
   * `null` the moment one is out of reach. A move that carries nobody is in
   * reach with nothing to ask.
   */
  carriedCatalogueReach(
    riders: readonly MoveRider[],
    activeBarbers: readonly Pick<Barber, 'id'>[],
    services: readonly MoveCatalogService[],
  ): readonly ServiceId[] | null {
    const carried: ServiceId[] = [];
    for (let i = 0; i < riders.length; i++) {
      const rider = riders[i] as MoveRider;
      if (!isActiveBarber(activeBarbers, rider.barberId)) return null;
      let service: MoveCatalogService | null = null;
      for (let k = 0; k < services.length && service === null; k++) {
        if ((services[k] as MoveCatalogService).id === rider.serviceId) {
          service = services[k] as MoveCatalogService;
        }
      }
      if (service === null) return null;
      if (rider.variantId !== null) {
        let offered = false;
        for (let k = 0; k < service.variants.length && !offered; k++) {
          if (service.variants[k]?.variantId === rider.variantId) {
            offered = true;
          }
        }
        if (!offered) return null;
      }
      carried.push(service.id);
    }
    return carried;
  },

  /**
   * Can the shop still serve every seat a move CARRIES, together, at one
   * shop (`carriedSeatsInReach`)? Out of reach the moment one rider is
   * ({@link carriedCatalogueReach}); then, once the shop read has answered
   * (`activeShops` — `null` while it has not: a list that has not arrived
   * is not "no shop"), some ACTIVE shop must offer every carried service at
   * once — each one served somewhere is not enough. `true` for a move that
   * carries nobody. Reads the catalogue's own entities as they are (Law 3:
   * a `Barber` and a `ShopLocation` pass by their `id`).
   */
  carriedSeatsInReach(
    riders: readonly MoveRider[],
    activeBarbers: readonly Pick<Barber, 'id'>[],
    services: readonly MoveCatalogService[],
    activeShops: readonly Pick<ShopLocation, 'id'>[] | null,
  ): boolean {
    if (riders.length === 0) return true;
    const carried = MoveSystem.carriedCatalogueReach(
      riders,
      activeBarbers,
      services,
    );
    if (carried === null) return false;
    if (activeShops === null) return true;
    for (let s = 0; s < activeShops.length; s++) {
      const shopId = (activeShops[s] as Pick<ShopLocation, 'id'>).id;
      let servesAll = true;
      for (let c = 0; c < carried.length && servesAll; c++) {
        let service: MoveCatalogService | null = null;
        for (let k = 0; k < services.length && service === null; k++) {
          if ((services[k] as MoveCatalogService).id === carried[c]) {
            service = services[k] as MoveCatalogService;
          }
        }
        servesAll =
          service !== null &&
          LocationScopeSystem.servesLocation(service, shopId);
      }
      if (servesAll) return true;
    }
    return false;
  },

  /**
   * The commit refusal a carried seat hit → what the client is told to phone
   * about. Two refusals are read one level deeper than their code: an
   * `INVALID_INPUT` on `variantId` is a retired variant (a retired service,
   * one level down); an `INVARIANT_VIOLATED` carrying the past-start
   * violation is a seat the shift moved to a start that is not after now.
   */
  carriedRefusalOf(error: BookingError): CarriedSeatRefusal {
    switch (error.errorCode) {
      case BookingErrorCode.SlotUnavailable:
      case BookingErrorCode.BarberNotRostered:
        return CarriedSeatRefusal.BarberUnavailable;
      case BookingErrorCode.UnknownService:
      case BookingErrorCode.ServiceNotAtLocation:
        return CarriedSeatRefusal.ServiceUnavailable;
      case BookingErrorCode.TooSoon:
      case BookingErrorCode.BeyondHorizon:
        return CarriedSeatRefusal.OutsideBookingWindow;
      case BookingErrorCode.InvalidInput:
        return error.field === 'variantId'
          ? CarriedSeatRefusal.ServiceUnavailable
          : CarriedSeatRefusal.PartyConflict;
      case BookingErrorCode.InvariantViolated:
        for (let i = 0; i < error.violations.length; i++) {
          if (
            error.violations[i]?.errorCode ===
            SchedulingErrorCode.AppointmentPastStartTime
          ) {
            return CarriedSeatRefusal.OutsideBookingWindow;
          }
        }
        return CarriedSeatRefusal.PartyConflict;
      default:
        return CarriedSeatRefusal.PartyConflict;
    }
  },

  /**
   * A moved visit's held chairs ON `localDate` — the release the engine
   * hands back (`day-availability.ts` `releaseOn`). The chairs are minutes
   * of the visit's own shop day (`releaseLocalDate`; `null` on a new
   * booking); on any other day they release nothing.
   */
  releaseOn(
    release: readonly ChairTime[],
    releaseLocalDate: LocalDate | null,
    localDate: LocalDate,
  ): readonly ChairTime[] {
    return releaseLocalDate === localDate ? release : [];
  },

  /**
   * Why this move cannot happen here, if it cannot (`client-booking.ts`
   * `refusal`): what the landing decided (`stored`) first, else — when the
   * shop can no longer serve who the move carries (`carriedInReach` false,
   * {@link carriedSeatsInReach}) — `CARRIED_OUT_OF_REACH` at the flow's
   * shop (`locationId`). `null` when neither refuses. Which catalogue reads
   * must have answered before reach is asked is the caller's gating (an
   * unanswered read is not "everyone is gone" — pass `true` until then).
   */
  refusalOf(
    stored: MoveRefusal | null,
    carriedInReach: boolean,
    locationId: LocationId | null,
  ): MoveRefusal | null {
    if (stored !== null) return stored;
    return carriedInReach ? null : MoveRefusal.carriedOutOfReach(locationId);
  },

  /**
   * What the CLIENT may do about moving this visit (`client-appointments.ts`
   * `canMove` / `shopMovesOnly` / `windowClosed`), one answer:
   *
   * - `MOVABLE`: the free window still allows it — the same rule a
   *   cancellation is refused by ({@link CancellationPolicySystem.mayCancel})
   *   — AND a seat on it is theirs to move ({@link hasSeatTheBookerCanMove},
   *   the rule the server refuses `shop_only` by);
   * - `SHOP_ONLY`: the window allows it, but nothing on it is the client's —
   *   only the shop can move it;
   * - `NONE`: the window (or the lifecycle) refuses.
   *
   * `windowClosed` is computed exactly as the sheet did: live by status
   * ({@link BookingLifecycle.isLive}) and NOT
   * {@link BookingPolicy.mayCancelAt} on the visit's start instant — never
   * derived from `mayCancel`'s refusal, which waves through a start that is
   * not a finite instant (where `windowClosed` is `true`).
   */
  clientMove(
    appointment: Appointment,
    policy: BookingPolicy,
    nowUtcMs: UtcEpochMs,
    ownerUserId: UserId | null,
  ): ClientMoveAnswer {
    const cancellable = CancellationPolicySystem.mayCancel(
      appointment,
      policy,
      nowUtcMs,
    ).ok;
    const clientMove = !cancellable
      ? ClientMove.None
      : MoveSystem.hasSeatTheBookerCanMove(appointment, ownerUserId)
        ? ClientMove.Movable
        : ClientMove.ShopOnly;
    return {
      clientMove,
      windowClosed:
        BookingLifecycle.isLive(appointment) &&
        !BookingPolicy.mayCancelAt(
          policy,
          CancellationPolicySystem.startUtcMsOf(appointment),
          nowUtcMs,
        ),
    };
  },

  /**
   * THE CARRIED-SEAT LADDER of a client move (`reschedule-appointment`
   * pipeline): a carried seat whose service the catalogue no longer offers
   * (`offered` — the bookable services) is never decided; otherwise the
   * WHOLE party is decided (`decide(plan.carried)`). When that is refused,
   * or a service was retired, the cart ALONE is decided (`decide([])`): a
   * cart that does not fit is the cart's own refusal; a cart that fits makes
   * the carried seats the client's call to the shop
   * (`MOVE_CARRIED_SEAT_UNPLACEABLE`) — `SERVICE_UNAVAILABLE` naming the
   * retired seats, else the decision's refusal re-read
   * ({@link carriedRefusalOf}) naming every carried seat. A party with
   * nobody carried answers the whole decision's refusal as it is.
   *
   * Higher-order and pure: `decide` is the caller's decision over the
   * carried lines it is handed, called in this order (whole party first,
   * then the cart alone), at most twice.
   */
  decideCarried<D>(
    plan: MovePlan,
    offered: readonly Pick<Service, 'id'>[],
    decide: (carried: readonly CarriedLine[]) => Result<D, BookingError>,
  ): Result<D, BookingError | MoveCarriedSeatUnplaceable> {
    const retired: CarriedLine[] = [];
    for (let i = 0; i < plan.carried.length; i++) {
      const line = plan.carried[i] as CarriedLine;
      if (!isOffered(offered, line.seat.serviceId)) retired.push(line);
    }
    const decided = retired.length > 0 ? null : decide(plan.carried);
    if (decided !== null && decided.ok) return decided;
    if (decided !== null && plan.carried.length === 0) return decided;
    // The cart alone first: a cart that does not fit is the cart's refusal.
    const own = decide([]);
    if (!own.ok) return own;
    const named = decided === null ? retired : plan.carried;
    const seatIds: SeatId[] = [];
    for (let i = 0; i < named.length; i++) {
      seatIds.push((named[i] as CarriedLine).seatId);
    }
    return Result.err(
      MoveCarriedSeatUnplaceable.of(
        decided === null
          ? CarriedSeatRefusal.ServiceUnavailable
          : MoveSystem.carriedRefusalOf(decided.error),
        seatIds,
      ),
    );
  },

  /**
   * The visit's seats once the move is decided (`reschedule-appointment`
   * pipeline): the cart seats are the decided ones; a carried seat — decided
   * after the cart, in plan order — keeps everything it was but its start.
   */
  seatsAfter(
    decided: { readonly appointment: Pick<Appointment, 'seats'> },
    plan: MovePlan,
  ): readonly Seat[] {
    const seats: Seat[] = [];
    const decidedSeats = decided.appointment.seats;
    for (let i = 0; i < decidedSeats.length; i++) {
      const seat = decidedSeats[i] as Seat;
      const carried =
        i >= plan.cart.length ? plan.carried[i - plan.cart.length] : undefined;
      seats.push(
        carried === undefined
          ? seat
          : { ...carried.seat, startMinutes: seat.startMinutes },
      );
    }
    return seats;
  },

  /**
   * The basis a NAMED move's fingerprint is hashed from (`moveDigest`):
   * the shop and the seats, as sent — the staff edit's digest basis over one
   * `{ move }` command, so the two kinds of intent share one ledger.
   */
  digestBasis(request: unknown): string {
    return JSON.stringify(['staff-operation/v1', [{ move: request }]]);
  },

  /**
   * The stored visit plus the client's cart → the plan the decision runs on.
   * Refused, in order: a visit the graph will not let go (`status` — the
   * same rule as a cancel); an empty cart (`seats`); a cart naming another
   * account (`subject` — a carried companion comes from the stored visit,
   * never the wire); a visit with no seat of the booker's (`shop_only`,
   * naming the seats only the shop can move); a carried seat its kept
   * distance would take off the request's shop day (`barber_unavailable` —
   * the shop is closed at midnight, as the decision would have found); and —
   * unless the cart asks for exactly where the visit already is — a party
   * MID-SERVICE (`seat_resolved`: re-seating it would erase a served or
   * no-showed fact); last, a visit moved IN from another shop arrives there
   * and is asked what a new booking is — the target must be listed
   * (`targetListed`, `PartyAdmissionSystem.shopListed` of the request's
   * shop; the `location_id` refusal, reason `UNLISTED`): a client's move is
   * never a door to a hidden shop. A move that stays at its own shop is
   * never asked, so a visit booked at a shop hidden since is still moved
   * there. `targetListed` defaults to listed for a caller that has already
   * admitted the shop.
   */
  plan(
    appointment: Appointment,
    ownerUserId: UserId | null,
    request: MoveRequestInput,
    targetListed = true,
  ): Result<MovePlan, MoveError> {
    if (!BookingLifecycle.canTransition(appointment, BookingStatus.Cancelled)) {
      return Result.err(BookingError.invalidInput('status'));
    }
    if (request.seats.length === 0) {
      return Result.err(BookingError.invalidInput('seats'));
    }
    for (let i = 0; i < request.seats.length; i++) {
      if (
        (request.seats[i] as BookingCall.Seat).subject.requestedSubjectRole ===
        RequestedSubjectRole.Companion
      ) {
        return Result.err(BookingError.invalidInput('subject'));
      }
    }

    const replaced: Seat[] = [];
    const carriedSeats: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (Seat.isMovableByBooker(seat, ownerUserId)) replaced.push(seat);
      else carriedSeats.push(seat);
    }
    const anchor = anchorOf(appointment, ownerUserId);
    if (replaced.length === 0 || anchor === null) {
      const seatIds: SeatId[] = [];
      for (let i = 0; i < carriedSeats.length; i++) {
        seatIds.push((carriedSeats[i] as Seat).seatId);
      }
      return Result.err(
        MoveCarriedSeatUnplaceable.of(CarriedSeatRefusal.ShopOnly, seatIds),
      );
    }

    let cartEarliest = (request.seats[0] as BookingCall.Seat).startMinutes;
    const cart: MovedCartLine[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as BookingCall.Seat;
      if (seat.startMinutes < cartEarliest) cartEarliest = seat.startMinutes;
      cart.push({ lineId: CartLineId.of(`${CART_LINE}${i}`), seat });
    }

    const carried: CarriedLine[] = [];
    const offDay: SeatId[] = [];
    for (let i = 0; i < carriedSeats.length; i++) {
      const seat = carriedSeats[i] as Seat;
      const startMinutes = carriedStartMinutes(
        cartEarliest,
        carriedOffsetMinutes(seat.startMinutes, anchor),
      );
      if (startMinutes === null) {
        offDay.push(seat.seatId);
        continue;
      }
      carried.push({
        lineId: CartLineId.of(`${CARRIED_LINE}${i}`),
        seatId: seat.seatId,
        userId:
          seat.seatSubject === SeatSubject.Account ? seat.subjectUserId : null,
        startMinutes,
        terms: {
          priceCents: seat.priceCents,
          currency: seat.currency,
          durationMinutes: seat.durationMinutes,
          setupMinutes: seat.setupMinutes,
          cleanupMinutes: seat.cleanupMinutes,
        },
        seat,
      });
    }
    if (offDay.length > 0) {
      return Result.err(
        MoveCarriedSeatUnplaceable.of(
          CarriedSeatRefusal.BarberUnavailable,
          offDay,
        ),
      );
    }

    const storedKeys: string[] = [];
    for (let i = 0; i < replaced.length; i++) {
      const seat = replaced[i] as Seat;
      storedKeys.push(
        placementKey(
          // A replaced seat is the booker's own or a guest's — a walk-in
          // the shop keeps a record for is a guest by label too (OR-26).
          seat.seatSubject === SeatSubject.Account
            ? 'self'
            : `guest:${seat.guestLabel}`,
          seat.serviceId,
          seat.variantId,
          seat.barberId,
          seat.startMinutes,
          seat.barberPreference,
        ),
      );
    }
    const cartKeys: string[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as BookingCall.Seat;
      cartKeys.push(
        placementKey(
          seat.subject.requestedSubjectRole === RequestedSubjectRole.Guest
            ? `guest:${seat.subject.label.trim()}`
            : 'self',
          seat.serviceId,
          seat.variantId,
          seat.barberId,
          seat.startMinutes,
          seat.barberPreference,
        ),
      );
    }
    const unchanged =
      appointment.locationId === request.locationId &&
      appointment.localDate === request.localDate &&
      sameKeys(storedKeys, cartKeys);

    if (!unchanged) {
      for (let i = 0; i < appointment.seats.length; i++) {
        if (SeatOutcome.isResolved(appointment.seats[i] as Seat)) {
          return Result.err(BookingError.invalidInput('seat_resolved'));
        }
      }
    }
    if (request.locationId !== appointment.locationId && !targetListed) {
      return Result.err(
        BookingError.shopUnavailable(
          request.locationId,
          ShopUnavailableReason.Unlisted,
        ),
      );
    }

    return Result.ok({
      replaced,
      cart,
      carried,
      unchanged,
      release: releaseOf(appointment),
    });
  },
} as const;
