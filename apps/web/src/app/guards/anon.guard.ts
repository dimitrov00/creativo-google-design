import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SessionAccessSystem } from '@core/systems';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { routeFor } from './access';
import { RouteGate } from '@core/components';

/**
 * Blueprint §1.4's `/onboarding` guard ("anonGate anon → /auth") — only
 * bars anonymous visitors; onboarding and active principals may both land
 * here (an already-active user revisiting onboarding is out of scope for
 * this guard — nothing in §1.4 asks it to bounce them elsewhere). The
 * decision is `SessionAccessSystem.decide`'s (`SIGNED_IN` gate).
 *
 * THE PRINCIPAL AS OBSERVED, never `ensureSessionReady` (2026-11-08). That
 * loop refreshes an `ONBOARDING` token on its whole back-off, about five
 * seconds, hoping the claims turn active. This gate lets an onboarding
 * principal and an active one through alike, so the wait could never change
 * its answer. It only held every new account on «Влизаме в профила ти…»
 * after the code was verified. That was half of the e2e suite's ten-second
 * budget for the step, which a cold verify callable then used up. The lag
 * the loop is for, right after `completeRegistration`, is the onboarding
 * store's to settle (`OnboardingFlowStore`); `activeGuard` still waits.
 */
export const anonGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const principal = await firstValueFrom(
    inject(AUTH_SESSION_PORTS).observePrincipal(),
  );
  return routeFor(
    router,
    SessionAccessSystem.decide(principal, { routeGate: RouteGate.SignedIn }),
    null,
  );
};
