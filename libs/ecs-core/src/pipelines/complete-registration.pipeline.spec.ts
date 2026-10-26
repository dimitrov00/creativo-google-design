import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  AccountStatus,
  AuthClaims,
  AuthDeployment,
  type BirthDate,
  BlockReason,
  CustomerOrigin,
  type DocBody,
  E164,
  Email,
  ParsedIdentifier,
  Registration,
  RegistrationState,
  type RegistrationFields,
  Role,
  WriteOp,
} from '@core/components';
import {
  IdentifierChannel,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  AccountsErrorCode,
  CompleteRegistrationRefusalCode,
  IdentityErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryErrorCode,
} from '@core/errors';
import { Collections, type Customer, type User } from '@core/entities';
import type { AuthAdminPorts, CommitPlan, UserLookupPorts } from '@core/ports';
import {
  AuditSystem,
  RegistrationSystem,
  SearchFieldsSystem,
} from '@core/systems';
import {
  customerOf,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TENANT_ID,
  fixedTenantPorts,
  type IdentityWorld,
  memoryAuthAdminPorts,
  memoryIdentityWorld,
  memoryTxPorts,
  memoryUserLookupPorts,
  recordingTelemetry,
  registeredUserFixture,
  unwrapOk,
} from '@core/testing';
import {
  type CompleteRegistrationCommand,
  completeRegistration,
} from './complete-registration.pipeline';

/*
 * `completeRegistration` (identity flip (2), F2-7b, F2-8): the strategy's
 * fields, the birthday on the UTC day, the identifier, then not-found vs
 * not-yours OUTSIDE; inside ONE transaction the account and its client
 * record are read in one `getAll`, the profile settles on THAT read, and the
 * plan is one `Set` of the flat registered body plus the `REGISTRATION`
 * record when it is absent. Every case the deleted use-case spec held, plus
 * the flip's own.
 */

const UID = UserId.of('uid_1');
const PHONE = E164.of('+14155552671');
const USER_PATH = [Collections.Users, UID];
const CUSTOMER_PATH = [Collections.Customers, customerOf(UID)];

/** The contact-channel stub `verifyOtp` provisions — no profile fields yet. */
function phoneStub(uid: UserId = UID): User {
  return RegistrationSystem.provision(uid, ParsedIdentifier.phone(PHONE));
}

function fields(
  submitted: Partial<Record<keyof RegistrationFields, string>>,
): RegistrationFields {
  return { ...Registration.emptyFields(), ...submitted };
}

const byPhone = (
  submitted: Partial<Record<keyof RegistrationFields, string>>,
  callerUserId: UserId = UID,
): CompleteRegistrationCommand => ({
  callerUserId,
  identifierChannel: IdentifierChannel.Phone,
  rawIdentifier: PHONE,
  fields: fields(submitted),
  operationId: null,
});

const ADA = { firstName: 'Ada', lastName: 'Lovelace' } as const;

type Rig = {
  readonly world: IdentityWorld;
  readonly auth?: Partial<AuthAdminPorts>;
  readonly lookup?: Partial<UserLookupPorts>;
  readonly commit?: (inner: CommitPlan) => CommitPlan;
};

function rig(options: Rig) {
  const tx = memoryTxPorts(options.world.store);
  const telemetry = recordingTelemetry();
  const run = completeRegistration({
    commit:
      options.commit === undefined ? tx.commit : options.commit(tx.commit),
    nowUtcMs: tx.nowUtcMs,
    hash: tx.hash,
    ...memoryUserLookupPorts(options.world),
    ...options.lookup,
    ...fixedTenantPorts(),
    ...memoryAuthAdminPorts(options.world),
    ...options.auth,
    authDeployment: AuthDeployment.DEFAULT,
    log: telemetry.log,
    trackError: telemetry.trackError,
  });
  return { tx, telemetry, run };
}

/** A stored body by path — the entity minus `id`. */
function stored(world: IdentityWorld, path: readonly string[]) {
  return world.store.get(path.join('/'));
}

