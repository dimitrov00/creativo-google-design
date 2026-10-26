import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { type Principal, Role } from '@core/components';
import { UserId } from '@core/primitives';
import {
  immediateTimerPorts,
  memoryAuthSessionPorts,
  principalFixture,
} from '@core/testing';
import {
  AUTH_SESSION_PORTS,
  TIMER_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { appRoutes } from './app.routes';

const ADMIN = principalFixture.staff(UserId.of('admin-1'), [Role.Admin]);
const BARBER = principalFixture.staff(UserId.of('barber-1'), [Role.Barber]);

/** The REAL route table, the session settled on `principal`. */
function routerFor(principal: Principal): Router {
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
    ],
  });
  return TestBed.inject(Router);
}

/** Where `url` lands: the router's URL once the navigation and its redirects settle. */
async function landingOf(principal: Principal, url: string): Promise<string> {
  const router = routerFor(principal);
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
