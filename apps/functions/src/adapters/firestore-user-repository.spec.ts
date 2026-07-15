import type { Firestore } from 'firebase-admin/firestore';
import { User } from '@creativo/domain/models';
import { describe, expect, it } from 'vitest';
import { createFakeFirestore } from '../test-support/fake-firestore';
import { FirestoreUserRepository } from './firestore-user-repository';

function db() {
  return createFakeFirestore() as unknown as Firestore;
}

function newUser(): User {
  const result = User.create({
    id: 'uid_1',
    email: 'client@example.com',
    referralCode: 'ABC123',
    gamificationPoints: 5,
    tenantMemberships: [{ tenantId: 'creativo', role: 'client' }],
  });
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('FirestoreUserRepository', () => {
  it('saves a user and finds it back by email', async () => {
    const repo = new FirestoreUserRepository(db());
    const user = newUser();
    await repo.save(user);

    const result = await repo.findByDestination('client@example.com', 'email');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.id.equals(user.id)).toBe(true);
      expect(result.value?.referralCode).toBe('ABC123');
      expect(result.value?.tenantMemberships).toHaveLength(1);
    }
  });

  it('returns null when no user matches the destination', async () => {
    const repo = new FirestoreUserRepository(db());
    const result = await repo.findByDestination('nobody@example.com', 'email');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('looks up by phone when destinationType is sms', async () => {
    const repo = new FirestoreUserRepository(db());
    const result = User.create({
      id: 'uid_2',
      phone: '+15551234567',
      referralCode: 'XYZ789',
      gamificationPoints: 0,
      tenantMemberships: [],
    });
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    await repo.save(result.value);

    const found = await repo.findByDestination('+15551234567', 'sms');
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(result.value.id)).toBe(true);
    }
  });
});
