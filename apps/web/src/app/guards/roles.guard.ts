import { CanActivateFn } from '@angular/router';

// TODO(goal-05/goal-03): wire to Principal.isStaff / isAdmin once the
// identity domain + AuthGateway port land — this is a structural
// placeholder only (Phase 0: workspace alignment).
export const rolesGuard = (...roles: readonly string[]): CanActivateFn => {
  void roles;
  return () => true;
};
