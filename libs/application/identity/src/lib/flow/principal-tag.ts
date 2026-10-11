import { PrincipalKind, isStaff, knownRoles } from '@core/components';
import { type PrincipalTag } from '@core/systems';
import { Principal } from '@creativo/domain/identity';

/**
 * Phase 2 shim converter (ECS migration), shared by the two shims that hand
 * a legacy `Principal` to an ecs-core system (`guest-guard.ts`,
 * `ensure-session-ready.use-case.ts`). Internal to this lib — not exported
 * from its index — and deleted with the legacy `Principal` in Phase 4.
 *
 * The legacy `active` principal is the system's `staff` or `client` by its
 * roles (an unknown role string grants nothing).
 */
export function principalTagOf(principal: Principal): PrincipalTag {
  switch (principal.kind) {
    case 'anonymous':
      return { principalKind: PrincipalKind.Anonymous };
    case 'onboarding':
      return { principalKind: PrincipalKind.Onboarding };
    default:
      return {
        principalKind: isStaff(knownRoles(principal.roles))
          ? PrincipalKind.Staff
          : PrincipalKind.Client,
      };
  }
}
