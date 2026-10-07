import { CanDeactivateFn, Route } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { STAFF_ROLES } from '@creativo/domain/accounts';
import type { AdminRhythmLeaving } from '@creativo/features/admin/loyalty';
import { activeGuard } from './guards/active.guard';
import { anonGuard } from './guards/anon.guard';
import { homeGuard } from './guards/home.guard';
import { rolesGuard } from './guards/roles.guard';

/**
 * `/admin/loyalty/rhythm`'s leave guard — the app's first `canDeactivate`
 * (client-card revision 3 §2.6, §3.17). The DECISION is the feature lib's
 * own `adminRhythmCanDeactivate` (it asks the page, which holds the draft);
 * this only reaches it through the SAME dynamic import as the page.
 *
 * Not a static import: this file names a feature lib only inside a
 * `loadComponent`, because a static import of a feature barrel pulls that
 * feature into the initial chunk — the `initial` budget in project.json
 * fails a build past 1 MB, and the chunk is ~955 kB. By the time a leave is
 * decided the route was activated, so the module is loaded and the import
 * resolves at once; a leave from a route whose page never came to be is
 * answered `true` by the lib's guard (its `null` arm).
 */
const adminRhythmLeaveGuard: CanDeactivateFn<
  AdminRhythmLeaving | null
> = async (component, currentRoute, currentState, nextState) => {
  const { adminRhythmCanDeactivate } =
    await import('@creativo/features/admin/loyalty');
  const answer = adminRhythmCanDeactivate(
    component,
    currentRoute,
    currentState,
    nextState,
  );
  return isObservable(answer) ? firstValueFrom(answer) : answer;
};

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
    // The loyalty rules' home; its one page today is the rhythm's. The
    // redirect is deliberately UNGUARDED, like `staff`'s: it is not an
    // authorization decision, and the target's own guards still run.
    path: 'admin/loyalty',
    pathMatch: 'full',
    redirectTo: 'admin/loyalty/rhythm',
  },
  {
    // «Ритъм» — the rhythm rule the admin manages (client-card revision 3
    // §2.6). The pair `isAdmin()` names in firestore.rules, as on `admin`
    // above; and the app's first `canDeactivate`: leaving with an unsaved
    // draft asks first, whichever way the admin leaves.
    path: 'admin/loyalty/rhythm',
    canActivate: [activeGuard, rolesGuard('admin', 'sysadmin')],
    canDeactivate: [adminRhythmLeaveGuard],
    loadComponent: () =>
      import('@creativo/features/admin/loyalty').then((m) => m.AdminRhythm),
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: '' },
];
