/**
 * The roles a user account may hold — the ONLY source of these strings
 * (`users.roles`, the ID token's `roles` claim, `firestore.rules`'
 * `hasAnyRole([...])` lists) — claim and rules values, exempt from the
 * SCREAMING sweep (flatten-spec §0.4, OQ-3). No brand: the stored strings
 * are unchanged, and
 * guards compare `Role.Admin`, never a bare `'admin'` (blueprint §2.4).
 *
 * A user holds a SET of roles — a shop owner is commonly `barber` AND
 * `admin` — so the grant lists and predicates take role lists; they are
 * the {@link Roles} companion (`roles.data.ts`, pass D D-7.3: a dictionary
 * const cannot carry methods). v2's `customer` is `client` here, the
 * workspace's own word for the customer-facing area.
 */
export const Role = {
  Client: 'client',
  Barber: 'barber',
  Receptionist: 'receptionist',
  ContentManager: 'content_manager',
  Admin: 'admin',
  Sysadmin: 'sysadmin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
