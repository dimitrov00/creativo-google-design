import { Route } from '@angular/router';
import { activeGuard } from './guards/active.guard';
import { anonGuard } from './guards/anon.guard';
import { homeGuard } from './guards/home.guard';
import { rolesGuard } from './guards/roles.guard';

// Route tree per blueprint §1.4 — 1:1 with v2. Feature libs are still
// placeholder screens (Phase 6 lands real UI); this phase only wires the
// guard/redirect shape v2 has today.
export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [homeGuard],
    loadComponent: () =>
      import('@creativo/features/marketing/landing').then((m) => m.HomePage),
  },
  {
    // No route guard — v2 deliberately lets the user become authed
    // mid-flow via in-component latch logic (blueprint §1.4/§7.5).
    path: 'auth',
    loadComponent: () =>
      import('@creativo/features/client/auth').then((m) => m.ClientAuth),
  },
  {
    path: 'onboarding',
    canActivate: [anonGuard],
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
    path: 'account/appointments',
    canActivate: [activeGuard],
    loadComponent: () =>
      import('@creativo/features/client/appointments').then(
        (m) => m.ClientAppointments,
      ),
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
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: '' },
];
