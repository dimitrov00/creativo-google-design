import { CommitBookingInvalidInputError } from './commit-booking.errors';

/*
 * THE DECISION'S OWN REFUSALS OF A PARTY — requests no seat-by-seat check
 * catches, because what is wrong is two seats TOGETHER.
 *
 * Both are `invalid_input` on the wire (a request that cannot be taken as
 * sent, which re-picking from a fresh grid would not fix), told apart by
 * their `field`: the client words them from `booking.commit.invalid_input.
 * <field>` (`bookingErrorMessage`). Subclasses rather than new codes, so
 * every path that already answers `CommitBookingError` — the commit, the
 * move, the staff edit, and the wire mapping (`toHttpsError`) — carries them
 * unchanged, and a caller that wants the reason still has the class.
 */

/**
 * One person, two chairs, the same minutes (owner decision, 2026-09-25: one
 * person can never sit in two chairs at once). Judged on the SOLD slots
 * (`PersonSlot`), the rule the availability engine offers times by — so a
 * grid never offers what this refuses, and a cart that asks for it anyway
 * (a stale tab, a forged payload) is refused whole. A rebuild of a visit
 * that already held such a pair (a staff edit, a client's move) is refused
 * only for a NEW overlap: the pair itself, by seat id, may keep overlapping
 * wherever the edit puts it (`DecideBookingDeps.standing`). The rule stops
 * a write from seating somebody twice anew; it does not freeze a visit
 * booked before it.
 *
 * `person` is the decision's own key for them (`self`, `guest:<label>`,
 * `account:<uid>`). Kept OFF the wire on purpose — it can name somebody
 * else's account.
 */
export class CommitBookingPersonDoubleBookedError extends CommitBookingInvalidInputError {
  static readonly FIELD = 'person_overlap';

  constructor(readonly person: string) {
    super(CommitBookingPersonDoubleBookedError.FIELD);
  }
}

/**
 * Two DIFFERENT guests of one cart under one label. A guest is nothing but
 * their label to the server (`personKey`), so taking the cart would merge
 * the two into one person — one seat's service filed under the other, the
 * party counted short. Refused rather than guessed at: only the booker knows
 * who is who, and one rename tells us.
 *
 * Detected only when the client names its guests (`RequestedSeat` guest
 * `guestKey`); a request without keys reads one label as one person, as it
 * always has.
 */
export class CommitBookingDuplicateGuestLabelError extends CommitBookingInvalidInputError {
  static readonly FIELD = 'guest_label';

  constructor(readonly label: string) {
    super(CommitBookingDuplicateGuestLabelError.FIELD);
  }
}
