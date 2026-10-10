import {
  BookingCommitError,
  BookingCommitErrorCode,
} from '../components/booking-commit-errors.data';
import type { BarberPrefKind } from '../components/barber-pref.data';
import { BookingState, BookingStatus } from '../components/booking-status.data';
import { Result } from '../components/result.data';
import { SchedulingErrorCode } from '../components/scheduling-errors.data';
import { SeatOutcome } from '../components/seat-outcome.data';
import { Seat, type SeatId, SeatSubjectKind } from '../components/seat.data';
import type {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ServiceId } from '../entities/service.entity';
import type { UserId } from '../entities/user.entity';
import type { ChairTime } from './availability.system';
import { LocationScopeSystem } from './location-scope.system';

const MS_PER_MINUTE = 60_000;

/** The prefix the cart's re-keyed line ids live under. */
const CART_LINE = 'cart-';
/** The prefix the carried seats' line ids live under — never a cart line's. */
const CARRIED_LINE = 'carried-';

/**
 * Why a seat CARRIED with a client's move cannot be placed — the ONLY
 * source of these strings (`CarriedSeatRefusal`,
 * `reschedule-booking.errors.ts`): the client is told to phone the shop.
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

/** The move's own refusal code — the rest are the commit's (`BookingCommitError`). */
export const MoveErrorCode = {
  CarriedSeatUnplaceable: 'booking.reschedule.carried_seat_unplaceable',
} as const;
export type MoveErrorCode = (typeof MoveErrorCode)[keyof typeof MoveErrorCode];

/** Somebody the move carries cannot be placed — the client phones the shop. */
export type MoveCarriedSeatUnplaceable = {
  readonly code: typeof MoveErrorCode.CarriedSeatUnplaceable;
  readonly refusal: CarriedSeatRefusal;
  readonly seatIds: readonly SeatId[];
};

/**
 * What a move plan refuses with: the commit's `invalid_input` (`status`,
 * `seats`, `subject`, `seat_resolved`), or a carried seat it cannot place.
 */
export type MoveError =
  BookingCommitError.InvalidInput | MoveCarriedSeatUnplaceable;

/** Who a cart seat is for — the booker, or an anonymous guest by label. A cart never names another account. */
export const MoveCartSubjectKind = {
  Self: 'self',
  Guest: 'guest',
  /** Never sent by an honest client — refused by the plan (`subject`). */
  Companion: 'companion',
} as const;
export type MoveCartSubjectKind =
  (typeof MoveCartSubjectKind)[keyof typeof MoveCartSubjectKind];

/** One seat of the client's cart, as the move asks for it — every field present. */
export type MoveCartSeat = {
  readonly subjectKind: MoveCartSubjectKind;
  /** The guest's label (trimmed by the plan); `null` for the booker. */
  readonly label: string | null;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly barberPref: BarberPrefKind | null;
  readonly startMs: number;
};

/** The client's move: the shop it goes to and the cart that stands in for their seats. */
export type MoveRequest = {
  readonly locationId: LocationId;
  readonly seats: readonly MoveCartSeat[];
};

/** A cart seat re-keyed by the server — positional, so no cart line can borrow a carried seat's terms. */
export type MovedCartLine = {
  readonly lineId: string;
  readonly seat: MoveCartSeat;
};

/**
 * A seat the move CARRIES, shifted: the stored seat (its identity, service,
 * barber and the terms it was SOLD at — a move is not a re-sale) at its new
 * start, under a server-built line id.
 */
