import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { type Principal, Role, StaffPermissions } from '@core/components';
import type { User } from '@core/entities';
import { RepositoryError } from '@core/errors';
import type { StaffPermissionsStreamPorts } from '@core/ports';
import { AccessScope, BarberId, Result, UserId } from '@core/primitives';
import {
  immediateTimerPorts,
  memoryAuthSessionPorts,
  memoryProfilePorts,
  memoryStaffPermissionsStreamPorts,
  principalFixture,
  registeredUserFixture,
} from '@core/testing';
import { LANDING_NAVIGATION } from '@creativo/features/client/account-state';
import {
  AUTH_SESSION_PORTS,
  PROFILE_PORTS,
  STAFF_PERMISSIONS_PORTS,
  TIMER_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { of } from 'rxjs';
import { appRoutes } from './app.routes';

const ADMIN = principalFixture.staff(UserId.of('admin-1'), [Role.Admin]);
const BARBER = principalFixture.staff(UserId.of('barber-1'), [Role.Barber]);

/**
 * What the capability gate reads beside the session: the stored accounts
 * (none unless given, so the token's roles stand) and the owner's cells
 * (every default unless given).
 */
type Stored = {
  readonly accounts?: readonly User[];
  readonly permissions?: StaffPermissionsStreamPorts;
};

/** The REAL route table, the session settled on `principal`. */
function routerFor(principal: Principal, stored: Stored = {}): Router {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(appRoutes),
      {
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({
          principals$: new BehaviorSubject<Principal>(principal),
        }),
      },
      { provide: TIMER_PORTS, useValue: immediateTimerPorts() },
      {
        provide: PROFILE_PORTS,
        useValue: memoryProfilePorts(
          new Map((stored.accounts ?? []).map((user) => [user.id, user])),
        ),
      },
      {
        provide: STAFF_PERMISSIONS_PORTS,
        useValue: stored.permissions ?? memoryStaffPermissionsStreamPorts(),
      },
    ],
  });
  return TestBed.inject(Router);
}

/** Where `url` lands: the router's URL once the navigation and its redirects settle. */
async function landingOf(
  principal: Principal,
  url: string,
  stored: Stored = {},
): Promise<string> {
  const router = routerFor(principal, stored);
  await router.navigateByUrl(url);
  return router.url;
}

/*
 * `test` rather than `it`: apps/web lints with eslint-plugin-playwright,
 * whose `no-standalone-expect` only recognises `test()`.
 */
describe('appRoutes — where a person lands (owner rulings 2026-11-25)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const CONTENT = principalFixture.staff(UserId.of('content-1'), [
    Role.ContentManager,
  ]);

  test('/admin, a door with no page of its own, opens each person’s home', async () => {
    // The owner with no chair of their own: the schedule, every chair.
    expect(await landingOf(ADMIN, '/admin')).toBe('/staff/schedule');
    expect(await landingOf(BARBER, '/admin')).toBe('/staff/schedule');
    expect(await landingOf(CONTENT, '/admin')).toBe('/admin/programs');
    expect(await landingOf(principalFixture.client(), '/admin')).toBe(
      '/account',
    );
  });

  test('the schedule opens on the person’s own chair when their account links one', async () => {
    expect(
      await landingOf(ADMIN, '/admin', {
        accounts: [
          registeredUserFixture({
            id: UserId.of('admin-1'),
            roles: [Role.Admin, Role.Barber],
            linkedBarberId: BarberId.of('ivan'),
          }),
        ],
      }),
    ).toBe('/staff/schedule?barber=ivan');
  });

  test('a signed-out visitor is sent to sign in first, and back to the door after', async () => {
    expect(await landingOf(principalFixture.anonymous(), '/admin')).toBe(
      '/auth?redirect=%2Fadmin',
    );
  });

  test('a sign-in’s remembered link the person can no longer open lands them home, never /forbidden — any other refusal is still /forbidden', async () => {
    const remembered = async (
      principal: Principal,
      url: string,
    ): Promise<string> => {
      const router = routerFor(principal);
      await router.navigateByUrl(url, {
        state: { [LANDING_NAVIGATION]: true },
      });
      return router.url;
    };
    expect(await remembered(principalFixture.client(), '/staff/schedule')).toBe(
      '/account',
    );
    expect(await remembered(CONTENT, '/staff/schedule')).toBe(
      '/admin/programs',
    );
    expect(await remembered(BARBER, '/admin/team/permissions')).toBe(
      '/staff/schedule',
    );
    // Opened any other way, a refused page is still /forbidden.
    expect(await landingOf(principalFixture.client(), '/staff/schedule')).toBe(
      '/forbidden',
    );
  });
});

