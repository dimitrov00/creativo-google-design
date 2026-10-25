import type { Role } from './role.data';

/** Which guard a route mounts — the discriminator `routeGate` of {@link RouteGateRule}. */
export const RouteGate = {
  /** `/account`, `/staff`, `/admin`: an active principal only. */
  Active: 'ACTIVE',
  /** `/onboarding`: anyone signed in. */
  SignedIn: 'SIGNED_IN',
  /** `/`: an installed-PWA launch by an active principal skips the landing. */
  Home: 'HOME',
  /** `/staff`, `/admin` beside `ACTIVE`: any of the listed roles. */
  Roles: 'ROLES',
} as const;
export type RouteGate = (typeof RouteGate)[keyof typeof RouteGate];

/** The guard a route mounts, with what that guard reads (`SessionAccessSystem.decide`). */
export type RouteGateRule =
  | { readonly routeGate: typeof RouteGate.Active }
  | { readonly routeGate: typeof RouteGate.SignedIn }
  | { readonly routeGate: typeof RouteGate.Home; readonly standalone: boolean }
  | {
      readonly routeGate: typeof RouteGate.Roles;
      readonly roles: readonly Role[];
    };
