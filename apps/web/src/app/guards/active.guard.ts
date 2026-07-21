import { CanActivateFn } from '@angular/router';

// TODO(goal-05/goal-03): wire to the real EnsureSessionReady application
// service (AuthGateway port) once identity use-cases land — this is a
// structural placeholder only (Phase 0: workspace alignment).
export const activeGuard: CanActivateFn = () => true;
