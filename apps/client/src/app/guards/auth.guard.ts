import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '@creativo/adapters/firebase';

/**
 * Proves the RBAC wiring pattern exists — no login-page UI ships this pass
 * (the OTP entry form is a follow-up), so this only gates the route, it
 * doesn't offer a way to actually sign in yet.
 */
export const authGuard: CanActivateFn = () => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  if (authState.isSignedIn()) {
    return true;
  }
  return router.createUrlTree(['/']);
};
