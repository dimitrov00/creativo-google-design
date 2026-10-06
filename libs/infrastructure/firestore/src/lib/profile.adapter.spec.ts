import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  AccountStatus,
  USER_ROLES,
  User,
  UserId,
} from '@creativo/domain/accounts';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import { FirestoreProfileAdapter } from './profile.adapter';

function createAdapter(): FirestoreProfileAdapter {
  TestBed.resetTestingModule();
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
    onSnapshot: vi.fn(),
    runTransaction: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
  };
});

/** The FIX 2 owner allowlist (`firestore.rules`, `users` update), spelled out
 * here on purpose rather than imported: the spec pins the rule's list. */
const OWNER_EDITABLE_KEYS = [
  'birthDate',
  'firstName',
  'lastName',
  'searchName',
  'searchPrefixes',
];

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

function buildUser(
  overrides: Partial<Parameters<typeof User.create>[0]> = {},
): User {
  const created = User.create(
    {
      id: 'user-1',
      phone: '+359888123456',
      firstName: 'Ivan',
      lastName: 'Petrov',
      roles: ['client'],
      status: AccountStatus.active(),
      ...overrides,
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

/** A registered `users/{uid}` as registration writes it. */
function storedDoc(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    phone: '+359888123456',
    firstName: 'Ivan',
    lastName: 'Petrov',
    roles: ['client'],
    status: { kind: 'active' },
    email: 'ivan@example.com',
    birthDate: null,
    searchName: 'ivan petrov',
    searchPrefixes: ['i', 'iv', 'ivan'],
    ...overrides,
  };
}

function snapshotOf(data: Record<string, unknown> | undefined) {
  return {
    exists: () => data !== undefined,
    id: 'user-1',
    data: () => data,
  };
}

/**
 * Runs `saveProfile`'s transaction against a stored document (or none) and
 * hands back the `update` spy — the one write the adapter may make.
 */
async function transactionOver(
  stored: Record<string, unknown> | undefined,
): Promise<ReturnType<typeof vi.fn>> {
  const { runTransaction } = await import('firebase/firestore');
  const update = vi.fn();
  vi.mocked(runTransaction).mockImplementationOnce((async (
    _db: unknown,
    body: (transaction: unknown) => Promise<unknown>,
  ) => body({ get: async () => snapshotOf(stored), update })) as never);
  return update;
}

function payloadOf(update: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(update).toHaveBeenCalledTimes(1);
  const [, payload] = update.mock.calls[0] as [
    unknown,
    Record<string, unknown>,
  ];
  return payload;
}

describe('FirestoreProfileAdapter', () => {
  describe('saveProfile', () => {
    it('updates only the owner-editable keys, never a whole-document set', async () => {
      const { setDoc, updateDoc } = await import('firebase/firestore');
      const update = await transactionOver(storedDoc());
      const adapter = createAdapter();

      const result = await adapter.saveProfile(
        buildUser({ firstName: 'Georgi', birthDate: '1990-05-17' }),
      );

      expect(result.isSuccess()).toBe(true);
      const payload = payloadOf(update);
      expect(Object.keys(payload).sort()).toEqual(OWNER_EDITABLE_KEYS);
      expect(payload).toMatchObject({
        firstName: 'Georgi',
        lastName: 'Petrov',
        birthDate: '1990-05-17',
        searchName: 'georgi petrov',
      });
      expect(setDoc).not.toHaveBeenCalled();
      expect(updateDoc).not.toHaveBeenCalled();
    });

    it('never sends roles, status, phone or email, whatever the passed User carries', async () => {
      const update = await transactionOver(storedDoc());
      const adapter = createAdapter();

      const result = await adapter.saveProfile(
        buildUser({
          roles: ['client', 'admin'],
          status: AccountStatus.blocked({ reason: 'manual' }),
          phone: '+359877000111',
          email: 'someone-else@example.com',
        }),
      );

      expect(result.isSuccess()).toBe(true);
      const payload = payloadOf(update);
      for (const key of ['roles', 'status', 'phone', 'email']) {
        expect(payload).not.toHaveProperty(key);
      }
    });

    it('rebuilds the search keys from the edited name and the STORED contact channels', async () => {
      // A local part too short to index, so every "ivan" left would be the
      // old name's.
      const update = await transactionOver(storedDoc({ email: 'ip@abv.bg' }));
      const adapter = createAdapter();

      await adapter.saveProfile(
        buildUser({
          firstName: 'Georgi',
          phone: '+359877000111',
          email: 'someone-else@example.com',
        }),
      );

      const prefixes = payloadOf(update)['searchPrefixes'] as string[];
      expect(prefixes).toEqual(
        expect.arrayContaining([
          'g',
          'georgi',
          'petrov',
          // The stored number in both forms, from the 3rd digit…
          '359888123456',
          '0888123456',
          // …and the stored e-mail.
          'ip@',
          'ip@abv.bg',
        ]),
      );
      // The caller's number and e-mail are not on the document, so they are
      // not indexed either.
      expect(prefixes).not.toContain('359877000111');
      expect(prefixes).not.toContain('someone-else');
      // The old first name is gone from the index.
      expect(prefixes).not.toContain('ivan');
    });

    it('sends null for an absent birth date, so a cleared one is cleared', async () => {
      const update = await transactionOver(
        storedDoc({ birthDate: '1990-05-17' }),
      );
      const adapter = createAdapter();

      await adapter.saveProfile(buildUser());

      expect(payloadOf(update)['birthDate']).toBeNull();
    });

    it('refuses to create: a missing document fails and nothing is written', async () => {
      const update = await transactionOver(undefined);
      const adapter = createAdapter();

      const result = await adapter.saveProfile(buildUser());

      expect(result.isFailure()).toBe(true);
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses to register: a contact-only stub fails and nothing is written', async () => {
      const update = await transactionOver({
        phone: '+359888123456',
        email: null,
      });
      const adapter = createAdapter();

      const result = await adapter.saveProfile(buildUser());

      expect(result.isFailure()).toBe(true);
      expect(update).not.toHaveBeenCalled();
    });

    it('surfaces a refused transaction (rules, offline) as a failed Result', async () => {
      const { runTransaction } = await import('firebase/firestore');
      vi.mocked(runTransaction).mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'permission-denied' }),
      );
      const adapter = createAdapter();

      const result = await adapter.saveProfile(buildUser());

      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(RepositoryError);
      }
    });

    it('property: the payload is always exactly the allowlist', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray([...USER_ROLES], { minLength: 1 }),
          fc.constantFrom(
            AccountStatus.active(),
            AccountStatus.blocked({ reason: 'manual' }),
            AccountStatus.blocked({ reason: 'fraud_suspect' }),
          ),
          fc.constantFrom('+359888123456', '+359877000111', '+359899555010'),
          fc.option(fc.constantFrom('a@example.com', 'b.c@example.org'), {
            nil: undefined,
          }),
          fc.option(fc.constantFrom('1980-01-31', '2001-12-01'), {
            nil: undefined,
          }),
          async (roles, status, phone, email, birthDate) => {
            const update = await transactionOver(storedDoc());
            const result = await createAdapter().saveProfile(
              buildUser({
                roles,
                status,
                phone,
                ...(email !== undefined && { email }),
                ...(birthDate !== undefined && { birthDate }),
              }),
            );
            expect(result.isSuccess()).toBe(true);
            expect(Object.keys(payloadOf(update)).sort()).toEqual(
              OWNER_EDITABLE_KEYS,
            );
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('getProfile', () => {
    it('returns null when the doc does not exist', async () => {
      const { getDoc } = await import('firebase/firestore');
      vi.mocked(getDoc).mockResolvedValueOnce(snapshotOf(undefined) as never);
      const adapter = createAdapter();

      const result = await adapter.getProfile(requireUserId('user-1'));

      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null for the pre-registration stub (contact channels only)', async () => {
      const { getDoc } = await import('firebase/firestore');
      vi.mocked(getDoc).mockResolvedValueOnce(
        snapshotOf({ phone: '+359888123456', email: null }) as never,
      );
      const adapter = createAdapter();

      const result = await adapter.getProfile(requireUserId('user-1'));

      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.value).toBeNull();
      }
    });

    it('reconstitutes a User from a stored document', async () => {
      const { getDoc } = await import('firebase/firestore');
      vi.mocked(getDoc).mockResolvedValueOnce(
        snapshotOf(storedDoc({ email: null })) as never,
      );
      const adapter = createAdapter();

      const result = await adapter.getProfile(requireUserId('user-1'));

      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess() && result.value) {
        expect(result.value.fullName()).toBe('Ivan Petrov');
        expect(result.value.status.kind).toBe('active');
      }
    });

    it('surfaces a malformed document as a failed Result', async () => {
      const { getDoc } = await import('firebase/firestore');
      vi.mocked(getDoc).mockResolvedValueOnce(
        snapshotOf(storedDoc({ phone: 'not-a-phone' })) as never,
      );
      const adapter = createAdapter();

      const result = await adapter.getProfile(requireUserId('user-1'));

      expect(result.isFailure()).toBe(true);
    });

    it('surfaces a registered document without a status as a failed Result, not a throw', async () => {
      const { getDoc } = await import('firebase/firestore');
      vi.mocked(getDoc).mockResolvedValueOnce(
        snapshotOf(storedDoc({ status: undefined })) as never,
      );
      const adapter = createAdapter();

      const result = await adapter.getProfile(requireUserId('user-1'));

      expect(result.isFailure()).toBe(true);
    });
  });

  describe('observeProfile', () => {
    /** Captures the snapshot listener so a test can push documents at it. */
    async function listen(): Promise<{
      push: (data: Record<string, unknown> | undefined) => void;
      results: Result<User | null, RepositoryError>[];
      unsubscribeSnapshot: ReturnType<typeof vi.fn>;
      stop: () => void;
    }> {
      const { onSnapshot } = await import('firebase/firestore');
      let onNext: (snapshot: unknown) => void = () => undefined;
      const unsubscribeSnapshot = vi.fn();
      vi.mocked(onSnapshot).mockImplementationOnce(((
        _ref: unknown,
        next: (snapshot: unknown) => void,
      ) => {
        onNext = next;
        return unsubscribeSnapshot;
      }) as never);
      const results: Result<User | null, RepositoryError>[] = [];
      const subscription = createAdapter()
        .observeProfile(requireUserId('user-1'))
        .subscribe((result) => results.push(result));
      return {
        push: (data) => onNext(snapshotOf(data)),
        results,
        unsubscribeSnapshot,
        stop: () => subscription.unsubscribe(),
      };
    }

    it('emits ok(null) while the document is absent or still a stub', async () => {
      const live = await listen();

      live.push(undefined);
      live.push({ phone: '+359888123456', email: null });

      expect(live.results).toHaveLength(2);
      for (const result of live.results) {
        expect(result.isSuccess() && result.value === null).toBe(true);
      }
      live.stop();
    });

    it('maps each snapshot, so a server-written status change arrives live', async () => {
      const live = await listen();

      live.push(storedDoc());
      live.push(
        storedDoc({
          status: {
            kind: 'blocked',
            reason: 'manual',
            untilIso: '2026-10-12T00:00:00.000+03:00',
          },
        }),
      );

      const [first, second] = live.results;
      expect(first?.isSuccess() && first.value?.status.kind).toBe('active');
      expect(second?.isSuccess()).toBe(true);
      if (second?.isSuccess()) {
        const status = second.value?.status;
        expect(status?.kind).toBe('blocked');
        if (status?.kind === 'blocked') {
          expect(status.reason).toBe('manual');
          expect(status.until?.toISODate()).toBe('2026-10-12');
        }
        expect(second.value?.fullName()).toBe('Ivan Petrov');
        expect(second.value?.email?.value).toBe('ivan@example.com');
      }
      live.stop();
    });

    it('emits a failed Result for a malformed document', async () => {
      const live = await listen();

      live.push(storedDoc({ status: { kind: 'blocked', reason: 'nope' } }));

      expect(live.results).toHaveLength(1);
      expect(live.results[0]?.isFailure()).toBe(true);
      live.stop();
    });

    it('detaches the snapshot listener on unsubscribe', async () => {
      const live = await listen();

      live.stop();

      expect(live.unsubscribeSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});
