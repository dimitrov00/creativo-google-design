import { Principal, PrincipalKind } from '../components/principal.data';
import type { Role } from '../components/role.data';
import type { PrincipalTag } from './guest-guard.system';

/**
 * SessionAccessSystem — who may enter which route, and when a session is
 * ready to be asked (blueprint §2.8). The pure halves of
 * `apps/web/src/app/guards/*` (`activeGuard`, `anonGuard`, `homeGuard`,
 * `rolesGuard`) and of `EnsureSessionReadyUseCase`'s refresh backoff
 * (`libs/application/identity/src/lib/use-cases/
 * ensure-session-ready.use-case.ts`).
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

/**
 * What the session-ready loop does next — the discriminator
 * `sessionReadiness` of {@link SessionReadinessState}.
 */
export const SessionReadiness = {
  /** Settled — answer the principal as it stands. */
  Ready: 'READY',
  /** Wait `delayMs`, refresh the token, observe the principal again. */
  Refresh: 'REFRESH',
  /** The schedule ran out — answer the principal as it stands (still onboarding). */
  Exhausted: 'EXHAUSTED',
} as const;
export type SessionReadiness =
  (typeof SessionReadiness)[keyof typeof SessionReadiness];

export type SessionReadinessState =
  | { readonly sessionReadiness: typeof SessionReadiness.Ready }
  | {
      readonly sessionReadiness: typeof SessionReadiness.Refresh;
      readonly delayMs: number;
    }
  | { readonly sessionReadiness: typeof SessionReadiness.Exhausted };

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

export type RouteGateRule =
  | { readonly routeGate: typeof RouteGate.Active }
  | { readonly routeGate: typeof RouteGate.SignedIn }
  | { readonly routeGate: typeof RouteGate.Home; readonly standalone: boolean }
  | {
      readonly routeGate: typeof RouteGate.Roles;
      readonly roles: readonly Role[];
    };

/** Where a refused principal is sent — the redirect's `to`. */
export const AccessTarget = {
  Auth: 'AUTH',
  Onboarding: 'ONBOARDING',
  Account: 'ACCOUNT',
  Forbidden: 'FORBIDDEN',
} as const;
export type AccessTarget = (typeof AccessTarget)[keyof typeof AccessTarget];

/** The guard's verdict — the discriminator `accessVerdict` of {@link AccessDecision}. */
export const AccessVerdict = {
  Allow: 'ALLOW',
  Redirect: 'REDIRECT',
} as const;
export type AccessVerdict = (typeof AccessVerdict)[keyof typeof AccessVerdict];

/**
 * The guard's answer. A redirect to `AUTH` from the active gate keeps the
 * attempted URL (`?redirect=`), so the person lands back where they aimed.
 */
export type AccessDecision =
  | { readonly accessVerdict: typeof AccessVerdict.Allow }
  | {
      readonly accessVerdict: typeof AccessVerdict.Redirect;
      readonly to: AccessTarget;
      readonly keepReturnUrl: boolean;
    };

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
      default:
        return Principal.hasAnyRole(principal, gate.roles)
          ? ALLOW
          : redirect(AccessTarget.Forbidden, false);
    }
  },
} as const;
