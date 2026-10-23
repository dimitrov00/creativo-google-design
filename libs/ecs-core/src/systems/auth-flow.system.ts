import {
  AuthFlowEventKind,
  type AuthFlowEvent,
  AuthFlowState,
  AuthFlowStep,
  SessionKind,
} from '@core/components';
import { IdentityError, Result } from '@core/primitives';

/**
 * AuthFlowSystem — the identity flow's transition function (blueprint
 * §2.8), the pure port of the legacy identity application lib's `flow/
 * auth-flow.ts` (`advanceAuthFlow`): `identify → otp → authenticated | done`,
 * with `BLOCKED` for a locked-out channel.
 *
 * Total over the tagged unions: every (step, event) pair answers — the next
 * state, or `IDENTITY_AUTH_FLOW_INVALID_TRANSITION` carrying the step and the
 * event tags. The network never runs here; the async send and verify
 * collapse into the events the store dispatches once the callables settle.
 */
export const AuthFlowSystem = {
  /** The flow opens on identify — the welcome interstitial is retired. */
  initial(): AuthFlowState {
    return AuthFlowState.initial();
  },

  next(
    state: AuthFlowState,
    event: AuthFlowEvent,
  ): Result<AuthFlowState, IdentityError> {
    switch (state.authFlowStep) {
      case AuthFlowStep.Identify:
        if (event.authFlowEventKind === AuthFlowEventKind.SubmitIdentifier) {
          return Result.ok(AuthFlowState.otp(event.identifier, null));
        }
        break;

      case AuthFlowStep.Otp:
        switch (event.authFlowEventKind) {
          case AuthFlowEventKind.RequestFailed:
            // A (re)send failed: back to identify with the error attached,
            // never stranded on the code step for a code that was not sent.
            return Result.ok(
              event.blocked
                ? AuthFlowState.blocked()
                : AuthFlowState.identify(event.message),
            );
          case AuthFlowEventKind.VerifyFailed:
            return Result.ok(
              event.blocked
                ? AuthFlowState.blocked()
                : AuthFlowState.otp(state.identifier, event.message),
            );
          case AuthFlowEventKind.Verified:
            return Result.ok(
              event.sessionKind === SessionKind.Returning
                ? AuthFlowState.authenticated()
                : AuthFlowState.done(state.identifier, event.sessionKind),
            );
          case AuthFlowEventKind.ChangeIdentifier:
          case AuthFlowEventKind.Back:
            // Both return to a clean identify; the outstanding challenge
            // stays alive in the store, so the same destination rejoins.
            return Result.ok(AuthFlowState.identify(null));
          case AuthFlowEventKind.ResendOtp:
          case AuthFlowEventKind.SubmitOtp:
            // No state change — the store awaits the callable and
            // dispatches the outcome once it settles.
            return Result.ok(state);
          default:
            break;
        }
        break;

      default:
        // BLOCKED, DONE, AUTHENTICATED: terminal, no outgoing transition.
        break;
    }
    return Result.err(
      IdentityError.authFlowInvalidTransition(
        state.authFlowStep,
        event.authFlowEventKind,
      ),
    );
  },
} as const;
