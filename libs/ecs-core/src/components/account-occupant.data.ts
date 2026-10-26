import type { SeatOccupant } from './seat-occupant.data';

/**
 * An occupant as the ACCOUNT rules read it — {@link AccountOccupant.Account},
 * an anonymous guest or {@link AccountOccupant.WalkIn} (split out of
 * `seat.data.ts`, pass D, L-2: a helper type with readers outside its file
 * gets its own). A {@link SeatOccupant} passes straight in (Law 3).
 */
export type AccountOccupant =
  AccountOccupant.Account | SeatOccupant.Anonymous | AccountOccupant.WalkIn;

export namespace AccountOccupant {
  /**
   * The `ACCOUNT` variant as the ACCOUNT rules read it — who signed in,
   * never whom the shop serves (D29): the booker's own seat, one person in
   * two chairs, the uid mirrors. A {@link SeatOccupant.Account} passes
   * straight in (Law 3), and a rule that reads no client record never asks
   * for one — no placeholder value, no uid→customer cast (flatten L7). (Was
   * the top-level `AccountRef`, read nowhere else.)
   */
  export type Account = Omit<SeatOccupant.Account, 'subjectCustomerId'>;

  /**
   * The `WALK_IN` variant as the ACCOUNT rules read it (OR-26) — no
   * account, so a guest by label to every rule that reads accounts; the
   * client record it names is the shop's, which those rules never ask for.
   * A {@link SeatOccupant.WalkIn} passes straight in (Law 3).
   */
  export type WalkIn = Omit<SeatOccupant.WalkIn, 'subjectCustomerId'>;
}
