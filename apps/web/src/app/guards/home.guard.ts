import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RouteGate, SessionAccessSystem } from '@core/systems';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { firstValueFrom } from 'rxjs';
import { isStandalone } from '../shell/is-standalone';
import { routeFor } from './access';

/**
 * Blueprint §1.4's `/` guard: an installed-PWA launch by an already-active
 * user skips the marketing landing straight to `/account` (mirrors v2's
 * `routes/index.tsx` `isStandalone && settled === 'active'` check). A
 * one-shot read of the current `Principal` — no session-ready backoff,
 * this never blocks an anonymous visitor from seeing the landing page.
 */
export const homeGuard: CanActivateFn = async () => {
  if (!isStandalone()) return true;

  const session = inject(AUTH_SESSION_PORTS);
  const router = inject(Router);
  const principal = await firstValueFrom(session.observePrincipal());
  return routeFor(
    router,
    SessionAccessSystem.decide(principal, {
      routeGate: RouteGate.Home,
      standalone: true,
    }),
    null,
  );
};
