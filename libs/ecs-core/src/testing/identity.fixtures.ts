import {
  AccountLifecycle,
  BlockReason,
  CustomerOrigin,
  E164,
  ErasureLifecycle,
  Identifier,
  ImpersonationLifecycle,
  ImpersonationScope,
  OtpDestinationType,
  OtpPurpose,
  ParsedIdentifier,
  Principal,
  PrincipalKind,
  RegistrationState,
  Role,
  WriteProvenance,
} from '@core/components';
import type { Customer, ImpersonationSession, Otp, User } from '@core/entities';
import {
  ImpersonationSessionId,
  OtpId,
  TenantId,
  UserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import { RegistrationSystem } from '@core/systems';
import { customerOf } from './test-support';

/**
 * The identity fixtures (flatten-spec §8.1/§8.7) — the account entities in
 * their flat, branded shapes, every field present, overridable field by
 * field. Test support only, reached through `@core/testing`.
 *
 * Self-contained on purpose: `testing.ts` re-exports this file, so it never
 * imports `testing.ts` back (a cycle would hand a spec half-initialised
 * constants). The pins it shares with `test-support.ts` — the client's id
 * (`FIXTURE_IDS.client`) and the pinned clock (`FIXTURE_NOW_UTC_MS`) — are
 * restated here and held equal by `identity.fixtures.spec.ts`. The one
 * import from `test-support.ts` is {@link customerFixture}'s id derivation
 * (`customerOf`, D29 — never a cast): `test-support.ts` imports no fixture
 * file, so the edge cannot close a cycle.
 */

/** `FIXTURE_IDS.client` — the fixture client's account. */
const CLIENT_USER_ID = UserId.of('u-client');

/** `FIXTURE_NOW_UTC_MS` — 2026-09-28T06:00:00Z, restated. */
const NOW_MS = 1_790_575_200_000;

/** A fixture instant — a defect, never a Result, for a literal that cannot fail. */
function instant(ms: number): UtcEpochMs {
  const at = UtcEpochMs.of(ms);
  return at.ok ? at.value : defect(`${ms} is no instant`);
}

/** The fixture deployment's tenant — the single tenant the functions root declares. */
export const FIXTURE_TENANT_ID: TenantId = TenantId.of('creativo');

/** The fixture client's login phone, E.164. */
export const FIXTURE_PHONE: E164 = E164.of('+359888123456');

/** The code every fixture challenge was issued with (the emulator's fixed code). */
export const FIXTURE_OTP_CODE = '123456';

/** The fixture salt of {@link otpFixture}. */
export const FIXTURE_OTP_SALT = 'salt-1';

/**
 * The fixture digest of a code under a salt — what `fixedOtpCryptoPorts`
 * hashes with and compares by, so {@link otpFixture}'s `codeHash` matches
 * {@link FIXTURE_OTP_CODE}. Plain text on purpose: a test reads it.
 */
export function fixtureCodeHash(code: string, salt: string): string {
  return `hash(${salt}:${code})`;
}

/**
 * A registered, active client with a phone and nothing else optional — the
 * account slice `ACTIVE` at the root, the search keys of Maria Petrova.
 */
export function userFixture(overrides: Partial<User> = {}): User {
  const base: User = {
    id: CLIENT_USER_ID,
    registrationState: RegistrationState.Registered,
    phone: FIXTURE_PHONE,
    firstName: 'Maria',
    lastName: 'Petrova',
    roles: [Role.Client],
    ...AccountLifecycle.active(),
    email: null,
    birthDate: null,
    profileEditedAtUtcMs: null,
    searchName: 'maria petrova',
    searchPrefixes: ['m', 'ma', 'mar', 'p', 'pe', 'pet'],
  };
  // A spread of a partial union is wider than the union; the override is the
  // spec's own choice of variant (a block passes its `blockReason` too).
  return { ...base, ...overrides } as User;
}

/**
 * The `PROVISIONED` stub `verifyOtp` creates for the fixture client's phone
 * — `RegistrationSystem.provision`, every key present (names and birth date
 * `null`, roles `[]`, no search keys).
 */
export function provisionedUserFixture(overrides: Partial<User> = {}): User {
  const base = RegistrationSystem.provision(
    CLIENT_USER_ID,
    ParsedIdentifier.phone(FIXTURE_PHONE),
  );
  return { ...base, ...overrides } as User;
}

/**
 * Maria Petrova as `completeRegistration` leaves her: the stub of
 * {@link provisionedUserFixture} registered through
 * `RegistrationSystem.register` — `client`, the login phone, no e-mail or
 * birth date, and the search keys the registration computes (so an
 * unchanged owner edit of her decides `null`). Overrides replace fields
 * verbatim; they never recompute the search keys.
 */
export function registeredUserFixture(overrides: Partial<User> = {}): User {
  const base = RegistrationSystem.register(provisionedUserFixture(), {
    firstName: 'Maria',
    lastName: 'Petrova',
    phone: FIXTURE_PHONE,
    email: null,
    birthDate: null,
    roles: [Role.Client],
  });
  return { ...base, ...overrides } as User;
}

/**
 * {@link registeredUserFixture}, blocked by the shop (`MANUAL`) until
 * 2026-12-01T00:00:00Z — the lifecycle's variant keys flat at the root.
 */
export function blockedUserFixture(overrides: Partial<User> = {}): User {
  return registeredUserFixture({
    ...AccountLifecycle.block(BlockReason.Manual, instant(1_796_083_200_000)),
    ...overrides,
  });
}

/**
 * The fixture client's RECORD (`customers/{id}`, D29) as the first booking
 * opened it: Maria Petrova, linked to her account by the explicit `userId`,
 * her login phone, no e-mail, the search keys of her name, opened a day
 * before the pinned clock, no erasure (`NONE`). The id is DERIVED from the
 * account (`customerOf` — `CustomerId.forUser`), never cast. Every field
 * present, overridable field by field; it passes
 * `StoredDocumentSystem.customer` as stored (`identity.fixtures.spec.ts`).
 */
export function customerFixture(overrides: Partial<Customer> = {}): Customer {
  const base: Customer = {
    id: customerOf(CLIENT_USER_ID),
    userId: CLIENT_USER_ID,
    displayName: 'Maria Petrova',
    phone: FIXTURE_PHONE,
    email: null,
    searchName: 'maria petrova',
    searchPrefixes: ['m', 'ma', 'mar', 'p', 'pe', 'pet'],
    createdAtUtcMs: instant(NOW_MS - 86_400_000),
    customerOrigin: CustomerOrigin.FirstBooking,
    ...WriteProvenance.NONE,
    ...ErasureLifecycle.none(),
  };
  // A spread of a partial union is wider than the union; the override is the
  // spec's own choice of variant (an erasure passes its stamps too).
  return { ...base, ...overrides } as Customer;
}

/**
 * An open login challenge for the fixture client's phone, issued at the
 * pinned clock with the default strategy's policy (5 minutes, 5 attempts),
 * its hash that of {@link FIXTURE_OTP_CODE} under {@link FIXTURE_OTP_SALT}.
 */
export function otpFixture(overrides: Partial<Otp> = {}): Otp {
  return {
    id: OtpId.of('otp-1'),
    tenantId: FIXTURE_TENANT_ID,
    destination: Identifier.of(FIXTURE_PHONE),
    otpDestinationType: OtpDestinationType.Sms,
    otpPurpose: OtpPurpose.Login,
    codeHash: fixtureCodeHash(FIXTURE_OTP_CODE, FIXTURE_OTP_SALT),
    salt: FIXTURE_OTP_SALT,
    expiresAtUtcMs: instant(NOW_MS + 5 * 60_000),
    attemptCount: 0,
    maxAttempts: 5,
    consumedAtUtcMs: null,
    createdAtUtcMs: instant(NOW_MS),
    ...overrides,
  };
}

/**
 * An ACTIVE read-scope session: the fixture admin acting as the fixture
 * client, started at the pinned clock for 30 minutes.
 */
export function impersonationSessionFixture(
  overrides: Partial<ImpersonationSession> = {},
): ImpersonationSession {
  const base: ImpersonationSession = {
    id: ImpersonationSessionId.of('imp-1'),
    adminUserId: UserId.of('u-admin'),
    targetUserId: CLIENT_USER_ID,
    impersonationScope: ImpersonationScope.Read,
    reason: 'Support request',
    startedAtUtcMs: instant(NOW_MS),
    expiresAtUtcMs: instant(NOW_MS + 30 * 60_000),
    ...ImpersonationLifecycle.active(),
  };
  // As for the user: an `ENDED` override brings its own variant keys.
  return { ...base, ...overrides } as ImpersonationSession;
}

/**
 * The four routing principals (Phase 4a §3.7) — the ecs `Principal` a
 * session double emits, on the fixture tenant: anonymous, onboarding (claims
 * not yet active), a client and a staff member with the given roles.
 */
export const principalFixture = {
  anonymous(): Principal.Anonymous {
    return Principal.anonymous();
  },
  onboarding(userId: UserId = CLIENT_USER_ID): Principal.Onboarding {
    return {
      principalKind: PrincipalKind.Onboarding,
      userId,
      tenantId: FIXTURE_TENANT_ID,
    };
  },
  client(userId: UserId = CLIENT_USER_ID): Principal.Client {
    return {
      principalKind: PrincipalKind.Client,
      userId,
      roles: [Role.Client],
      tenantId: FIXTURE_TENANT_ID,
    };
  },
  staff(
    userId: UserId,
    roles: readonly Role[] = [Role.Barber],
  ): Principal.Staff {
    return {
      principalKind: PrincipalKind.Staff,
      userId,
      roles,
      tenantId: FIXTURE_TENANT_ID,
    };
  },
} as const;
