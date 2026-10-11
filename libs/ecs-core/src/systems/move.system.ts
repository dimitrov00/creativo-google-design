import type { BarberPreference } from '../components/barber-pref.data';
import {
  BookingLifecycle,
  BookingStatus,
} from '../components/booking-lifecycle.data';
import {
  BookingError,
  BookingErrorCode,
} from '../components/booking-errors.data';
import { Result } from '../components/result.data';
import { SchedulingErrorCode } from '../components/scheduling-errors.data';
import { SeatOutcome } from '../components/seat-outcome.data';
import { Seat, SeatSubject } from '../components/seat.data';
import type { ServiceTerms } from '../components/service-terms.data';
import type { Appointment } from '../entities/appointment.entity';
import type {
  DurationMinutes,
  MinuteCount,
} from '../primitives/duration-minutes.primitive';
import { MinuteDelta } from '../primitives/duration-minutes.primitive';
import {
  type BarberId,
  CartLineId,
  type LocationId,
  type SeatId,
  type ServiceId,
  type ServiceVariantId,
  type UserId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import { MinuteOfDay } from '../primitives/minute-of-day.primitive';
import type { ChairTime } from './availability.system';
import { LocationScopeSystem } from './location-scope.system';

/** The prefix the cart's re-keyed line ids live under. */
const CART_LINE = 'cart-';
/** The prefix the carried seats' line ids live under — never a cart line's. */
const CARRIED_LINE = 'carried-';

/**
 * Why a seat CARRIED with a client's move cannot be placed — the ONLY
 * source of these strings (`CarriedSeatRefusal`,
 * `reschedule-booking.errors.ts`): the client is told to phone the shop.
 * The values are i18n key SEGMENTS and wire params
 * (`errors.BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE.shop_only`), so they
 * keep their spelling (flatten-spec §4.1).
 */
export const CarriedSeatRefusal = {
  /** The seat's barber is not free, or not working, at the shifted time. */
  BarberUnavailable: 'barber_unavailable',
  /** The seat's service — or the variant it was sold as — is retired or not offered there. */
  ServiceUnavailable: 'service_unavailable',
  /** The shifted time falls before the lead time or past the horizon. */
  OutsideBookingWindow: 'outside_booking_window',
  /** The seat collides with the rest of the party, or the party breaks a rule. */
  PartyConflict: 'party_conflict',
  /** Only seats the cart cannot name are left — the shop moves this visit. */
  ShopOnly: 'shop_only',
} as const;
export type CarriedSeatRefusal =
  (typeof CarriedSeatRefusal)[keyof typeof CarriedSeatRefusal];

/** The move's own refusal code — the rest are the commit's (`BookingError`). */
export const MoveErrorCode = {
  CarriedSeatUnplaceable: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE',
} as const;
export type MoveErrorCode = (typeof MoveErrorCode)[keyof typeof MoveErrorCode];

/** Somebody the move carries cannot be placed — the client phones the shop. */
export type MoveCarriedSeatUnplaceable = {
  readonly errorCode: typeof MoveErrorCode.CarriedSeatUnplaceable;
  readonly refusal: CarriedSeatRefusal;
  readonly seatIds: readonly SeatId[];
};

/**
 * What a move plan refuses with: the commit's `BOOKING_INVALID_INPUT`
 * (`status`, `seats`, `subject`, `seat_resolved`), or a carried seat it
 * cannot place.
 */
export type MoveError = BookingError.InvalidInput | MoveCarriedSeatUnplaceable;

/**
 * Who a cart seat is for — the field `moveSubjectRole`: the booker, or an
 * anonymous guest by label. A cart never names another account.
 */
export const MoveSubjectRole = {
  Self: 'SELF',
  Guest: 'GUEST',
  /** Never sent by an honest client — refused by the plan (`subject`). */
  Companion: 'COMPANION',
} as const;
export type MoveSubjectRole =
  (typeof MoveSubjectRole)[keyof typeof MoveSubjectRole];

/**
 * One seat of the client's cart, as the move asks for it (foreign input the
 * edge already read: ids and the start on the request's day) — every field
 * present.
 */
export type MoveCartSeatInput = {
  readonly moveSubjectRole: MoveSubjectRole;
  /** The guest's label (trimmed by the plan); `null` for the booker. */
  readonly label: string | null;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly barberPreference: BarberPreference | null;
  /** On the request's `localDate`, the shop's wall clock. */
  readonly startMinutes: MinuteOfDay;
};

/**
 * The client's move: the shop it goes to, the ONE shop day it lands on, and
 * the cart that stands in for their seats.
 */
export type MoveRequestInput = {
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly seats: readonly MoveCartSeatInput[];
};

/** A cart seat re-keyed by the server — positional, so no cart line can borrow a carried seat's terms. */
export type MovedCartLine = {
  readonly lineId: CartLineId;
  readonly seat: MoveCartSeatInput;
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

/**
 * One carried seat as the booking flow holds it while the client moves the
 * visit — what the review step shows and the grid keeps room for: its
 * wall-clock distance from the move anchor and the chair time it was SOLD at.
 */
export type MoveRider = {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly offsetMinutes: MinuteDelta;
  readonly durationMinutes: DurationMinutes;
  readonly setupMinutes: MinuteCount;
  readonly cleanupMinutes: MinuteCount;
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

function anchorOf(
  appointment: Pick<Appointment, 'seats'>,
  ownerUserId: UserId | null,
): MinuteOfDay | null {
  let anchor: MinuteOfDay | null = null;
  for (let i = 0; i < appointment.seats.length; i++) {
    const seat = appointment.seats[i] as Seat;
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
 * `Appointment.moveAnchor/seatsTheBookerCanMove/chairTimes`, the plan of
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

  /** The seats the booker's own cart can name, in seat order (`Seat.isMovableByBooker`). */
  seatsTheBookerCanMove(
    appointment: Pick<Appointment, 'seats'>,
    ownerUserId: UserId | null,
  ): readonly Seat[] {
    const movable: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (Seat.isMovableByBooker(seat, ownerUserId)) movable.push(seat);
    }
    return movable;
  },

  /** Can the booker move this visit at all? `false` when nothing on it is theirs to name. */
  hasSeatTheBookerCanMove(
    appointment: Pick<Appointment, 'seats'>,
    ownerUserId: UserId | null,
  ): boolean {
    for (let i = 0; i < appointment.seats.length; i++) {
      if (Seat.isMovableByBooker(appointment.seats[i] as Seat, ownerUserId)) {
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
   * Empty when there is nothing to anchor to.
   */
  placeRiders(
    assignmentStarts: readonly MinuteOfDay[],
    riders: readonly MoveRider[],
  ): readonly PlacedRider[] {
    if (assignmentStarts.length === 0) return [];
    let earliest = assignmentStarts[0] as MinuteOfDay;
    for (let i = 1; i < assignmentStarts.length; i++) {
      const start = assignmentStarts[i] as MinuteOfDay;
      if (start < earliest) earliest = start;
    }
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
    activeBarberIds: readonly BarberId[],
    services: readonly MoveCatalogService[],
  ): readonly ServiceId[] | null {
    const carried: ServiceId[] = [];
    for (let i = 0; i < riders.length; i++) {
      const rider = riders[i] as MoveRider;
      if (!activeBarberIds.includes(rider.barberId)) return null;
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
   * (`activeShopIds` — `null` while it has not: a list that has not arrived
   * is not "no shop"), some ACTIVE shop must offer every carried service at
   * once — each one served somewhere is not enough. `true` for a move that
   * carries nobody.
   */
  carriedSeatsInReach(
    riders: readonly MoveRider[],
    activeBarberIds: readonly BarberId[],
    services: readonly MoveCatalogService[],
    activeShopIds: readonly LocationId[] | null,
  ): boolean {
    if (riders.length === 0) return true;
    const carried = MoveSystem.carriedCatalogueReach(
      riders,
      activeBarberIds,
      services,
    );
    if (carried === null) return false;
    if (activeShopIds === null) return true;
    for (let s = 0; s < activeShopIds.length; s++) {
      const shopId = activeShopIds[s] as LocationId;
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
   * no-showed fact).
   */
  plan(
    appointment: Appointment,
    ownerUserId: UserId | null,
    request: MoveRequestInput,
  ): Result<MovePlan, MoveError> {
    if (!BookingLifecycle.canTransition(appointment, BookingStatus.Cancelled)) {
      return Result.err(BookingError.invalidInput('status'));
    }
    if (request.seats.length === 0) {
      return Result.err(BookingError.invalidInput('seats'));
    }
    for (let i = 0; i < request.seats.length; i++) {
      if (
        (request.seats[i] as MoveCartSeatInput).moveSubjectRole ===
        MoveSubjectRole.Companion
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
      return Result.err({
        errorCode: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.ShopOnly,
        seatIds,
      });
    }

    let cartEarliest = (request.seats[0] as MoveCartSeatInput).startMinutes;
    const cart: MovedCartLine[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as MoveCartSeatInput;
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
      return Result.err({
        errorCode: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.BarberUnavailable,
        seatIds: offDay,
      });
    }

    const storedKeys: string[] = [];
    for (let i = 0; i < replaced.length; i++) {
      const seat = replaced[i] as Seat;
      storedKeys.push(
        placementKey(
          seat.seatSubject === SeatSubject.Anonymous
            ? `guest:${seat.guestLabel}`
            : 'self',
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
      const seat = request.seats[i] as MoveCartSeatInput;
      cartKeys.push(
        placementKey(
          seat.moveSubjectRole === MoveSubjectRole.Guest
            ? `guest:${(seat.label ?? '').trim()}`
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

    return Result.ok({
      replaced,
      cart,
      carried,
      unchanged,
      release: releaseOf(appointment),
    });
  },
} as const;
