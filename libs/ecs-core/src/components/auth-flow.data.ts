import type { AuthFailure } from '@core/errors';
import type { ParsedIdentifier } from './parsed-identifier.data';
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
 * The identity flow's state — prove who the person is via a code challenge,
 * `identify → otp → authenticated | done` (the pure port of v2's
 * `auth.machine.ts`). The network never runs here: the async send and verify
 * collapse into events the store dispatches once the callables settle, and
 * `AuthFlowSystem.next(state, event)` stays a synchronous total function.
 * `error` is the last refusal to show (`null` for none) — present on every
 * step that can show one, never an optional key — as its struct
 * (`AuthFailure`: an identity refusal, or the callable's failure as the
 * gateway answered it), so its params survive to the words (Law 7.5, pass D
 * §2.11). In-memory UI state (F-8): the parsed `identifier` stays a named
 * reference.
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
  identify(error: AuthFailure | null): AuthFlowState.Identify {
    return error === null
      ? IDENTIFY
      : { authFlowStep: AuthFlowStep.Identify, error };
  },
  otp(
    identifier: ParsedIdentifier,
    error: AuthFailure | null,
  ): AuthFlowState.Otp {
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
    readonly error: AuthFailure | null;
  };
  export type Otp = {
    readonly authFlowStep: typeof AuthFlowStep.Otp;
    readonly identifier: ParsedIdentifier;
    readonly error: AuthFailure | null;
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
