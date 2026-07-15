import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, UrlTree } from '@angular/router';
import { AuthStateService } from '@creativo/adapters/firebase';
import { authGuard } from './auth.guard';

function setup(isSignedIn: boolean, role: string | null) {
  const fakeAuthState = {
    isSignedIn: signal(isSignedIn),
    claims: signal(role ? { tenantId: 'creativo', role } : null),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthStateService, useValue: fakeAuthState },
    ],
  });
}

function runGuard(): boolean | UrlTree {
  return TestBed.runInInjectionContext(() =>
    authGuard(null as never, null as never),
  ) as boolean | UrlTree;
}

describe('authGuard', () => {
  it('redirects to / when signed out', () => {
    setup(false, null);
    const result = runGuard();
    expect(result).not.toBe(true);
    expect(result).toBeInstanceOf(UrlTree);
  });

  it('redirects to / when signed in as a client', () => {
    setup(true, 'client');
    const result = runGuard();
    expect(result).not.toBe(true);
    expect(result).toBeInstanceOf(UrlTree);
  });

  it('allows access when signed in as owner', () => {
    setup(true, 'owner');
    expect(runGuard()).toBe(true);
  });

  it('allows access when signed in as performer', () => {
    setup(true, 'performer');
    expect(runGuard()).toBe(true);
  });
});
