import type { Auth } from 'firebase-admin/auth';
import { UserId } from '@creativo/domain/models';
import { describe, expect, it } from 'vitest';
import { createFakeAuth } from '../test-support/fake-auth';
import { FirebaseAuthTokenAdapter } from './firebase-auth-token-adapter';

describe('FirebaseAuthTokenAdapter.createCustomToken', () => {
  it('mints a token carrying the given claims', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const uidResult = UserId.create('uid_1');
    if (uidResult.isFailure())
      throw new Error('unexpected failure in test fixture');

    const result = await adapter.createCustomToken(uidResult.value, {
      tenantId: 'creativo',
      role: 'client',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toContain('uid_1');
    }
    expect(fakeAuth.customTokens[0].claims).toEqual({
      tenantId: 'creativo',
      role: 'client',
    });
  });
});

describe('FirebaseAuthTokenAdapter.provisionAuthUser', () => {
  it('creates a Firebase Auth user by email and returns its uid', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const result = await adapter.provisionAuthUser(
      'client@example.com',
      'email',
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeInstanceOf(UserId);
      expect(result.value.value.length).toBeGreaterThan(0);
    }
  });

  it('creates a Firebase Auth user by phone number', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const result = await adapter.provisionAuthUser('+15551234567', 'sms');
    expect(result.isSuccess()).toBe(true);
  });
});
