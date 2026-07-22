import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import {
  Identifier,
  NEW_SESSION,
  RETURNING_SESSION,
  createIdentifier,
} from '@creativo/domain/identity';
import {
  AUTH_FLOW_INITIAL_STATE,
  AuthFlowState,
  advanceAuthFlow,
} from './auth-flow';
import { InvalidAuthFlowTransitionError } from './auth-flow.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const IDENTIFIER: Identifier = requiredValue(
  createIdentifier({ kind: 'email', value: 'client@example.com' }),
);

function advance(
  state: AuthFlowState,
  event: Parameters<typeof advanceAuthFlow>[1],
): AuthFlowState {
  return requiredValue(advanceAuthFlow(state, event));
}

describe('advanceAuthFlow', () => {
  it('walks welcome -> identify -> otp -> authenticated for a returning session', () => {
    let state = advance(AUTH_FLOW_INITIAL_STATE, { type: 'get_started' });
    expect(state.kind).toBe('identify');

    state = advance(state, {
      type: 'submit_identifier',
      identifier: IDENTIFIER,
    });
    expect(state.kind).toBe('otp');

    state = advance(state, { type: 'verified', session: RETURNING_SESSION });
    expect(state.kind).toBe('authenticated');
  });

  it('routes a new session to done, carrying the session kind', () => {
    let state = advance(AUTH_FLOW_INITIAL_STATE, { type: 'get_started' });
    state = advance(state, {
      type: 'submit_identifier',
      identifier: IDENTIFIER,
    });

    state = advance(state, { type: 'verified', session: NEW_SESSION });

    expect(state.kind).toBe('done');
    if (state.kind === 'done') {
      expect(state.session.kind).toBe('new');
    }
  });

  it('routes a blocked verify failure to the terminal blocked state', () => {
    let state = advance(AUTH_FLOW_INITIAL_STATE, { type: 'get_started' });
    state = advance(state, {
      type: 'submit_identifier',
      identifier: IDENTIFIER,
    });

    state = advance(state, {
      type: 'verify_failed',
      blocked: true,
      message: 'blocked',
    });

    expect(state.kind).toBe('blocked');
  });

  it('keeps a non-blocked verify failure on the otp step, carrying the error', () => {
    let state = advance(AUTH_FLOW_INITIAL_STATE, { type: 'get_started' });
    state = advance(state, {
      type: 'submit_identifier',
      identifier: IDENTIFIER,
    });

    state = advance(state, {
      type: 'verify_failed',
      blocked: false,
      message: 'incorrect code',
    });

    expect(state.kind).toBe('otp');
    if (state.kind === 'otp') {
      expect(state.error).toBe('incorrect code');
    }
  });

  it('routes a failed (re)send back to identify with the error attached', () => {
    let state = advance(AUTH_FLOW_INITIAL_STATE, { type: 'get_started' });
    state = advance(state, {
      type: 'submit_identifier',
      identifier: IDENTIFIER,
    });

    state = advance(state, {
      type: 'request_failed',
      blocked: false,
      message: 'rate limited',
    });

    expect(state.kind).toBe('identify');
    if (state.kind === 'identify') {
      expect(state.error).toBe('rate limited');
    }
  });

  it('rejects an illegal transition from a terminal state', () => {
    const result = advanceAuthFlow(
      { kind: 'authenticated' },
      { type: 'get_started' },
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidAuthFlowTransitionError);
    }
  });

  it('rejects submitting an identifier from the welcome state', () => {
    const result = advanceAuthFlow(AUTH_FLOW_INITIAL_STATE, {
      type: 'submit_identifier',
      identifier: IDENTIFIER,
    });
    expect(result.isFailure()).toBe(true);
  });
});
