import type { AccessScope, StaffCapability } from '@core/primitives';
import type { Role } from './role.data';
import type { StaffPermissions } from './staff-permissions.data';

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
  /**
   * A staff route beside `ACTIVE` that the owner's permissions decide
   * (staff permissions P8): `/staff/analytics` today.
   */
  Capability: 'CAPABILITY',
} as const;
export type RouteGate = (typeof RouteGate)[keyof typeof RouteGate];

/**
 * A capability a route is behind, and the least reach that opens it: `OWN`
 * for a screen that shows the person their own, `ALL` for one that shows
 * everyone's. Never `NONE` — a route nobody needs anything for mounts no
 * capability gate.
 */
export type RouteCapability = {
  readonly staffCapability: StaffCapability;
  readonly accessScope: typeof AccessScope.Own | typeof AccessScope.All;
};

/** The guard a route mounts, with what that guard reads (`SessionAccessSystem.decide`). */
export type RouteGateRule =
  | { readonly routeGate: typeof RouteGate.Active }
  | { readonly routeGate: typeof RouteGate.SignedIn }
  | { readonly routeGate: typeof RouteGate.Home; readonly standalone: boolean }
  | {
      readonly routeGate: typeof RouteGate.Roles;
      readonly roles: readonly Role[];
    }
  | {
      readonly routeGate: typeof RouteGate.Capability;
      /** What the route is behind; any ONE of them opens it. */
      readonly routeCapabilities: readonly RouteCapability[];
      /**
       * The account's roles as the server reads them: the STORED ones, and
       * the token's only until the account has loaded.
       */
      readonly storedRoles: readonly Role[];
      /** The owner's cells as read; cells nobody could read grant nothing. */
      readonly permissions: StaffPermissions;
    };
