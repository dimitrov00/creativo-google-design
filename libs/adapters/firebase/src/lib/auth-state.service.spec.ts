import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { onIdTokenChangedMock } = vi.hoisted(() => ({
  onIdTokenChangedMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: onIdTokenChangedMock,
}));

import { AuthStateService } from './auth-state.service';
import { FIREBASE_AUTH } from './firebase-app.provider';

function makeUser(
  getIdTokenResult: (forceRefresh?: boolean) => Promise<{ claims: unknown }>,
) {
  return {
    uid: 'uid_1',
    getIdTokenResult,
  } as unknown as import('firebase/auth').User;
}

describe('AuthStateService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with no current user and no claims', () => {
    onIdTokenChangedMock.mockImplementation(() => () => undefined);
    const fakeAuth = { currentUser: null };
    TestBed.configureTestingModule({
      providers: [{ provide: FIREBASE_AUTH, useValue: fakeAuth }],
    });

    const service = TestBed.inject(AuthStateService);
    expect(service.currentUser()).toBeNull();
    expect(service.claims()).toBeNull();
    expect(service.isSignedIn()).toBe(false);
  });

  it('decodes valid custom claims off the ID token when a user signs in', async () => {
    let emit: ((user: import('firebase/auth').User | null) => void) | undefined;
    onIdTokenChangedMock.mockImplementation((_auth, callback) => {
      emit = callback;
      return () => undefined;
    });
    const fakeAuth = { currentUser: null };
    TestBed.configureTestingModule({
      providers: [{ provide: FIREBASE_AUTH, useValue: fakeAuth }],
    });
    const service = TestBed.inject(AuthStateService);

    const user = makeUser(async () => ({
      claims: { tenantId: 'creativo', role: 'client' },
    }));
    emit?.(user);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentUser()).toBe(user);
    expect(service.isSignedIn()).toBe(true);
    expect(service.claims()?.tenantId).toBe('creativo');
    expect(service.claims()?.role).toBe('client');
  });

  it('clears claims to null when claims fail schema validation (e.g. missing role)', async () => {
    let emit: ((user: import('firebase/auth').User | null) => void) | undefined;
    onIdTokenChangedMock.mockImplementation((_auth, callback) => {
      emit = callback;
      return () => undefined;
    });
    const fakeAuth = { currentUser: null };
    TestBed.configureTestingModule({
      providers: [{ provide: FIREBASE_AUTH, useValue: fakeAuth }],
    });
    const service = TestBed.inject(AuthStateService);

    const user = makeUser(async () => ({ claims: { tenantId: 'creativo' } }));
    emit?.(user);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.claims()).toBeNull();
  });

  it('refreshClaims() forces a token refresh via getIdTokenResult(true)', async () => {
    onIdTokenChangedMock.mockImplementation(() => () => undefined);
    const getIdTokenResult = vi.fn(async (forceRefresh?: boolean) => ({
      claims: forceRefresh
        ? { tenantId: 'creativo', role: 'owner' }
        : { tenantId: 'creativo', role: 'client' },
    }));
    const user = makeUser(getIdTokenResult);
    const fakeAuth = { currentUser: user };
    TestBed.configureTestingModule({
      providers: [{ provide: FIREBASE_AUTH, useValue: fakeAuth }],
    });
    const service = TestBed.inject(AuthStateService);

    await service.refreshClaims();

    expect(getIdTokenResult).toHaveBeenCalledWith(true);
    expect(service.claims()?.tenantId).toBe('creativo');
    expect(service.claims()?.role).toBe('owner');
  });

  it('refreshClaims() is a no-op when nobody is signed in', async () => {
    onIdTokenChangedMock.mockImplementation(() => () => undefined);
    const fakeAuth = { currentUser: null };
    TestBed.configureTestingModule({
      providers: [{ provide: FIREBASE_AUTH, useValue: fakeAuth }],
    });
    const service = TestBed.inject(AuthStateService);

    await expect(service.refreshClaims()).resolves.toBeUndefined();
    expect(service.claims()).toBeNull();
  });
});
