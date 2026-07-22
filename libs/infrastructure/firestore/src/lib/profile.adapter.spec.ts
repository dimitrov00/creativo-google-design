import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { AccountStatus, User, UserId } from '@creativo/domain/accounts';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { FirestoreProfileAdapter } from './profile.adapter';

function createAdapter(): FirestoreProfileAdapter {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} as Firestore },
      FirestoreProfileAdapter,
    ],
  });
  return TestBed.inject(FirestoreProfileAdapter);
}

vi.mock('firebase/firestore', async () => {
  const actual =
    await vi.importActual<typeof import('firebase/firestore')>(
      'firebase/firestore',
    );
  return {
    ...actual,
    doc: vi.fn(() => ({ id: 'user-1' })),
    collection: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
  };
});

function today(): ZonedDateTime {
  const result = ZonedDateTime.now('Europe/Sofia');
  if (result.isFailure()) throw new Error('bad fixture zone');
  return result.value;
}

function requireUserId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture id');
  return result.value;
}

function buildUser(): User {
  const created = User.create(
    {
      id: 'user-1',
      phone: '+359888123456',
      firstName: 'Ivan',
      lastName: 'Petrov',
      roles: ['client'],
      status: AccountStatus.active(),
    },
    today(),
  );
  if (created.isFailure()) {
    throw new Error(
      `fixture construction failed: ${JSON.stringify(created.error)}`,
    );
  }
  return created.value;
}

describe('FirestoreProfileAdapter', () => {
  it('saveProfile writes the persistence shape including search fields', async () => {
    const { setDoc } = await import('firebase/firestore');
    const adapter = createAdapter();
    const user = buildUser();

    const result = await adapter.saveProfile(user);

    expect(result.isSuccess()).toBe(true);
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(setDoc).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(payload['phone']).toBe('+359888123456');
    expect(payload['roles']).toEqual(['client']);
    expect(payload['searchName']).toBe('ivan petrov');
    expect(payload['searchPrefixes']).toEqual(
      expect.arrayContaining(['i', 'iv', 'ivan', 'p', 'pe', 'petrov']),
    );
  });

  it('getProfile returns null when the doc does not exist', async () => {
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
      id: 'user-1',
      data: () => undefined,
    } as never);
    const adapter = createAdapter();

    const result = await adapter.getProfile(requireUserId('user-1'));

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('getProfile reconstitutes a User from a stored document', async () => {
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      id: 'user-1',
      data: () => ({
        phone: '+359888123456',
        firstName: 'Ivan',
        lastName: 'Petrov',
        roles: ['client'],
        status: { kind: 'active' },
        email: null,
        birthDate: null,
        searchName: 'ivan petrov',
        searchPrefixes: ['i', 'iv', 'ivan'],
      }),
    } as never);
    const adapter = createAdapter();
    const idResult = UserId.create('user-1');
    if (idResult.isFailure()) throw new Error('bad fixture');

    const result = await adapter.getProfile(idResult.value);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value) {
      expect(result.value.fullName()).toBe('Ivan Petrov');
      expect(result.value.status.kind).toBe('active');
    }
  });

  it('surfaces a malformed document as a failed Result', async () => {
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      id: 'user-1',
      data: () => ({
        phone: 'not-a-phone',
        firstName: 'Ivan',
        lastName: 'Petrov',
        roles: ['client'],
        status: { kind: 'active' },
      }),
    } as never);
    const adapter = createAdapter();
    const idResult = UserId.create('user-1');
    if (idResult.isFailure()) throw new Error('bad fixture');

    const result = await adapter.getProfile(idResult.value);

    expect(result.isFailure()).toBe(true);
  });
});
