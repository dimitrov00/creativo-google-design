import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AuthFlowEvent,
  AuthFlowEventKind,
  AuthFlowState,
  AuthFlowStep,
  Email,
  type ParsedIdentifier,
  ParsedIdentifier as Parsed,
  SessionKind,
} from '@core/components';
import { IdentityErrorCode } from '@core/primitives';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { AuthFlowSystem } from './auth-flow.system';

/*
 * The cases of the legacy identity application lib's `auth-flow.spec.ts`
 * (deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), COPIED and re-targeted: `advanceAuthFlow` → `AuthFlowSystem.next`,
 * the `{ type }` events → the `AuthFlowEvent` companion, `isSuccess(r)` →
 * `r.ok`, the `InvalidAuthFlowTransitionError` class → the
 * `IDENTITY_AUTH_FLOW_INVALID_TRANSITION` struct.
 */

const IDENTIFIER: ParsedIdentifier = Parsed.email(
  Email.of('client@example.com'),
);

function advance(state: AuthFlowState, event: AuthFlowEvent): AuthFlowState {
  return unwrapOk(AuthFlowSystem.next(state, event));
}

const submitted = (): AuthFlowState =>
  advance(AuthFlowSystem.initial(), AuthFlowEvent.submitIdentifier(IDENTIFIER));

