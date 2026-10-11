import type { ParsedIdentifier } from './identifier.data';
import type { SessionKind } from './session-kind.data';

/** Auth flow step tags — the ONLY source of these strings, the discriminator `authFlowStep`. */
export const AuthFlowStep = {
  Identify: 'IDENTIFY',
  Otp: 'OTP',
  Blocked: 'BLOCKED',
  Done: 'DONE',
  Authenticated: 'AUTHENTICATED',
} as const;
export type AuthFlowStep = (typeof AuthFlowStep)[keyof typeof AuthFlowStep];

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
 * The identity flow's state — prove who the person is via a code challenge,
 * `identify → otp → authenticated | done` (the pure port of v2's
 * `auth.machine.ts`). The network never runs here: the async send and verify
 * collapse into events the store dispatches once the callables settle, and
 * `AuthFlowSystem.next(state, event)` stays a synchronous total function.
 * `error` is the last refusal to show (`null` for none) — present on every
 * step that can show one, never an optional key. In-memory UI state (F-8):
 * the parsed `identifier` stays a named reference.
 */
export type AuthFlowState =
  | AuthFlowState.Identify
  | AuthFlowState.Otp
  | AuthFlowState.Blocked
  | AuthFlowState.Done
  | AuthFlowState.Authenticated;

const IDENTIFY: AuthFlowState.Identify = {
  authFlowStep: AuthFlowStep.Identify,
  error: null,
};
const BLOCKED: AuthFlowState.Blocked = { authFlowStep: AuthFlowStep.Blocked };
const AUTHENTICATED: AuthFlowState.Authenticated = {
  authFlowStep: AuthFlowStep.Authenticated,
};

export const AuthFlowState = {
  /** The flow opens on identify — the v2 welcome interstitial is retired. */
  initial(): AuthFlowState.Identify {
    return IDENTIFY;
  },
  identify(error: string | null): AuthFlowState.Identify {
    return error === null
      ? IDENTIFY
      : { authFlowStep: AuthFlowStep.Identify, error };
  },
  otp(identifier: ParsedIdentifier, error: string | null): AuthFlowState.Otp {
    return { authFlowStep: AuthFlowStep.Otp, identifier, error };
  },
  blocked(): AuthFlowState.Blocked {
    return BLOCKED;
  },
  /** A NEW person proved the channel — onboarding follows. */
  done(
    identifier: ParsedIdentifier,
    sessionKind: SessionKind,
  ): AuthFlowState.Done {
    return { authFlowStep: AuthFlowStep.Done, identifier, sessionKind };
  },
  /** A returning person — straight into the app. */
  authenticated(): AuthFlowState.Authenticated {
    return AUTHENTICATED;
  },
  /** No outgoing transitions from here. */
  isTerminal(state: AuthFlowState): boolean {
    return (
      state.authFlowStep === AuthFlowStep.Blocked ||
      state.authFlowStep === AuthFlowStep.Done ||
      state.authFlowStep === AuthFlowStep.Authenticated
    );
  },
} as const;

export namespace AuthFlowState {
  export type Identify = {
    readonly authFlowStep: typeof AuthFlowStep.Identify;
    readonly error: string | null;
  };
  export type Otp = {
    readonly authFlowStep: typeof AuthFlowStep.Otp;
    readonly identifier: ParsedIdentifier;
    readonly error: string | null;
  };
  export type Blocked = {
    readonly authFlowStep: typeof AuthFlowStep.Blocked;
  };
  export type Done = {
    readonly authFlowStep: typeof AuthFlowStep.Done;
    readonly identifier: ParsedIdentifier;
    readonly sessionKind: SessionKind;
  };
  export type Authenticated = {
    readonly authFlowStep: typeof AuthFlowStep.Authenticated;
  };
}

/**
 * What the store tells the auth flow. `blocked` on a failure says the
 * channel is locked out (the flow ends); `message` is the refusal to show.
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
    message: string,
  ): AuthFlowEvent.RequestFailed {
    return {
      authFlowEventKind: AuthFlowEventKind.RequestFailed,
      blocked,
      message,
    };
  },
  submitOtp(): AuthFlowEvent.SubmitOtp {
    return { authFlowEventKind: AuthFlowEventKind.SubmitOtp };
  },
  verifyFailed(blocked: boolean, message: string): AuthFlowEvent.VerifyFailed {
    return {
      authFlowEventKind: AuthFlowEventKind.VerifyFailed,
      blocked,
      message,
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
    readonly message: string;
  };
  export type SubmitOtp = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.SubmitOtp;
  };
  export type VerifyFailed = {
    readonly authFlowEventKind: typeof AuthFlowEventKind.VerifyFailed;
    readonly blocked: boolean;
    readonly message: string;
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
