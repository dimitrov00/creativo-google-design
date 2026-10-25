import type { AuthFailure } from '@core/errors';
import type { ParsedIdentifier } from './parsed-identifier.data';
import type { SessionKind } from './session-kind.data';

/**
 * Auth flow event tags — what the wrapping store dispatches; the
 * discriminator `authFlowEventKind` (N15: `AuthFlowEvent` is the union).
 */
export const AuthFlowEventKind = {
  SubmitIdentifier: 'SUBMIT_IDENTIFIER',
  RequestFailed: 'REQUEST_FAILED',
  SubmitOtp: 'SUBMIT_OTP',
  VerifyFailed: 'VERIFY_FAILED',
  Verified: 'VERIFIED',
  ResendOtp: 'RESEND_OTP',
  ChangeIdentifier: 'CHANGE_IDENTIFIER',
  Back: 'BACK',
} as const;
export type AuthFlowEventKind =
  (typeof AuthFlowEventKind)[keyof typeof AuthFlowEventKind];

/**
 * What the store tells the auth flow. `blocked` on a failure says the
 * channel is locked out (the flow ends); `error` is the refusal to show, as
 * its struct (`AuthFailure`, pass D §2.11).
 */
export type AuthFlowEvent =
  | AuthFlowEvent.SubmitIdentifier
  | AuthFlowEvent.RequestFailed
  | AuthFlowEvent.SubmitOtp
  | AuthFlowEvent.VerifyFailed
  | AuthFlowEvent.Verified
  | AuthFlowEvent.ResendOtp
  | AuthFlowEvent.ChangeIdentifier
  | AuthFlowEvent.Back;

export const AuthFlowEvent = {
  submitIdentifier(
    identifier: ParsedIdentifier,
  ): AuthFlowEvent.SubmitIdentifier {
    return {
      authFlowEventKind: AuthFlowEventKind.SubmitIdentifier,
      identifier,
    };
  },
  requestFailed(
    blocked: boolean,
    error: AuthFailure,
  ): AuthFlowEvent.RequestFailed {
    return {
      authFlowEventKind: AuthFlowEventKind.RequestFailed,
      blocked,
      error,
    };
  },
  submitOtp(): AuthFlowEvent.SubmitOtp {
    return { authFlowEventKind: AuthFlowEventKind.SubmitOtp };
  },
  verifyFailed(
    blocked: boolean,
    error: AuthFailure,
  ): AuthFlowEvent.VerifyFailed {
    return {
      authFlowEventKind: AuthFlowEventKind.VerifyFailed,
      blocked,
      error,
    };
  },
  verified(sessionKind: SessionKind): AuthFlowEvent.Verified {
    return { authFlowEventKind: AuthFlowEventKind.Verified, sessionKind };
  },
  resendOtp(): AuthFlowEvent.ResendOtp {
    return { authFlowEventKind: AuthFlowEventKind.ResendOtp };
  },
  changeIdentifier(): AuthFlowEvent.ChangeIdentifier {
    return { authFlowEventKind: AuthFlowEventKind.ChangeIdentifier };
  },
  back(): AuthFlowEvent.Back {
    return { authFlowEventKind: AuthFlowEventKind.Back };
  },
} as const;

export namespace AuthFlowEvent {
  export type SubmitIdentifier = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.SubmitIdentifier;
    readonly identifier: ParsedIdentifier;
  };
  export type RequestFailed = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.RequestFailed;
    readonly blocked: boolean;
    readonly error: AuthFailure;
  };
  export type SubmitOtp = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.SubmitOtp;
  };
  export type VerifyFailed = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.VerifyFailed;
    readonly blocked: boolean;
    readonly error: AuthFailure;
  };
  export type Verified = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.Verified;
    readonly sessionKind: SessionKind;
  };
  export type ResendOtp = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.ResendOtp;
  };
  export type ChangeIdentifier = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.ChangeIdentifier;
  };
  export type Back = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.Back;
  };
}