function bodyOf(entity: { readonly id: string }): DocBody {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** What the stub registered as Ada leaves — the system's own body. */
function registeredAda(
  overrides: Partial<{
    readonly email: Email | null;
    readonly birthDate: BirthDate | null;
  }> = {},
): User {
  return RegistrationSystem.register(phoneStub(), {
    ...ADA,
    phone: PHONE,
    email: overrides.email ?? null,
    birthDate: overrides.birthDate ?? null,
    roles: [Role.Client],
  });
}

const minted = (world: IdentityWorld) =>
  world.minted.map(({ uid, claims }) => ({ uid, claims }));

const CLIENT_CLAIMS = unwrapOk(
  AuthClaims.active(FIXTURE_TENANT_ID, [Role.Client]),
);

describe('completeRegistration', () => {
  it('fills in the required profile fields and promotes claims to active — ONE Set of the flat body, the REGISTRATION record beside it', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { tx, run } = rig({ world });
    expect(await run(byPhone(ADA))).toEqual({
      ok: true,
      value: { customToken: 'token:uid_1:1' },
    });
    const registered = registeredAda();
    const record: Omit<Customer, 'id'> = {
      userId: UID,
      displayName: 'Ada Lovelace',
      phone: PHONE,
      email: null,
      ...SearchFieldsSystem.searchFields('Ada', 'Lovelace', PHONE, null),
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.Registration,
    };
    expect(tx.plans).toEqual([
      [
        WriteOp.set(USER_PATH, bodyOf(registered)),
        WriteOp.create(CUSTOMER_PATH, record),
      ],
    ]);
    expect(stored(world, USER_PATH)).toEqual({
      registrationState: RegistrationState.Registered,
      phone: PHONE,
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: [Role.Client],
      accountStatus: AccountStatus.Active,
      email: null,
      birthDate: null,
      profileEditedAtUtcMs: null,
      searchName: registered.searchName,
      searchPrefixes: registered.searchPrefixes,
    });
    expect(stored(world, CUSTOMER_PATH)).toEqual(record);
    expect(minted(world)).toEqual([{ uid: UID, claims: CLIENT_CLAIMS }]);
    expect(world.displayNames.get(UID)).toBe('Ada Lovelace');
  });

  it('reads the account AND its client record in ONE getAll inside the transaction', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { tx, run } = rig({ world });
    await run(byPhone(ADA));
    expect(tx.transactions[0]?.reads).toEqual([USER_PATH, CUSTOMER_PATH]);
  });

  it('changes exactly the audited fields today’s registered `set` changes over the stub — the roles it sets included (WS-3, DEP-13)', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const before = { ...(stored(world, USER_PATH) ?? {}) };
    await rig({ world }).run(byPhone(ADA));
    expect(
      AuditSystem.changedProfileFields(before, stored(world, USER_PATH) ?? {}),
    ).toEqual(['firstName', 'lastName', 'roles']);
    // The registration row's role tags: from the stub's empty list to the client role.
    expect(
      AuditSystem.profileTagDelta(before, stored(world, USER_PATH) ?? {}),
    ).toEqual({
      profileRolesFrom: [],
      profileRolesTo: ['client'],
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
    });

    const withMore = memoryIdentityWorld({ users: [phoneStub()] });
    const stub = { ...(stored(withMore, USER_PATH) ?? {}) };
    await rig({ world: withMore }).run(
      byPhone({ ...ADA, email: 'ada@example.com', birthDate: '1990-07-03' }),
    );
    expect(
      AuditSystem.changedProfileFields(stub, stored(withMore, USER_PATH) ?? {}),
    ).toEqual(['firstName', 'lastName', 'email', 'birthDate', 'roles']);
  });

  it('lands a spaced login phone and a mixed-case form e-mail as E.164 and lower-case — in users and in the record', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { run } = rig({ world });
    const answer = await run({
      ...byPhone({ ...ADA, email: '  Ada@Example.COM ' }),
      rawIdentifier: '+1 415 555 2671',
    });
    expect(answer.ok).toBe(true);
    expect(stored(world, USER_PATH)).toMatchObject({
      phone: '+14155552671',
      email: 'ada@example.com',
    });
    expect(stored(world, CUSTOMER_PATH)).toMatchObject({
      phone: '+14155552671',
      email: 'ada@example.com',
    });
  });

  it('rejects when a required field (e.g. lastName) is missing — nothing minted, nothing written', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { tx, run } = rig({ world });
    expect(await run(byPhone({ firstName: 'Ada' }))).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.RegistrationFieldMissing,
        field: 'lastName',
      },
    });
    expect(tx.transactions).toEqual([]);
    expect(world.minted).toEqual([]);
  });

  it('counts a blank required field as missing', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const answer = await rig({ world }).run(
      byPhone({ firstName: 'Ada', lastName: '   ' }),
    );
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: IdentityErrorCode.RegistrationFieldMissing,
      field: 'lastName',
    });
  });

  it('rejects when no provisioned user exists for the identifier', async () => {
    const world = memoryIdentityWorld();
    const { tx, run } = rig({ world });
    expect(await run(byPhone(ADA))).toEqual({
      ok: false,
      error: { errorCode: IdentityErrorCode.RegistrationUserNotFound },
    });
    expect(tx.transactions).toEqual([]);
  });

  it('answers not-found when the account vanished between the lookup and the transaction', async () => {
    const world = memoryIdentityWorld();
    const { tx, run } = rig({
      world,
      lookup: {
        findUserByDestination: async () => Result.ok(phoneStub()),
      },
    });
    expect(await run(byPhone(ADA))).toEqual({
      ok: false,
      error: { errorCode: IdentityErrorCode.RegistrationUserNotFound },
    });
    expect(tx.plans).toEqual([]);
  });

  it('persists a valid optional birthDate on the user document', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const answer = await rig({ world }).run(
      byPhone({ ...ADA, birthDate: '1990-07-03' }),
    );
    expect(answer.ok).toBe(true);
    expect(stored(world, USER_PATH)?.['birthDate']).toBe('1990-07-03');
  });

  it('registers exactly as before when birthDate is absent — nothing persisted, nothing rejected', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const answer = await rig({ world }).run(byPhone(ADA));
    expect(answer.ok).toBe(true);
    expect(stored(world, USER_PATH)?.['birthDate']).toBeNull();
    expect(world.minted).toHaveLength(1);
  });

  it('rejects an invalid birthDate with the typed, reason-carrying error — nothing minted, nothing saved', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { tx, run } = rig({ world });
    for (const [birthDate, errorCode] of [
      ['2030-01-01', IdentityErrorCode.BirthDateInFuture],
      ['1990-02-30', IdentityErrorCode.BirthDateInvalid],
      ['03.07.1990', IdentityErrorCode.BirthDateInvalid],
      ['2020-01-01', IdentityErrorCode.BirthDateTooYoung],
    ] as const) {
      const answer = await run(byPhone({ ...ADA, birthDate }));
      expect(!answer.ok && answer.error.errorCode, birthDate).toBe(errorCode);
    }
    expect(world.minted).toEqual([]);
    expect(tx.transactions).toEqual([]);
    expect(stored(world, USER_PATH)?.['firstName']).toBeNull();
  });

  it('judges the age window on the UTC civil date of the clock', async () => {
    // FIXTURE_NOW is 2026-09-28T06:00Z: a sixteenth birthday that day is old enough.
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const ok = await rig({ world }).run(
      byPhone({ ...ADA, birthDate: '2010-09-28' }),
    );
    expect(ok.ok).toBe(true);
    const young = await rig({
      world: memoryIdentityWorld({ users: [phoneStub()] }),
    }).run(byPhone({ ...ADA, birthDate: '2010-09-29' }));
    expect(!young.ok && young.error.errorCode).toBe(
      IdentityErrorCode.BirthDateTooYoung,
    );
  });

  it('refuses an identifier that does not parse on its channel', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const answer = await rig({ world }).run({
      ...byPhone(ADA),
      rawIdentifier: 'not a phone',
    });
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: IdentityErrorCode.IdentifierInvalid,
      identifierKind: IdentifierChannel.Phone,
    });
  });

  it("refuses to complete a registration the caller's uid does not own", async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { tx, run } = rig({ world });
    expect(
      await run(
        byPhone(
          { firstName: 'Mallory', lastName: 'Intruder' },
          UserId.of('uid_someone_else'),
        ),
      ),
    ).toEqual({
      ok: false,
      error: { errorCode: IdentityErrorCode.RegistrationForbidden },
    });
    // Nothing minted, nothing overwritten — the stub stays for its owner.
    expect(tx.transactions).toEqual([]);
    expect(world.minted).toEqual([]);
    expect(stored(world, USER_PATH)?.['firstName']).toBeNull();
  });

  it('refuses the settled profile as ONE aggregate, every refusal collected in today’s order — nothing written', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const { tx, run } = rig({ world });
    const answer = await run(
      byPhone({ firstName: 'A', lastName: 'B', email: 'not-an-email' }),
    );
    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: CompleteRegistrationRefusalCode.ProfileInvalid,
        errors: [
          {
            errorCode: AccountsErrorCode.FirstNameTooShort,
            attempted: 'A',
            minLength: 2,
          },
          {
            errorCode: AccountsErrorCode.LastNameTooShort,
            attempted: 'B',
            minLength: 2,
          },
          {
            errorCode: AccountsErrorCode.EmailInvalid,
            attempted: 'not-an-email',
          },
        ],
      },
    });
    expect(tx.plans).toEqual([]);
    expect(world.minted).toEqual([]);
  });

  it('takes the channel the login did not verify from the form on a first registration', async () => {
    const mailStub = RegistrationSystem.provision(
      UID,
      ParsedIdentifier.email(Email.of('ada@example.com')),
    );
    const world = memoryIdentityWorld({ users: [mailStub] });
    const answer = await rig({ world }).run({
      callerUserId: UID,
      identifierChannel: IdentifierChannel.Email,
      rawIdentifier: 'ada@example.com',
      fields: fields({ ...ADA, phone: '+14155552671' }),
      operationId: null,
    });
    expect(answer.ok).toBe(true);
    expect(stored(world, USER_PATH)).toMatchObject({
      email: 'ada@example.com',
      phone: '+14155552671',
      roles: [Role.Client],
      accountStatus: AccountStatus.Active,
    });
  });

  it('logs and ignores a failed display-name write — the registration still completes', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const down = PipelineError.bare(PipelineErrorCode.Unavailable);
    const { telemetry, run } = rig({
      world,
      auth: { setDisplayName: async () => Result.err(down) },
    });
    expect((await run(byPhone(ADA))).ok).toBe(true);
    expect(world.minted).toHaveLength(1);
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: 'registration.display_name_failed',
        fields: { uid: UID, errorCode: PipelineErrorCode.Unavailable },
      },
    ]);
  });

  it('answers a mint failure as itself, after the registration committed', async () => {
    const world = memoryIdentityWorld({ users: [phoneStub()] });
    const down = PipelineError.bare(PipelineErrorCode.Unknown);
    const { run } = rig({
      world,
      auth: { mintCustomToken: async () => Result.err(down) },
    });
    expect(await run(byPhone(ADA))).toEqual({ ok: false, error: down });
    expect(stored(world, USER_PATH)?.['firstName']).toBe('Ada');
  });

  describe('the client record (D29)', () => {
    it('creates no second record on a re-run, and writes the same body', async () => {
      const world = memoryIdentityWorld({ users: [phoneStub()] });
      const { tx, run } = rig({ world });
      await run(byPhone(ADA));
      const first = stored(world, USER_PATH);
      await run(byPhone(ADA));
      expect(tx.plans[1]).toEqual([WriteOp.set(USER_PATH, first ?? {})]);
      expect(stored(world, USER_PATH)).toEqual(first);
      expect(
        [...world.store.keys()].filter((key) =>
          key.startsWith(`${Collections.Customers}/`),
        ),
      ).toEqual([CUSTOMER_PATH.join('/')]);
    });

    it('leaves a FIRST_BOOKING record alone — no writer rewrites somebody’s record', async () => {
      const world = memoryIdentityWorld({ users: [phoneStub()] });
      const firstBooking = {
        userId: UID,
        displayName: 'Ada L.',
        phone: PHONE,
        email: null,
        searchName: 'ada l.',
        searchPrefixes: [],
        createdAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -86_400_000),
        customerOrigin: CustomerOrigin.FirstBooking,
      };
      world.store.set(CUSTOMER_PATH.join('/'), firstBooking);
      const { tx, run } = rig({ world });
      await run(byPhone(ADA));
      expect(tx.plans[0]).toHaveLength(1);
      expect(stored(world, CUSTOMER_PATH)).toEqual(firstBooking);
    });

    it('re-runs ONCE when the record Create meets ALREADY_EXISTS, and settles with the user Set alone', async () => {
      const world = memoryIdentityWorld({ users: [phoneStub()] });
      const winner = {
        userId: UID,
        displayName: 'Ada Lovelace',
        phone: PHONE,
        email: null,
        searchName: null,
        searchPrefixes: [],
        createdAtUtcMs: FIXTURE_NOW_UTC_MS,
        customerOrigin: CustomerOrigin.FirstBooking,
      };
      const { tx, run } = rig({
        world,
        commit: (inner) => {
          let calls = 0;
          const wrapped: CommitPlan = (read, decide) => {
            calls++;
            if (calls !== 1) return inner(read, decide);
            return inner(async (readTx) => {
              const snapshot = await read(readTx);
              world.store.set(CUSTOMER_PATH.join('/'), winner);
              return snapshot;
            }, decide);
          };
          return wrapped;
        },
      });
      expect((await run(byPhone(ADA))).ok).toBe(true);
      expect(tx.transactions).toHaveLength(2);
      expect(tx.plans).toEqual([
        [WriteOp.set(USER_PATH, bodyOf(registeredAda()))],
      ]);
      expect(stored(world, CUSTOMER_PATH)).toEqual(winner);
    });

    it('answers a second lost record race as itself — never success', async () => {
      const world = memoryIdentityWorld({ users: [phoneStub()] });
      const key = CUSTOMER_PATH.join('/');
      const { run } = rig({
        world,
        commit: (inner) => {
          const wrapped: CommitPlan = (read, decide) =>
            inner(async (readTx) => {
              world.store.delete(key);
              const snapshot = await read(readTx);
              world.store.set(key, { userId: UID });
              return snapshot;
            }, decide);
          return wrapped;
        },
      });
      const answer = await run(byPhone(ADA));
      expect(!answer.ok && answer.error.errorCode).toBe(
        RepositoryErrorCode.AlreadyExists,
      );
      expect(world.minted).toEqual([]);
    });
  });

  describe('a re-run keeps what the server granted', () => {
    /** Ada, registered and blocked by the shop until 2026-12-01. */
    function blockedAda(overrides: Partial<User> = {}): User {
      return registeredUserFixture({
        id: UID,
        phone: PHONE,
        ...ADA,
        ...AccountLifecycle.block(
          BlockReason.Manual,
          UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 64 * 86_400_000),
        ),
        ...overrides,
      });
    }

    it('keeps a paused status — calling the callable again never lifts a pause', async () => {
      const paused = blockedAda();
      const world = memoryIdentityWorld({ users: [paused] });
      expect((await rig({ world }).run(byPhone(ADA))).ok).toBe(true);
      expect(stored(world, USER_PATH)).toMatchObject({
        accountStatus: paused.accountStatus,
        blockReason: BlockReason.Manual,
        blockedUntilUtcMs: UtcEpochMs.plusMs(
          FIXTURE_NOW_UTC_MS,
          64 * 86_400_000,
        ),
      });
    });

    it('keeps the pause even when the stored first name was blanked', async () => {
      const world = memoryIdentityWorld({
        users: [blockedAda({ firstName: '  ' })],
      });
      expect((await rig({ world }).run(byPhone(ADA))).ok).toBe(true);
      expect(stored(world, USER_PATH)).toMatchObject({
        firstName: 'Ada',
        accountStatus: AccountStatus.Blocked,
        blockReason: BlockReason.Manual,
      });
    });

    it('keeps staff roles and mints them, never a demoting plain client', async () => {
      const world = memoryIdentityWorld({
        users: [
          registeredUserFixture({
            id: UID,
            phone: PHONE,
            ...ADA,
            roles: [Role.Barber, Role.Receptionist],
          }),
        ],
      });
      expect((await rig({ world }).run(byPhone(ADA))).ok).toBe(true);
      expect(stored(world, USER_PATH)?.['roles']).toEqual([
        Role.Barber,
        Role.Receptionist,
      ]);
      expect(minted(world)).toEqual([
        {
          uid: UID,
          claims: unwrapOk(
            AuthClaims.active(FIXTURE_TENANT_ID, [
              Role.Barber,
              Role.Receptionist,
            ]),
          ),
        },
      ]);
    });

    it('never changes a registered contact channel — those move only through a verified contact change', async () => {
      const world = memoryIdentityWorld({
        users: [
          registeredUserFixture({
            id: UID,
            phone: PHONE,
            ...ADA,
            email: Email.of('ada@example.com'),
          }),
        ],
      });
      const viaPhone = await rig({ world }).run(
        byPhone({ ...ADA, email: 'mallory@example.com' }),
      );
      expect(viaPhone.ok).toBe(true);
      expect(stored(world, USER_PATH)?.['email']).toBe('ada@example.com');

      const viaEmail = await rig({ world }).run({
        callerUserId: UID,
        identifierChannel: IdentifierChannel.Email,
        rawIdentifier: 'ada@example.com',
        fields: fields({ ...ADA, phone: '+14155550999' }),
        operationId: null,
      });
      expect(viaEmail.ok).toBe(true);
      expect(stored(world, USER_PATH)?.['phone']).toBe('+14155552671');
    });
  });
});
