import {
  PrincipalKind,
  type PrincipalTag,
  isStaff,
  knownRoles,
} from '@creativo/ecs-core';
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
      return { kind: PrincipalKind.Anonymous };
    case 'onboarding':
      return { kind: PrincipalKind.Onboarding };
    default:
      return {
        kind: isStaff(knownRoles(principal.roles))
          ? PrincipalKind.Staff
          : PrincipalKind.Client,
      };
  }
}
