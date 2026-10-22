import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';
import {
  E164,
  OtpCode,
  ParsedIdentifier,
  Registration,
  type RegistrationFields,
  SessionKind,
} from '@core/components';
import {
  IdentifierChannel,
  OtpId,
  PipelineError,
  PipelineErrorCode,
  Result,
} from '@core/primitives';
import { Callables } from '@core/ports';
import {
  type GatewayCall,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { otpChallengePorts } from './otp-challenge.adapter';

const { signInWithCustomTokenMock } = vi.hoisted(() => ({
  signInWithCustomTokenMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: signInWithCustomTokenMock,
}));

/** A brand off its smart constructor, or the spec stops. */
function brand<T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!parsed.ok) throw new Error('fixture failed its smart constructor');
  return parsed.value;
}

const auth = {} as Auth;
const PHONE = ParsedIdentifier.phone(E164.of('+359888123456'));
const CHALLENGE = brand(OtpId.parse('challenge-1'));
const CODE = brand(OtpCode.parse('123456'));

type E2eWindow = Window & { __e2eLastOtpCode?: string };

describe('otpChallengePorts', () => {
  let calls: GatewayCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    delete (window as E2eWindow).__e2eLastOtpCode;
  });

  it('requestOtpChallenge dials requestOtpChallenge with the identity call, answering the branded challenge id', async () => {
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts(
        {
          [Callables.RequestOtpChallenge]: () =>
            Result.ok({ challengeId: CHALLENGE, devCode: null }),
        },
        calls,
      ),
      document,
    );

    const result = await ports.requestOtpChallenge(PHONE);

    expect(unwrapOk(result)).toBe(CHALLENGE);
    expect(calls).toEqual([
      {
        callable: Callables.RequestOtpChallenge,
        input: {
          identifierChannel: IdentifierChannel.Phone,
          identifier: '+359888123456',
        },
      },
    ]);
  });

  it('stashes the emulator’s code for the e2e suite, and nothing in a real deployment', async () => {
    const answers = [
      { challengeId: CHALLENGE, devCode: '654321' },
      { challengeId: CHALLENGE, devCode: null },
    ];
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts({
        [Callables.RequestOtpChallenge]: () =>
          Result.ok(
            answers.shift() ?? { challengeId: CHALLENGE, devCode: null },
          ),
      }),
      document,
    );

    await ports.requestOtpChallenge(PHONE);
    expect((window as E2eWindow).__e2eLastOtpCode).toBe('654321');

    delete (window as E2eWindow).__e2eLastOtpCode;
    await ports.requestOtpChallenge(PHONE);
    expect((window as E2eWindow).__e2eLastOtpCode).toBeUndefined();
  });

  it('requestOtpChallenge answers the callable’s failure as it is classified', async () => {
    const refused = PipelineError.fromWire('functions/permission-denied', null);
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts({
        [Callables.RequestOtpChallenge]: () => Result.err(refused),
      }),
      document,
    );

    const failure = unwrapErr(await ports.requestOtpChallenge(PHONE));

    expect(failure).toBe(refused);
    expect(PipelineError.isBlocked(failure)).toBe(true);
  });

  it('verifyOtpChallenge signs in with the returned custom token and never leaks it', async () => {
    signInWithCustomTokenMock.mockResolvedValue({ user: {} });
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts(
        {
          [Callables.VerifyOtpChallenge]: () =>
            Result.ok({
              sessionKind: SessionKind.Returning,
              customToken: 'secret-token',
            }),
        },
        calls,
      ),
      document,
    );

    const result = await ports.verifyOtpChallenge(CHALLENGE, CODE);

    expect(calls[0]?.input).toEqual({ challengeId: CHALLENGE, code: CODE });
    expect(signInWithCustomTokenMock).toHaveBeenCalledWith(
      auth,
      'secret-token',
    );
    expect(unwrapOk(result)).toBe(SessionKind.Returning);
  });

  it('verifyOtpChallenge fails when sign-in with the custom token throws', async () => {
    signInWithCustomTokenMock.mockRejectedValue(new Error('bad token'));
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts({
        [Callables.VerifyOtpChallenge]: () =>
          Result.ok({ sessionKind: SessionKind.New, customToken: 't' }),
      }),
      document,
    );

    const failure = unwrapErr(await ports.verifyOtpChallenge(CHALLENGE, CODE));

    expect(failure).toEqual(PipelineError.bare(PipelineErrorCode.Unknown));
    expect(PipelineError.isBlocked(failure)).toBe(false);
  });

  it('verifyOtpChallenge never signs in on a refused code', async () => {
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts({
        [Callables.VerifyOtpChallenge]: () =>
          Result.err(PipelineError.bare(PipelineErrorCode.InvalidRequest)),
      }),
      document,
    );

    const result = await ports.verifyOtpChallenge(CHALLENGE, CODE);

    expect(result.ok).toBe(false);
    expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
  });

  it('completeRegistration forwards the identifier and fields, then signs in with the freshly-promoted token', async () => {
    signInWithCustomTokenMock.mockResolvedValue({ user: {} });
    const fields: RegistrationFields = {
      ...Registration.emptyFields(),
      firstName: 'Ivan',
      lastName: 'Petrov',
    };
    const ports = otpChallengePorts(
      auth,
      scriptedGatewayPorts(
        {
          [Callables.CompleteRegistration]: () =>
            Result.ok({ customToken: 'promoted-token' }),
        },
        calls,
      ),
      document,
    );

    const result = await ports.completeRegistration(PHONE, fields);

    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({
      callable: Callables.CompleteRegistration,
      input: {
        identifierChannel: IdentifierChannel.Phone,
        identifier: '+359888123456',
        fields,
      },
    });
    expect(signInWithCustomTokenMock).toHaveBeenCalledWith(
      auth,
      'promoted-token',
    );
  });
});
