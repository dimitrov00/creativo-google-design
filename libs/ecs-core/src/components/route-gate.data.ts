import { AccessScope, StaffCapability } from '@core/primitives';
import type { Role } from './role.data';
import type { StaffPermissions } from './staff-permissions.data';

/** Which guard a route mounts — the discriminator `routeGate` of {@link RouteGateRule}. */
export const RouteGate = {
  /** `/account`, `/staff`, `/admin`: an active principal only. */
  Active: 'ACTIVE',
  /** `/onboarding`: anyone signed in. */
  SignedIn: 'SIGNED_IN',
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

/**
 * WHAT OPENS EACH ROUTE THE OWNER'S PERMISSIONS DECIDE — one definition,
 * read by the route's gate and by every way in to it (the menu's row, the
 * schedule's chart button), so a way in can never show for a route that
 * would turn the person away.
 */
export const RouteCapabilities = {
  /**
   * «Анализи»: the figures at "own" or wider — a barber's own on the
   * standard, the shop's for the admin.
   */
  Analytics: [
    {
      staffCapability: StaffCapability.Analytics,
      accessScope: AccessScope.Own,
    },
  ],
  /**
   * «Екип»: whoever manages the team sees everyone; whoever edits every
   * barber's profile or prices reaches the records for it (`listTeam`
   * answers the records alone for them).
   */
  Team: [
    {
      staffCapability: StaffCapability.TeamManage,
      accessScope: AccessScope.All,
    },
    {
      staffCapability: StaffCapability.TeamProfiles,
      accessScope: AccessScope.All,
    },
    {
      staffCapability: StaffCapability.TeamOfferings,
      accessScope: AccessScope.All,
    },
  ],
  /**
   * «Моят профил» (`/staff/profile`): the member page on the person's own
   * barber record, for whoever may edit their own profile — a barber, by
   * default (staff permissions O1). The welcome and the setup card lead
   * here; every row still asks what the person may change.
   */
  OwnProfile: [
    {
      staffCapability: StaffCapability.TeamProfiles,
      accessScope: AccessScope.Own,
    },
  ],
} as const satisfies Record<string, readonly RouteCapability[]>;

/** The guard a route mounts, with what that guard reads (`SessionAccessSystem.decide`). */
export type RouteGateRule =
  | { readonly routeGate: typeof RouteGate.Active }
  | { readonly routeGate: typeof RouteGate.SignedIn }
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
