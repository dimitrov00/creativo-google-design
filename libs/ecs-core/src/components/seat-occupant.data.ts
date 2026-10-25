import { CustomerId, type StoredFields, UserId } from '@core/primitives';
import type { AccountOccupant } from './account-occupant.data';
import type { SeatLabel } from './seat-label.data';

/**
 * Who a seat's subject is — the field `seatSubject`, the ONLY source of
 * these strings. `ACCOUNT` names the account AND, beside it, the client
 * record the shop keeps about that person (D29, the appointment flip (1),
 * F1-4: "beside, not instead"); a `CUSTOMER` variant — a record with no
 * account — joins with the walk-in path.
 */
export const SeatSubject = {
  /** A registered account and its client record, each referenced by id — never an embedded profile. */
  Account: 'ACCOUNT',
  /** No account, no PII beyond a `SeatLabel` handle. */
  Anonymous: 'ANONYMOUS',
} as const;
export type SeatSubject = (typeof SeatSubject)[keyof typeof SeatSubject];

/** How an account subject relates to the party's owner — the field `subjectRelationship`. */
export const SubjectRelationship = {
  /** The booker's own seat — what authority hangs off; never guessed. */
  Self: 'SELF',
  /** Someone with an account of their own the booker vouches for. */
  Companion: 'COMPANION',
  /** A third party a STAFF member booked for. */
  Client: 'CLIENT',
} as const;
export type SubjectRelationship =
  (typeof SubjectRelationship)[keyof typeof SubjectRelationship];

/**
 * WHO a seat is FOR (`seat.ts:22,40-52`) — a flat variant slice of every
 * `seats[]` element, discriminated by `seatSubject`: an account by its uid
 * (`subjectUserId` — who signs in, the rules and "my …" key) with the
 * client record the shop keeps about that person (`subjectCustomerId` —
 * whom the shop serves, bills and rewards; D29: two fields, two values,
 * never derived from each other) and its relationship to the booker, or an
 * anonymous guest by label. (Split out of `seat.data.ts`, pass D, L-1.)
 */
export type SeatOccupant = SeatOccupant.Account | SeatOccupant.Anonymous;

export const SeatOccupant = {
  account(
    userId: UserId,
    customerId: CustomerId,
    relationship: SubjectRelationship,
  ): SeatOccupant.Account {
    return {
      seatSubject: SeatSubject.Account,
      subjectUserId: userId,
      subjectCustomerId: customerId,
      subjectRelationship: relationship,
    };
  },

  anonymous(label: SeatLabel): SeatOccupant.Anonymous {
    return { seatSubject: SeatSubject.Anonymous, guestLabel: label };
  },

  /**
   * The read-time check of a stored occupant (edge hardening D-1): the NAME
   * of the first field that is not well-formed, or `null`. Narrows on
   * `seatSubject` (a `SeatSubject` member, else `'seatSubject'`); an
   * ACCOUNT names its account (`subjectUserId`) and its client record
   * (`subjectCustomerId`) — the ids the mirrors, the rules and the stats
   * projection key on. An anonymous guest's label is display-only and is
   * not checked; neither is `subjectRelationship`. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    switch (raw['seatSubject']) {
      case SeatSubject.Account:
        if (!UserId.is(raw['subjectUserId'])) return 'subjectUserId';
        return CustomerId.is(raw['subjectCustomerId'])
          ? null
          : 'subjectCustomerId';
      case SeatSubject.Anonymous:
        return null;
      default:
        return 'seatSubject';
    }
  },

  /** A subject with no identity and no contact channel. */
  isContactless(occupant: AccountOccupant): boolean {
    return occupant.seatSubject === SeatSubject.Anonymous;
  },

  /** The occupant slice of a value that carries one (a whole `Seat`), copied to exactly its variant's fields. */
  of(occupant: SeatOccupant): SeatOccupant {
    return occupant.seatSubject === SeatSubject.Account
      ? SeatOccupant.account(
          occupant.subjectUserId,
          occupant.subjectCustomerId,
          occupant.subjectRelationship,
        )
      : SeatOccupant.anonymous(occupant.guestLabel);
  },
} as const;

export namespace SeatOccupant {
  export type Account = {
    readonly seatSubject: typeof SeatSubject.Account;
    readonly subjectUserId: UserId;
    /** The client record of this account (D29) — `CustomerId.forUser(subjectUserId, hash)`, resolved by the pipeline. */
    readonly subjectCustomerId: CustomerId;
    readonly subjectRelationship: SubjectRelationship;
  };
  export type Anonymous = {
    readonly seatSubject: typeof SeatSubject.Anonymous;
    readonly guestLabel: SeatLabel;
  };
}
