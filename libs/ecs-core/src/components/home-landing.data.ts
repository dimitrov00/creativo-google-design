import type { BarberId } from '@core/primitives';

/**
 * WHERE A PERSON LANDS with no link to follow — the discriminator
 * `homeDestination` of {@link HomeLanding} (`SessionAccessSystem.homeOf`;
 * owner rulings 2026-11-25, Q3–Q4 of the role-aware homes brief). Each is a
 * route the person's own token opens, so a landing is never `/forbidden`.
 * Apart from `AccessTarget`, which says where a REFUSED principal is sent.
 */
export const HomeDestination = {
  /** `/staff/schedule`: whoever works the book (`Roles.BOOK`). */
  Schedule: 'SCHEDULE',
  /** `/admin/programs`: a content manager who does not work the book (`Roles.CATALOG`). */
  Programs: 'PROGRAMS',
  /** `/account`: everyone else — a client. */
  Account: 'ACCOUNT',
} as const;
export type HomeDestination =
  (typeof HomeDestination)[keyof typeof HomeDestination];

/**
 * A landing: where, and — on the schedule — whose chair it opens on
 * (`homeBarberId`, the account's linked barber record; `null` for every
 * chair, and off the schedule).
 */
export type HomeLanding = {
  readonly homeDestination: HomeDestination;
  readonly homeBarberId: BarberId | null;
};
