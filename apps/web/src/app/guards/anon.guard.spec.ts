import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import type { Principal } from '@core/components';
import { Result } from '@core/primitives';
import { memoryAuthSessionPorts, principalFixture } from '@core/testing';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { anonGuard } from './anon.guard';

/** The guard over a scripted session that counts its token refreshes. */
function configureGuardTest(principal: Principal): { refreshes: () => number } {
  let refreshes = 0;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({
          principals$: new BehaviorSubject<Principal>(principal),
          refresh: () => {
            refreshes++;
            return Result.ok(undefined);
          },
        }),
      },
    ],
  });
  return { refreshes: () => refreshes };
}

function runGuard(): Promise<unknown> {
  return TestBed.runInInjectionContext(
    () => anonGuard({} as never, {} as never) as Promise<unknown>,
  );
}

/**
 * Blueprint §1.4's `/onboarding` guard: only an anonymous visitor is sent
 * to `/auth`. It judges the principal as observed: the refresh back-off
 * could never change a `SIGNED_IN` verdict, and it held every new account
 * for about five seconds after its code was verified (2026-11-08).
 */
describe('anonGuard', () => {
  test('lets a new account (onboarding) in at once, without refreshing its token', async () => {
    const session = configureGuardTest(principalFixture.onboarding());

    expect(await runGuard()).toBe(true);
    expect(session.refreshes()).toBe(0);
  });

  test('lets an active account in', async () => {
    const session = configureGuardTest(principalFixture.client());

    expect(await runGuard()).toBe(true);
    expect(session.refreshes()).toBe(0);
  });

  test('sends an anonymous visitor to /auth', async () => {
    configureGuardTest(principalFixture.anonymous());

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/auth',
    );
  });
});
