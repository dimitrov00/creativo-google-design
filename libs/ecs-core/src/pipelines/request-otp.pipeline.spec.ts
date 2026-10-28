import { describe, expect, it } from 'vitest';
import {
  AuthDeployment,
  AuthStrategy,
  AuthStrategyKind,
  type DocBody,
  E164,
  Email,
  OtpDestinationType,
  OtpPurpose,
  ParsedIdentifier,
  RegistrationField,
  WriteOp,
} from '@core/components';
import {
  AuditResourceId,
  IdentifierChannel,
  OperationId,
  OtpId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import {
  IdentityError,
  IdentityErrorCode,
  PipelineErrorCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import { Collections, type Otp } from '@core/entities';
import type { CommitPlan, NowUtcMs, OtpStorePorts } from '@core/ports';
import { AuditSystem, IdentityAuditSystem } from '@core/systems';
import {
  auditRowsOf,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_OTP_CODE,
  FIXTURE_OTP_SALT,
  FIXTURE_TENANT_ID,
  fixedOtpCryptoPorts,
  fixedTenantPorts,
  fixtureCodeHash,
  fixtureHash,
  type IdentityWorld,
  memoryIdentityWorld,
  memoryOtpStorePorts,
  memoryTxPorts,
  otpFixture,
  pinnedNowUtcMs,
  recordingOtpDeliveryPorts,
  recordingTelemetry,
  sequentialIds,
  unwrapOk,
} from '@core/testing';
import { type RequestOtpCommand, requestOtp } from './request-otp.pipeline';

/*
 * `requestOtp` (identity flip (2), §3.2): the successor of the legacy
 * `RequestOtpUseCase` (deleted in Phase 4b) as a sandwich whose one write
 * is a read-free commit — channel, parse, resend window, tenant, then issue
 * → save (the challenge and its `IDENTITY_OTP_REQUESTED` row, ONE commit —
 * audit-hardening Phase 3, P3-DEP-6 / P3-DEP-7) → send — with the stored
 * destination the payload text trimmed (F2-10). Every case the deleted
 * use-case spec held, plus the flip's own and the sign-in row's.
 */

/** A deployment running the given OTP strategy (`required` and policy as the default's unless given). */
function deployment(
  authStrategyKind: string,
  policy: { readonly [key: string]: unknown } = {
    ttlMinutes: 5,
    maxAttempts: 5,
    sessionDays: 30,
  },
): AuthDeployment {
  return {
    ...AuthDeployment.DEFAULT,
    strategy: unwrapOk(
      AuthStrategy.parse({
        authStrategyKind,
        required: [
          RegistrationField.Phone,
          RegistrationField.FirstName,
          RegistrationField.LastName,
        ],
        policy,
      }),
    ),
  };
}

const EMAIL: RequestOtpCommand = {
  otpDestinationType: OtpDestinationType.Email,
  rawDestination: 'client@example.com',
  operationId: null,
};
const SMS: RequestOtpCommand = {
  otpDestinationType: OtpDestinationType.Sms,
  rawDestination: '+359888123456',
  operationId: null,
};

type Rig = {
  readonly world?: IdentityWorld;
  readonly deployment?: AuthDeployment;
  readonly nowUtcMs?: NowUtcMs;
  readonly failingSend?: boolean;
  /** The deployed project's sender: every delivery refused `IDENTITY_OTP_SEND_UNAVAILABLE` (WS-0). */
  readonly refusingSend?: boolean;
  readonly store?: Partial<OtpStorePorts>;
  /** Wraps the commit port — a store failure scripted around the save. */
  readonly commit?: (inner: CommitPlan) => CommitPlan;
  /** The code the crypto port draws — `FIXTURE_OTP_CODE` unless given. */
  readonly code?: string;
  /** The id prefix — distinct per rig when two share a world. */
  readonly idPrefix?: string;
};

function rig(options: Rig = {}) {
  const world = options.world ?? memoryIdentityWorld();
  const delivery = recordingOtpDeliveryPorts({
    failing: options.failingSend === true,
  });
  const telemetry = recordingTelemetry();
  // The challenge is saved through the commit port over the world's own
  // table — the same store the open-window probe reads.
  const tx = memoryTxPorts(world.store, {
    nowUtcMs: options.nowUtcMs ?? pinnedNowUtcMs(),
    nextId: sequentialIds(options.idPrefix ?? 'otp'),
  });
  const run = requestOtp({
    ...memoryOtpStorePorts(world),
    ...options.store,
    ...delivery.ports,
    ...(options.refusingSend === true
      ? {
          sendOtp: async () => Result.err(IdentityError.otpSendUnavailable()),
        }
      : {}),
    ...fixedOtpCryptoPorts(options.code),
    ...fixedTenantPorts(),
    authDeployment: options.deployment ?? AuthDeployment.DEFAULT,
    commit:
      options.commit === undefined ? tx.commit : options.commit(tx.commit),
    hash: tx.hash,
    nowUtcMs: tx.nowUtcMs,
    nextId: tx.nextId,
    log: telemetry.log,
    trackError: telemetry.trackError,
  });
  return { world, delivery, telemetry, tx, run };
}

/** Every stored audit row, by id. */
function rowsIn(world: IdentityWorld): ReadonlyMap<string, DocBody> {
  const prefix = `${Collections.AuditLog}/`;
  return new Map(
    [...world.store]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) => [key.slice(prefix.length), body]),
  );
}

