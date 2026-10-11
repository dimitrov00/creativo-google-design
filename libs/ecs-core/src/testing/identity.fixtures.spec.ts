import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BlockReason,
} from '../components/account-status.data';
import { FIXTURE_IDS, deepFreeze, utcMs } from '../testing';
import { userFixture } from './identity.fixtures';

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
});
