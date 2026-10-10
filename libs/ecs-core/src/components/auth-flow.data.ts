import type { ParsedIdentifier } from './identifier.data';
import type { SessionKind } from './session-kind.data';

/** Auth flow step tags — the ONLY source of these strings. */
export const AuthFlowStep = {
  Identify: 'identify',
  Otp: 'otp',
  Blocked: 'blocked',
  Done: 'done',
  Authenticated: 'authenticated',
} as const;
export type AuthFlowStep = (typeof AuthFlowStep)[keyof typeof AuthFlowStep];

/** Auth flow event tags — what the wrapping store dispatches. */
export const AuthFlowEventKind = {
  SubmitIdentifier: 'submit_identifier',
  RequestFailed: 'request_failed',
  SubmitOtp: 'submit_otp',
  VerifyFailed: 'verify_failed',
  Verified: 'verified',
  ResendOtp: 'resend_otp',
  ChangeIdentifier: 'change_identifier',
  Back: 'back',
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
 * step that can show one, never an optional key.
 */
export type AuthFlowState =
  | AuthFlowState.Identify
  | AuthFlowState.Otp
  | AuthFlowState.Blocked
  | AuthFlowState.Done
  | AuthFlowState.Authenticated;

const IDENTIFY: AuthFlowState.Identify = {
  kind: AuthFlowStep.Identify,
  error: null,
};
const BLOCKED: AuthFlowState.Blocked = { kind: AuthFlowStep.Blocked };
const AUTHENTICATED: AuthFlowState.Authenticated = {
  kind: AuthFlowStep.Authenticated,
};

export const AuthFlowState = {
  /** The flow opens on identify — the v2 welcome interstitial is retired. */
  initial(): AuthFlowState.Identify {
    return IDENTIFY;
  },
  identify(error: string | null): AuthFlowState.Identify {
    return error === null ? IDENTIFY : { kind: AuthFlowStep.Identify, error };
  },
  otp(identifier: ParsedIdentifier, error: string | null): AuthFlowState.Otp {
    return { kind: AuthFlowStep.Otp, identifier, error };
  },
  blocked(): AuthFlowState.Blocked {
    return BLOCKED;
  },
  /** A NEW person proved the channel — onboarding follows. */
  done(identifier: ParsedIdentifier, session: SessionKind): AuthFlowState.Done {
    return { kind: AuthFlowStep.Done, identifier, session };
  },
  /** A returning person — straight into the app. */
  authenticated(): AuthFlowState.Authenticated {
    return AUTHENTICATED;
  },
  /** No outgoing transitions from here. */
  isTerminal(state: AuthFlowState): boolean {
    return (
      state.kind === AuthFlowStep.Blocked ||
      state.kind === AuthFlowStep.Done ||
      state.kind === AuthFlowStep.Authenticated
    );
  },
} as const;

export namespace AuthFlowState {
  export type Identify = {
    readonly kind: typeof AuthFlowStep.Identify;
    readonly error: string | null;
  };
  export type Otp = {
    readonly kind: typeof AuthFlowStep.Otp;
    readonly identifier: ParsedIdentifier;
    readonly error: string | null;
  };
  export type Blocked = {
    readonly kind: typeof AuthFlowStep.Blocked;
  };
  export type Done = {
    readonly kind: typeof AuthFlowStep.Done;
    readonly identifier: ParsedIdentifier;
    readonly session: SessionKind;
  };
  export type Authenticated = {
    readonly kind: typeof AuthFlowStep.Authenticated;
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
    return { kind: AuthFlowEventKind.SubmitIdentifier, identifier };
  },
  requestFailed(
    blocked: boolean,
    message: string,
  ): AuthFlowEvent.RequestFailed {
    return { kind: AuthFlowEventKind.RequestFailed, blocked, message };
  },
  submitOtp(): AuthFlowEvent.SubmitOtp {
    return { kind: AuthFlowEventKind.SubmitOtp };
  },
  verifyFailed(blocked: boolean, message: string): AuthFlowEvent.VerifyFailed {
    return { kind: AuthFlowEventKind.VerifyFailed, blocked, message };
  },
  verified(session: SessionKind): AuthFlowEvent.Verified {
    return { kind: AuthFlowEventKind.Verified, session };
  },
  resendOtp(): AuthFlowEvent.ResendOtp {
    return { kind: AuthFlowEventKind.ResendOtp };
  },
  changeIdentifier(): AuthFlowEvent.ChangeIdentifier {
    return { kind: AuthFlowEventKind.ChangeIdentifier };
  },
  back(): AuthFlowEvent.Back {
    return { kind: AuthFlowEventKind.Back };
  },
} as const;

export namespace AuthFlowEvent {
  export type SubmitIdentifier = {
    readonly kind: typeof AuthFlowEventKind.SubmitIdentifier;
    readonly identifier: ParsedIdentifier;
  };
  export type RequestFailed = {
    readonly kind: typeof AuthFlowEventKind.RequestFailed;
    readonly blocked: boolean;
    readonly message: string;
  };
  export type SubmitOtp = {
    readonly kind: typeof AuthFlowEventKind.SubmitOtp;
  };
  export type VerifyFailed = {
    readonly kind: typeof AuthFlowEventKind.VerifyFailed;
    readonly blocked: boolean;
    readonly message: string;
  };
  export type Verified = {
    readonly kind: typeof AuthFlowEventKind.Verified;
    readonly session: SessionKind;
  };
  export type ResendOtp = {
    readonly kind: typeof AuthFlowEventKind.ResendOtp;
  };
  export type ChangeIdentifier = {
    readonly kind: typeof AuthFlowEventKind.ChangeIdentifier;
  };
  export type Back = {
    readonly kind: typeof AuthFlowEventKind.Back;
  };
}
