import { Route } from '@angular/router';
import { activeGuard } from './guards/active.guard';
import { rolesGuard } from './guards/roles.guard';

// Placeholder route tree mirroring v2 (blueprint §1.4). Feature libs are
// still empty skeletons at this phase (Phase 0: workspace alignment) —
// real screens land with their respective feature-slice passes.
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('@creativo/features/marketing/landing').then((m) => m.HomePage),
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('@creativo/features/client/auth').then((m) => m.ClientAuth),
  },
  {
    path: 'onboarding',
    canActivate: [activeGuard],
    loadComponent: () =>
      import('@creativo/features/client/onboarding').then(
        (m) => m.ClientOnboarding,
      ),
  },
  {
    path: 'book',
    loadComponent: () =>
      import('@creativo/features/client/booking').then((m) => m.ClientBooking),
  },
  {
    path: 'account',
    canActivate: [activeGuard],
    loadComponent: () =>
      import('@creativo/features/client/account').then((m) => m.ClientAccount),
  },
  {
    path: 'staff',
    canActivate: [activeGuard, rolesGuard('staff')],
    loadComponent: () =>
      import('@creativo/features/staff/dashboard').then(
        (m) => m.StaffDashboard,
      ),
  },
  {
    path: 'admin',
    canActivate: [activeGuard, rolesGuard('admin')],
    loadComponent: () =>
      import('@creativo/features/admin/impersonation').then(
        (m) => m.AdminImpersonation,
      ),
  },
];
