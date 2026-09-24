import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { FirestoreUserSearchAdapter } from './user-search.adapter';

function createAdapter(): FirestoreUserSearchAdapter {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} as Firestore },
      FirestoreUserSearchAdapter,
    ],
  });
  return TestBed.inject(FirestoreUserSearchAdapter);
}

vi.mock('firebase/firestore', async () => {
  const actual =
    await vi.importActual<typeof import('firebase/firestore')>(
      'firebase/firestore',
    );
  return {
    ...actual,
    collection: vi.fn(),
    query: vi.fn((...args: unknown[]) => args),
    where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
    orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
    limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
    getDocs: vi.fn(),
  };
});

describe('FirestoreUserSearchAdapter', () => {
  it('returns an empty result for a blank query without hitting Firestore', async () => {
    const { getDocs } = await import('firebase/firestore');
    const adapter = createAdapter();

    const result = await adapter.search('   ');

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual([]);
    }
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('names a person as written, not by the lowercased search key', async () => {
    const { getDocs } = await import('firebase/firestore');
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: 'user-2',
          data: () => ({
            firstName: 'Мартин',
            lastName: 'Илиев',
            searchName: 'мартин илиев',
            phone: '+359887654321',
          }),
        },
      ],
    } as never);
    const result = await createAdapter().search('март');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value[0]?.displayName).toBe('Мартин Илиев');
      expect(result.value[0]?.phone).toBe('+359887654321');
    }
  });

  it('maps matching documents to UserSearchResult', async () => {
    const { getDocs } = await import('firebase/firestore');
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: 'user-1',
          data: () => ({
            searchName: 'ivan petrov',
            email: 'ivan@example.com',
          }),
        },
      ],
    } as never);
    const adapter = createAdapter();

    const result = await adapter.search('Ivan');

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.displayName).toBe('ivan petrov');
      expect(result.value[0]?.email?.value).toBe('ivan@example.com');
    }
  });

  it('surfaces a Firestore error as a failed Result', async () => {
    const { getDocs } = await import('firebase/firestore');
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('boom'));
    const adapter = createAdapter();

    const result = await adapter.search('ivan');

    expect(result.isFailure()).toBe(true);
  });
});
