import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  AccountStatus,
  BlockReason,
  AuthStage,
  AuthStrategy,
  AuthStrategyKind,
  BirthDate,
  Email,
  ParsedIdentifier,
  E164,
  Registration,
  RegistrationField,
  type RegistrationFields,
  RegistrationState,
  Role,
} from '@core/components';
import { IdentifierChannel, TenantId, UserId } from '@core/primitives';
import type { User } from '@core/entities';
import { deepFreeze, unwrapOk, utcMs } from '@core/testing';
import {
  type RegistrationStanding,
  RegistrationSystem,
} from './registration.system';
import { SearchFieldsSystem } from './search-fields.system';

/*
 * COPIED and re-targeted while the originals still ran against their shims (the
 * legacy ones deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1):
 * - the legacy identity application lib's `register-user.use-case.spec.ts`
 *   — the client-side field check (`effectiveFields` + `missingField`);
 * - the math of apps/functions/src/use-cases/complete-registration.use-case.spec.ts
 *   — the field check, the settle of a first registration and of a re-run
 *   (roles, contact channels and status kept), the active claims; its
 *   birth-date reasons live in age.system.spec.ts, its ownership, not-found
 *   and unreadable-status cases are the pipeline's (no math);
 * - the claims math of apps/functions/src/use-cases/verify-otp.use-case.spec.ts
 *   (onboarding for a stub, the STORED roles once registered, `client` when
 *   none were granted) and its provisioned stub;
 * - the legacy identity `registration-field.spec.ts` (the field
 *   vocabulary, blueprint §7);
 * - the provisioned stub of apps/functions/src/adapters/
 *   firestore-user-repository.spec.ts.
 */

const STRATEGY: AuthStrategy = unwrapOk(
  AuthStrategy.parse({
    authStrategyKind: AuthStrategyKind.EmailOtp,
    required: [
      RegistrationField.Phone,
      RegistrationField.FirstName,
      RegistrationField.LastName,
    ],
    policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
  }),
);

const TENANT = TenantId.of('creativo');

function fields(given: Partial<RegistrationFields>): RegistrationFields {
  return { ...Registration.emptyFields(), ...given };
}

/** The `{ email, phone }` stub `verifyOtp` provisions — no profile yet. */
function stub(
  overrides: Partial<RegistrationStanding> = {},
): RegistrationStanding {
  return {
    registrationState: RegistrationState.Provisioned,
    roles: [],
    email: null,
    phone: E164.of('+14155552671'),
    birthDate: null,
    ...overrides,
  };
}

/** A registered body, as a re-run of the callable finds it. */
function registered(
  overrides: Partial<RegistrationStanding> = {},
): RegistrationStanding {
  return stub({
    registrationState: RegistrationState.Registered,
    roles: [Role.Client],
    ...overrides,
  });
}

