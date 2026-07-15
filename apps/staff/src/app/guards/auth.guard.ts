import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '@creativo/adapters/firebase';

/**
 * Gates staff-only routes. Owner and performer share this one app/scope
 * (see docs/architecture/module-boundaries.md's Amendments section) — the
 * distinction between them is purely in-app RBAC via claims, not a
 * separate Nx scope/deployable, so this guard checks both roles.
 */
export const authGuard: CanActivateFn = () => {
  const authState = inject(AuthStateService);
  const router = inject(Router);

  const role = authState.claims()?.role;
  if (authState.isSignedIn() && (role === 'owner' || role === 'performer')) {
    return true;
  }

  return router.createUrlTree(['/']);
};
