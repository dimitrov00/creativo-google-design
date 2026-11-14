import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { type RouteCapability, RouteGate } from '@core/components';
import { SessionAccessSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { firstValueFrom } from 'rxjs';
import { routeFor } from './access';

/**
 * Capability gate for a staff route the owner's permissions decide (staff
 * permissions P8) — always paired with `activeGuard` on the same route, as
 * `rolesGuard` is, so it reads the settled `Principal` that guard resolved.
 *
 * It waits for what the decision reads — the stored account and the owner's
 * cells (`StaffAccessService.whenSettled`), as `rolesGuard` waits for a
 * settled session — and the route opens when the account's levels reach far
 * enough for any ONE of `routeCapabilities`. A refusal is `/forbidden`: the
 * person is signed in, the owner has not given them this screen. The
 * decision is `SessionAccessSystem.decide`'s (`CAPABILITY` gate); the
 * callable behind the screen judges the same account and cells again.
 */
export const capabilityGuard = (
  ...routeCapabilities: readonly RouteCapability[]
): CanActivateFn => {
  return async () => {
    const router = inject(Router);
    const session = inject(AUTH_SESSION_PORTS);
    const access = inject(StaffAccessService);
    const principal = await firstValueFrom(session.observePrincipal());
    const { storedRoles, permissions } = await access.whenSettled();
    return routeFor(
      router,
      SessionAccessSystem.decide(principal, {
        routeGate: RouteGate.Capability,
        routeCapabilities,
        storedRoles,
        permissions,
      }),
      null,
    );
  };
};
