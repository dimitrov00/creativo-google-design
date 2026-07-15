import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStateService } from '@creativo/adapters/firebase';
import { authGuard } from './auth.guard';

function configureWith(isSignedIn: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthStateService, useValue: { isSignedIn: () => isSignedIn } },
    ],
  });
}

describe('authGuard', () => {
  it('allows activation when signed in', () => {
    configureWith(true);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/bookings' } as never),
    );
    expect(result).toBe(true);
  });

  it('redirects to / when not signed in', () => {
    configureWith(false);
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/bookings' } as never),
    );
    expect(result).toEqual(router.createUrlTree(['/']));
  });
});
