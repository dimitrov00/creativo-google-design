import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { type Principal, Role, StaffPermissions } from '@core/components';
import type { User } from '@core/entities';
import { RepositoryError } from '@core/errors';
import type { StaffPermissionsStreamPorts } from '@core/ports';
import { AccessScope, Result, UserId } from '@core/primitives';
import {
  immediateTimerPorts,
  memoryAuthSessionPorts,
  memoryProfilePorts,
  memoryStaffPermissionsStreamPorts,
  principalFixture,
  registeredUserFixture,
} from '@core/testing';
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
describe('appRoutes — /admin (OR-24)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  test('an admin who opens /admin lands on the rhythm page', async () => {
    expect(await landingOf(ADMIN, '/admin')).toBe('/admin/loyalty/rhythm');
  });

  test('a signed-in non-admin gets the rhythm guard’s answer: /forbidden', async () => {
    expect(await landingOf(BARBER, '/admin')).toBe('/forbidden');
    expect(await landingOf(principalFixture.client(), '/admin')).toBe(
      '/forbidden',
    );
  });

  test('a signed-out visitor is sent to sign in, and back to the rhythm page after', async () => {
    expect(await landingOf(principalFixture.anonymous(), '/admin')).toBe(
      '/auth?redirect=%2Fadmin%2Floyalty%2Frhythm',
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