/** Every stored challenge, by id. */
function otpsIn(world: IdentityWorld): ReadonlyMap<string, DocBody> {
  const prefix = `${Collections.Otps}/`;
  return new Map(
    [...world.store]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) => [key.slice(prefix.length), body]),
  );
}

const plusMs = (ms: number): NowUtcMs =>
  pinnedNowUtcMs(UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, ms));

describe('requestOtp', () => {
  it('issues a challenge, saves its flat body, sends the raw code and answers otpId + rawCode', async () => {
    const { world, delivery, run } = rig();
    const answer = await run(EMAIL);
    expect(answer).toEqual({
      ok: true,
      value: { otpId: 'otp-1', rawCode: FIXTURE_OTP_CODE },
    });
    const body: Omit<Otp, 'id'> = {
      tenantId: FIXTURE_TENANT_ID,
      destination: EMAIL.rawDestination as Otp['destination'],
      otpDestinationType: OtpDestinationType.Email,
      otpPurpose: OtpPurpose.Login,
      codeHash: fixtureCodeHash(FIXTURE_OTP_CODE, FIXTURE_OTP_SALT),
      salt: FIXTURE_OTP_SALT,
      expiresAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 5 * 60_000),
      attemptCount: 0,
      maxAttempts: 5,
      consumedAtUtcMs: null,
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
    };
    expect(Object.fromEntries(otpsIn(world))).toEqual({ 'otp-1': body });
    expect(delivery.sent).toEqual([
      {
        destination: ParsedIdentifier.email(Email.of('client@example.com')),
        code: FIXTURE_OTP_CODE,
      },
    ]);
  });

  it('answers the id the IdPorts drew and the code the OtpCrypto port drew — never one of its own', async () => {
    const { run } = rig();
    const first = unwrapOk(await run(EMAIL));
    const second = unwrapOk(
      await rig({ nowUtcMs: plusMs(120_000) }).run(EMAIL),
    );
    expect(first.otpId).toBe('otp-1');
    expect(second.otpId).toBe('otp-1');
    expect(first.rawCode).toBe(FIXTURE_OTP_CODE);
  });

  it('rate-limits a second request for the same destination within the window — nothing saved, nothing sent', async () => {
    const world = memoryIdentityWorld();
    await rig({ world }).run(EMAIL);
    const again = rig({ world, nowUtcMs: plusMs(30_000) });
    const answer = await again.run(EMAIL);
    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.OtpRateLimited,
        retryAfterSeconds: 30,
      },
    });
    expect(otpsIn(world).size).toBe(1);
    expect(again.delivery.sent).toEqual([]);
  });

  it('carries the seconds left on the 60 s window, rounded up — never 0 while refused, free one millisecond past it (OR-9)', async () => {
    const world = memoryIdentityWorld();
    await rig({ world }).run(EMAIL);
    const retryAfter = async (ms: number) => {
      const answer = await rig({ world, nowUtcMs: plusMs(ms) }).run(EMAIL);
      return (
        !answer.ok &&
        answer.error.errorCode === IdentityErrorCode.OtpRateLimited &&
        answer.error.retryAfterSeconds
      );
    };
    expect(await retryAfter(0)).toBe(60);
    expect(await retryAfter(1_000)).toBe(59);
    expect(await retryAfter(59_000)).toBe(1);
    expect(await retryAfter(59_500)).toBe(1);
    // The window's last instant still throttles (index #10's `>=`).
    expect(await retryAfter(60_000)).toBe(1);
    expect(otpsIn(world).size).toBe(1);
    const free = rig({ world, nowUtcMs: plusMs(60_001), idPrefix: 'free' });
    expect((await free.run(EMAIL)).ok).toBe(true);
    expect(free.delivery.sent).toHaveLength(1);
  });

  it('counts the seconds from the NEWEST open challenge of the destination', async () => {
    const open = (id: string, agoMs: number) =>
      otpFixture({
        id: OtpId.of(id),
        destination: EMAIL.rawDestination as Otp['destination'],
        otpDestinationType: OtpDestinationType.Email,
        createdAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -agoMs),
      });
    const world = memoryIdentityWorld({
      otps: [open('otp-old', 50_000), open('otp-new', 10_000)],
    });
    expect(await rig({ world }).run(EMAIL)).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.OtpRateLimited,
        retryAfterSeconds: 50,
      },
    });
  });

  it('allows a new request once the rate-limit window has passed', async () => {
    const world = memoryIdentityWorld();
    await rig({ world }).run(EMAIL);
    const later = rig({ world, nowUtcMs: plusMs(120_000), idPrefix: 'later' });
    const answer = await later.run(EMAIL);
    expect(answer.ok).toBe(true);
    expect(later.delivery.sent).toHaveLength(1);
    expect(otpsIn(world).size).toBe(2);
  });

  it('never counts a CONSUMED challenge toward the window', async () => {
    const world = memoryIdentityWorld({
      otps: [
        otpFixture({
          destination: EMAIL.rawDestination as Otp['destination'],
          otpDestinationType: OtpDestinationType.Email,
          consumedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
      ],
    });
    expect((await rig({ world }).run(EMAIL)).ok).toBe(true);
  });

  it('probes the PARSED destination while storing the trimmed text — a non-normalised value is never rate-limited (F2-10, today’s pair)', async () => {
    const world = memoryIdentityWorld();
    const mixed: RequestOtpCommand = {
      otpDestinationType: OtpDestinationType.Email,
      rawDestination: 'Client@Example.com',
      operationId: null,
    };
    await rig({ world, idPrefix: 'first' }).run(mixed);
    const again = await rig({
      world,
      nowUtcMs: plusMs(10_000),
      idPrefix: 'second',
    }).run(mixed);
    expect(again.ok).toBe(true);
    expect([...otpsIn(world).values()].map((b) => b['destination'])).toEqual([
      'Client@Example.com',
      'Client@Example.com',
    ]);
  });

  it('stores a padded e-mail and a padded phone TRIMMED, delivering to the parsed identifier', async () => {
    const mail = rig();
    await mail.run({
      otpDestinationType: OtpDestinationType.Email,
      rawDestination: '  a@b.com  ',
      operationId: null,
    });
    expect(otpsIn(mail.world).get('otp-1')?.['destination']).toBe('a@b.com');
    expect(mail.delivery.sent[0]?.destination).toEqual(
      ParsedIdentifier.email(Email.of('a@b.com')),
    );

    const phone = rig({ deployment: deployment(AuthStrategyKind.PhoneOtp) });
    await phone.run({
      otpDestinationType: OtpDestinationType.Sms,
      rawDestination: ' +359888123456 ',
      operationId: null,
    });
    expect(otpsIn(phone.world).get('otp-1')).toMatchObject({
      destination: '+359888123456',
      otpDestinationType: OtpDestinationType.Sms,
    });
    expect(phone.delivery.sent[0]?.destination).toEqual(
      ParsedIdentifier.phone(E164.of('+359888123456')),
    );
  });

  it('rejects an email request under a phone_otp deployment (channel mismatch)', async () => {
    const { world, delivery, run } = rig({
      deployment: deployment(AuthStrategyKind.PhoneOtp),
    });
    expect(await run(EMAIL)).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.OtpChannelMismatch,
        requested: IdentifierChannel.Email,
        authStrategyKind: AuthStrategyKind.PhoneOtp,
      },
    });
    expect(otpsIn(world).size).toBe(0);
    expect(delivery.sent).toEqual([]);
  });

  it('rejects an sms request under an email_otp deployment (channel mismatch)', async () => {
    const { delivery, run } = rig();
    const answer = await run(SMS);
    expect(!answer.ok && answer.error).toEqual({
      errorCode: IdentityErrorCode.OtpChannelMismatch,
      requested: IdentifierChannel.Phone,
      authStrategyKind: AuthStrategyKind.EmailOtp,
    });
    expect(delivery.sent).toEqual([]);
  });

  it('refuses every code challenge under a magic-link deployment', async () => {
    const link = deployment(AuthStrategyKind.EmailLink, {
      ttlMinutes: 15,
      sessionDays: 30,
    });
    const answer = await rig({ deployment: link }).run(EMAIL);
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: IdentityErrorCode.OtpChannelMismatch,
      authStrategyKind: AuthStrategyKind.EmailLink,
    });
  });

  it('checks the channel BEFORE the destination — a garbage phone under an e-mail deployment is a mismatch', async () => {
    const answer = await rig().run({
      otpDestinationType: OtpDestinationType.Sms,
      rawDestination: 'not a phone',
      operationId: null,
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      IdentityErrorCode.OtpChannelMismatch,
    );
  });

  it('refuses a destination that does not parse on its channel, with the channel and the text', async () => {
    const mail = await rig().run({
      otpDestinationType: OtpDestinationType.Email,
      rawDestination: 'not-an-email',
      operationId: null,
    });
    expect(mail).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.IdentifierInvalid,
        identifierKind: IdentifierChannel.Email,
        attempted: 'not-an-email',
      },
    });
    const phone = await rig({
      deployment: deployment(AuthStrategyKind.PhoneOtp),
    }).run({
      otpDestinationType: OtpDestinationType.Sms,
      rawDestination: '0888',
      operationId: null,
    });
    expect(!phone.ok && phone.error).toMatchObject({
      errorCode: IdentityErrorCode.IdentifierInvalid,
      identifierKind: IdentifierChannel.Phone,
    });
  });

  it('refuses an e-mail whose last label is one character — the one `Email.parse` rule, a deliberate tightening (plan §0 F2-1) — nothing saved, nothing sent', async () => {
    const { world, delivery, run } = rig();
    const answer = await run({
      otpDestinationType: OtpDestinationType.Email,
      rawDestination: 'a@b.c',
      operationId: null,
    });
    // The wire answers this `invalid_input` 'invalid email destination'
    // (`identity.wire.spec.ts` pins the IDENTIFIER_INVALID mapping).
    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.IdentifierInvalid,
        identifierKind: IdentifierChannel.Email,
        attempted: 'a@b.c',
      },
    });
    expect(otpsIn(world).size).toBe(0);
    expect(delivery.sent).toEqual([]);
  });

  it("issues the OTP with the deployment strategy's own ttl/maxAttempts, not local constants", async () => {
    const { world, run } = rig({
      deployment: deployment(AuthStrategyKind.EmailOtp, {
        ttlMinutes: 7,
        maxAttempts: 2,
        sessionDays: 30,
      }),
    });
    expect((await run(EMAIL)).ok).toBe(true);
    expect(otpsIn(world).get('otp-1')).toMatchObject({
      maxAttempts: 2,
      expiresAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 7 * 60_000),
    });
  });

  it('answers a failed delivery as itself — the saved challenge stays, as today', async () => {
    const { world, telemetry, run } = rig({ failingSend: true });
    const answer = await run(EMAIL);
    expect(!answer.ok && answer.error.errorCode).toBe(
      PipelineErrorCode.Unavailable,
    );
    expect(otpsIn(world).size).toBe(1);
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: 'otp.send_failed',
        fields: { otpId: 'otp-1', errorCode: PipelineErrorCode.Unavailable },
      },
    ]);
  });

  it('passes the deployed sender’s refusal through unchanged — saved first, the resend window consumed, the order frozen (WS-0)', async () => {
    const { world, telemetry, run } = rig({ refusingSend: true });
    const answer = await run(EMAIL);
    expect(answer).toEqual({
      ok: false,
      error: { errorCode: IdentityErrorCode.OtpSendUnavailable },
    });
    expect(otpsIn(world).size).toBe(1);
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: 'otp.send_failed',
        fields: {
          otpId: 'otp-1',
          errorCode: IdentityErrorCode.OtpSendUnavailable,
        },
      },
    ]);
    // The saved challenge holds the OR-9 window, as a delivered one would.
    const again = await run(EMAIL);
    expect(!again.ok && again.error.errorCode).toBe(
      IdentityErrorCode.OtpRateLimited,
    );
  });

  it('answers a store failure of the probe or the save, sending nothing', async () => {
    const down = Result.err(RepositoryError.readFailed(Collections.Otps, 'x'));
    const probe = rig({ store: { loadOpenOtps: async () => down } });
    const probed = await probe.run(EMAIL);
    expect(!probed.ok && probed.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
    expect(probe.delivery.sent).toEqual([]);

    // The save is the commit now (P3-DEP-6): its failure is the same answer,
    // and neither the challenge nor its row lands.
    const save = rig({
      commit: () => async () =>
        Result.err(RepositoryError.writeFailed(Collections.Otps, 'x')),
    });
    const saved = await save.run(EMAIL);
    expect(!saved.ok && saved.error.errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
    expect(save.delivery.sent).toEqual([]);
    expect(otpsIn(save.world).size).toBe(0);
    expect(rowsIn(save.world).size).toBe(0);
  });

  it('stamps the challenge with the tenant the TenantPorts answer', async () => {
    const world = memoryIdentityWorld();
    const delivery = recordingOtpDeliveryPorts();
    const telemetry = recordingTelemetry();
    const tx = memoryTxPorts(world.store);
    await requestOtp({
      ...memoryOtpStorePorts(world),
      ...delivery.ports,
      ...fixedOtpCryptoPorts(),
      ...fixedTenantPorts(FIXTURE_TENANT_ID),
      authDeployment: AuthDeployment.DEFAULT,
      commit: tx.commit,
      hash: tx.hash,
      nowUtcMs: pinnedNowUtcMs(),
      nextId: sequentialIds('otp'),
      log: telemetry.log,
      trackError: telemetry.trackError,
    })(EMAIL);
    expect(otpsIn(world).get('otp-1')?.['tenantId']).toBe(FIXTURE_TENANT_ID);
  });
});

