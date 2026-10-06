import { DomainError } from '@creativo/domain/kernel';
import type { CommitBookingError } from './commit-booking.errors';

/**
 * WHY a person the client's cart cannot express could not come along.
 *
 * A closed vocabulary rather than the underlying commit code, because the
 * client can act on none of them — they are facts about somebody else's seat
 * (a companion the shop added), and the only fix is a phone call. The code is
 * still worth keeping for the shop and the log: "Stefan is off that day" and
 * "that service was retired" are different conversations at the desk.
 */
export type CarriedSeatRefusal =
  /** The seat's barber is not free, or not working, at the shifted time. */
  | 'barber_unavailable'
  /**
   * The seat's service — or the variant it was sold as — is retired, or not
   * offered at the shop being moved to.
   */
  | 'service_unavailable'
  /** The shifted time falls before the lead time or past the horizon. */
  | 'outside_booking_window'
  /** The seat collides with the rest of the party, or the party breaks a rule. */
  | 'party_conflict'
  /**
   * EVERYONE on the visit is somebody the cart cannot name — the client's own
   * seat was removed and only a companion the shop seated is left. A move
   * follows the client's seats; with none there is nothing for the carried
   * ones to follow, and re-seating another account is the shop's call. The
   * web flow refuses this before a cart is ever built (`MoveRefusal`
   * `companions_only`); this is the same rule where it is enforced.
   */
  | 'shop_only';

/**
 * The client asked to move a visit that carries someone their cart cannot
 * express — a companion ACCOUNT staff seated beside them — and that person
 * cannot be placed at the new time (or, `shop_only`, there is no seat of the
 * client's own for them to move with).
 *
 * The move is refused WHOLE. The alternative, moving the client and leaving
 * the companion behind (or dropping them), silently removes a person from a
 * booking, which is the one thing a move must never do (owner decision,
 * 2026-09-25). The copy tells the client to contact the shop, because the
 * shop is the only party that can re-seat somebody else.
 */
export class RescheduleCarriedSeatUnplaceableError extends DomainError {
  readonly code = 'booking.reschedule.carried_seat_unplaceable' as const;

  constructor(
    readonly refusal: CarriedSeatRefusal,
    readonly seatIds: readonly string[],
  ) {
    super(
      `A seat carried with the move cannot be placed (${refusal}): ${seatIds.join(', ')}`,
      // Ids and a code only — never who the person is. The client already
      // holds these seat ids on their own appointment.
      { refusal, seatIds: seatIds.join(',') },
    );
  }
}

/** Every way a client move can be refused: the commit's, plus the carried seats. */
export type RescheduleBookingError =
  CommitBookingError | RescheduleCarriedSeatUnplaceableError;
