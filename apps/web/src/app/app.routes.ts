import { Route } from '@angular/router';
import { STAFF_ROLES } from '@creativo/domain/accounts';
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
    // Public browse pages behind the landing page's careers/courses
    // teaser CTAs — no guard, same posture as `book`.
    path: 'careers',
    loadComponent: () =>
      import('@creativo/features/marketing/careers').then(
        (m) => m.MarketingCareers,
      ),
  },
  {
    path: 'courses',
    loadComponent: () =>
      import('@creativo/features/marketing/courses').then(
        (m) => m.MarketingCourses,
      ),
  },
  {
    path: 'events',
    loadComponent: () =>
      import('@creativo/features/marketing/events').then(
        (m) => m.MarketingEvents,
      ),
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
    path: 'account/profile',
    canActivate: [activeGuard],
    loadComponent: () =>
      import('@creativo/features/client/profile').then((m) => m.ClientProfile),
  },
  {
    // The REAL staff vocabulary, spread — not a literal 'staff' token. No
    // role named 'staff' exists and nothing ever minted one, so this guard
    // used to bounce every principal to /forbidden; the identity brand's
    // unvalidated Role string is what let it compile. The list is
    // `STAFF_ROLES` from domain/accounts, the same grouping
    // firestore.rules' `isStaff()` enforces — the guard and the rules must
    // never disagree about who counts.
    //
    // NAMED `staff/schedule`, not bare `staff`, ahead of the staff area
    // growing siblings (clients, money, insights — see
    // docs/design-research/staff-surfaces-proposal.md). `staff` becomes the
    // shell at that point and the day sheet needs its own segment anyway;
    // claiming it now costs two lines, and claiming it after the URL has
    // been bookmarked and pasted around costs a broken link.
    path: 'staff/schedule',
    canActivate: [activeGuard, rolesGuard(...STAFF_ROLES)],
    loadComponent: () =>
      import('@creativo/features/staff/dashboard').then(
        (m) => m.StaffDashboard,
      ),
  },
  {
    // The old address, kept working. Deliberately UNGUARDED: the redirect
    // is not an authorization decision, and the target's own guards still
    // run afterwards — a client following a stale `/staff` link lands on
    // /forbidden exactly as before, via one extra hop nobody sees.
    path: 'staff',
    pathMatch: 'full',
    redirectTo: 'staff/schedule',
  },
  {
    // `sysadmin` included — rules' `isAdmin()` is the pair, and a guard
    // that denies what the rules allow strands a legitimate principal on
    // /forbidden over a screen the data layer would happily serve.
    path: 'admin',
    canActivate: [activeGuard, rolesGuard('admin', 'sysadmin')],
    loadComponent: () =>
      import('@creativo/features/admin/impersonation').then(
        (m) => m.AdminImpersonation,
      ),
  },
  {
    // Matches `isCatalogManager()` in firestore.rules — content_manager's
    // own tier plus the admin pair the rules fold in.
    path: 'admin/programs',
    canActivate: [
      activeGuard,
      rolesGuard('content_manager', 'admin', 'sysadmin'),
    ],
    loadComponent: () =>
      import('@creativo/features/admin/programs').then((m) => m.AdminPrograms),
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: '' },
];
