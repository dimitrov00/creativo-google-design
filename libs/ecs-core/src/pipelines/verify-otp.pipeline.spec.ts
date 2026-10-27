import { describe, expect, it } from 'vitest';
import {
  AuthClaims,
  E164,
  Email,
  Identifier,
  OtpCode,
  OtpDestinationType,
  OtpRefusalReason,
  ParsedIdentifier,
  RegistrationState,
  Role,
  SessionKind,
  WriteOp,
} from '@core/components';
import {
  OperationId,
  OtpId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  IdentityErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import { Collections, type Otp } from '@core/entities';
import type {
  AuthAdminPorts,
  AuthUserLookupPorts,
  CommitPlan,
  NowUtcMs,
} from '@core/ports';
import {
  AuditSystem,
  IdentityAuditSystem,
  RegistrationSystem,
} from '@core/systems';
import {
  auditRowsOf,
  contendedCommit,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_OTP_CODE,
  FIXTURE_PHONE,
  FIXTURE_TENANT_ID,
  fixedOtpCryptoPorts,
  fixtureHash,
  type IdentityWorld,
  memoryAuthAdminPorts,
  memoryAuthUserLookupPorts,
  memoryIdentityWorld,
  memoryTxPorts,
  memoryUserLookupPorts,
  otpFixture,
  pinnedNowUtcMs,
  provisionedUserFixture,
  recordingTelemetry,
  registeredUserFixture,
  unwrapOk,
} from '@core/testing';
import { type VerifyOtpCommand, verifyOtp } from './verify-otp.pipeline';

/*
 * `verifyOtp` (identity flip (2), F2-9): tx 1 is the attempt and ALWAYS
 * commits its plan (a wrong code's increment included); the account is
 * looked up outside; a new identity's stub is created in tx 2 only when
 * absent, adopted only when it is a stub of this same contact, refused
 * otherwise; the claims come from the body the session signs into. Every
 * case the deleted use-case spec held, plus the flip's own. Audit-hardening
 * Phase 3 (P3-DEP-7): tx 1's state changes carry their sign-in rows
 * (VERIFIED, REFUSED) and a minted token its SESSION_ISSUED row, in one
 * more commit — the plan pins below include them on purpose.
 */

const OTP_ID = OtpId.of('otp-1');
const OTP_PATH = [Collections.Otps, OTP_ID];
const MAIL = Email.of('client@example.com');
const WRONG = OtpCode.of('000000');
const RIGHT = OtpCode.of(FIXTURE_OTP_CODE);

const command = (code: OtpCode = RIGHT): VerifyOtpCommand => ({
  otpId: OTP_ID,
  code,
  operationId: null,
});

/** The fixture challenge for the e-mail destination. */
const mailOtp = (overrides: Parameters<typeof otpFixture>[0] = {}) =>
  otpFixture({
    destination: Identifier.of(MAIL),
    otpDestinationType: OtpDestinationType.Email,
    ...overrides,
  });

type Rig = {
  readonly world: IdentityWorld;
  readonly nowUtcMs?: NowUtcMs;
  readonly auth?: Partial<AuthAdminPorts & AuthUserLookupPorts>;
  /** Wraps the commit port — a race scripted around a transaction. */
  readonly commit?: (inner: CommitPlan) => CommitPlan;
};

function rig(options: Rig) {
  const tx = memoryTxPorts(options.world.store, {
    nowUtcMs: options.nowUtcMs ?? pinnedNowUtcMs(),
  });
  const telemetry = recordingTelemetry();
  const run = verifyOtp({
    commit:
      options.commit === undefined ? tx.commit : options.commit(tx.commit),
    nowUtcMs: tx.nowUtcMs,
    hash: tx.hash,
    ...fixedOtpCryptoPorts(),
    ...memoryUserLookupPorts(options.world),
    ...memoryAuthUserLookupPorts(options.world),
    ...memoryAuthAdminPorts(options.world),
    ...options.auth,
    log: telemetry.log,
    trackError: telemetry.trackError,
  });
  return { tx, telemetry, run };
}

function bodyAt(world: IdentityWorld, path: readonly string[]) {
  return world.store.get(path.join('/'));
}

const later = (ms: number): NowUtcMs =>
  pinnedNowUtcMs(UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, ms));

