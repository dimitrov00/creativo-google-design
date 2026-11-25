import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Role, type Principal } from '@core/components';
import { BarberId, UserId } from '@core/primitives';
import { memoryAuthSessionPorts, principalFixture } from '@core/testing';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { homeGuard } from './home.guard';

const ACTIVE_PRINCIPAL: Principal = principalFixture.client();
const OWNER = UserId.of('owner');

function configureGuardTest(
  principal: Principal,
  linkedBarberId: BarberId | null = null,
): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({
          principals$: new BehaviorSubject<Principal>(principal),
        }),
      },
      {
        // The account document's answer: the chair the schedule opens on.
        provide: StaffAccessService,
        useValue: {
          whenSettled: async () => ({ storedRoles: [], permissions: null }),
          linkedBarberId: () => linkedBarberId,
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
 * Blueprint §1.4's `/` guard (goal 06.1's PWA-redirect acceptance line;
 * owner rulings 2026-11-25): an installed-PWA launch by an already-active
 * user skips the marketing landing straight to their home — a client's
 * account, the owner's schedule on their own chair, a content manager's
 * programs; every other combination lets the landing page render.
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
    configureGuardTest(principalFixture.anonymous());

    const result = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );

    expect(result).toBe(true);
  });

  it('lands a standalone-launch client on their account', async () => {
    setStandalone(true);
    configureGuardTest(ACTIVE_PRINCIPAL);

    const result = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );

    const router = TestBed.inject(Router);
    expect(result).toEqual(router.createUrlTree(['/account']));
  });

  it('lands a standalone-launch owner who cuts hair on the schedule, on their own chair', async () => {
    setStandalone(true);
    configureGuardTest(
      principalFixture.staff(OWNER, [Role.Barber, Role.Admin]),
      BarberId.of('ivan'),
    );

    const result = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );

    const router = TestBed.inject(Router);
    expect(result).toEqual(
      router.createUrlTree(['/staff/schedule'], {
        queryParams: { barber: 'ivan' },
      }),
    );
  });

  it('lands an owner with no chair on every chair, and a content manager on the programs', async () => {
    setStandalone(true);
    configureGuardTest(principalFixture.staff(OWNER, [Role.Admin]));
    const owner = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );
    expect(owner).toEqual(
      TestBed.inject(Router).createUrlTree(['/staff/schedule']),
    );
    TestBed.resetTestingModule();

    configureGuardTest(principalFixture.staff(OWNER, [Role.ContentManager]));
    const content = await TestBed.runInInjectionContext(() =>
      homeGuard({} as never, {} as never),
    );
    expect(content).toEqual(
      TestBed.inject(Router).createUrlTree(['/admin/programs']),
    );
  });
});
