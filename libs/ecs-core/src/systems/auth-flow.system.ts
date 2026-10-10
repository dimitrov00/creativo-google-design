import {
  AuthFlowEventKind,
  type AuthFlowEvent,
  AuthFlowState,
  AuthFlowStep,
} from '../components/auth-flow.data';
import { IdentityError } from '../components/identity-errors.data';
import { Result } from '../components/result.data';
import { SessionKind } from '../components/session-kind.data';

/**
 * AuthFlowSystem — the identity flow's transition function (blueprint
 * §2.8), the pure port of `libs/application/identity/src/lib/flow/
 * auth-flow.ts` (`advanceAuthFlow`): `identify → otp → authenticated | done`,
 * with `blocked` for a locked-out channel.
 *
 * Total over the tagged unions: every (step, event) pair answers — the next
 * state, or `identity.auth_flow.invalid_transition` carrying the step and the
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
    switch (state.kind) {
      case AuthFlowStep.Identify:
        if (event.kind === AuthFlowEventKind.SubmitIdentifier) {
          return Result.ok(AuthFlowState.otp(event.identifier, null));
        }
        break;

      case AuthFlowStep.Otp:
        switch (event.kind) {
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
              event.session === SessionKind.Returning
                ? AuthFlowState.authenticated()
                : AuthFlowState.done(state.identifier, event.session),
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
        // blocked, done, authenticated: terminal, no outgoing transition.
        break;
    }
    return Result.err(
      IdentityError.authFlowInvalidTransition(state.kind, event.kind),
    );
  },
} as const;
