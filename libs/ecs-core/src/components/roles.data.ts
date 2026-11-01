import { Tag } from '@core/primitives';
import { Role } from './role.data';

/**
 * A SET of roles one account holds — a shop owner is commonly `barber` AND
 * `admin`, so every grant below is asked of a list, never of one role
 * (blueprint §2.4). The role-set rules of the `Role` claim dictionary live
 * here because a dictionary const cannot carry methods (pass D, D-7.3):
 * `Role` stays the claim and `firestore.rules` vocabulary, `Roles` is its
 * companion of grant lists and predicates.
 *
 * The predicates that answer an UNTRUSTED list (an ID token's claims, a
 * `users.roles` array read back) take `readonly string[]`: an unrecognised
 * string is simply in no grant list, so it grants nothing.
 */
export type Roles = readonly Role[];

/** Whether `value` is in the grant list `granting` — typed `string`, so a grant list of narrower roles needs no cast. */
function grants(granting: readonly string[], value: string): boolean {
  return granting.includes(value);
}

/** Whether any member of `held` is in `granting` — claims-tolerant (index loop, no allocation). */
function anyIn(granting: readonly string[], held: readonly string[]): boolean {
  for (let i = 0; i < held.length; i++) {
    if (grants(granting, held[i] as string)) return true;
  }
  return false;
}