describe('appRoutes — /account/notifications (OR-19)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  test('a client opens the inbox', async () => {
    expect(
      await landingOf(principalFixture.client(), '/account/notifications'),
    ).toBe('/account/notifications');
  });

  test('is guarded like /account — a signed-out visitor signs in first', async () => {
    expect(
      await landingOf(principalFixture.anonymous(), '/account/notifications'),
    ).toBe('/auth?redirect=%2Faccount%2Fnotifications');
  });
});

/*
 * `/admin/team` and «Права» (team onboarding D8; staff permissions P10).
 * The Team page is behind the capabilities that open it; «Права» is the
 * owner's alone, as its save is.
 */
describe('appRoutes — the schedule, the programs and /support (2026-11-24)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const staff = (role: Role) =>
    principalFixture.staff(UserId.of(`staff-${role}`), [role]);

  /**
   * The schedule's guard is `Roles.BOOK`, the rules' `worksTheBook()`: a
   * content manager is staff, but the rules refuse them every appointment
   * read, so the day would open empty.
   */
  test('whoever works the book opens the schedule; a content manager and a client do not', async () => {
    for (const role of [
      Role.Barber,
      Role.Receptionist,
      Role.Admin,
      Role.Sysadmin,
    ]) {
      expect(await landingOf(staff(role), '/staff/schedule')).toBe(
        '/staff/schedule',
      );
    }
    expect(await landingOf(staff(Role.ContentManager), '/staff/schedule')).toBe(
      '/forbidden',
    );
    expect(await landingOf(principalFixture.client(), '/staff/schedule')).toBe(
      '/forbidden',
    );
  });

  /** `Roles.CATALOG`, the rules' `isCatalogManager()`. */
  test('a content manager and the admin pair open the programs; a barber and the front desk do not', async () => {
    for (const role of [Role.ContentManager, Role.Admin, Role.Sysadmin]) {
      expect(await landingOf(staff(role), '/admin/programs')).toBe(
        '/admin/programs',
      );
    }
    for (const role of [Role.Barber, Role.Receptionist]) {
      expect(await landingOf(staff(role), '/admin/programs')).toBe(
        '/forbidden',
      );
    }
  });

  /** `Roles.SUPPORT`: the vendor's sysadmin alone (owner ruling 2026-11-24). */
  test('the sysadmin opens support’s read-as page; the shop’s admin and everyone else do not', async () => {
    expect(await landingOf(staff(Role.Sysadmin), '/support')).toBe('/support');
    for (const role of [Role.Admin, Role.Barber, Role.Receptionist]) {
      expect(await landingOf(staff(role), '/support')).toBe('/forbidden');
    }
    expect(await landingOf(principalFixture.client(), '/support')).toBe(
      '/forbidden',
    );
  });
});

describe('appRoutes — /admin/team', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const staff = (role: Role) =>
    principalFixture.staff(UserId.of(`staff-${role}`), [role]);

  test('the owner and a content editor open the Team page; a barber and the front desk do not', async () => {
    expect(await landingOf(ADMIN, '/admin/team')).toBe('/admin/team');
    expect(await landingOf(staff(Role.ContentManager), '/admin/team')).toBe(
      '/admin/team',
    );
    for (const role of [Role.Barber, Role.Receptionist, Role.Sysadmin]) {
      expect(await landingOf(staff(role), '/admin/team')).toBe('/forbidden');
    }
    expect(await landingOf(principalFixture.client(), '/admin/team')).toBe(
      '/forbidden',
    );
  });

  test('the owner’s cells decide: the front desk let in to manage the team, a content editor cut from the profiles', async () => {
    expect(
      await landingOf(staff(Role.Receptionist), '/admin/team', {
        permissions: memoryStaffPermissionsStreamPorts(
          StaffPermissions.read({
            receptionistTeamManageScope: AccessScope.All,
          }),
        ),
      }),
    ).toBe('/admin/team');
    expect(
      await landingOf(staff(Role.ContentManager), '/admin/team', {
        permissions: memoryStaffPermissionsStreamPorts(
          StaffPermissions.read({
            contentManagerTeamProfilesScope: AccessScope.None,
          }),
        ),
      }),
    ).toBe('/forbidden');
  });

  test('«Права» and a level’s page open for the owner alone — not the sysadmin, not whoever manages the team', async () => {
    expect(await landingOf(ADMIN, '/admin/team/permissions')).toBe(
      '/admin/team/permissions',
    );
    expect(await landingOf(ADMIN, '/admin/team/permissions/barber')).toBe(
      '/admin/team/permissions/barber',
    );
    for (const role of [
      Role.Sysadmin,
      Role.ContentManager,
      Role.Receptionist,
    ]) {
      expect(await landingOf(staff(role), '/admin/team/permissions')).toBe(
        '/forbidden',
      );
      expect(
        await landingOf(staff(role), '/admin/team/permissions/receptionist'),
      ).toBe('/forbidden');
    }
  });

  test('a signed-out visitor is sent to sign in, and back here after', async () => {
    expect(
      await landingOf(principalFixture.anonymous(), '/admin/team/permissions'),
    ).toBe('/auth?redirect=%2Fadmin%2Fteam%2Fpermissions');
  });
});

