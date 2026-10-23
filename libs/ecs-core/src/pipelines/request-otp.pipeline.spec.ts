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
} from '@core/components';
import { IdentifierChannel, Result, UtcEpochMs } from '@core/primitives';
import {
  IdentityErrorCode,
  PipelineErrorCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import { Collections, type Otp } from '@core/entities';
import type { NowUtcMs, OtpStorePorts } from '@core/ports';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_OTP_CODE,
  FIXTURE_OTP_SALT,
  FIXTURE_TENANT_ID,
  fixedOtpCryptoPorts,
  fixedTenantPorts,
  fixtureCodeHash,
  type IdentityWorld,
  memoryIdentityWorld,
  memoryOtpStorePorts,
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
 * `RequestOtpUseCase` (deleted in Phase 4b) as a transaction-free
 * sandwich — channel, parse, resend window, tenant, then issue → save →
 * send — with the stored destination the payload text trimmed (F2-10). Every case the deleted use-case spec held, plus the
 * flip's own.
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
};
const SMS: RequestOtpCommand = {
  otpDestinationType: OtpDestinationType.Sms,
  rawDestination: '+359888123456',
};

type Rig = {
  readonly world?: IdentityWorld;
  readonly deployment?: AuthDeployment;
  readonly nowUtcMs?: NowUtcMs;
  readonly failingSend?: boolean;
  readonly store?: Partial<OtpStorePorts>;
  /** The id prefix — distinct per rig when two share a world. */
  readonly idPrefix?: string;
};

function rig(options: Rig = {}) {
  const world = options.world ?? memoryIdentityWorld();
  const delivery = recordingOtpDeliveryPorts({
    failing: options.failingSend === true,
  });
  const telemetry = recordingTelemetry();
  const run = requestOtp({
    ...memoryOtpStorePorts(world),
    ...options.store,
    ...delivery.ports,
    ...fixedOtpCryptoPorts(),
    ...fixedTenantPorts(),
    authDeployment: options.deployment ?? AuthDeployment.DEFAULT,
    nowUtcMs: options.nowUtcMs ?? pinnedNowUtcMs(),
    nextId: sequentialIds(options.idPrefix ?? 'otp'),
    log: telemetry.log,
    trackError: telemetry.trackError,
  });
  return { world, delivery, telemetry, run };
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
      error: { errorCode: IdentityErrorCode.OtpRateLimited },
    });
    expect(otpsIn(world).size).toBe(1);
    expect(again.delivery.sent).toEqual([]);
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
    });
    expect(otpsIn(mail.world).get('otp-1')?.['destination']).toBe('a@b.com');
    expect(mail.delivery.sent[0]?.destination).toEqual(
      ParsedIdentifier.email(Email.of('a@b.com')),
    );

    const phone = rig({ deployment: deployment(AuthStrategyKind.PhoneOtp) });
    await phone.run({
      otpDestinationType: OtpDestinationType.Sms,
      rawDestination: ' +359888123456 ',
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
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      IdentityErrorCode.OtpChannelMismatch,
    );
  });

  it('refuses a destination that does not parse on its channel, with the channel and the text', async () => {
    const mail = await rig().run({
      otpDestinationType: OtpDestinationType.Email,
      rawDestination: 'not-an-email',
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

  it('answers a store failure of the probe or the save, sending nothing', async () => {
    const down = Result.err(RepositoryError.readFailed(Collections.Otps, 'x'));
    const probe = rig({ store: { loadOpenOtps: async () => down } });
    const probed = await probe.run(EMAIL);
    expect(!probed.ok && probed.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
    expect(probe.delivery.sent).toEqual([]);

    const save = rig({
      store: {
        saveOtp: async () =>
          Result.err(RepositoryError.writeFailed(Collections.Otps, 'x')),
      },
    });
    const saved = await save.run(EMAIL);
    expect(!saved.ok && saved.error.errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
    expect(save.delivery.sent).toEqual([]);
  });

  it('stamps the challenge with the tenant the TenantPorts answer', async () => {
    const world = memoryIdentityWorld();
    const delivery = recordingOtpDeliveryPorts();
    const telemetry = recordingTelemetry();
    await requestOtp({
      ...memoryOtpStorePorts(world),
      ...delivery.ports,
      ...fixedOtpCryptoPorts(),
      ...fixedTenantPorts(FIXTURE_TENANT_ID),
      authDeployment: AuthDeployment.DEFAULT,
      nowUtcMs: pinnedNowUtcMs(),
      nextId: sequentialIds('otp'),
      log: telemetry.log,
      trackError: telemetry.trackError,
    })(EMAIL);
    expect(otpsIn(world).get('otp-1')?.['tenantId']).toBe(FIXTURE_TENANT_ID);
  });
});