/*
 * The sign-in half of the audit log (audit-hardening Phase 3 WS-B, P3-DEP-6,
 * P3-DEP-7): the challenge is saved by ONE commit that also creates its
 * `IDENTITY_OTP_REQUESTED` row; a refusal before the issue commits nothing;
 * the row holds ids, tags and stamps only (R36 / T5) — every PII-bearing
 * input below is a SENTINEL, and the serialised rows are searched for it.
 */
describe('requestOtp — the IDENTITY_OTP_REQUESTED row', () => {
  const SENTINEL_PHONE = '+359880000777';
  const SENTINEL_EMAIL = 'sentinel@example.invalid';
  const SENTINEL_CODE = '774411';
  const OTP_1 = OtpId.of('otp-1');

  it('saves the challenge and its row in ONE commit — [Set otps/<id>, Create auditLog/<id>] — then sends', async () => {
    const { world, tx, delivery, run } = rig();
    const answer = await run({
      ...EMAIL,
      operationId: OperationId.of('op-request-0123456789'),
    });
    expect(answer.ok).toBe(true);
    const body = otpsIn(world).get(OTP_1) as DocBody;
    const challenge = { id: OTP_1, ...body } as unknown as Otp;
    expect(tx.plans).toEqual([
      [
        WriteOp.set([Collections.Otps, OTP_1], body),
        ...AuditSystem.createsOf(
          [IdentityAuditSystem.planOtpRequested(challenge)],
          fixtureHash,
        ),
      ],
    ]);
    // The row exactly: the sign-in callable as the actor, the challenge as
    // the resource, no account yet, and NO operation id even though the
    // call carried one (P3-L-20: caller-chosen text on an unauthenticated
    // path never reaches the permanent log).
    const resourceId = AuditResourceId.forOtp(OTP_1);
    const rowId = fixtureHash(
      AuditSystem.rowBasis(
        'IDENTITY_OTP_REQUESTED',
        resourceId,
        null,
        AuditSystem.changeKey.otpRequested(OTP_1),
      ),
    );
    expect(auditRowsOf(tx.plans)).toEqual([
      {
        id: rowId,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: 'otps/otp-1',
        auditOperationId: null,
        actorRole: 'SYSTEM',
        actorSystemSource: 'IDENTITY_CALLABLE',
        auditAction: 'IDENTITY_OTP_REQUESTED',
        otpDestinationType: OtpDestinationType.Email,
        otpPurpose: OtpPurpose.Login,
        otpExpiresAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 5 * 60_000),
        auditTarget: 'NONE',
      },
    ]);
    // Landed in the same table, beside the challenge; the code sent after.
    expect([...rowsIn(world).keys()]).toEqual([rowId]);
    expect(delivery.sent).toHaveLength(1);
  });

  it('plans one row per challenge — a second challenge past the window is its own row', async () => {
    const world = memoryIdentityWorld();
    await rig({ world }).run(EMAIL);
    await rig({ world, nowUtcMs: plusMs(120_000), idPrefix: 'later' }).run(
      EMAIL,
    );
    const rows = [...rowsIn(world).values()];
    expect(rows.map((row) => row['resourceId'])).toEqual(
      expect.arrayContaining(['otps/otp-1', 'otps/later-1']),
    );
    expect(rows).toHaveLength(2);
  });

  it('commits nothing on a refusal before the issue — resend window, channel, identifier (P3-L-2)', async () => {
    const world = memoryIdentityWorld();
    await rig({ world }).run(EMAIL);
    const cooled = rig({ world, nowUtcMs: plusMs(30_000), idPrefix: 'again' });
    expect((await cooled.run(EMAIL)).ok).toBe(false);
    expect(cooled.tx.transactions).toEqual([]);
    expect(rowsIn(world).size).toBe(1);

    const mismatch = rig({ deployment: deployment(AuthStrategyKind.PhoneOtp) });
    expect((await mismatch.run(EMAIL)).ok).toBe(false);
    expect(mismatch.tx.transactions).toEqual([]);
    expect(rowsIn(mismatch.world).size).toBe(0);

    const garbage = rig();
    const refused = await garbage.run({
      otpDestinationType: OtpDestinationType.Email,
      rawDestination: 'not-an-email',
      operationId: null,
    });
    expect(!refused.ok && refused.error.errorCode).toBe(
      IdentityErrorCode.IdentifierInvalid,
    );
    expect(garbage.tx.transactions).toEqual([]);
    expect(rowsIn(garbage.world).size).toBe(0);
  });

  it('a refused send follows its already-committed row — ONE REQUESTED row, the same send-failed line (RU-3 order, P3-RU-8)', async () => {
    for (const options of [{ refusingSend: true }, { failingSend: true }]) {
      const { world, tx, telemetry, run } = rig(options);
      const answer = await run(EMAIL);
      expect(answer.ok).toBe(false);
      expect(auditRowsOf(tx.plans).map((row) => row.auditAction)).toEqual([
        'IDENTITY_OTP_REQUESTED',
      ]);
      expect(rowsIn(world).size).toBe(1);
      expect(telemetry.lines.map((line) => line.msg)).toEqual([
        'otp.send_failed',
      ]);
    }
  });

  it('the row holds no destination, code, code hash or salt (R36 / T5)', async () => {
    const phone = rig({
      deployment: deployment(AuthStrategyKind.PhoneOtp),
      code: SENTINEL_CODE,
    });
    expect(
      (
        await phone.run({
          otpDestinationType: OtpDestinationType.Sms,
          rawDestination: SENTINEL_PHONE,
          operationId: null,
        })
      ).ok,
    ).toBe(true);
    const mail = rig({ code: SENTINEL_CODE });
    expect(
      (
        await mail.run({
          otpDestinationType: OtpDestinationType.Email,
          rawDestination: SENTINEL_EMAIL,
          operationId: null,
        })
      ).ok,
    ).toBe(true);
    const rows = [
      ...auditRowsOf(phone.tx.plans),
      ...auditRowsOf(mail.tx.plans),
    ];
    expect(rows).toHaveLength(2);
    // The challenges themselves DO hold the destination — the scan is not vacuous.
    expect(JSON.stringify([...otpsIn(phone.world).values()])).toContain(
      SENTINEL_PHONE,
    );
    for (const row of rows) {
      // The body only: the row id is a hash, never a value of the person.
      const body = Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== 'id'),
      );
      const json = JSON.stringify(body);
      for (const secret of [
        SENTINEL_PHONE,
        SENTINEL_EMAIL,
        SENTINEL_CODE,
        fixtureCodeHash(SENTINEL_CODE, FIXTURE_OTP_SALT),
        FIXTURE_OTP_SALT,
      ]) {
        expect(json).not.toContain(secret);
      }
      for (const key of ['destination', 'codeHash', 'salt', 'code']) {
        expect(Object.keys(body)).not.toContain(key);
      }
    }
  });
});
