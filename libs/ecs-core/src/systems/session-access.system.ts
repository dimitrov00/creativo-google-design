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

/** What the session-ready loop does next. */
export const SessionReadinessKind = {
  /** Settled — answer the principal as it stands. */
  Ready: 'ready',
  /** Wait `delayMs`, refresh the token, observe the principal again. */
  Refresh: 'refresh',
  /** The schedule ran out — answer the principal as it stands (still onboarding). */
  Exhausted: 'exhausted',
} as const;
export type SessionReadinessKind =
  (typeof SessionReadinessKind)[keyof typeof SessionReadinessKind];

export type SessionReadiness =
  | { readonly kind: typeof SessionReadinessKind.Ready }
  | {
      readonly kind: typeof SessionReadinessKind.Refresh;
      readonly delayMs: number;
    }
  | { readonly kind: typeof SessionReadinessKind.Exhausted };

/** Which guard a route mounts. */
export const RouteGateKind = {
  /** `/account`, `/staff`, `/admin`: an active principal only. */
  Active: 'active',
  /** `/onboarding`: anyone signed in. */
  SignedIn: 'signed_in',
  /** `/`: an installed-PWA launch by an active principal skips the landing. */
  Home: 'home',
  /** `/staff`, `/admin` beside `active`: any of the listed roles. */
  Roles: 'roles',
} as const;
export type RouteGateKind = (typeof RouteGateKind)[keyof typeof RouteGateKind];

export type RouteGate =
  | { readonly kind: typeof RouteGateKind.Active }
  | { readonly kind: typeof RouteGateKind.SignedIn }
  | { readonly kind: typeof RouteGateKind.Home; readonly standalone: boolean }
  | {
      readonly kind: typeof RouteGateKind.Roles;
      readonly roles: readonly Role[];
    };

/** Where a refused principal is sent. */
export const AccessTarget = {
  Auth: 'auth',
  Onboarding: 'onboarding',
  Account: 'account',
  Forbidden: 'forbidden',
} as const;
export type AccessTarget = (typeof AccessTarget)[keyof typeof AccessTarget];

export const AccessVerdict = {
  Allow: 'allow',
  Redirect: 'redirect',
} as const;
export type AccessVerdict = (typeof AccessVerdict)[keyof typeof AccessVerdict];

/**
 * The guard's answer. A redirect to `auth` from the active gate keeps the
 * attempted URL (`?redirect=`), so the person lands back where they aimed.
 */
export type AccessDecision =
  | { readonly kind: typeof AccessVerdict.Allow }
  | {
      readonly kind: typeof AccessVerdict.Redirect;
      readonly to: AccessTarget;
      readonly keepReturnUrl: boolean;
    };

const ALLOW: AccessDecision = { kind: AccessVerdict.Allow };

function redirect(to: AccessTarget, keepReturnUrl: boolean): AccessDecision {
  return { kind: AccessVerdict.Redirect, to, keepReturnUrl };
}

export const SessionAccessSystem = {
  /**
   * The session-ready loop, one observation at a time. `refreshesDone` is
   * how many refreshes ran before this observation (`0` for the first).
   * The first observation settles on anything but `onboarding`; after a
   * refresh only an active principal settles (a principal that went
   * anonymous mid-loop keeps refreshing, as the legacy loop did); once the
   * schedule is spent the loop stops with the principal as it stands.
   */
  readiness(principal: PrincipalTag, refreshesDone: number): SessionReadiness {
    if (refreshesDone === 0) {
      if (principal.kind !== PrincipalKind.Onboarding) {
        return { kind: SessionReadinessKind.Ready };
      }
    } else if (
      principal.kind === PrincipalKind.Client ||
      principal.kind === PrincipalKind.Staff
    ) {
      return { kind: SessionReadinessKind.Ready };
    }
    if (refreshesDone >= REFRESH_BACKOFF_MS.length) {
      return { kind: SessionReadinessKind.Exhausted };
    }
    return {
      kind: SessionReadinessKind.Refresh,
      delayMs: REFRESH_BACKOFF_MS[refreshesDone] as number,
    };
  },

  /** The route decision for a settled principal. */
  decide(principal: Principal, gate: RouteGate): AccessDecision {
    switch (gate.kind) {
      case RouteGateKind.Active:
        if (Principal.isActive(principal)) return ALLOW;
        return principal.kind === PrincipalKind.Onboarding
          ? redirect(AccessTarget.Onboarding, false)
          : redirect(AccessTarget.Auth, true);
      case RouteGateKind.SignedIn:
        return principal.kind === PrincipalKind.Anonymous
          ? redirect(AccessTarget.Auth, false)
          : ALLOW;
      case RouteGateKind.Home:
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