describe('AuthFlowSystem.next', () => {
  it('opens on identify — the welcome interstitial is retired (design §1.5)', () => {
    expect(AuthFlowSystem.initial().authFlowStep).toBe(AuthFlowStep.Identify);
  });

  it('walks identify -> otp -> authenticated for a returning session', () => {
    let state = submitted();
    expect(state.authFlowStep).toBe(AuthFlowStep.Otp);

    state = advance(state, AuthFlowEvent.verified(SessionKind.Returning));
    expect(state.authFlowStep).toBe(AuthFlowStep.Authenticated);
  });

  it('routes a new session to done, carrying the session kind', () => {
    const state = advance(submitted(), AuthFlowEvent.verified(SessionKind.New));

    expect(state.authFlowStep).toBe(AuthFlowStep.Done);
    if (state.authFlowStep === AuthFlowStep.Done) {
      expect(state.sessionKind).toBe(SessionKind.New);
      expect(state.identifier).toEqual(IDENTIFIER);
    }
  });

  it('routes a blocked verify failure to the terminal blocked state', () => {
    const state = advance(
      submitted(),
      AuthFlowEvent.verifyFailed(true, 'blocked'),
    );
    expect(state.authFlowStep).toBe(AuthFlowStep.Blocked);
  });

  it('keeps a non-blocked verify failure on the otp step, carrying the error', () => {
    const state = advance(
      submitted(),
      AuthFlowEvent.verifyFailed(false, 'incorrect code'),
    );

    expect(state.authFlowStep).toBe(AuthFlowStep.Otp);
    if (state.authFlowStep === AuthFlowStep.Otp) {
      expect(state.error).toBe('incorrect code');
      expect(state.identifier).toEqual(IDENTIFIER);
    }
  });

  it('routes a failed (re)send back to identify with the error attached', () => {
    const state = advance(
      submitted(),
      AuthFlowEvent.requestFailed(false, 'rate limited'),
    );

    expect(state.authFlowStep).toBe(AuthFlowStep.Identify);
    if (state.authFlowStep === AuthFlowStep.Identify) {
      expect(state.error).toBe('rate limited');
    }
  });

  it('routes a blocked (re)send failure to the terminal blocked state', () => {
    const state = advance(
      submitted(),
      AuthFlowEvent.requestFailed(true, 'blocked'),
    );
    expect(state.authFlowStep).toBe(AuthFlowStep.Blocked);
  });

  it.each([AuthFlowEvent.changeIdentifier(), AuthFlowEvent.back()])(
    'returns from otp to a clean identify on $authFlowEventKind',
    (event) => {
      // Even with an error attached, leaving the otp step drops it.
      let state = advance(
        submitted(),
        AuthFlowEvent.verifyFailed(false, 'incorrect code'),
      );

      state = advance(state, event);

      expect(state).toEqual(AuthFlowState.identify(null));
    },
  );

  it('re-enters otp after change_identifier with a fresh submit_identifier', () => {
    let state = advance(submitted(), AuthFlowEvent.changeIdentifier());
    state = advance(state, AuthFlowEvent.submitIdentifier(IDENTIFIER));

    expect(state.authFlowStep).toBe(AuthFlowStep.Otp);
  });

  it('stays on otp for the self-transitions resend_otp and submit_otp', () => {
    const otp = submitted();

    expect(advance(otp, AuthFlowEvent.resendOtp())).toEqual(otp);
    expect(advance(otp, AuthFlowEvent.submitOtp())).toEqual(otp);
  });

  it('rejects an illegal transition from a terminal state', () => {
    const error = unwrapErr(
      AuthFlowSystem.next(AuthFlowState.authenticated(), AuthFlowEvent.back()),
    );
    expect(error).toEqual({
      errorCode: IdentityErrorCode.AuthFlowInvalidTransition,
      from: AuthFlowStep.Authenticated,
      event: AuthFlowEventKind.Back,
    });
  });

  it('rejects back from identify — there is no earlier step to return to', () => {
    const result = AuthFlowSystem.next(
      AuthFlowSystem.initial(),
      AuthFlowEvent.back(),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects verifying from the identify state', () => {
    const result = AuthFlowSystem.next(
      AuthFlowSystem.initial(),
      AuthFlowEvent.verified(SessionKind.Returning),
    );
    expect(result.ok).toBe(false);
  });
});

describe('AuthFlowSystem properties', () => {
  const states: readonly AuthFlowState[] = [
    AuthFlowState.initial(),
    AuthFlowState.identify('rate limited'),
    AuthFlowState.otp(IDENTIFIER, null),
    AuthFlowState.otp(IDENTIFIER, 'incorrect code'),
    AuthFlowState.blocked(),
    AuthFlowState.done(IDENTIFIER, SessionKind.New),
    AuthFlowState.authenticated(),
  ];
  const events: readonly AuthFlowEvent[] = [
    AuthFlowEvent.submitIdentifier(IDENTIFIER),
    AuthFlowEvent.requestFailed(false, 'x'),
    AuthFlowEvent.requestFailed(true, 'x'),
    AuthFlowEvent.submitOtp(),
    AuthFlowEvent.verifyFailed(false, 'x'),
    AuthFlowEvent.verifyFailed(true, 'x'),
    AuthFlowEvent.verified(SessionKind.New),
    AuthFlowEvent.verified(SessionKind.Returning),
    AuthFlowEvent.resendOtp(),
    AuthFlowEvent.changeIdentifier(),
    AuthFlowEvent.back(),
  ];

  it('is total: every (state, event) pair answers, and a terminal state refuses everything', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...states),
        fc.constantFrom(...events),
        (state, event) => {
          const result = AuthFlowSystem.next(state, event);
          if (AuthFlowState.isTerminal(state)) {
            expect(result.ok).toBe(false);
          }
          if (!result.ok) {
            expect(result.error).toEqual({
              errorCode: IdentityErrorCode.AuthFlowInvalidTransition,
              from: state.authFlowStep,
              event: event.authFlowEventKind,
            });
          }
        },
      ),
    );
  });
});

describe('AuthFlowSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const state = deepFreeze(AuthFlowState.otp(IDENTIFIER, 'incorrect code'));
    const event = deepFreeze(AuthFlowEvent.verified(SessionKind.New));
    const once = AuthFlowSystem.next(state, event);
    const twice = AuthFlowSystem.next(state, event);
    expect(twice).toEqual(once);
    expect(state).toEqual(AuthFlowState.otp(IDENTIFIER, 'incorrect code'));
  });
});