export type CarriedLine = {
  readonly lineId: string;
  readonly seatId: SeatId;
  readonly userId: UserId | null;
  readonly startMs: number;
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
 * distance from the move anchor and the chair time it was SOLD at.
 */
export type MoveRider = {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly offsetMinutes: number;
  readonly durationMinutes: number;
  readonly setupMinutes: number;
  readonly cleanupMinutes: number;
};

/** What a move is decided with, read off the visit: the riders and every chair it holds. */
export type MoveFacts = {
  readonly riders: readonly MoveRider[];
  readonly release: readonly ChairTime[];
};

/**
 * What the reach question reads of a catalogue service — its id, the
 * variants it still sells, and where it is offered (`ServiceEntity` is one).
 */
export type MoveCatalogService = {
  readonly id: ServiceId;
  readonly variants: readonly { readonly id: ServiceVariantId }[];
  readonly locationIds: readonly LocationId[];
};

/** A rider, and the instant the server will seat it at. */
export type PlacedRider = {
  readonly rider: MoveRider;
  readonly startMs: number;
};

function carriedOffsetMinutes(seatStartMs: number, anchorMs: number): number {
  return Math.round((seatStartMs - anchorMs) / MS_PER_MINUTE);
}

function carriedStartMs(cartEarliestMs: number, offsetMinutes: number): number {
  return cartEarliestMs + offsetMinutes * MS_PER_MINUTE;
}

function anchorOf(
  appointment: AppointmentEntity,
  ownerUserId: UserId | null,
): number | null {
  let anchor: number | null = null;
  for (let i = 0; i < appointment.seats.length; i++) {
    const seat = appointment.seats[i] as Seat;
    if (!Seat.isMovableByBooker(seat, ownerUserId)) continue;
    if (anchor === null || seat.startMs < anchor) anchor = seat.startMs;
  }
  return anchor;
}

function releaseOf(appointment: AppointmentEntity): readonly ChairTime[] {
  const chairs: ChairTime[] = [];
  for (let i = 0; i < appointment.seats.length; i++) {
    const seat = appointment.seats[i] as Seat;
    chairs.push({ barberId: seat.barberId, occupied: Seat.chairTime(seat) });
  }
  return chairs;
}

/** One placement as a comparable key: WHO, WHAT, WITH WHOM, WHEN, and what they asked for. */
function placementKey(
  person: string,
  serviceId: string,
  variantId: string | null,
  barberId: string,
  startMs: number,
  barberPref: string | null,
): string {
  return JSON.stringify([
    person,
    serviceId,
    variantId,
    barberId,
    startMs,
    barberPref,
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
 * side by side, straight after stays straight after, and the arithmetic is
 * on instants, so a DST boundary changes nothing. ONE implementation for
 * the server, the availability engine and the review card.
 */
export const MoveSystem = {
  /**
   * Minutes from the move anchor to a carried seat's start — what a move
   * keeps, WHOLE minutes (rounded once, here). Negative when the carried
   * seat starts first.
   */
  carriedOffsetMinutes,

  /** Where a carried seat starts once the cart's earliest seat starts at `cartEarliestMs`. */
  carriedStartMs,

  /** The seats the booker's own cart can name, in seat order (`Seat.isMovableByBooker`). */
  seatsTheBookerCanMove(
    appointment: AppointmentEntity,
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
    appointment: AppointmentEntity,
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
   * The instant a move is measured FROM: the earliest start among the seats
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
    appointment: AppointmentEntity,
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
        offsetMinutes: carriedOffsetMinutes(seat.startMs, anchor),
        durationMinutes: seat.terms.durationMinutes,
        setupMinutes: seat.terms.setupMinutes,
        cleanupMinutes: seat.terms.cleanupMinutes,
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
    assignmentStartsMs: readonly number[],
    riders: readonly MoveRider[],
  ): readonly PlacedRider[] {
    if (assignmentStartsMs.length === 0) return [];
    let earliest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < assignmentStartsMs.length; i++) {
      const start = assignmentStartsMs[i] as number;
      if (start < earliest) earliest = start;
    }
    const placed: PlacedRider[] = [];
    for (let i = 0; i < riders.length; i++) {
      const rider = riders[i] as MoveRider;
      placed.push({
        rider,
        startMs: carriedStartMs(earliest, rider.offsetMinutes),
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
          if (service.variants[k]?.id === rider.variantId) offered = true;
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
   * `invalid_input` on `variantId` is a retired variant (a retired service,
   * one level down); an `invariant_violated` carrying the past-start
   * violation is a seat the shift moved to a start that is not after now.
   */
  carriedRefusalOf(error: BookingCommitError): CarriedSeatRefusal {
    switch (error.code) {
      case BookingCommitErrorCode.SlotUnavailable:
      case BookingCommitErrorCode.BarberNotRostered:
        return CarriedSeatRefusal.BarberUnavailable;
      case BookingCommitErrorCode.UnknownService:
      case BookingCommitErrorCode.ServiceNotAtLocation:
        return CarriedSeatRefusal.ServiceUnavailable;
      case BookingCommitErrorCode.TooSoon:
      case BookingCommitErrorCode.BeyondHorizon:
        return CarriedSeatRefusal.OutsideBookingWindow;
      case BookingCommitErrorCode.InvalidInput:
        return error.field === 'variantId'
          ? CarriedSeatRefusal.ServiceUnavailable
          : CarriedSeatRefusal.PartyConflict;
      case BookingCommitErrorCode.InvariantViolated:
        for (let i = 0; i < error.violations.length; i++) {
          if (
            error.violations[i]?.code ===
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
   * naming the seats only the shop can move); and — unless the cart asks
   * for exactly where the visit already is — a party MID-SERVICE
   * (`seat_resolved`: re-seating it would erase a served or no-showed fact).
   */
  plan(
    appointment: AppointmentEntity,
    ownerUserId: UserId | null,
    request: MoveRequest,
  ): Result<MovePlan, MoveError> {
    if (
      !BookingStatus.canTransition(
        appointment.bookingStatus,
        BookingState.Cancelled,
      )
    ) {
      return Result.err(BookingCommitError.invalidInput('status'));
    }
    if (request.seats.length === 0) {
      return Result.err(BookingCommitError.invalidInput('seats'));
    }
    for (let i = 0; i < request.seats.length; i++) {
      if (
        (request.seats[i] as MoveCartSeat).subjectKind ===
        MoveCartSubjectKind.Companion
      ) {
        return Result.err(BookingCommitError.invalidInput('subject'));
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
        seatIds.push((carriedSeats[i] as Seat).id);
      }
      return Result.err({
        code: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.ShopOnly,
        seatIds,
      });
    }

    let cartEarliestMs = Number.POSITIVE_INFINITY;
    const cart: MovedCartLine[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as MoveCartSeat;
      if (seat.startMs < cartEarliestMs) cartEarliestMs = seat.startMs;
      cart.push({ lineId: `${CART_LINE}${i}`, seat });
    }

    const carried: CarriedLine[] = [];
    for (let i = 0; i < carriedSeats.length; i++) {
      const seat = carriedSeats[i] as Seat;
      const startMs = carriedStartMs(
        cartEarliestMs,
        carriedOffsetMinutes(seat.startMs, anchor),
      );
      carried.push({
        lineId: `${CARRIED_LINE}${i}`,
        seatId: seat.id,
        userId:
          seat.subject.kind === SeatSubjectKind.Account
            ? seat.subject.userId
            : null,
        startMs,
        terms: {
          priceMinorUnits: seat.terms.priceMinorUnits,
          currencyCode: seat.terms.currencyCode,
          durationMinutes: seat.terms.durationMinutes,
          setupMinutes: seat.terms.setupMinutes,
          cleanupMinutes: seat.terms.cleanupMinutes,
        },
        seat,
      });
    }

    const storedKeys: string[] = [];
    for (let i = 0; i < replaced.length; i++) {
      const seat = replaced[i] as Seat;
      storedKeys.push(
        placementKey(
          seat.subject.kind === SeatSubjectKind.Anonymous
            ? `guest:${seat.subject.label}`
            : 'self',
          seat.serviceId,
          seat.variantId,
          seat.barberId,
          seat.startMs,
          seat.barberPref,
        ),
      );
    }
    const cartKeys: string[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as MoveCartSeat;
      cartKeys.push(
        placementKey(
          seat.subjectKind === MoveCartSubjectKind.Guest
            ? `guest:${(seat.label ?? '').trim()}`
            : 'self',
          seat.serviceId,
          seat.variantId,
          seat.barberId,
          seat.startMs,
          seat.barberPref,
        ),
      );
    }
    const unchanged =
      appointment.locationId === request.locationId &&
      sameKeys(storedKeys, cartKeys);

    if (!unchanged) {
      for (let i = 0; i < appointment.seats.length; i++) {
        if (SeatOutcome.isResolved((appointment.seats[i] as Seat).outcome)) {
          return Result.err(BookingCommitError.invalidInput('seat_resolved'));
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
