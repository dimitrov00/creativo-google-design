import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ensureSessionReady } from './session';

/**
 * Requires an `active` principal — blueprint §1.4's `/account`, `/staff`,
 * `/admin` guard. `anonymous` bounces to `/auth` (with `?redirect=` back to
 * the attempted URL); `onboarding` bounces to `/onboarding` (an onboarding
 * account isn't done yet, but shouldn't be sent through `/auth` again).
 */
export const activeGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const principal = await ensureSessionReady();

  switch (principal.kind) {
    case 'active':
      return true;
    case 'onboarding':
      return router.createUrlTree(['/onboarding']);
    case 'anonymous':
      return router.createUrlTree(['/auth'], {
        queryParams: { redirect: state.url },
      });
  }
};
