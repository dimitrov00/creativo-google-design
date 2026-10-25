import { Router, type UrlTree } from '@angular/router';
import {
  type AccessDecision,
  AccessTarget,
  AccessVerdict,
} from '@core/components';

/** Where each refused principal is sent — the one route per `AccessTarget`. */
const TARGET_PATH = {
  [AccessTarget.Auth]: '/auth',
  [AccessTarget.Onboarding]: '/onboarding',
  [AccessTarget.Account]: '/account',
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
