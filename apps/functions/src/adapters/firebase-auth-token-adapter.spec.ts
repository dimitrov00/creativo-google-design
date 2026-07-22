import type { Auth } from 'firebase-admin/auth';
import { Email, TenantId, UserId } from '@creativo/domain/models';
import { OtpDestination } from '@creativo/application/identity';
import { PhoneNumber } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { createFakeAuth } from '../test-support/fake-auth';
import { FirebaseAuthTokenAdapter } from './firebase-auth-token-adapter';

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

describe('FirebaseAuthTokenAdapter.createCustomToken', () => {
  it('mints a token carrying onboarding-stage claims', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const uidResult = UserId.create('uid_1');
    if (uidResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    const tenantIdResult = TenantId.create('creativo');
    if (tenantIdResult.isFailure())
      throw new Error('unexpected failure in test fixture');

    const result = await adapter.createCustomToken(
      uidResult.value,
      tenantIdResult.value,
      { stage: 'onboarding' },
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toContain('uid_1');
    }
    expect(fakeAuth.customTokens[0].claims).toEqual({
      tenantId: 'creativo',
      stage: 'onboarding',
    });
  });

  it('mints a token carrying active-stage claims with roles', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const uidResult = UserId.create('uid_2');
    if (uidResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    const tenantIdResult = TenantId.create('creativo');
    if (tenantIdResult.isFailure())
      throw new Error('unexpected failure in test fixture');

    await adapter.createCustomToken(uidResult.value, tenantIdResult.value, {
      stage: 'active',
      roles: ['client'],
    });
    expect(fakeAuth.customTokens[0].claims).toEqual({
      tenantId: 'creativo',
      stage: 'active',
      roles: ['client'],
    });
  });
});

describe('FirebaseAuthTokenAdapter.setUserClaims', () => {
  it('sets custom claims for an already-signed-in user', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const uidResult = UserId.create('uid_3');
    if (uidResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    const tenantIdResult = TenantId.create('creativo');
    if (tenantIdResult.isFailure())
      throw new Error('unexpected failure in test fixture');

    const result = await adapter.setUserClaims(
      uidResult.value,
      tenantIdResult.value,
      { stage: 'active', roles: ['client'] },
    );
    expect(result.isSuccess()).toBe(true);
    expect(fakeAuth.claimsByUid.get('uid_3')).toEqual({
      tenantId: 'creativo',
      stage: 'active',
      roles: ['client'],
    });
  });
});

describe('FirebaseAuthTokenAdapter.provisionAuthUser', () => {
  it('creates a Firebase Auth user by email and returns its uid', async () => {
    const fakeAuth = createFakeAuth();
    const adapter = new FirebaseAuthTokenAdapter(fakeAuth as unknown as Auth);
    const result = await adapter.provisionAuthUser(
      emailDestination('client@example.com'),
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
    const result = await adapter.provisionAuthUser(
      phoneDestination('+14155552671'),
    );
    expect(result.isSuccess()).toBe(true);
  });
});
