import type { Firestore } from 'firebase-admin/firestore';
import { Email, UserId } from '@creativo/domain/models';
import { AccountStatus, User } from '@creativo/domain/accounts';
import {
  OtpDestination,
  ProvisionedUser,
} from '@creativo/application/identity';
import { PhoneNumber, ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { createFakeFirestore } from '../test-support/fake-firestore';
import { FirestoreUserRepository } from './firestore-user-repository';

function db() {
  return createFakeFirestore() as unknown as Firestore;
}

function emailDestination(raw: string): OtpDestination {
  const result = Email.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return { kind: 'email', email: result.value };
}

function phoneDestination(raw: string): OtpDestination {
  const result = PhoneNumber.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return { kind: 'sms', phone: result.value };
}

function uid(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function provisionedStub(
  id: string,
  channels: { email?: string; phone?: string },
): ProvisionedUser {
  return {
    id: uid(id),
    email: channels.email ?? null,
    phone: channels.phone ?? null,
  };
}

const TODAY = ((): ZonedDateTime => {
  const result = ZonedDateTime.fromISO('2026-07-25T12:00:00', 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
})();

function registeredUser(): User {
  const result = User.create(
    {
      id: 'uid_1',
      phone: '+14155552671',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: ['client'],
      status: AccountStatus.active(),
      email: 'client@example.com',
      birthDate: '1990-07-03',
    },
    TODAY,
  );
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('FirestoreUserRepository', () => {
  it('provisions a contact-channel stub and finds it back, unregistered', async () => {
    const repo = new FirestoreUserRepository(db());
    await repo.provision(
      provisionedStub('uid_1', { email: 'client@example.com' }),
    );

    const result = await repo.findByDestination(
      emailDestination('client@example.com'),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.id.value).toBe('uid_1');
      expect(result.value?.email).toBe('client@example.com');
      expect(result.value?.phone).toBeNull();
      expect(result.value?.birthDate).toBeNull();
      expect(result.value?.registered).toBe(false);
    }
  });

  it('persists a registered user in the accounts-adapter document shape', async () => {
    const firestore = createFakeFirestore();
    const repo = new FirestoreUserRepository(firestore as unknown as Firestore);
    await repo.saveRegistered(registeredUser());

    // The document MUST match what the web's `FirestoreProfileAdapter`
    // (`libs/infrastructure/firestore`) writes and reconstitutes —
    // field-for-field, including the denormalized search fields.
    const snapshot = await firestore.collection('users').doc('uid_1').get();
    expect(snapshot.data()).toEqual({
      phone: '+14155552671',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: ['client'],
      status: { kind: 'active' },
      email: 'client@example.com',
      birthDate: '1990-07-03',
      searchName: 'ada lovelace',
      searchPrefixes: [
        'a',
        'ad',
        'ada',
        'l',
        'lo',
        'lov',
        'love',
        'lovel',
        'lovela',
        'lovelac',
        'lovelace',
      ],
    });
  });

  it('reads a registered user back with the registered flag and stored birthDate', async () => {
    const repo = new FirestoreUserRepository(db());
    await repo.saveRegistered(registeredUser());

    const result = await repo.findByDestination(
      emailDestination('client@example.com'),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.registered).toBe(true);
      expect(result.value?.birthDate).toBe('1990-07-03');
      expect(result.value?.phone).toBe('+14155552671');
    }
  });

  it('returns null when no user matches the destination', async () => {
    const repo = new FirestoreUserRepository(db());
    const result = await repo.findByDestination(
      emailDestination('nobody@example.com'),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('looks up by phone when destinationType is sms', async () => {
    const repo = new FirestoreUserRepository(db());
    await repo.provision(provisionedStub('uid_2', { phone: '+14155552671' }));

    const found = await repo.findByDestination(
      phoneDestination('+14155552671'),
    );
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.value).toBe('uid_2');
      expect(found.value?.registered).toBe(false);
    }
  });
});
