import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { principalHasRole, roleFromPrimitive } from '@creativo/domain/identity';
import { firstValueFrom } from 'rxjs';

/**
 * Role gate for `/staff`/`/admin` (blueprint §1.4) — always paired with
 * `activeGuard` on the same route (roles only exist on an `active`
 * principal), so this doesn't re-run session-ready backoff itself, just
 * reads the settled `Principal` `activeGuard` already resolved.
 * Redirects to `/forbidden` rather than `/auth` — the user IS signed in,
 * they just lack the role, and `/goal`'s smoke test expects a rendered
 * Forbidden screen, not a bounce back through auth.
 */
export const rolesGuard = (...roles: readonly string[]): CanActivateFn => {
  const required = roles.map(roleFromPrimitive);
  return async () => {
    const router = inject(Router);
    const authGateway = inject(AUTH_GATEWAY);
    const principal = await firstValueFrom(authGateway.observePrincipal());
    const allowed = required.some((role) => principalHasRole(principal, role));
    return allowed ? true : router.createUrlTree(['/forbidden']);
  };
};
