import {
  type AccessDecision,
  AccessTarget,
  AccessVerdict,
  Principal,
  PrincipalKind,
  type RouteCapability,
  RouteGate,
  type RouteGateRule,
  SessionReadiness,
  type SessionReadinessState,
  type StaffPermissions,
} from '@core/components';
import { AccessScope } from '@core/primitives';
import type { PrincipalTag } from './guest-guard.system';
import { StaffAccessSystem } from './staff-access.system';

/**
 * SessionAccessSystem — who may enter which route, and when a session is
 * ready to be asked (blueprint §2.8). The pure halves of
 * `apps/web/src/app/guards/*` (`activeGuard`, `anonGuard`, `homeGuard`,
 * `rolesGuard`) and of `EnsureSessionReadyUseCase`'s refresh backoff (the
 * legacy identity application lib's `ensure-session-ready.use-case.ts`,
 * deleted in Phase 4b).
 *
 * The guards keep the router and the gateway; this decides. The backoff
 * keeps the timer and the token refresh; this says whether to wait, how
 * long, and when to stop.
 */

/**
 * The refresh schedule right after sign-in or registration — v2's
 * `routerAuth.ensureReady()` backoff verbatim: freshly minted claims can lag
 * a beat behind the ID token the client already holds.
 */
export const REFRESH_BACKOFF_MS: readonly number[] = [
  0, 200, 400, 700, 1200, 1600,
];

const ALLOW: AccessDecision = { accessVerdict: AccessVerdict.Allow };

function redirect(to: AccessTarget, keepReturnUrl: boolean): AccessDecision {
  return { accessVerdict: AccessVerdict.Redirect, to, keepReturnUrl };
}

export const SessionAccessSystem = {
  /**
   * The session-ready loop, one observation at a time. `refreshesDone` is
   * how many refreshes ran before this observation (`0` for the first).
   * The first observation settles on anything but `ONBOARDING`; after a
   * refresh only an active principal settles (a principal that went
   * anonymous mid-loop keeps refreshing, as the legacy loop did); once the
   * schedule is spent the loop stops with the principal as it stands.
   */
  readiness(
    principal: PrincipalTag,
    refreshesDone: number,
  ): SessionReadinessState {
    if (refreshesDone === 0) {
      if (principal.principalKind !== PrincipalKind.Onboarding) {
        return { sessionReadiness: SessionReadiness.Ready };
      }
    } else if (
      principal.principalKind === PrincipalKind.Client ||
      principal.principalKind === PrincipalKind.Staff
    ) {
      return { sessionReadiness: SessionReadiness.Ready };
    }
    if (refreshesDone >= REFRESH_BACKOFF_MS.length) {
      return { sessionReadiness: SessionReadiness.Exhausted };
    }
    return {
      sessionReadiness: SessionReadiness.Refresh,
      delayMs: REFRESH_BACKOFF_MS[refreshesDone] as number,
    };
  },

  /**
   * Whether a role set opens a route the owner's permissions decide: its
   * levels reach far enough for any ONE of the route's capabilities. What
   * the gate decides on, and what a way in to the route is shown by — so
   * the two cannot disagree.
   */
  opens(
    routeCapabilities: readonly RouteCapability[],
    permissions: StaffPermissions,
    storedRoles: readonly string[],
  ): boolean {
    for (let i = 0; i < routeCapabilities.length; i++) {
      const need = routeCapabilities[i] as RouteCapability;
      const scope = StaffAccessSystem.scopeOf(
        permissions,
        need.staffCapability,
        storedRoles,
      );
      if (
        scope === AccessScope.All ||
        (scope === AccessScope.Own && need.accessScope === AccessScope.Own)
      ) {
        return true;
      }
    }
    return false;
  },

  /** The route decision for a settled principal. */
  decide(principal: Principal, gate: RouteGateRule): AccessDecision {
    switch (gate.routeGate) {
      case RouteGate.Active:
        if (Principal.isActive(principal)) return ALLOW;
        return principal.principalKind === PrincipalKind.Onboarding
          ? redirect(AccessTarget.Onboarding, false)
          : redirect(AccessTarget.Auth, true);
      case RouteGate.SignedIn:
        return principal.principalKind === PrincipalKind.Anonymous
          ? redirect(AccessTarget.Auth, false)
          : ALLOW;
      case RouteGate.Home:
        return gate.standalone && Principal.isActive(principal)
          ? redirect(AccessTarget.Account, false)
          : ALLOW;
      case RouteGate.Roles:
        return Principal.hasAnyRole(principal, gate.roles)
          ? ALLOW
          : redirect(AccessTarget.Forbidden, false);
      default: {
        // The owner's permissions decide (staff permissions P8): the route
        // opens when the account's levels reach far enough for any one of
        // its capabilities. A principal that is not active holds nothing.
        return Principal.isActive(principal) &&
          SessionAccessSystem.opens(
            gate.routeCapabilities,
            gate.permissions,
            gate.storedRoles,
          )
          ? ALLOW
          : redirect(AccessTarget.Forbidden, false);
      }
    }
  },
} as const;
