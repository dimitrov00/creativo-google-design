import { CustomerId, type StoredFields, UserId } from '@core/primitives';
import type { AccountOccupant } from './account-occupant.data';
import type { SeatLabel } from './seat-label.data';

/**
 * Who a seat's subject is — the field `seatSubject`, the ONLY source of
 * these strings. `ACCOUNT` names the account AND, beside it, the client
 * record the shop keeps about that person (D29, the appointment flip (1),
 * F1-4: "beside, not instead"); `WALK_IN` names a client record with no
 * account — a walk-in the desk took a phone or an e-mail for (OR-26,
 * DEP-F20, the variant flatten-spec §5.5 anticipated). A name-only guest
 * stays `ANONYMOUS`: a name is no key, and keying on it would mint
 * duplicates.
 */
export const SeatSubject = {
  /** A registered account and its client record, each referenced by id — never an embedded profile. */
  Account: 'ACCOUNT',
  /** No account, no PII beyond a `SeatLabel` handle. */
  Anonymous: 'ANONYMOUS',
  /** No account, but a client record the server keeps (`CustomerId.forWalkIn`) — referenced by id, its label beside it. */
  WalkIn: 'WALK_IN',
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
 * never derived from each other) and its relationship to the booker; a
 * walk-in by the client record the shop keeps for them (OR-26 — no
 * account, so no `subjectUserId`) and the label the seat shows; or an
 * anonymous guest by label. (Split out of `seat.data.ts`, pass D, L-1.)
 */
export type SeatOccupant =
  SeatOccupant.Account | SeatOccupant.Anonymous | SeatOccupant.WalkIn;

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

  /** A walk-in: the client record the server keeps for them (OR-26), and the label the seat shows. */
  walkIn(customerId: CustomerId, label: SeatLabel): SeatOccupant.WalkIn {
    return {
      seatSubject: SeatSubject.WalkIn,
      subjectCustomerId: customerId,
      guestLabel: label,
    };
  },

  /**
   * The read-time check of a stored occupant (edge hardening D-1): the NAME
   * of the first field that is not well-formed, or `null`. Narrows on
   * `seatSubject` (a `SeatSubject` member, else `'seatSubject'`); an
   * ACCOUNT names its account (`subjectUserId`) and its client record
   * (`subjectCustomerId`), a WALK_IN its client record — the ids the
   * mirrors, the rules and the stats projection key on. A guest's label
   * (an anonymous one's or a walk-in's) is display-only and is not
   * checked; neither is `subjectRelationship`. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    switch (raw['seatSubject']) {
      case SeatSubject.Account:
        if (!UserId.is(raw['subjectUserId'])) return 'subjectUserId';
        return CustomerId.is(raw['subjectCustomerId'])
          ? null
          : 'subjectCustomerId';
      case SeatSubject.WalkIn:
        return CustomerId.is(raw['subjectCustomerId'])
          ? null
          : 'subjectCustomerId';
      case SeatSubject.Anonymous:
        return null;
      default:
        return 'seatSubject';
    }
  },

  /**
   * A subject with no identity and no contact channel — an anonymous guest.
   * A walk-in is not one: the shop keeps a record with their phone or
   * e-mail (OR-26).
   */
  isContactless(occupant: AccountOccupant): boolean {
    return occupant.seatSubject === SeatSubject.Anonymous;
  },

  /** The occupant slice of a value that carries one (a whole `Seat`), copied to exactly its variant's fields. */
  of(occupant: SeatOccupant): SeatOccupant {
    switch (occupant.seatSubject) {
      case SeatSubject.Account:
        return SeatOccupant.account(
          occupant.subjectUserId,
          occupant.subjectCustomerId,
          occupant.subjectRelationship,
        );
      case SeatSubject.WalkIn:
        return SeatOccupant.walkIn(
          occupant.subjectCustomerId,
          occupant.guestLabel,
        );
      case SeatSubject.Anonymous:
        return SeatOccupant.anonymous(occupant.guestLabel);
    }
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
  export type WalkIn = {
    readonly seatSubject: typeof SeatSubject.WalkIn;
    /** The walk-in's client record (OR-26) — `CustomerId.forWalkIn(contactKey, keyedHash)` (the server's keyed digest), resolved by the pipeline. */
    readonly subjectCustomerId: CustomerId;
    /** The label the seat shows — what the desk called them on this visit (the record keeps its own name). */
    readonly guestLabel: SeatLabel;
  };
}
