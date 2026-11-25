import { Router, type UrlTree } from '@angular/router';
import {
  type AccessDecision,
  AccessTarget,
  AccessVerdict,
  type Principal,
} from '@core/components';
import type { HomeLandingService } from '@creativo/features/client/account-state';

/** Where each refused principal is sent — the one route per `AccessTarget`. */
const TARGET_PATH = {
  [AccessTarget.Auth]: '/auth',
  [AccessTarget.Onboarding]: '/onboarding',
  [AccessTarget.Forbidden]: '/forbidden',
} as const satisfies Record<AccessTarget, string>;

/**
 * A guard's answer from `SessionAccessSystem.decide`'s verdict — `true` to
 * let the route activate, else the redirect it names (`?redirect=` back to
 * the attempted URL when the decision keeps it).
 */
export function routeFor(
  router: Router,
  decision: AccessDecision,
  attemptedUrl: string | null,
): true | UrlTree {
  if (decision.accessVerdict === AccessVerdict.Allow) return true;
  const path = TARGET_PATH[decision.to];
  return decision.keepReturnUrl && attemptedUrl !== null
    ? router.createUrlTree([path], { queryParams: { redirect: attemptedUrl } })
    : router.createUrlTree([path]);
}

/**
 * A role or capability gate's answer (owner ruling 2026-11-25, Q3 of the
 * role-aware homes brief): a refusal of a sign-in's own navigation — a link
 * the person remembered and can no longer open — lands them on their home,
 * never `/forbidden`. Every other answer is {@link routeFor}'s. The home is
 * a route the person's roles open (`SessionAccessSystem.homeOf`), so it can
 * never be refused in turn.
 */
export async function gateAnswer(
  router: Router,
  landing: HomeLandingService,
  decision: AccessDecision,
  principal: Principal,
): Promise<true | UrlTree> {
  if (
    decision.accessVerdict === AccessVerdict.Redirect &&
    decision.to === AccessTarget.Forbidden &&
    landing.isLanding()
  ) {
    return landing.homeUrl(principal);
  }
  return routeFor(router, decision, null);
}
