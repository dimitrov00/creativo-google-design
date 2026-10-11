import {
  AccountLifecycle,
  E164,
  RegistrationState,
  Role,
} from '@core/components';
import type { User } from '@core/entities';
import { UserId } from '@core/primitives';

/**
 * The identity fixtures (flatten-spec §8.1/§8.7) — the account entities in
 * their flat, branded shapes, every field present, overridable field by
 * field. Test support only, reached through `@core/testing`.
 *
 * Self-contained on purpose: `testing.ts` re-exports this file, so it never
 * imports `testing.ts` back (a cycle would hand a spec half-initialised
 * constants). The one pin it shares with `testing.ts` — the client's id,
 * `FIXTURE_IDS.client` — is restated here and held equal by
 * `identity.fixtures.spec.ts`.
 */

/** `FIXTURE_IDS.client` — the fixture client's account. */
const CLIENT_USER_ID = UserId.of('u-client');

/**
 * A registered, active client with a phone and nothing else optional — the
 * account slice `ACTIVE` at the root, the search keys of Maria Petrova.
 */
export function userFixture(overrides: Partial<User> = {}): User {
  const base: User = {
    id: CLIENT_USER_ID,
    registrationState: RegistrationState.Registered,
    phone: E164.of('+359888123456'),
    firstName: 'Maria',
    lastName: 'Petrova',
    roles: [Role.Client],
    ...AccountLifecycle.active(),
    email: null,
    birthDate: null,
    searchName: 'maria petrova',
    searchPrefixes: ['m', 'ma', 'mar', 'p', 'pe', 'pet'],
  };
  // A spread of a partial union is wider than the union; the override is the
  // spec's own choice of variant (a block passes its `blockReason` too).
  return { ...base, ...overrides } as User;
}
