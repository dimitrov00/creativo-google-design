import {
  AuthFlowEvent as FlowEvent,
  AuthFlowState as FlowState,
  AuthFlowStep,
  AuthFlowSystem,
  Identifier as Channel,
  IdentifierChannel,
  type ParsedIdentifier,
  SessionKind as SessionTag,
} from '@creativo/ecs-core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Identifier,
  NEW_SESSION,
  RETURNING_SESSION,
  SessionKind,
  reconstituteIdentifier,
} from '@creativo/domain/identity';
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

/*
 * Phase 2 shim (ECS migration): the transition function is
 * `AuthFlowSystem.next` (`@creativo/ecs-core`). This file keeps its legacy
 * state, event and error shapes for the store and converts at the edge — the
 * helpers below are the only code besides the delegating body.
 */

function toChannel(identifier: Identifier): ParsedIdentifier {
  return identifier.kind === 'phone'
    ? {
        identifierChannel: IdentifierChannel.Phone,
        identifier: Channel.of(identifier.value.toString()),
      }
    : {
        identifierChannel: IdentifierChannel.Email,
        identifier: Channel.of(identifier.value.toString()),
      };
}

function toSessionTag(session: SessionKind): SessionTag {
  return session.kind === 'new' ? SessionTag.New : SessionTag.Returning;
}

function toFlowState(state: AuthFlowState): FlowState {
  switch (state.kind) {
    case 'identify':
      return FlowState.identify(state.error ?? null);
    case 'otp':
      return FlowState.otp(toChannel(state.identifier), state.error ?? null);
    case 'blocked':
      return FlowState.blocked();
    case 'done':
      return FlowState.done(
        toChannel(state.identifier),
        toSessionTag(state.session),
      );
    default:
      return FlowState.authenticated();
  }
}

function toFlowEvent(event: AuthFlowEvent): FlowEvent {
  switch (event.type) {
    case 'submit_identifier':
      return FlowEvent.submitIdentifier(toChannel(event.identifier));
    case 'request_failed':
      return FlowEvent.requestFailed(event.blocked, event.message);
    case 'submit_otp':
      return FlowEvent.submitOtp();
    case 'verify_failed':
      return FlowEvent.verifyFailed(event.blocked, event.message);
    case 'verified':
      return FlowEvent.verified(toSessionTag(event.session));
    case 'resend_otp':
      return FlowEvent.resendOtp();
    case 'change_identifier':
      return FlowEvent.changeIdentifier();
    default:
      return FlowEvent.back();
  }
}

/**
 * The legacy identifier a next state carries: the caller's own object
 * whenever the system copied it from the event or the current state (it
 * only ever does), rebuilt from the canonical value otherwise.
 */
function toLegacyIdentifier(
  channel: ParsedIdentifier,
  from: AuthFlowState,
  event: AuthFlowEvent,
): Identifier {
  if (event.type === 'submit_identifier') return event.identifier;
  if (from.kind === 'otp' || from.kind === 'done') return from.identifier;
  return reconstituteIdentifier({
    kind:
      channel.identifierChannel === IdentifierChannel.Phone ? 'phone' : 'email',
    value: channel.identifier,
  });
}

/** The next state back in the legacy shape. */
function toLegacyState(
  next: FlowState,
  from: AuthFlowState,
  event: AuthFlowEvent,
): AuthFlowState {
  switch (next.authFlowStep) {
    case AuthFlowStep.Identify:
      return next.error === null
        ? { kind: 'identify' }
        : { kind: 'identify', error: next.error };
    case AuthFlowStep.Otp: {
      const identifier = toLegacyIdentifier(next.identifier, from, event);
      return next.error === null
        ? { kind: 'otp', identifier }
        : { kind: 'otp', identifier, error: next.error };
    }
    case AuthFlowStep.Blocked:
      return { kind: 'blocked' };
    case AuthFlowStep.Done:
      return {
        kind: 'done',
        identifier: toLegacyIdentifier(next.identifier, from, event),
        session:
          next.sessionKind === SessionTag.New ? NEW_SESSION : RETURNING_SESSION,
      };
    default:
      return { kind: 'authenticated' };
  }
}

export function advanceAuthFlow(
  state: AuthFlowState,
  event: AuthFlowEvent,
): Result<AuthFlowState, InvalidAuthFlowTransitionError> {
  const current = toFlowState(state);
  const next = AuthFlowSystem.next(current, toFlowEvent(event));
  if (!next.ok) {
    return fail(new InvalidAuthFlowTransitionError(state.kind, event.type));
  }
  // A self-transition (`resend_otp`, `submit_otp`) answers the very state it
  // was given — and so does this shim: the caller's own object.
  return ok(
    next.value === current ? state : toLegacyState(next.value, state, event),
  );
}
