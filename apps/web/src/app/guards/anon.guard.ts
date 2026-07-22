import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ensureSessionReady } from './session';

/**
 * Blueprint §1.4's `/onboarding` guard ("anonGate anon → /auth") — only
 * bars anonymous visitors; `onboarding` and `active` principals may both
 * land here (an already-active user revisiting onboarding is out of scope
 * for this guard — nothing in §1.4 asks it to bounce them elsewhere).
 */
export const anonGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const principal = await ensureSessionReady();
  return principal.kind === 'anonymous'
    ? router.createUrlTree(['/auth'])
    : true;
};
