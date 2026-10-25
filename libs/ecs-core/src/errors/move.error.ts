import type { LocationId, SeatId } from '@core/primitives';
import type { BookingError } from './booking.error';

/**
 * Why a seat CARRIED with a client's move cannot be placed — the ONLY
 * source of these strings (`CarriedSeatRefusal`, the field `refusal`): the
 * client is told to phone the shop. The values are i18n key SEGMENTS
 * (`errors.BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE.shop_only`), so they
 * keep their spelling (flatten-spec §4.1). Moved here from `move.system.ts`
 * (Law 7.5, Phase 4a 4A-6).
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

/**
 * The move's own codes — the rest are the commit's (`BookingError`). One
 * dictionary for the move domain (pass D, D-9.2): the server's carried-seat
 * refusal, and the three CLIENT-side refusals a `?reschedule=` link ends in
 * when it cannot become a move (folded in from the retired
 * `MoveRefusalReason`; no callable raises them — the edge holds inert rows).
 */
export const MoveErrorCode = {
  CarriedSeatUnplaceable: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE',
  /** Only seats the shop must re-seat remain (the server refuses `shop_only`). */
  CompanionsOnly: 'BOOKING_RESCHEDULE_COMPANIONS_ONLY',
  /** The visit could not be read for this account, or no longer rebuilds into a bag. */
  Unavailable: 'BOOKING_RESCHEDULE_UNAVAILABLE',
  /** Somebody the move carries can no longer be served anywhere. */
  CarriedOutOfReach: 'BOOKING_RESCHEDULE_CARRIED_OUT_OF_REACH',
} as const;
export type MoveErrorCode = (typeof MoveErrorCode)[keyof typeof MoveErrorCode];

/** Somebody the move carries cannot be placed — the client phones the shop. */
export type MoveCarriedSeatUnplaceable = {
  readonly errorCode: typeof MoveErrorCode.CarriedSeatUnplaceable;
  readonly refusal: CarriedSeatRefusal;
  readonly seatIds: readonly SeatId[];
};

export const MoveCarriedSeatUnplaceable = {
  of(
    refusal: CarriedSeatRefusal,
    seatIds: readonly SeatId[],
  ): MoveCarriedSeatUnplaceable {
    return {
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal,
      seatIds,
    };
  },
} as const;

/**
 * What a move plan refuses with (`MoveSystem.plan`, moved here from
 * `move.system.ts`, pass D D-9.1): the commit's `BOOKING_INVALID_INPUT`
 * (`status`, `seats`, `subject`, `seat_resolved`), or a carried seat it
 * cannot place. The namespace also declares the move family's client-side
 * refusals, which {@link MoveRefusal} names.
 */
export type MoveError = BookingError.InvalidInput | MoveCarriedSeatUnplaceable;

export namespace MoveError {
  /** Nobody is left for the cart to stand in for — only the shop can move the rest. */
  export type CompanionsOnly = {
    readonly errorCode: typeof MoveErrorCode.CompanionsOnly;
    /** The visit's shop, when known — the refusal's call button dials it. */
    readonly locationId: LocationId | null;
  };
  /** The visit could not be read here, or no longer rebuilds into a bag. */
  export type Unavailable = {
    readonly errorCode: typeof MoveErrorCode.Unavailable;
    readonly locationId: LocationId | null;
  };
  /** Somebody the move carries can no longer be served at the flow's shop. */
  export type CarriedOutOfReach = {
    readonly errorCode: typeof MoveErrorCode.CarriedOutOfReach;
    readonly locationId: LocationId | null;
  };
}

/**
 * Why a `?reschedule=` link did not become a move, and its shop when known
 * (the shell's call button) — a flat `{ errorCode, locationId }` struct of
 * the move error family (pass D, D-9.2; was `MoveRefusal {
 * moveRefusalReason }` in components). The refusal panel words it by its
 * own sentence table (`booking.moveRefused.*`, Law 7.5 note), keyed by the
 * three codes.
 */
export type MoveRefusal =
  | MoveError.CompanionsOnly
  | MoveError.Unavailable
  | MoveError.CarriedOutOfReach;

export const MoveRefusal = {
  /** Only seats the shop must re-seat remain. */
  companionsOnly(locationId: LocationId | null): MoveError.CompanionsOnly {
    return { errorCode: MoveErrorCode.CompanionsOnly, locationId };
  },
  /** The visit cannot be read for this account, or no longer rebuilds into a bag. */
  unavailable(locationId: LocationId | null): MoveError.Unavailable {
    return { errorCode: MoveErrorCode.Unavailable, locationId };
  },
  /** Somebody the move carries can no longer be served — at `locationId`, the flow's shop. */
  carriedOutOfReach(
    locationId: LocationId | null,
  ): MoveError.CarriedOutOfReach {
    return { errorCode: MoveErrorCode.CarriedOutOfReach, locationId };
  },
} as const;
