import type { Brand } from './brand';

/** The booker's own seat, as a request names it. */
const SELF = 'self';
/** The prefix of an account's key — `account:<uid>`. */
const ACCOUNT_PREFIX = 'account:';
/** The prefix of a guest's key — `guest:<label>`. */
const GUEST_PREFIX = 'guest:';

/**
 * Who a seat is, as people are COUNTED — "one person, one chair at a time"
 * (`StandingSeatPair.personKey`) and "how many others came" (the visit
 * story's peer count): one key per person, whatever seats they hold. Only
 * ever compared for equality ({@link PersonKey.equals}); never stored, never
 * sent, never parsed. OR-49: one constructor module, so the two spellers —
 * `GuestLabelSystem` (a REQUEST's subjects) and `VisitStorySystem` (a STORED
 * visit's occupants) — can no longer drift apart.
 *
 * Three spellings, byte-identical to the ones the two systems spelt before:
 * - {@link PersonKey.self} — `self`, the booker of a request (a request's
 *   booker has no uid on the seat; a STORED visit names every account by
 *   its uid, so the stored side never spells `self`);
 * - {@link PersonKey.account} — `account:<uid>`;
 * - {@link PersonKey.guest} — `guest:<label>`, the label trimmed the way
 *   `SeatLabel` stores it, so « Иван» and «Иван» are the one person they
 *   will be on the appointment.
 *
 * Never a `SeatKeyText` (the cart's seat key — `self`, `guest-…`,
 * `companion-<uid>` — a different family that only shares the `self`
 * spelling), never a `DraftPersonKey` (a staff sheet's draft key).
 */
export type PersonKey = Brand<string, 'PersonKey'>;

export const PersonKey = {
  /** The booker's own seat on a request — `self`. */
  self(): PersonKey {
    return SELF as PersonKey;
  },

  /**
   * An account's key — `account:<uid>`. The uid as the caller holds it: a
   * stored occupant's `UserId`, or a request's raw companion id before the
   * decision parses it (the key only ever meets another key, never a read).
   */
  account(uid: string): PersonKey {
    return `${ACCOUNT_PREFIX}${uid}` as PersonKey;
  },

  /** A guest's key — `guest:<label>`, the label trimmed as it is stored. */
  guest(label: string): PersonKey {
    return `${GUEST_PREFIX}${label.trim()}` as PersonKey;
  },

  /** The same person — the one comparison a key is for. */
  equals(a: PersonKey, b: PersonKey): boolean {
    return a === b;
  },
} as const;
