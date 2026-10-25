import { type IdentifierChannel, OtpId, Result } from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import type { OtpCode } from './otp-code.data';
import type { ProfileEdits } from './profile-edits.data';
import { SessionKind } from './session-kind.data';
import type { RegistrationFields } from './registration-fields.data';

/**
 * THE IDENTITY WIRE (Phase 4a 4A-4) — the three OTP callables and
 * `updateProfile`. The root type is `requestOtpChallenge`'s request: the
 * channel and the identifier as typed (the server parses it with the
 * deployment's strategy). `devCode` rides only on the emulator.
 */
export type IdentityCall = {
  readonly identifierChannel: IdentifierChannel;
  readonly identifier: string;
};

export const IdentityCall = {
  decodeRequestOtpAnswer(
    raw: unknown,
  ): Result<IdentityCall.RequestOtpAnswer, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const challengeId = CallAnswer.parsed(answer, 'challengeId', OtpId.parse);
    const devCode = CallAnswer.field(answer, 'devCode') ?? null;
    if (
      challengeId === null ||
      (devCode !== null && typeof devCode !== 'string')
    ) {
      return CallAnswer.unusable();
    }
    return Result.ok({ challengeId, devCode });
  },

  decodeVerifyOtpAnswer(
    raw: unknown,
  ): Result<IdentityCall.VerifyOtpAnswer, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const sessionKind = CallAnswer.tag(answer, 'sessionKind', SessionKind);
    const customToken = CallAnswer.text(answer, 'customToken');
    return sessionKind === null || customToken === null || customToken === ''
      ? CallAnswer.unusable()
      : Result.ok({ sessionKind, customToken });
  },

  decodeCompleteRegistrationAnswer(
    raw: unknown,
  ): Result<IdentityCall.CompleteRegistrationAnswer, PipelineError> {
    const answer = CallAnswer.read(raw);
    const customToken =
      answer === null ? null : CallAnswer.text(answer, 'customToken');
    return customToken === null || customToken === ''
      ? CallAnswer.unusable()
      : Result.ok({ customToken });
  },

  decodeUpdateProfileAnswer(
    raw: unknown,
  ): Result<IdentityCall.UpdateProfileAnswer, PipelineError> {
    const answer = CallAnswer.read(raw);
    const changed = answer === null ? null : CallAnswer.flag(answer, 'changed');
    return changed === null ? CallAnswer.unusable() : Result.ok({ changed });
  },
} as const;

export namespace IdentityCall {
  export type RequestOtpAnswer = {
    readonly challengeId: OtpId;
    /** The emulator's code for the e2e suite; `null` in every real deployment. */
    readonly devCode: string | null;
  };
  export type VerifyOtp = {
    readonly challengeId: OtpId;
    readonly code: OtpCode;
  };
  export type VerifyOtpAnswer = {
    readonly sessionKind: SessionKind;
    /** Signed in with at once by the adapter; never crosses a port. */
    readonly customToken: string;
  };
  export type CompleteRegistration = {
    readonly identifierChannel: IdentifierChannel;
    readonly identifier: string;
    readonly fields: RegistrationFields;
  };
  export type CompleteRegistrationAnswer = { readonly customToken: string };
  export type UpdateProfile = ProfileEdits;
  export type UpdateProfileAnswer = {
    /** `false` for an edit equal to the stored values — nothing written. */
    readonly changed: boolean;
  };
}