export const Roles = {
  /** Every role, dictionary order — derived, never a second source. */
  ALL: Tag.values(Role),

  /**
   * Roles that grant the STAFF-tier area: everyone who is not a plain client
   * (deliberately broader than v2's `isStaff`, which left `admin`/`sysadmin` to
   * a separate tier). `firestore.rules`' `isStaff()` is its twin
   * (`role.rules-parity.spec.ts` holds them equal).
   */
  STAFF: [
    Role.Barber,
    Role.Receptionist,
    Role.ContentManager,
    Role.Admin,
    Role.Sysadmin,
  ],

  /**
   * The roles that WORK THE BOOK — the twin of `worksTheBook()` in
   * `firestore.rules`. Narrower than `STAFF`: `content_manager` is a
   * copy-and-media role the rules refuse every read on `appointments`, so the
   * callables must refuse it every write too — a permission the reader is
   * denied and the writer granted is the wrong way round.
   */
  BOOK: [Role.Barber, Role.Receptionist, Role.Admin, Role.Sysadmin],

  /**
   * The roles that may SPEND THE SHOP'S MONEY on a booking — reprice a seat,
   * author an ad-hoc discount. The front desk and the owners, never a barber
   * (who may still honour a coupon the client holds: that act is gated on
   * `mayBook`). The same three roles `firestore.rules` lets list the clientele.
   */
  MONEY: [Role.Receptionist, Role.Admin, Role.Sysadmin],

  /**
   * Roles that grant the ADMIN area and its writes — `firestore.rules`'
   * `isAdmin()` (an admin or the sysadmin). ONE home: the admin routes, the
   * shell's admin entry and the impersonation callables' caller gate read it
   * (Phase 4a §3.2).
   */
  ADMIN: [Role.Admin, Role.Sysadmin],

  /**
   * The roles that may READ A CLIENT'S SPEND — `clientStats/{customerId}/
   * restricted/money`, the twin of that block's `hasAnyRole(['admin'])` in
   * `firestore.rules`: the shop's admin ONLY. Narrower than `ADMIN` on
   * purpose — not the sysadmin (a support role with no business in a client's
   * spend), not the front desk — so never `isAdmin`, which adds the sysadmin.
   */
  SPEND: [Role.Admin],

  /**
   * The roles that may act on a person's data as a DATA-SUBJECT REQUEST —
   * the client export and erasure callables (audit-hardening Phase 3,
   * P3-RU-13): the shop's admin ONLY. An irreversible or wholesale act on a
   * client's data stays with the owner; the sysadmin is a support role with
   * no business in it, so never `isAdmin`. CALLABLE-ONLY: no
   * `firestore.rules` helper twins it — the callables are the only door
   * (`role.rules-parity.spec.ts` says so) — and the server re-reads the
   * caller's STORED roles against it, behind the token's claims.
   */
  PRIVACY: [Role.Admin],

  /**
   * The roles that may CHANGE AN ACCOUNT'S ROLES — the `setRoles` callable
   * (security hardening S-WS-E, S-RU-14): the shop's admin ONLY. The
   * sysadmin is the vendor's support role, provisioned out of band, so never
   * `isAdmin`. CALLABLE-ONLY like `PRIVACY`: `users.roles` takes no client
   * write (`firestore.rules`), so no rules helper twins it
   * (`role.rules-parity.spec.ts` says so); the server re-reads the caller's
   * STORED roles against it, behind the token's claims.
   */
  ASSIGN: [Role.Admin],

  /**
   * The roles `setRoles` may grant or take away — every role but the
   * vendor's `sysadmin`, dictionary order (S-RU-14). CALLABLE-ONLY, as
   * {@link Roles.ASSIGN}.
   */
  ASSIGNABLE: [
    Role.Client,
    Role.Barber,
    Role.Receptionist,
    Role.ContentManager,
    Role.Admin,
  ],

  /** The edge guard for an untrusted value — a stored array entry, a token claim. */
  isRole(value: unknown): value is Role {
    return Tag.has(Role, value);
  },

  /**
   * The known roles of an untrusted list, in order, each once — an
   * unrecognised string is not a role, grants nothing and is dropped (a token
   * claim, a `users.roles` array read back).
   */
  known(raw: readonly unknown[]): Roles {
    const out: Role[] = [];
    for (let i = 0; i < raw.length; i++) {
      const value = raw[i];
      if (Tag.has(Role, value) && !out.includes(value)) out.push(value);
    }
    return out;
  },

  /** Whether a single role is a staff-tier role. */
  isStaffRole(role: Role): boolean {
    return grants(Roles.STAFF, role);
  },

  /** Whether a role set grants the staff area (any member qualifies). */
  isStaff(roles: Roles): boolean {
    return anyIn(Roles.STAFF, roles);
  },

  /**
   * Whether a role set may read and write the shop's book (`worksTheBook`).
   * Takes `readonly string[]` because callers hold unvalidated claims off an ID
   * token: an unrecognised string is simply not in `BOOK`.
   */
  mayBook(roles: readonly string[]): boolean {
    return anyIn(Roles.BOOK, roles);
  },

  /** Whether a role set may reprice a seat or invent a discount (`handlesMoney`). Claims-tolerant like `mayBook`. */
  seesMoney(roles: readonly string[]): boolean {
    return anyIn(Roles.MONEY, roles);
  },

  /**
   * Whether a role set holds the admin pair (`ADMIN`, the rules'
   * `isAdmin()`) — the impersonation callables' and the owner-only gates.
   * Claims-tolerant like `mayBook`: an entry counts only when it IS one of
   * the two roles.
   */
  isAdmin(roles: readonly string[]): boolean {
    return anyIn(Roles.ADMIN, roles);
  },

  /**
   * Whether a role set may read a client's lifetime spend (`SPEND` — the
   * admin alone). Claims-tolerant like `mayBook`: the staff client card
   * loads the money document only when this holds, so it never asks for a
   * read the rules refuse.
   */
  seesClientSpend(roles: readonly string[]): boolean {
    return anyIn(Roles.SPEND, roles);
  },

  /**
   * Whether a role set may export or erase a client's data (`PRIVACY` — the
   * admin alone): the server's gate on the privacy callables (claims, then
   * the stored roles) and the staff client card's gate on its privacy block,
   * one home for both. Claims-tolerant like `mayBook`.
   */
  handlesClientPrivacy(roles: readonly string[]): boolean {
    return anyIn(Roles.PRIVACY, roles);
  },

  /**
   * Whether a role set may change another account's roles (`ASSIGN` — the
   * admin alone): the `setRoles` wire's gate on the claims, the system's on
   * the stored roles and the staff client card's gate on its «Роли» block,
   * one home for all three. Claims-tolerant like `mayBook`.
   */
  assignsRoles(roles: readonly string[]): boolean {
    return anyIn(Roles.ASSIGN, roles);
  },

  /**
   * Whether a role set reads the CLIENT'S OWN WORDS on their visits — the
   * note a client left with a booking (R15): every role but the sysadmin, a
   * support role the client's words are kept from. Claims-tolerant: holding
   * `sysadmin` beside any other role still keeps them.
   */
  readsClientWords(roles: readonly string[]): boolean {
    return !roles.includes(Role.Sysadmin);
  },
} as const;
