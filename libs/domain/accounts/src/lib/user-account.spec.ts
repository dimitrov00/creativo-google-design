import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { AccountStatus } from './account-status';
import { User } from './user';
import { UserAccount } from './user-account';

function today(): ZonedDateTime {
  const result = ZonedDateTime.fromISO('2026-07-22T12:00:00', 'Europe/Sofia');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('UserAccount.provisioned', () => {
  it('accepts an id + phone with no profile yet', () => {
    const result = UserAccount.provisioned({
      id: 'uid_1',
      phone: '+359885550100',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('provisioned');
      expect(result.value.profile).toBeUndefined();
      expect(result.value.contactVerified).toBe(false);
    }
  });

  it('accepts an optional booking-side profile snapshot', () => {
    const result = UserAccount.provisioned({
      id: 'uid_1',
      phone: '+359885550100',
      firstName: 'Ivo',
      lastName: 'Petrov',
      email: 'client@example.com',
      contactVerified: true,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.profile?.firstName?.value).toBe('Ivo');
      expect(result.value.profile?.lastName?.value).toBe('Petrov');
      expect(result.value.profile?.email?.value).toBe('client@example.com');
      expect(result.value.contactVerified).toBe(true);
    }
  });

  it('rejects an empty id', () => {
    expect(
      UserAccount.provisioned({ id: '', phone: '+359885550100' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an invalid phone number', () => {
    expect(
      UserAccount.provisioned({
        id: 'uid_1',
        phone: 'not-a-phone',
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed optional email', () => {
    expect(
      UserAccount.provisioned({
        id: 'uid_1',
        phone: '+359885550100',
        email: 'nope',
      }).isFailure(),
    ).toBe(true);
  });
});

describe('UserAccount.registered / isRegistered / isProvisioned', () => {
  it('wraps an already-validated User with no re-validation', () => {
    const userResult = User.create(
      {
        id: 'uid_1',
        phone: '+359885550100',
        firstName: 'Ivo',
        lastName: 'Petrov',
        roles: ['client'],
        status: AccountStatus.active(),
      },
      today(),
    );
    if (userResult.isFailure())
      throw new Error('unexpected failure in test fixture');

    const account = UserAccount.registered(userResult.value);
    expect(account.kind).toBe('registered');
    expect(UserAccount.isRegistered(account)).toBe(true);
    expect(UserAccount.isProvisioned(account)).toBe(false);

    const provisionedResult = UserAccount.provisioned({
      id: 'uid_2',
      phone: '+359885550101',
    });
    if (provisionedResult.isFailure()) {
      throw new Error('unexpected failure in test fixture');
    }
    expect(UserAccount.isProvisioned(provisionedResult.value)).toBe(true);
    expect(UserAccount.isRegistered(provisionedResult.value)).toBe(false);
  });
});
