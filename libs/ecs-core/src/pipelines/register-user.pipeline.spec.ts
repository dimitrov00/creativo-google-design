import { describe, expect, it } from 'vitest';
import {
  AuthDeployment,
  AuthStrategyKind,
  E164,
  ParsedIdentifier,
  RegistrationField,
  type RegistrationFields,
} from '@core/components';
import { IdentityErrorCode } from '@core/primitives';
import { type OtpChallengeCall, memoryOtpChallengePorts } from '@core/testing';
import { registerUser } from './register-user.pipeline';

/*
 * The cases of `RegisterUserUseCase`'s spec (`libs/application/identity`,
 * deleted in 4b): the deployment's strategy gates the call; the identifier
 * satisfies its own channel's field; optional extras go through untouched.
 */
const PHONE = ParsedIdentifier.phone(E164.of('+359881234567'));

const fields = (given: Partial<RegistrationFields>): RegistrationFields => ({
  [RegistrationField.Phone]: null,
  [RegistrationField.Email]: null,
  [RegistrationField.FirstName]: null,
  [RegistrationField.LastName]: null,
  [RegistrationField.BirthDate]: null,
  ...given,
});

/** A phone-OTP deployment requiring the phone and both names. */
const PHONE_DEPLOYMENT: AuthDeployment = {
  ...AuthDeployment.DEFAULT,
  strategy: {
    ...AuthDeployment.DEFAULT.strategy,
    authStrategyKind: AuthStrategyKind.PhoneOtp,
    required: [
      RegistrationField.Phone,
      RegistrationField.FirstName,
      RegistrationField.LastName,
    ],
  } as AuthDeployment['strategy'],
};

function rig() {
  const calls: OtpChallengeCall[] = [];
  const run = registerUser({
    ...memoryOtpChallengePorts({ calls }),
    authDeployment: PHONE_DEPLOYMENT,
  });
  return { run, calls };
}

describe('registerUser — the about step’s submit', () => {
  it('completes registration once every required field is present', async () => {
    const { run, calls } = rig();
    const result = await run(
      PHONE,
      fields({ phone: '+359881234567', firstName: 'Jane', lastName: 'Doe' }),
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('refuses a missing required field, naming it, without calling', async () => {
    const { run, calls } = rig();
    expect(await run(PHONE, fields({ firstName: 'Jane' }))).toEqual({
      ok: false,
      error: {
        errorCode: IdentityErrorCode.RegistrationFieldMissing,
        field: RegistrationField.LastName,
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('forwards an optional birth date the strategy does not require', async () => {
    const { run, calls } = rig();
    await run(
      PHONE,
      fields({ firstName: 'Jane', lastName: 'Doe', birthDate: '1990-07-03' }),
    );
    const [call] = calls;
    expect(call?.otpCall === 'COMPLETE' && call.fields.birthDate).toBe(
      '1990-07-03',
    );
  });

  it('treats the identifier itself as its own field — the about step never re-collects it', async () => {
    const { run, calls } = rig();
    const result = await run(
      PHONE,
      fields({ firstName: 'Ada', lastName: 'Lovelace' }),
    );
    expect(result.ok).toBe(true);
    const [call] = calls;
    expect(call?.otpCall === 'COMPLETE' && call.fields.phone).toBe(
      '+359881234567',
    );
  });
});
