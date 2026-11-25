import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { type Role, RouteGate } from '@core/components';
import { SessionAccessSystem } from '@core/systems';
import { HomeLandingService } from '@creativo/features/client/account-state';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { firstValueFrom } from 'rxjs';
import { gateAnswer } from './access';

/**
 * Role gate for `/staff`/`/admin` (blueprint §1.4) — always paired with
 * `activeGuard` on the same route (roles only exist on an active
 * principal), so this doesn't re-run session-ready backoff itself, just
 * reads the settled `Principal` `activeGuard` already resolved.
 * Redirects to `/forbidden` rather than `/auth` — the user IS signed in,
 * they just lack the role, and `/goal`'s smoke test expects a rendered
 * Forbidden screen, not a bounce back through auth — except on a sign-in's
 * own navigation, whose refusal is the person's home (`gateAnswer`). The
 * decision is `SessionAccessSystem.decide`'s (`ROLES` gate, any of `roles`).
 */
export const rolesGuard = (...roles: readonly Role[]): CanActivateFn => {
  return async () => {
    const router = inject(Router);
    const session = inject(AUTH_SESSION_PORTS);
    const landing = inject(HomeLandingService);
    const principal = await firstValueFrom(session.observePrincipal());
    return gateAnswer(
      router,
      landing,
      SessionAccessSystem.decide(principal, {
        routeGate: RouteGate.Roles,
        roles,
      }),
      principal,
    );
  };
};