/*
 * `/staff/analytics` (docs/designs/staff-analytics.md, The screen): behind
 * the `ANALYTICS` capability (staff permissions P8). On the standard a
 * barber and the admin open it and nobody else; the owner's cells and the
 * STORED roles move that, as they do for the callable.
 */
describe('appRoutes — /staff/analytics', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const cells = (stored: Record<string, unknown>): Stored => ({
    permissions: memoryStaffPermissionsStreamPorts(
      StaffPermissions.read(stored),
    ),
  });
  const DESK = principalFixture.staff(UserId.of('desk-1'), [Role.Receptionist]);

  test('the owner’s cells decide: a narrowed barber is turned away, a front desk given analytics opens it', async () => {
    expect(
      await landingOf(
        BARBER,
        '/staff/analytics',
        cells({ barberAnalyticsScope: AccessScope.None }),
      ),
    ).toBe('/forbidden');
    expect(
      await landingOf(
        DESK,
        '/staff/analytics/takings',
        cells({ receptionistAnalyticsScope: AccessScope.All }),
      ),
    ).toBe('/staff/analytics/takings');
    // The owner is never turned away, whatever is stored.
    expect(
      await landingOf(
        ADMIN,
        '/staff/analytics',
        cells({ barberAnalyticsScope: AccessScope.None }),
      ),
    ).toBe('/staff/analytics');
  });

  test('the STORED roles decide, not the token’s', async () => {
    // The token still says barber; the owner has since made the account front desk.
    expect(
      await landingOf(BARBER, '/staff/analytics', {
        accounts: [
          registeredUserFixture({
            id: UserId.of('barber-1'),
            roles: [Role.Receptionist],
          }),
        ],
      }),
    ).toBe('/forbidden');
    // The token says front desk; the stored account is a barber's too.
    expect(
      await landingOf(DESK, '/staff/analytics', {
        accounts: [
          registeredUserFixture({
            id: UserId.of('desk-1'),
            roles: [Role.Receptionist, Role.Barber],
          }),
        ],
      }),
    ).toBe('/staff/analytics');
  });

  test('cells that cannot be read open it for the admin alone', async () => {
    const refused: Stored = {
      permissions: {
        observeStaffPermissions: () =>
          of(
            Result.err(
              RepositoryError.readFailed(
                'settings/staffPermissions',
                'unavailable',
              ),
            ),
          ),
      },
    };
    expect(await landingOf(BARBER, '/staff/analytics', refused)).toBe(
      '/forbidden',
    );
    expect(await landingOf(ADMIN, '/staff/analytics', refused)).toBe(
      '/staff/analytics',
    );
  });

  test('a barber and the admin open it', async () => {
    expect(await landingOf(BARBER, '/staff/analytics')).toBe(
      '/staff/analytics',
    );
    expect(await landingOf(ADMIN, '/staff/analytics')).toBe('/staff/analytics');
  });

  test('a receptionist, the sysadmin and a client get /forbidden', async () => {
    for (const roles of [[Role.Receptionist], [Role.Sysadmin]]) {
      expect(
        await landingOf(
          principalFixture.staff(UserId.of('staff-1'), roles),
          '/staff/analytics',
        ),
      ).toBe('/forbidden');
    }
    expect(await landingOf(principalFixture.client(), '/staff/analytics')).toBe(
      '/forbidden',
    );
  });

  test('a signed-out visitor is sent to sign in, and back here after', async () => {
    expect(
      await landingOf(principalFixture.anonymous(), '/staff/analytics'),
    ).toBe('/auth?redirect=%2Fstaff%2Fanalytics');
  });
});
