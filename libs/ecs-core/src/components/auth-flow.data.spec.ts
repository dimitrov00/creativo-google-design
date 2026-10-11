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
    expect(AuthFlowState.initial()).toEqual({
      authFlowStep: 'IDENTIFY',
      error: null,
    });
    expect(AuthFlowState.initial()).toBe(AuthFlowState.identify(null));
  });

  it('identify(error) carries the refusal to show', () => {
    expect(AuthFlowState.identify('IDENTITY_IDENTIFIER_INVALID')).toEqual({
      authFlowStep: AuthFlowStep.Identify,
      error: 'IDENTITY_IDENTIFIER_INVALID',
    });
  });

  it('otp() carries the channel and the last refusal, every key present', () => {
    expect(AuthFlowState.otp(identifier, null)).toEqual({
      authFlowStep: 'OTP',
      identifier: {
        identifierChannel: 'EMAIL',
        identifier: 'client@example.com',
      },
      error: null,
    });
  });

  it('done() carries the channel and the session kind of a new person', () => {
    expect(AuthFlowState.done(identifier, SessionKind.New)).toEqual({
      authFlowStep: 'DONE',
      identifier,
      sessionKind: 'NEW',
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
    expect(AuthFlowState.blocked()).toEqual({ authFlowStep: 'BLOCKED' });
    expect(AuthFlowState.authenticated()).toEqual({
      authFlowStep: 'AUTHENTICATED',
    });
  });
});

describe('AuthFlowEvent — each event built from its tag', () => {
  it('carries the payload each event names, and nothing else', () => {
    expect(AuthFlowEvent.submitIdentifier(identifier)).toEqual({
      authFlowEventKind: AuthFlowEventKind.SubmitIdentifier,
      identifier,
    });
    expect(AuthFlowEvent.requestFailed(true, 'locked')).toEqual({
      authFlowEventKind: AuthFlowEventKind.RequestFailed,
      blocked: true,
      message: 'locked',
    });
    expect(AuthFlowEvent.verifyFailed(false, 'wrong code')).toEqual({
      authFlowEventKind: AuthFlowEventKind.VerifyFailed,
      blocked: false,
      message: 'wrong code',
    });
    expect(AuthFlowEvent.verified(SessionKind.Returning)).toEqual({
      authFlowEventKind: AuthFlowEventKind.Verified,
      sessionKind: SessionKind.Returning,
    });
    expect([
      AuthFlowEvent.submitOtp(),
      AuthFlowEvent.resendOtp(),
      AuthFlowEvent.changeIdentifier(),
      AuthFlowEvent.back(),
    ]).toEqual([
      { authFlowEventKind: AuthFlowEventKind.SubmitOtp },
      { authFlowEventKind: AuthFlowEventKind.ResendOtp },
      { authFlowEventKind: AuthFlowEventKind.ChangeIdentifier },
      { authFlowEventKind: AuthFlowEventKind.Back },
    ]);
  });
});
