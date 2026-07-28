import { Result, fail, ok } from '@creativo/domain/kernel';
import { Identifier, SessionKind } from '@creativo/domain/identity';
import { InvalidAuthFlowTransitionError } from './auth-flow.errors';

/**
 * Pure port of v2's `auth.machine.ts` (`docs/migration-blueprint.md` §5.3)
 * — identity only: prove who the user is via a code challenge
 * (`identify → otp → authenticated | done`). Unlike the XState original,
 * this machine never invokes the network itself: the async
 * `sendingOtp`/`verifyingOtp` steps collapse into events the wrapping
 * feature store dispatches once `RequestOtpUseCase`/`VerifyOtpUseCase`
 * settle — `advance` stays a synchronous, side-effect-free reducer.
 *
 * The v2 `welcome` interstitial (a lone "Get started" tap for nothing) is
 * retired — with a single sign-in method the flow OPENS on `identify`
 * (auth-flow design §1.5); the identify screen carries the brand moment
 * itself. Resend cooldowns and auto-verify delays are presentational store
 * state, never machine states — the machine stays synchronous and
 * channel-agnostic.
 */
export type AuthFlowState =
  | { readonly kind: 'identify'; readonly error?: string }
  | {
      readonly kind: 'otp';
      readonly identifier: Identifier;
      readonly error?: string;
    }
  | { readonly kind: 'blocked' }
  | {
      readonly kind: 'done';
      readonly identifier: Identifier;
      readonly session: SessionKind;
    }
  | { readonly kind: 'authenticated' };

export type AuthFlowEvent =
  | { readonly type: 'submit_identifier'; readonly identifier: Identifier }
  | {
      readonly type: 'request_failed';
      readonly blocked: boolean;
      readonly message: string;
    }
  | { readonly type: 'submit_otp' }
  | {
      readonly type: 'verify_failed';
      readonly blocked: boolean;
      readonly message: string;
    }
  | { readonly type: 'verified'; readonly session: SessionKind }
  | { readonly type: 'resend_otp' }
  | { readonly type: 'change_identifier' }
  | { readonly type: 'back' };

export const AUTH_FLOW_INITIAL_STATE: AuthFlowState = { kind: 'identify' };

export function advanceAuthFlow(
  state: AuthFlowState,
  event: AuthFlowEvent,
): Result<AuthFlowState, InvalidAuthFlowTransitionError> {
  switch (state.kind) {
    case 'identify':
      if (event.type === 'submit_identifier') {
        return ok({ kind: 'otp', identifier: event.identifier });
      }
      break;

    case 'otp':
      switch (event.type) {
        case 'request_failed':
          // A (re)send failed — v2 routes this back to `identify` with the
          // error attached, rather than stranding the user on the OTP step
          // for a code that was never actually sent.
          return ok(
            event.blocked
              ? { kind: 'blocked' }
              : { kind: 'identify', error: event.message },
          );
        case 'verify_failed':
          return ok(
            event.blocked
              ? { kind: 'blocked' }
              : { ...state, error: event.message },
          );
        case 'verified':
          return ok(
            event.session.kind === 'returning'
              ? { kind: 'authenticated' }
              : {
                  kind: 'done',
                  identifier: state.identifier,
                  session: event.session,
                },
          );
        case 'change_identifier':
        case 'back':
          // Both the "Edit" affordance and the in-page Back control return
          // to identify — the identifier field stays pre-filled (feature
          // state, not machine state) and the outstanding challenge stays
          // alive in the store: resubmitting the SAME destination rejoins
          // otp without a fresh code; only a new destination re-requests.
          return ok({ kind: 'identify' });
        case 'resend_otp':
        case 'submit_otp':
          // No state change — the store awaits the use-case and dispatches
          // `verified`/`verify_failed`/`request_failed` when it settles.
          return ok(state);
        default:
          break;
      }
      break;

    case 'blocked':
    case 'done':
    case 'authenticated':
      // Terminal — no outgoing transitions (mirrors v2's terminal states).
      break;
  }

  return fail(new InvalidAuthFlowTransitionError(state.kind, event.type));
}
