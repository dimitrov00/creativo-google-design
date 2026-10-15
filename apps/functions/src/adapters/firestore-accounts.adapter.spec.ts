import type { Firestore } from 'firebase-admin/firestore';
import { RepositoryErrorCode, UserId } from '@core/primitives';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreAccountPorts } from './firestore-accounts.adapter';

const U1 = UserId.of('u1');
const U2 = UserId.of('u2');
const GONE = UserId.of('gone');

describe('firestoreAccountPorts — the FIRST_BOOKING contact snapshot (F1-5)', () => {
  it('reads every named account in ONE getAll, keyed by uid; an absent account is simply missing', async () => {
    const fake = createProjectionFirestore({
      'users/u1': {
        firstName: 'Maria',
        lastName: 'Ivanova',
        phone: '+359888123456',
        email: 'maria@example.com',
      },
      'users/u2': {
        firstName: 'Petar',
        lastName: null,
        phone: null,
        email: null,
      },
    });
    const getAll = vi.spyOn(fake.db, 'getAll');
    const result = await firestoreAccountPorts(
      fake.db as unknown as Firestore,
    ).loadAccountContacts([U1, U2, GONE, U1]);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    const contacts = result.ok ? result.value : new Map();
    expect(contacts.get(U1)).toMatchObject({
      firstName: 'Maria',
      lastName: 'Ivanova',
      phone: '+359888123456',
      email: 'maria@example.com',
    });
    expect(contacts.get(U2)).toMatchObject({ firstName: 'Petar' });
    expect(contacts.has(GONE)).toBe(false);
  });

  it('asks nothing for nobody', async () => {
    const fake = createProjectionFirestore();
    const getAll = vi.spyOn(fake.db, 'getAll');
    const result = await firestoreAccountPorts(
      fake.db as unknown as Firestore,
    ).loadAccountContacts([]);
    expect(getAll).not.toHaveBeenCalled();
    expect(result.ok && result.value.size).toBe(0);
  });

  it('answers a read that throws as a REPOSITORY_READ_FAILED value', async () => {
    const db = {
      collection: () => ({ doc: (id: string) => ({ id }) }),
      getAll: async () => {
        throw new Error('down');
      },
    } as unknown as Firestore;
    const result = await firestoreAccountPorts(db).loadAccountContacts([U1]);
    expect(!result.ok && result.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });
});