describe('RegistrationSystem — the field check (register-user.use-case.spec.ts)', () => {
  const email = ParsedIdentifier.email(Email.of('client@example.com'));
  const effective = (given: Partial<RegistrationFields>) =>
    RegistrationSystem.effectiveFields(
      email.identifierChannel,
      email.identifier,
      fields(given),
    );

  it('completes registration once every required field is present', () => {
    expect(
      RegistrationSystem.missingField(
        STRATEGY,
        effective({
          phone: '+359881234567',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      ),
    ).toBeNull();
  });

  it('rejects when a required field is missing, without calling the client', () => {
    expect(
      RegistrationSystem.missingField(
        STRATEGY,
        effective({ phone: '+359881234567', firstName: 'Jane' }),
      ),
    ).toBe(RegistrationField.LastName);
  });

  it('forwards an optional birthDate the strategy does not require', () => {
    const forwarded = effective({
      phone: '+359881234567',
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1990-07-03',
    });
    expect(RegistrationSystem.missingField(STRATEGY, forwarded)).toBeNull();
    expect(forwarded.birthDate).toBe('1990-07-03');
  });

  it('still succeeds without birthDate — it is never a required field of the default strategy', () => {
    const forwarded = effective({
      phone: '+359881234567',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(RegistrationSystem.missingField(STRATEGY, forwarded)).toBeNull();
    expect(forwarded.birthDate).toBeNull();
  });

  it('treats the identifier itself as satisfying its own required field, even when the caller never resupplies it', () => {
    const phoneStrategy = unwrapOk(
      AuthStrategy.parse({
        authStrategyKind: AuthStrategyKind.PhoneOtp,
        required: [
          RegistrationField.Phone,
          RegistrationField.FirstName,
          RegistrationField.LastName,
        ],
        policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
      }),
    );
    const phone = ParsedIdentifier.phone(E164.of('+14155552671'));
    // No `phone` key in `fields` — the about step never re-collects the
    // number that was just used to sign in.
    const forwarded = RegistrationSystem.effectiveFields(
      phone.identifierChannel,
      phone.identifier,
      fields({ firstName: 'Ada', lastName: 'Lovelace' }),
    );
    expect(
      RegistrationSystem.missingField(phoneStrategy, forwarded),
    ).toBeNull();
    expect(forwarded.phone).toBe('+14155552671');
  });

  it('keeps a field the form DID send, even blank — and a blank required field is missing', () => {
    const forwarded = RegistrationSystem.effectiveFields(
      IdentifierChannel.Phone,
      '+14155552671',
      fields({ phone: '  ', firstName: 'Ada', lastName: 'Lovelace' }),
    );
    expect(forwarded.phone).toBe('  ');
    expect(RegistrationSystem.missingField(STRATEGY, forwarded)).toBe(
      RegistrationField.Phone,
    );
  });
});

describe('RegistrationSystem — complete-registration.use-case.spec.ts', () => {
  const byPhone = (given: Partial<RegistrationFields>) =>
    RegistrationSystem.effectiveFields(
      IdentifierChannel.Phone,
      '+14155552671',
      fields(given),
    );

  it('fills in the required profile fields and promotes claims to active', () => {
    const settled = RegistrationSystem.settle(
      stub(),
      byPhone({ firstName: 'Ada', lastName: 'Lovelace' }),
      null,
    );
    expect(settled).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+14155552671',
      email: null,
      birthDate: null,
      roles: [Role.Client],
    });
    expect(
      RegistrationSystem.claimsFor(
        RegistrationState.Registered,
        settled.roles,
        TENANT,
      ),
    ).toEqual({
      tenantId: TENANT,
      authStage: AuthStage.Active,
      roles: [Role.Client],
    });
  });

  it('rejects when a required field (e.g. lastName) is missing', () => {
    expect(
      RegistrationSystem.missingField(STRATEGY, byPhone({ firstName: 'Ada' })),
    ).toBe(RegistrationField.LastName);
  });

  it('persists a valid optional birthDate on the user document', () => {
    expect(
      RegistrationSystem.settle(
        stub(),
        byPhone({
          firstName: 'Ada',
          lastName: 'Lovelace',
          birthDate: '1990-07-03',
        }),
        BirthDate.of('1990-07-03'),
      ).birthDate,
    ).toBe('1990-07-03');
  });

  it('registers exactly as before when birthDate is absent — nothing persisted, nothing rejected', () => {
    expect(
      RegistrationSystem.settle(
        stub(),
        byPhone({ firstName: 'Ada', lastName: 'Lovelace' }),
        null,
      ).birthDate,
    ).toBeNull();
  });

  it('takes the channel the login did not verify from the form on a first registration', () => {
    const settled = RegistrationSystem.settle(
      stub({ email: Email.of('ada@example.com'), phone: null }),
      RegistrationSystem.effectiveFields(
        IdentifierChannel.Email,
        'ada@example.com',
        fields({
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: '+14155552671',
        }),
      ),
      null,
    );
    expect(settled).toMatchObject({
      email: 'ada@example.com',
      phone: '+14155552671',
      roles: [Role.Client],
    });
  });

  describe('a re-run keeps what the server granted', () => {
    const rerun = byPhone({ firstName: 'Ada', lastName: 'Lovelace' });
    const user = (
      standing: RegistrationStanding,
      lifecycle: AccountLifecycle,
    ): User => ({
      id: UserId.of('uid_1'),
      firstName: 'Ada',
      lastName: 'Lovelace',
      profileEditedAtUtcMs: null,
      ...lifecycle,
      searchName: 'ada lovelace',
      searchPrefixes: [],
      ...standing,
    });
    const paused = AccountLifecycle.block(
      BlockReason.Manual,
      utcMs('2026-12-01T00:00:00Z'),
    );

    function reregister(
      standing: RegistrationStanding,
      lifecycle: AccountLifecycle,
    ) {
      const settled = RegistrationSystem.settle(standing, rerun, null);
      return RegistrationSystem.register(user(standing, lifecycle), {
        firstName: settled.firstName,
        lastName: settled.lastName,
        phone: E164.of(settled.phone),
        email: settled.email === null ? null : Email.of(settled.email),
        birthDate: settled.birthDate,
        roles: settled.roles,
      });
    }

    it('keeps a paused status — calling the callable again never lifts a pause', () => {
      expect(reregister(registered(), paused)).toMatchObject(paused);
    });

    it('keeps the pause even when the stored first name was blanked', () => {
      // Reads as UNregistered, yet the status there was still written by
      // the server.
      expect(reregister(stub({ roles: [Role.Client] }), paused)).toMatchObject(
        paused,
      );
    });

    it('keeps staff roles and mints them, never a demoting plain client', () => {
      const standing = registered({ roles: [Role.Barber, Role.Receptionist] });
      const settled = RegistrationSystem.settle(standing, rerun, null);
      expect(settled.roles).toEqual([Role.Barber, Role.Receptionist]);
      expect(
        RegistrationSystem.claimsFor(
          standing.registrationState,
          standing.roles,
          TENANT,
        ),
      ).toEqual({
        tenantId: TENANT,
        authStage: AuthStage.Active,
        roles: [Role.Barber, Role.Receptionist],
      });
    });

    it('never changes a registered contact channel — those move only through a verified contact change', () => {
      const standing = registered({ email: Email.of('ada@example.com') });
      const byPhoneRun = RegistrationSystem.settle(
        standing,
        byPhone({
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'mallory@example.com',
        }),
        null,
      );
      expect(byPhoneRun.email).toBe('ada@example.com');

      const byEmailRun = RegistrationSystem.settle(
        standing,
        RegistrationSystem.effectiveFields(
          IdentifierChannel.Email,
          'ada@example.com',
          fields({
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+14155550999',
          }),
        ),
        null,
      );
      expect(byEmailRun.phone).toBe('+14155552671');
    });
  });

  it('a blank form e-mail falls back to the stored one; absent names and an unsent phone settle as empty text', () => {
    // A first registration takes the phone from the form only — the stub's
    // own number arrives through `effectiveFields` when it is the login.
    const settled = RegistrationSystem.settle(
      stub({ email: Email.of('ada@example.com') }),
      fields({ email: '   ' }),
      null,
    );
    expect(settled).toMatchObject({
      email: 'ada@example.com',
      firstName: '',
      lastName: '',
      phone: '',
    });
    // A registered document without a phone takes the form's.
    expect(
      RegistrationSystem.settle(
        registered({ phone: null }),
        fields({ phone: ' +14155550999 ' }),
        null,
      ).phone,
    ).toBe('+14155550999');
  });
});

describe('RegistrationSystem — the sign-in claims and the stub (verify-otp.use-case.spec.ts)', () => {
  it('mints onboarding claims for a freshly provisioned user, and provisions the login channel only', () => {
    const provisioned = RegistrationSystem.provision(
      UserId.of('uid_1'),
      ParsedIdentifier.email(Email.of('client@example.com')),
    );
    expect(provisioned).toMatchObject({
      email: 'client@example.com',
      phone: null,
      registrationState: RegistrationState.Provisioned,
      roles: [],
      firstName: null,
      searchPrefixes: [],
    });
    expect(
      RegistrationSystem.claimsFor(
        provisioned.registrationState,
        provisioned.roles,
        TENANT,
      ),
    ).toEqual({ tenantId: TENANT, authStage: AuthStage.Onboarding, roles: [] });
  });

  it('mints the STORED roles for a staff account — the out-of-band grant finally reaches the token', () => {
    expect(
      RegistrationSystem.claimsFor(
        RegistrationState.Registered,
        [Role.Barber, Role.Admin],
        TENANT,
      ).roles,
    ).toEqual([Role.Barber, Role.Admin]);
  });

  it('falls back to client claims when the doc carries no roles — a stub or pre-roles record never escalates', () => {
    expect(
      RegistrationSystem.claimsFor(RegistrationState.Registered, [], TENANT),
    ).toEqual({
      tenantId: TENANT,
      authStage: AuthStage.Active,
      roles: [Role.Client],
    });
  });
});

describe('RegistrationSystem.provision (firestore-user-repository.spec.ts)', () => {
  it('provisions a contact-channel stub — unregistered, every key present', () => {
    expect(
      RegistrationSystem.provision(
        UserId.of('uid_2'),
        ParsedIdentifier.phone(E164.of('+14155552671')),
      ),
    ).toEqual({
      id: 'uid_2',
      registrationState: RegistrationState.Provisioned,
      phone: '+14155552671',
      firstName: null,
      lastName: null,
      roles: [],
      accountStatus: AccountStatus.Active,
      email: null,
      birthDate: null,
      profileEditedAtUtcMs: null,
      searchName: null,
      searchPrefixes: [],
    });
  });

  it('writes the registered body with the search keys of the new names and channels', () => {
    const stubUser = RegistrationSystem.provision(
      UserId.of('uid_1'),
      ParsedIdentifier.email(Email.of('client@example.com')),
    );
    const body = RegistrationSystem.register(stubUser, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: E164.of('+14155552671'),
      email: Email.of('client@example.com'),
      birthDate: BirthDate.of('1990-07-03'),
      roles: [Role.Client],
    });
    expect(body.registrationState).toBe(RegistrationState.Registered);
    expect(body.searchName).toBe('ada lovelace');
    expect(body.searchPrefixes).toEqual(
      SearchFieldsSystem.searchFields(
        'Ada',
        'Lovelace',
        E164.of('+14155552671'),
        'client@example.com',
      ).searchPrefixes,
    );
    expect(body.accountStatus).toBe(AccountStatus.Active);
  });
});

describe('RegistrationSystem.adoptStub — verifyOtp’s tx-2 decision (F2-9)', () => {
  const UID = UserId.of('uid_auth');
  const PHONE = ParsedIdentifier.phone(E164.of('+359888123456'));
  const EMAIL = ParsedIdentifier.email(Email.of('client@example.com'));

  it('absent → the stub of the login channel, to create', () => {
    expect(RegistrationSystem.adoptStub(null, UID, PHONE)).toEqual({
      ok: true,
      value: {
        user: RegistrationSystem.provision(UID, PHONE),
        createStub: true,
      },
    });
  });

  it('a PROVISIONED stub of THIS destination → adopted as read, nothing to write (the race’s winner, or an orphan Auth user’s stub)', () => {
    const phoneStub = RegistrationSystem.provision(UID, PHONE);
    expect(RegistrationSystem.adoptStub(phoneStub, UID, PHONE)).toEqual({
      ok: true,
      value: { user: phoneStub, createStub: false },
    });
    const emailStub = RegistrationSystem.provision(UID, EMAIL);
    const adopted = unwrapOk(
      RegistrationSystem.adoptStub(emailStub, UID, EMAIL),
    );
    expect(adopted.user).toBe(emailStub);
    expect(adopted.createStub).toBe(false);
  });

  it('a REGISTERED account → IDENTITY_OTP_ACCOUNT_CONFLICT, never signed into — whatever its contact', () => {
    const registeredUser: User = {
      ...RegistrationSystem.provision(UID, PHONE),
      registrationState: RegistrationState.Registered,
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: [Role.Client],
    };
    expect(RegistrationSystem.adoptStub(registeredUser, UID, PHONE)).toEqual({
      ok: false,
      error: { errorCode: 'IDENTITY_OTP_ACCOUNT_CONFLICT' },
    });
  });

  it('a stub carrying another contact → IDENTITY_OTP_ACCOUNT_CONFLICT: another phone, or the e-mail channel where the phone was asked', () => {
    const otherPhone = RegistrationSystem.provision(
      UID,
      ParsedIdentifier.phone(E164.of('+359888000000')),
    );
    expect(RegistrationSystem.adoptStub(otherPhone, UID, PHONE)).toEqual({
      ok: false,
      error: { errorCode: 'IDENTITY_OTP_ACCOUNT_CONFLICT' },
    });
    const emailOnly = RegistrationSystem.provision(UID, EMAIL);
    expect(RegistrationSystem.adoptStub(emailOnly, UID, PHONE).ok).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const stub = deepFreeze(RegistrationSystem.provision(UID, PHONE));
    const parsed = deepFreeze({ ...PHONE });
    const once = RegistrationSystem.adoptStub(stub, UID, parsed);
    expect(RegistrationSystem.adoptStub(stub, UID, parsed)).toEqual(once);
    expect(RegistrationSystem.adoptStub(null, UID, parsed)).toEqual(
      RegistrationSystem.adoptStub(null, UID, parsed),
    );
    expect(stub).toEqual(RegistrationSystem.provision(UID, PHONE));
  });
});

describe('RegistrationField vocabulary (registration-field.spec.ts)', () => {
  it('accepts every known field', () => {
    for (const field of [
      'phone',
      'email',
      'firstName',
      'lastName',
      'birthDate',
    ]) {
      expect(Registration.isField(field)).toBe(true);
    }
    expect(RegistrationSystem.fieldOf(IdentifierChannel.Phone)).toBe('phone');
    expect(RegistrationSystem.fieldOf(IdentifierChannel.Email)).toBe('email');
  });

  it('rejects an unknown value', () => {
    expect(Registration.isField('middleName')).toBe(false);
    expect(Registration.isField(123)).toBe(false);
    expect(Registration.isField(undefined)).toBe(false);
  });
});

describe('RegistrationSystem properties', () => {
  const anyValue = fc.option(fc.constantFrom('', '  ', 'x', ' Ada '), {
    nil: null,
  });
  const anyFields = fc
    .tuple(anyValue, anyValue, anyValue, anyValue, anyValue)
    .map(
      ([phone, email, firstName, lastName, birthDate]): RegistrationFields => ({
        phone,
        email,
        firstName,
        lastName,
        birthDate,
      }),
    );

  it('missingField is the first required field that is absent or blank — brute force over the order', () => {
    fc.assert(
      fc.property(anyFields, (given) => {
        const brute =
          STRATEGY.required.find(
            // eslint-disable-next-line security/detect-object-injection -- `field` is a RegistrationField literal off the parsed strategy.
            (field) => (given[field] ?? '').trim().length === 0,
          ) ?? null;
        expect(RegistrationSystem.missingField(STRATEGY, given)).toBe(brute);
      }),
    );
  });

  it('effective fields change only the login channel field, and only when it was absent', () => {
    fc.assert(
      fc.property(anyFields, (given) => {
        const out = RegistrationSystem.effectiveFields(
          IdentifierChannel.Email,
          'a@b.cd',
          given,
        );
        for (const field of Registration.FIELDS) {
          if (field === RegistrationField.Email) {
            expect(out.email).toBe(given.email ?? 'a@b.cd');
          } else {
            // eslint-disable-next-line security/detect-object-injection -- `field` iterates the RegistrationField dictionary.
            expect(out[field]).toBe(given[field]);
          }
        }
      }),
    );
  });
});

describe('RegistrationSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const standing = deepFreeze(registered({ roles: [Role.Barber] }));
    const given = deepFreeze(fields({ firstName: ' Ada ', lastName: 'L' }));
    const run = () => ({
      effective: RegistrationSystem.effectiveFields(
        IdentifierChannel.Phone,
        '+14155552671',
        given,
      ),
      missing: RegistrationSystem.missingField(STRATEGY, given),
      settled: RegistrationSystem.settle(standing, given, null),
      claims: RegistrationSystem.claimsFor(
        standing.registrationState,
        standing.roles,
        TENANT,
      ),
    });
    expect(run()).toEqual(run());
    expect(standing).toEqual(registered({ roles: [Role.Barber] }));
    expect(given).toEqual(fields({ firstName: ' Ada ', lastName: 'L' }));
  });
});
