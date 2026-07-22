import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  ANONYMOUS_PRINCIPAL,
  PrincipalId,
  Principal,
  roleFromPrimitive,
} from '@creativo/domain/identity';
import { homeGuard } from './home.guard';

const ACTIVE_PRINCIPAL: Principal = {
  kind: 'active',
  uid: PrincipalId.generate(),
  roles: [roleFromPrimitive('client')],
};

function configureGuardTest(principal: Principal): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () => of(principal),
          refreshToken: () => Promise.resolve({ ok: true, value: undefined }),
          signOut: () => Promise.resolve({ ok: true, value: undefined }),
        },
      },
    ],
  });
}

function setStandalone(standalone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/**
 * Blueprint §1.4's `/` guard (goal 06.1's PWA-redirect acceptance line):
 * an installed-PWA launch by an already-active user skips the marketing
 * landing straight to `/account`; every other combination lets the
 * landing page render.
 */
describe('homeGuard', () => {
  afterEach(() => {
    setStandalone(false);
  });

  it('allows a non-standalone visitor through regardless of principal', async () => {
    setStandalone(false);
    configureGuardTest(ACTIVE_PRINCIPAL);

    const result = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );

    expect(result).toBe(true);
  });

  it('allows a standalone-launch anonymous visitor through', async () => {
    setStandalone(true);
    configureGuardTest(ANONYMOUS_PRINCIPAL);

    const result = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );

    expect(result).toBe(true);
  });

  it('redirects a standalone-launch active visitor to /account', async () => {
    setStandalone(true);
    configureGuardTest(ACTIVE_PRINCIPAL);

    const result = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );

    const router = TestBed.inject(Router);
    expect(result).toEqual(router.createUrlTree(['/account']));
  });
});
