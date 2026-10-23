import { describe, expect, it } from 'vitest';
import {
  AuthClaims,
  E164,
  Email,
  Identifier,
  OtpCode,
  OtpDestinationType,
  ParsedIdentifier,
  RegistrationState,
  Role,
  SessionKind,
  WriteOp,
} from '@core/components';
import { OtpId, Result, UserId, UtcEpochMs } from '@core/primitives';
import {
  IdentityErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryErrorCode,
} from '@core/errors';
import { Collections } from '@core/entities';
import type {
  AuthAdminPorts,
  AuthUserLookupPorts,
  CommitPlan,
  NowUtcMs,
} from '@core/ports';
import { RegistrationSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_OTP_CODE,
  FIXTURE_PHONE,
  FIXTURE_TENANT_ID,
  fixedOtpCryptoPorts,
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
 * case the deleted use-case spec held, plus the flip's own.
 */

const OTP_ID = OtpId.of('otp-1');
const OTP_PATH = [Collections.Otps, OTP_ID];
const MAIL = Email.of('client@example.com');
const WRONG = OtpCode.of('000000');
const RIGHT = OtpCode.of(FIXTURE_OTP_CODE);

const command = (code: OtpCode = RIGHT): VerifyOtpCommand => ({
  otpId: OTP_ID,
  code,
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

describe('verifyOtp', () => {
  describe('tx 1 — the attempt', () => {
    it('consumes the challenge with ONE root-key Update on a correct code', async () => {
      const world = memoryIdentityWorld({ otps: [mailOtp()] });
      const { tx, run } = rig({ world });
      expect((await run(command())).ok).toBe(true);
      expect(tx.plans[0]).toEqual([
        WriteOp.update(OTP_PATH, { consumedAtUtcMs: FIXTURE_NOW_UTC_MS }),
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
        [WriteOp.update(OTP_PATH, { attemptCount: 1 })],
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
      // tx 1's Update, then the re-run's empty plan — the refused Create applied nothing.
      expect(tx.plans).toEqual([
        [WriteOp.update(OTP_PATH, { consumedAtUtcMs: FIXTURE_NOW_UTC_MS })],
        [],
      ]);
      expect(tx.transactions).toHaveLength(3);
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
      expect(tx.plans).toHaveLength(1);
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
