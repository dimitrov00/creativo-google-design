import type { SeatOccupant } from './seat-occupant.data';

/**
 * An occupant as the ACCOUNT rules read it — {@link AccountOccupant.Account}
 * or an anonymous guest (split out of `seat.data.ts`, pass D, L-2: a helper
 * type with readers outside its file gets its own). A
 * {@link SeatOccupant} passes straight in (Law 3).
 */
export type AccountOccupant = AccountOccupant.Account | SeatOccupant.Anonymous;

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
}