/** The `IDENTITY_OTP_VERIFIED` Create a consumption plans — through the system's own planner. */
const verifiedRow = (consumed: Otp) =>
  AuditSystem.createsOf(
    [IdentityAuditSystem.planOtpVerified(consumed)],
    fixtureHash,
  );

describe('verifyOtp', () => {
  describe('tx 1 — the attempt', () => {
    it('consumes the challenge with ONE root-key Update on a correct code', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { tx, run } = rig({ world });
      expect((await run(command())).ok).toBe(true);
      expect(tx.plans[0]).toEqual([
        WriteOp.update(OTP_PATH, { consumedAtUtcMs: FIXTURE_NOW_UTC_MS }),
        ...verifiedRow(mailOtp({ consumedAtUtcMs: FIXTURE_NOW_UTC_MS })),
      ]);
      expect(bodyAt(world, OTP_PATH)).toMatchObject({
        consumedAtUtcMs: FIXTURE_NOW_UTC_MS,
        attemptCount: 0,
      });
    });

    it('rejects an incorrect code and increments attemptCount on the stored OTP — the plan COMMITS, the answer is the refusal', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { tx, run } = rig({ world });
      expect(await run(command(WRONG))).toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpWrongCode },
      });
      expect(tx.plans).toEqual([
        [
          WriteOp.update(OTP_PATH, { attemptCount: 1 }),
          ...AuditSystem.createsOf(
            [
              IdentityAuditSystem.planOtpRefused(
                mailOtp({ attemptCount: 1 }),
                OtpRefusalReason.WrongCode,
                FIXTURE_NOW_UTC_MS,
              ),
            ],
            fixtureHash,
          ),
        ],
      ]);
      expect(bodyAt(world, OTP_PATH)).toMatchObject({ attemptCount: 1 });
      expect(world.minted).toEqual([]);
      expect(world.authUsers).toEqual([]);
    });

    it('locks out after maxAttempts incorrect tries, even with the correct code', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { run } = rig({ world });
      for (let i = 0; i < 5; i++) {
        expect(unwrapErrCode(await run(command(WRONG)))).toBe(
          IdentityErrorCode.OtpWrongCode,
        );
      }
      expect(unwrapErrCode(await run(command()))).toBe(
        IdentityErrorCode.OtpLockedOut,
      );
      expect(bodyAt(world, OTP_PATH)).toMatchObject({
        attemptCount: 5,
        consumedAtUtcMs: null,
      });
      expect(world.minted).toEqual([]);
    });

    it('rejects an expired OTP — and writes nothing', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { tx, run } = rig({ world, nowUtcMs: later(10 * 60_000) });
      expect(unwrapErrCode(await run(command()))).toBe(
        IdentityErrorCode.OtpExpired,
      );
      expect(tx.plans).toEqual([[]]);
    });

    it('still verifies AT the expiry instant itself', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { run } = rig({ world, nowUtcMs: later(5 * 60_000) });
      expect((await run(command())).ok).toBe(true);
    });

    it('rejects reusing an already-consumed OTP', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { run } = rig({ world });
      expect((await run(command())).ok).toBe(true);
      expect(unwrapErrCode(await run(command()))).toBe(
        IdentityErrorCode.OtpAlreadyConsumed,
      );
      expect(world.minted).toHaveLength(1);
    });

    it('rejects an unknown otpId — nothing written, nobody provisioned', async () => {
      const world = memoryIdentityWorld();
      const { tx, run } = rig({ world });
      expect(await run(command())).toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpNotFound },
      });
      expect(tx.transactions[0]?.reads).toEqual([OTP_PATH]);
      expect(tx.plans).toEqual([[]]);
      expect(world.authUsers).toEqual([]);
    });

    it('answers a stored destination that no longer parses as corrupted, after consuming the challenge', async () => {
      const world = memoryIdentityWorld({
        otps: [mailOtp({ destination: Identifier.of('not-an-email') })],
      });
      const { run } = rig({ world });
      expect(unwrapErrCode(await run(command()))).toBe(
        IdentityErrorCode.OtpDestinationCorrupted,
      );
      expect(world.minted).toEqual([]);
    });
  });

  describe('a new identity — tx 2', () => {
    it('mints a client-role custom token on a correct code, provisioning a new user — the flat PROVISIONED stub, onboarding claims, NEW', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { tx, run } = rig({ world });
      const answer = await run(command());
      expect(answer).toEqual({
        ok: true,
        value: {
          customToken: 'token:auth-uid-1:1',
          sessionKind: SessionKind.New,
        },
      });
      const uid = UserId.of('auth-uid-1');
      const { id, ...stub } = RegistrationSystem.provision(
        uid,
        ParsedIdentifier.email(MAIL),
      );
      expect(tx.plans[1]).toEqual([
        WriteOp.create([Collections.Users, id], stub),
      ]);
      expect(bodyAt(world, [Collections.Users, uid])).toEqual(stub);
      expect(world.minted).toEqual([
        {
          uid,
          claims: AuthClaims.onboarding(FIXTURE_TENANT_ID),
          token: 'token:auth-uid-1:1',
        },
      ]);
    });

    it('provisions a phone destination by its E.164, the e-mail left null', async () => {
      const world = memoryIdentityWorld({ otps: [otpFixture()] });
      const { run } = rig({ world });
      expect((await run(command())).ok).toBe(true);
      expect(
        bodyAt(world, [Collections.Users, UserId.of('auth-uid-1')]),
      ).toMatchObject({
        registrationState: RegistrationState.Provisioned,
        phone: FIXTURE_PHONE,
        email: null,
      });
    });

    it('adopts an orphan Auth user (Auth holds the destination, no users doc) — the stub created, signed in, NEW', async () => {
      const orphan = UserId.of('orphan-uid');
      const world = memoryIdentityWorld({
        otps: [mailOtp()],
        authUsers: [{ uid: orphan, destination: ParsedIdentifier.email(MAIL) }],
      });
      const { run } = rig({ world });
      expect(unwrapOk(await run(command()))).toEqual({
        customToken: 'token:orphan-uid:1',
        sessionKind: SessionKind.New,
      });
      expect(bodyAt(world, [Collections.Users, orphan])).toMatchObject({
        registrationState: RegistrationState.Provisioned,
        email: MAIL,
      });
    });

    it('adopts a PROVISIONED stub of the same contact with NO write, minting from the read', async () => {
      const uid = UserId.of('stub-uid');
      const world = memoryIdentityWorld({
        otps: [mailOtp()],
        authUsers: [{ uid, destination: ParsedIdentifier.email(MAIL) }],
      });
      // The stub exists, but under a users query that cannot see it (the
      // stub of a concurrent first verification, committed after the lookup).
      const { tx, run } = rig({
        world,
        auth: {},
        commit: (inner) => {
          let calls = 0;
          const wrapped: CommitPlan = (read, decide) => {
            calls++;
            if (calls === 2) {
              const { id, ...stub } = RegistrationSystem.provision(
                uid,
                ParsedIdentifier.email(MAIL),
              );
              world.store.set(`${Collections.Users}/${id}`, stub);
            }
            return inner(read, decide);
          };
          return wrapped;
        },
      });
      expect(unwrapOk(await run(command())).sessionKind).toBe(SessionKind.New);
      expect(tx.plans[1]).toEqual([]);
      expect(world.minted[0]?.claims).toEqual(
        AuthClaims.onboarding(FIXTURE_TENANT_ID),
      );
    });

    it('refuses an adopted uid whose doc carries ANOTHER contact — nothing written, nothing minted', async () => {
      const uid = UserId.of('drifted-uid');
      const other = provisionedUserFixture({
        id: uid,
        phone: null,
        email: Email.of('someone@else.com'),
      });
      const world = memoryIdentityWorld({
        otps: [mailOtp()],
        authUsers: [{ uid, destination: ParsedIdentifier.email(MAIL) }],
        users: [other],
      });
      const { tx, telemetry, run } = rig({ world });
      expect(await run(command())).toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpAccountConflict },
      });
      expect(tx.plans).toHaveLength(1);
      const { id, ...body } = other;
      expect(bodyAt(world, [Collections.Users, id])).toEqual(body);
      expect(world.minted).toEqual([]);
      expect(telemetry.lines).toEqual([
        {
          level: 'warn',
          msg: 'otp.verify.adoption_refused',
          fields: { uid, errorCode: IdentityErrorCode.OtpAccountConflict },
        },
      ]);
    });

    it('refuses an adopted uid whose doc is REGISTERED — never a sign-in into someone else’s account', async () => {
      const uid = UserId.of('registered-uid');
      const world = memoryIdentityWorld({
        otps: [mailOtp()],
        authUsers: [{ uid, destination: ParsedIdentifier.email(MAIL) }],
        // Registered under another contact, so the users query misses it.
        users: [registeredUserFixture({ id: uid })],
      });
      const { run } = rig({ world });
      expect(unwrapErrCode(await run(command()))).toBe(
        IdentityErrorCode.OtpAccountConflict,
      );
      expect(world.minted).toEqual([]);
    });

    it('re-runs tx 2 ONCE when its stub Create meets ALREADY_EXISTS, and settles on the winner’s stub with no write', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { tx, run } = rig({
        world,
        commit: (inner) => {
          let calls = 0;
          const wrapped: CommitPlan = (read, decide) => {
            calls++;
            if (calls !== 2) return inner(read, decide);
            // The race: tx 2 reads absent, then the winner's stub lands.
            return inner(async (readTx) => {
              const snapshot = await read(readTx);
              const { id, ...stub } = RegistrationSystem.provision(
                UserId.of('auth-uid-1'),
                ParsedIdentifier.email(MAIL),
              );
              world.store.set(`${Collections.Users}/${id}`, stub);
              return snapshot;
            }, decide);
          };
          return wrapped;
        },
      });
      expect(unwrapOk(await run(command()))).toEqual({
        customToken: 'token:auth-uid-1:1',
        sessionKind: SessionKind.New,
      });
      // tx 1's Update and its row, then the re-run's empty plan — the
      // refused Create applied nothing — then the session row (P3-DEP-7).
      expect(tx.plans).toEqual([
        [
          WriteOp.update(OTP_PATH, { consumedAtUtcMs: FIXTURE_NOW_UTC_MS }),
          ...verifiedRow(mailOtp({ consumedAtUtcMs: FIXTURE_NOW_UTC_MS })),
        ],
        [],
        AuditSystem.createsOf(
          [
            IdentityAuditSystem.planSessionIssued(
              mailOtp({ consumedAtUtcMs: FIXTURE_NOW_UTC_MS }),
              UserId.of('auth-uid-1'),
              SessionKind.New,
              null,
              FIXTURE_NOW_UTC_MS,
            ),
          ],
          fixtureHash,
        ),
      ]);
      expect(tx.transactions).toHaveLength(4);
    });

    it('answers a second ALREADY_EXISTS as itself — a lost race is never success', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const key = `${Collections.Users}/auth-uid-1`;
      const { run } = rig({
        world,
        commit: (inner) => {
          let calls = 0;
          const wrapped: CommitPlan = (read, decide) => {
            calls++;
            if (calls === 1) return inner(read, decide);
            return inner(async (readTx) => {
              world.store.delete(key);
              const snapshot = await read(readTx);
              const { id, ...stub } = RegistrationSystem.provision(
                UserId.of('auth-uid-1'),
                ParsedIdentifier.email(MAIL),
              );
              world.store.set(`${Collections.Users}/${id}`, stub);
              return snapshot;
            }, decide);
          };
          return wrapped;
        },
      });
      const answer = await run(command());
      expect(!answer.ok && answer.error.errorCode).toBe(
        RepositoryErrorCode.AlreadyExists,
      );
      expect(world.minted).toEqual([]);
    });

    it('answers an Auth provisioning failure as itself, writing no stub', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const down = PipelineError.bare(PipelineErrorCode.Unavailable);
      const { tx, run } = rig({
        world,
        auth: { provisionAuthUser: async () => Result.err(down) },
      });
      expect(await run(command())).toEqual({ ok: false, error: down });
      expect(tx.plans).toHaveLength(1);
    });

    it('answers an Auth failure when nobody holds the destination after Auth refused it', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { run } = rig({
        world,
        auth: {
          provisionAuthUser: async () => Result.ok(null),
          findAuthUserByDestination: async () => Result.ok(null),
        },
      });
      expect(unwrapErrCode(await run(command()))).toBe(
        PipelineErrorCode.Unknown,
      );
      expect(world.minted).toEqual([]);
    });
  });

  describe('a returning identity', () => {
    it('reuses an existing user on a second OTP flow for the same destination — RETURNING, no second stub', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const first = rig({ world });
      expect(unwrapOk(await first.run(command())).sessionKind).toBe(
        SessionKind.New,
      );
      const second = mailOtp({
        id: OtpId.of('otp-2'),
        codeHash: 'hash(salt-1:654321)',
      });
      const { id, ...body } = second;
      world.store.set(`${Collections.Otps}/${id}`, body);
      const again = await rig({ world }).run({
        otpId: id,
        code: OtpCode.of('654321'),
        operationId: null,
      });
      expect(unwrapOk(again).sessionKind).toBe(SessionKind.Returning);
      expect(
        [...world.store.keys()].filter((key) =>
          key.startsWith(`${Collections.Users}/`),
        ),
      ).toHaveLength(1);
      expect(world.minted.map((token) => token.uid)).toEqual([
        UserId.of('auth-uid-1'),
        UserId.of('auth-uid-1'),
      ]);
    });

    it('mints the STORED roles for a staff account — the out-of-band grant finally reaches the token', async () => {
      const staff = registeredUserFixture({
        id: UserId.of('uid_staff'),
        email: MAIL,
        roles: [Role.Barber, Role.Admin],
      });
      const world = memoryIdentityWorld({ otps: [mailOtp()], users: [staff] });
      const { run } = rig({ world });
      expect(unwrapOk(await run(command())).sessionKind).toBe(
        SessionKind.Returning,
      );
      expect(world.minted[0]?.claims).toEqual(
        unwrapOk(
          AuthClaims.active(FIXTURE_TENANT_ID, [Role.Barber, Role.Admin]),
        ),
      );
      expect(world.authUsers).toEqual([]);
    });

    it('falls back to client claims when the doc carries no roles — a stub or pre-roles record never escalates', async () => {
      const existing = registeredUserFixture({
        id: UserId.of('uid_existing'),
        email: MAIL,
        roles: [],
      });
      const world = memoryIdentityWorld({
        otps: [mailOtp()],
        users: [existing],
      });
      const { run } = rig({ world });
      expect(unwrapOk(await run(command())).sessionKind).toBe(
        SessionKind.Returning,
      );
      expect(world.minted[0]?.claims).toEqual(
        unwrapOk(AuthClaims.active(FIXTURE_TENANT_ID, [Role.Client])),
      );
    });

    it('lands an abandoned registration back in onboarding — a PROVISIONED account returning', async () => {
      const stub = provisionedUserFixture({ phone: E164.of('+359888123456') });
      const world = memoryIdentityWorld({
        otps: [otpFixture()],
        users: [stub],
      });
      const { tx, run } = rig({ world });
      expect(unwrapOk(await run(command())).sessionKind).toBe(
        SessionKind.Returning,
      );
      expect(world.minted[0]?.claims).toEqual(
        AuthClaims.onboarding(FIXTURE_TENANT_ID),
      );
      // tx 1, then the session row — no tx 2 for a returning account.
      expect(tx.plans).toHaveLength(2);
    });

    it('answers a mint failure as itself', async () => {
      const staff = registeredUserFixture({ email: MAIL });
      const world = memoryIdentityWorld({ otps: [mailOtp()], users: [staff] });
      const down = PipelineError.bare(PipelineErrorCode.Unknown);
      const { run } = rig({
        world,
        auth: { mintCustomToken: async () => Result.err(down) },
      });
      expect(await run(command())).toEqual({ ok: false, error: down });
    });
  });
});

