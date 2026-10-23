import type { SeatId } from '@core/primitives';

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
