import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BlockReason,
  ImpersonationLifecycle,
  Registration,
} from '@core/components';
import type { User } from '@core/entities';
import {
  ProfileEditSystem,
  SearchFieldsSystem,
  StoredDocumentSystem,
} from '@core/systems';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  utcMs,
} from './test-support';
import { deepFreeze } from './deep-freeze';
import {
  FIXTURE_OTP_CODE,
  FIXTURE_OTP_SALT,
  blockedUserFixture,
  customerFixture,
  fixtureCodeHash,
  impersonationSessionFixture,
  otpFixture,
  provisionedUserFixture,
  registeredUserFixture,
  userFixture,
} from './identity.fixtures';

/*
 * The identity case of testing.spec.ts's "fixture builders" block, moved
 * here with its builder (flatten-spec §8.1) and re-shaped: the registration
 * tag is the plain field `registrationState`, the account lifecycle is flat
 * at the user's root.
 */
describe('identity fixtures', () => {
  it('the user fixture is a registered, active client', () => {
    const user = userFixture();
    expect(user.registrationState).toBe('REGISTERED');
    expect(user.accountStatus).toBe('ACTIVE');
    expect(user.roles).toEqual(['client']);
    expect(userFixture({ email: null }).email).toBeNull();
  });

  it('restates the shared client id of FIXTURE_IDS, so fixtures cross-reference', () => {
    expect(userFixture().id).toBe(FIXTURE_IDS.client);
  });

  it('overrides field by field, a block included, and shares no mutable value', () => {
    const blocked = userFixture(
      AccountLifecycle.block(BlockReason.Manual, utcMs('2026-12-01T00:00:00Z')),
    );
    expect(blocked).toMatchObject({
      accountStatus: 'BLOCKED',
      blockReason: 'MANUAL',
      firstName: 'Maria',
    });
    const frozen = deepFreeze(userFixture());
    expect(Object.isFrozen(userFixture())).toBe(false);
    expect(userFixture()).toEqual(frozen);
  });

  it('the provisioned stub is the PROVISIONED body verifyOtp creates — every key present, nothing registered', () => {
    const stub = provisionedUserFixture();
    expect(stub).toEqual({
      id: FIXTURE_IDS.client,
      registrationState: 'PROVISIONED',
      phone: '+359888123456',
      firstName: null,
      lastName: null,
      roles: [],
      accountStatus: 'ACTIVE',
      email: null,
      birthDate: null,
      profileEditedAtUtcMs: null,
      searchName: null,
      searchPrefixes: [],
    });
    expect(Registration.isRegistered(stub)).toBe(false);
  });

  it('the registered user carries the search keys registration computes — an unchanged owner edit decides nothing', () => {
    const user = registeredUserFixture();
    expect(user).toMatchObject({
      id: FIXTURE_IDS.client,
      registrationState: 'REGISTERED',
      firstName: 'Maria',
      lastName: 'Petrova',
      roles: ['client'],
      accountStatus: 'ACTIVE',
    });
    expect({
      searchName: user.searchName,
      searchPrefixes: user.searchPrefixes,
    }).toEqual(
      SearchFieldsSystem.searchFields('Maria', 'Petrova', user.phone, null),
    );
    expect(
      ProfileEditSystem.decide(
        user,
        { firstName: null, lastName: null, birthDate: null },
        FIXTURE_TODAY,
      ),
    ).toEqual({
      ok: true,
      value: null,
    });
  });

  it('the blocked user narrows to its block, flat at the root', () => {
    const user: User = blockedUserFixture();
    expect(user.accountStatus).toBe('BLOCKED');
    if (user.accountStatus === 'BLOCKED') {
      expect(user.blockReason).toBe('MANUAL');
      expect(user.blockedUntilUtcMs).toBe(utcMs('2026-12-01T00:00:00Z'));
    }
    expect(user.registrationState).toBe('REGISTERED');
  });

  it('the customer fixture is the client’s record — derived id, explicit link — and passes the read-time guard as stored', () => {
    const record = customerFixture();
    expect(record).toMatchObject({
      id: FIXTURE_IDS.customer,
      userId: FIXTURE_IDS.client,
      displayName: 'Maria Petrova',
      customerOrigin: 'FIRST_BOOKING',
      erasureStatus: 'NONE',
    });
    expect(record.createdAtUtcMs).toBeLessThan(FIXTURE_NOW_UTC_MS);
    const admitted = StoredDocumentSystem.customer(record);
    expect(admitted.ok).toBe(true);
    expect(admitted.ok && admitted.value).toBe(record);
    expect(customerFixture({ userId: null }).userId).toBeNull();
    expect(customerFixture()).toEqual(deepFreeze(customerFixture()));
  });

  it('the challenge is open at the pinned clock, hashed from the fixed code', () => {
    const otp = otpFixture();
    expect(otp.createdAtUtcMs).toBe(FIXTURE_NOW_UTC_MS);
    expect(otp.expiresAtUtcMs - otp.createdAtUtcMs).toBe(5 * 60_000);
    expect(otp).toMatchObject({
      destination: '+359888123456',
      otpDestinationType: 'SMS',
      otpPurpose: 'LOGIN',
      attemptCount: 0,
      maxAttempts: 5,
      consumedAtUtcMs: null,
      salt: FIXTURE_OTP_SALT,
      codeHash: fixtureCodeHash(FIXTURE_OTP_CODE, FIXTURE_OTP_SALT),
    });
    expect(otpFixture({ attemptCount: 3 }).attemptCount).toBe(3);
  });

  it('the impersonation session is ACTIVE for 30 minutes from the pinned clock', () => {
    const session = impersonationSessionFixture();
    expect(session).toMatchObject({
      adminUserId: 'u-admin',
      targetUserId: FIXTURE_IDS.client,
      impersonationScope: 'READ',
      ...ImpersonationLifecycle.active(),
    });
    expect(session.startedAtUtcMs).toBe(FIXTURE_NOW_UTC_MS);
    expect(session.expiresAtUtcMs - session.startedAtUtcMs).toBe(30 * 60_000);
  });
});
