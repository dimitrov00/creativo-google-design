import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RouteGate, SessionAccessSystem } from '@core/systems';
import { routeFor } from './access';
import { ensureSessionReady } from './session';

/**
 * Requires an active principal — blueprint §1.4's `/account`, `/staff`,
 * `/admin` guard. Anonymous bounces to `/auth` (with `?redirect=` back to
 * the attempted URL); onboarding bounces to `/onboarding` (an onboarding
 * account isn't done yet, but shouldn't be sent through `/auth` again).
 * The decision is `SessionAccessSystem.decide`'s.
 */
export const activeGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const principal = await ensureSessionReady();
  return routeFor(
    router,
    SessionAccessSystem.decide(principal, { routeGate: RouteGate.Active }),
    state.url,
  );
};
