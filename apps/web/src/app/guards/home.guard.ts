import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { firstValueFrom } from 'rxjs';
import { isStandalone } from '../shell/is-standalone';

/**
 * Blueprint §1.4's `/` guard: an installed-PWA launch by an already-active
 * user skips the marketing landing straight to `/account` (mirrors v2's
 * `routes/index.tsx` `isStandalone && settled === 'active'` check). A
 * one-shot read of the current `Principal` — no session-ready backoff,
 * this never blocks an anonymous visitor from seeing the landing page.
 */
export const homeGuard: CanActivateFn = async () => {
  if (!isStandalone()) return true;

  const authGateway = inject(AUTH_GATEWAY);
  const router = inject(Router);
  const principal = await firstValueFrom(authGateway.observePrincipal());
  return principal.kind === 'active'
    ? router.createUrlTree(['/account'])
    : true;
};
