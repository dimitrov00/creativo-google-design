import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RouteGate, SessionAccessSystem } from '@core/systems';
import { routeFor } from './access';
import { ensureSessionReady } from './session';

/**
 * Blueprint §1.4's `/onboarding` guard ("anonGate anon → /auth") — only
 * bars anonymous visitors; onboarding and active principals may both land
 * here (an already-active user revisiting onboarding is out of scope for
 * this guard — nothing in §1.4 asks it to bounce them elsewhere). The
 * decision is `SessionAccessSystem.decide`'s (`SIGNED_IN` gate).
 */
export const anonGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const principal = await ensureSessionReady();
  return routeFor(
    router,
    SessionAccessSystem.decide(principal, { routeGate: RouteGate.SignedIn }),
    null,
  );
};
