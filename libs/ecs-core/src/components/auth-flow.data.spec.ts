import { describe, expect, it } from 'vitest';
import { Email } from './email.data';
import {
  AuthFlowEvent,
  AuthFlowEventKind,
  AuthFlowState,
  AuthFlowStep,
} from './auth-flow.data';
import { ParsedIdentifier } from './identifier.data';
import { SessionKind } from './session-kind.data';

const identifier = ParsedIdentifier.email(Email.of('client@example.com'));

describe('AuthFlowState', () => {
  it('opens on identify with no error, a shared struct', () => {
    expect(AuthFlowState.initial()).toEqual({ kind: 'identify', error: null });
    expect(AuthFlowState.initial()).toBe(AuthFlowState.identify(null));
  });

  it('identify(error) carries the refusal to show', () => {
    expect(AuthFlowState.identify('identity.identifier.invalid')).toEqual({
      kind: AuthFlowStep.Identify,
      error: 'identity.identifier.invalid',
    });
  });

  it('otp() carries the channel and the last refusal, every key present', () => {
    expect(AuthFlowState.otp(identifier, null)).toEqual({
      kind: 'otp',
      identifier: { kind: 'email', value: 'client@example.com' },
      error: null,
    });
  });

  it('done() carries the channel and the session kind of a new person', () => {
    expect(AuthFlowState.done(identifier, SessionKind.New)).toEqual({
      kind: 'done',
      identifier,
      session: 'new',
    });
  });

  it('blocked, done and authenticated are terminal; identify and otp are not', () => {
    expect(AuthFlowState.isTerminal(AuthFlowState.blocked())).toBe(true);
    expect(AuthFlowState.isTerminal(AuthFlowState.authenticated())).toBe(true);
    expect(
      AuthFlowState.isTerminal(AuthFlowState.done(identifier, SessionKind.New)),
    ).toBe(true);
    expect(AuthFlowState.isTerminal(AuthFlowState.initial())).toBe(false);
    expect(AuthFlowState.isTerminal(AuthFlowState.otp(identifier, null))).toBe(
      false,
    );
    expect(AuthFlowState.blocked()).toEqual({ kind: 'blocked' });
    expect(AuthFlowState.authenticated()).toEqual({ kind: 'authenticated' });
  });
});

describe('AuthFlowEvent — each event built from its tag', () => {
  it('carries the payload each event names, and nothing else', () => {
    expect(AuthFlowEvent.submitIdentifier(identifier)).toEqual({
      kind: AuthFlowEventKind.SubmitIdentifier,
      identifier,
    });
    expect(AuthFlowEvent.requestFailed(true, 'locked')).toEqual({
      kind: AuthFlowEventKind.RequestFailed,
      blocked: true,
      message: 'locked',
    });
    expect(AuthFlowEvent.verifyFailed(false, 'wrong code')).toEqual({
      kind: AuthFlowEventKind.VerifyFailed,
      blocked: false,
      message: 'wrong code',
    });
    expect(AuthFlowEvent.verified(SessionKind.Returning)).toEqual({
      kind: AuthFlowEventKind.Verified,
      session: SessionKind.Returning,
    });
    expect([
      AuthFlowEvent.submitOtp(),
      AuthFlowEvent.resendOtp(),
      AuthFlowEvent.changeIdentifier(),
      AuthFlowEvent.back(),
    ]).toEqual([
      { kind: AuthFlowEventKind.SubmitOtp },
      { kind: AuthFlowEventKind.ResendOtp },
      { kind: AuthFlowEventKind.ChangeIdentifier },
      { kind: AuthFlowEventKind.Back },
    ]);
  });
});