/** The refusal's code of a failed answer. */
function unwrapErrCode<T>(
  result: Result<T, { readonly errorCode: string }>,
): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.error.errorCode;
}

/*
 * The sign-in rows (audit-hardening Phase 3 WS-B, P3-DEP-7): tx 1 plans a
 * row with each state change and none without one (P3-L-2); the session
 * row commits after the mint and before the answer (P3-RU-12). Every
 * PII-bearing input is a SENTINEL, and the serialised rows are searched.
 */
describe('verifyOtp — the sign-in rows', () => {
  const SENTINEL_EMAIL = 'sentinel@example.invalid';
  const OP = OperationId.of('op-verify-abcdefghij');

  /** Every row the APPLIED plans of a rig created, in commit order. */
  const rowsOf = (plans: Parameters<typeof auditRowsOf>[0]) =>
    auditRowsOf(plans);

  it('a correct code: [consume Update, VERIFIED Create] in tx 1 — no operation id even when the call sent one (P3-L-20)', async () => {
    const world = memoryIdentityWorld({ otps: [mailOtp()] });
    const { tx, run } = rig({ world });
    expect((await run({ ...command(), operationId: OP })).ok).toBe(true);
    const [verified] = rowsOf([tx.plans[0] ?? []]);
    expect(verified).toEqual({
      id: expect.any(String),
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      resourceId: 'otps/otp-1',
      auditOperationId: null,
      actorRole: 'SYSTEM',
      actorSystemSource: 'IDENTITY_CALLABLE',
      auditAction: 'IDENTITY_OTP_VERIFIED',
      otpDestinationType: OtpDestinationType.Email,
      otpPurpose: 'LOGIN',
      otpAttemptCount: 0,
      auditTarget: 'NONE',
    });
  });

  it('a wrong code: [attempt Update, REFUSED Create (WRONG_CODE)]; the attempt that reaches maxAttempts: LOCKED_OUT; the answer unchanged', async () => {
    const world = memoryIdentityWorld({
      otps: [mailOtp({ attemptCount: 3 })],
    });
    const { tx, run } = rig({ world });
    // maxAttempts − 2 recorded before: this attempt leaves one more.
    expect(unwrapErrCode(await run(command(WRONG)))).toBe(
      IdentityErrorCode.OtpWrongCode,
    );
    // maxAttempts − 1 recorded before: this attempt exhausts the challenge.
    expect(unwrapErrCode(await run(command(WRONG)))).toBe(
      IdentityErrorCode.OtpWrongCode,
    );
    expect(
      rowsOf(tx.plans).map((row) => ({
        auditAction: row.auditAction,
        ...('otpRefusalReason' in row
          ? {
              otpRefusalReason: row.otpRefusalReason,
              otpAttemptCount: row.otpAttemptCount,
              otpMaxAttempts: row.otpMaxAttempts,
            }
          : {}),
      })),
    ).toEqual([
      {
        auditAction: 'IDENTITY_OTP_REFUSED',
        otpRefusalReason: OtpRefusalReason.WrongCode,
        otpAttemptCount: 4,
        otpMaxAttempts: 5,
      },
      {
        auditAction: 'IDENTITY_OTP_REFUSED',
        otpRefusalReason: OtpRefusalReason.LockedOut,
        otpAttemptCount: 5,
        otpMaxAttempts: 5,
      },
    ]);
    // The challenge is now locked: even the right code changes nothing and plans no row.
    expect(unwrapErrCode(await run(command()))).toBe(
      IdentityErrorCode.OtpLockedOut,
    );
    expect(tx.plans[2]).toEqual([]);
    expect(rowsOf(tx.plans)).toHaveLength(2);
    expect(world.minted).toEqual([]);
  });

  it('the same wrong code twice is two recorded attempts — two rows with distinct ids', async () => {
    const world = memoryIdentityWorld({ otps: [mailOtp()] });
    const { tx, run } = rig({ world });
    await run(command(WRONG));
    await run(command(WRONG));
    const rows = rowsOf(tx.plans);
    expect(rows.map((row) => row.auditAction)).toEqual([
      'IDENTITY_OTP_REFUSED',
      'IDENTITY_OTP_REFUSED',
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(
      [...world.store.keys()].filter((key) =>
        key.startsWith(`${Collections.AuditLog}/`),
      ),
    ).toHaveLength(2);
  });

  it('a contended tx 1 decides the same row id twice — a re-run never plans a second row', async () => {
    const world = memoryIdentityWorld({ otps: [mailOtp()] });
    let decisions: readonly (readonly WriteOp[])[] = [];
    const { tx, run } = rig({
      world,
      commit: (inner) => {
        const contended = contendedCommit(inner);
        decisions = contended.decisions;
        return contended.commit;
      },
    });
    expect(unwrapErrCode(await run(command(WRONG)))).toBe(
      IdentityErrorCode.OtpWrongCode,
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
    expect(rowsOf(tx.plans)).toHaveLength(1);
  });

  it('a retry after consumption is ALREADY_CONSUMED — no write, no row, no second session', async () => {
    const world = memoryIdentityWorld({ otps: [mailOtp()] });
    expect((await rig({ world }).run(command())).ok).toBe(true);
    const retry = rig({ world });
    expect(unwrapErrCode(await retry.run(command()))).toBe(
      IdentityErrorCode.OtpAlreadyConsumed,
    );
    expect(retry.tx.plans).toEqual([[]]);
  });

  it('expired and unknown challenges plan no row', async () => {
    const expired = memoryIdentityWorld({ otps: [mailOtp()] });
    const late = rig({ world: expired, nowUtcMs: later(10 * 60_000) });
    await late.run(command());
    expect(rowsOf(late.tx.plans)).toEqual([]);
    const unknown = rig({ world: memoryIdentityWorld() });
    await unknown.run(command());
    expect(rowsOf(unknown.tx.plans)).toEqual([]);
  });

  it('the session commit after the mint holds ONE SESSION_ISSUED row naming the account — NEW, with the call’s operation id', async () => {
    const world = memoryIdentityWorld({ otps: [mailOtp()] });
    const { tx, run } = rig({ world });
    expect(unwrapOk(await run({ ...command(), operationId: OP }))).toEqual({
      customToken: 'token:auth-uid-1:1',
      sessionKind: SessionKind.New,
    });
    // tx 1, tx 2 (the stub), then the session commit — one Create, no reads.
    expect(tx.plans).toHaveLength(3);
    expect(tx.transactions[2]?.reads).toEqual([]);
    expect(rowsOf([tx.plans[2] ?? []])).toEqual([
      {
        id: expect.any(String),
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: 'users/auth-uid-1',
        auditOperationId: OP,
        actorRole: 'SYSTEM',
        actorSystemSource: 'IDENTITY_CALLABLE',
        auditAction: 'IDENTITY_SESSION_ISSUED',
        sessionKind: SessionKind.New,
        otpDestinationType: OtpDestinationType.Email,
        auditTarget: 'USER',
        targetUserId: 'auth-uid-1',
      },
    ]);
  });

  it('a RETURNING session’s row names the stored account; a call with no operation id names none (RU-21)', async () => {
    const staff = registeredUserFixture({
      id: UserId.of('uid_staff'),
      email: MAIL,
      roles: [Role.Barber],
    });
    const world = memoryIdentityWorld({ otps: [mailOtp()], users: [staff] });
    const { tx, run } = rig({ world });
    expect(unwrapOk(await run(command())).sessionKind).toBe(
      SessionKind.Returning,
    );
    const session = rowsOf(tx.plans).filter(
      (row) => row.auditAction === 'IDENTITY_SESSION_ISSUED',
    );
    expect(session).toEqual([
      expect.objectContaining({
        resourceId: 'users/uid_staff',
        auditOperationId: null,
        sessionKind: SessionKind.Returning,
        auditTarget: 'USER',
        targetUserId: 'uid_staff',
      }),
    ]);
  });

  it('a mint failure plans no session row', async () => {
    const staff = registeredUserFixture({ email: MAIL });
    const world = memoryIdentityWorld({ otps: [mailOtp()], users: [staff] });
    const down = PipelineError.bare(PipelineErrorCode.Unknown);
    const { tx, run } = rig({
      world,
      auth: { mintCustomToken: async () => Result.err(down) },
    });
    expect(await run(command())).toEqual({ ok: false, error: down });
    expect(tx.plans).toHaveLength(1);
    expect(rowsOf(tx.plans).map((row) => row.auditAction)).toEqual([
      'IDENTITY_OTP_VERIFIED',
    ]);
  });

  it('a session-commit failure answers the store failure — the minted token is never answered', async () => {
    const staff = registeredUserFixture({ email: MAIL });
    const world = memoryIdentityWorld({ otps: [mailOtp()], users: [staff] });
    const down = RepositoryError.writeFailed(Collections.AuditLog, 'x');
    const { run } = rig({
      world,
      commit: (inner) => {
        let calls = 0;
        const wrapped: CommitPlan = (read, decide) =>
          ++calls === 2
            ? Promise.resolve(Result.err(down))
            : inner(read, decide);
        return wrapped;
      },
    });
    const answer = await run(command());
    expect(answer).toEqual({ ok: false, error: down });
    expect(JSON.stringify(answer)).not.toContain('token:');
    expect(world.minted).toHaveLength(1);
    expect(
      [...world.store.keys()].filter((key) =>
        key.startsWith(`${Collections.AuditLog}/`),
      ),
    ).toHaveLength(1);
  });

  it('no row holds the destination, the code, its hash or its salt (R36 / T5)', async () => {
    const otp = mailOtp({ destination: Identifier.of(SENTINEL_EMAIL) });
    const world = memoryIdentityWorld({
      otps: [otp, { ...otp, id: OtpId.of('otp-2') }],
    });
    const { tx, run } = rig({ world });
    await run({ otpId: OtpId.of('otp-2'), code: WRONG, operationId: OP });
    expect((await run({ ...command(), operationId: OP })).ok).toBe(true);
    const rows = rowsOf(tx.plans);
    expect(rows.map((row) => row.auditAction)).toEqual([
      'IDENTITY_OTP_REFUSED',
      'IDENTITY_OTP_VERIFIED',
      'IDENTITY_SESSION_ISSUED',
    ]);
    for (const row of rows) {
      // The body only: the row id is a hash, never a value of the person.
      const body = Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== 'id'),
      );
      const json = JSON.stringify(body);
      for (const secret of [
        SENTINEL_EMAIL,
        FIXTURE_OTP_CODE,
        '000000',
        otp.codeHash,
        otp.salt,
      ]) {
        expect(json).not.toContain(secret);
      }
      for (const key of ['destination', 'codeHash', 'salt', 'code']) {
        expect(Object.keys(body)).not.toContain(key);
      }
    }
  });
});
