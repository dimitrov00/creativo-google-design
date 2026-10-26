import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthFlowStep,
  Email,
  ParsedIdentifier,
  SessionKind,
} from '@core/components';
import { OtpId, Result } from '@core/primitives';
import {
  IdentityError,
  IdentityErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { OtpLimits } from '@core/systems';
import { memoryOtpChallengePorts } from '@core/testing';
import { OTP_CHALLENGE_PORTS } from '@creativo/infrastructure/firebase-app';
import { AuthFlowStore } from './auth-flow.store';

/** The server's resend window, the ONE source the countdown reads (OR-9). */
const WINDOW = OtpLimits.ResendWindowSeconds;

function emailIdentifier(raw: string): ParsedIdentifier {
  const email = Email.parse(raw);
  if (email === null) throw new Error('unexpected failure in fixture');
  return ParsedIdentifier.email(email);
}

function requiredIdentifier(): ParsedIdentifier {
  return emailIdentifier('client@example.com');
}

/**
 * A throttled send as the gateway answers it: `IDENTITY_OTP_RATE_LIMITED`
 * on `resource-exhausted`, the seconds left on the window in the refusal's
 * allowlisted context (`serverParams.retryAfterSeconds`, OR-9) — or no
 * figure at all, when `null`.
 */
function rateLimited(retryAfterSeconds: number | null): PipelineError {
  const refused = PipelineError.fromWire('resource-exhausted', {
    errorCode: IdentityErrorCode.OtpRateLimited,
  });
  return {
    ...refused,
    serverParams: retryAfterSeconds === null ? {} : { retryAfterSeconds },
  };
}

describe('AuthFlowStore', () => {
  const requestChallenge = vi.fn();
  const verifyChallenge = vi.fn();
  let store: AuthFlowStore;

  beforeEach(() => {
    vi.useFakeTimers();
    requestChallenge
      .mockReset()
      .mockResolvedValue(Result.ok(OtpId.of('challenge_1')));
    verifyChallenge
      .mockReset()
      .mockResolvedValue(Result.ok(SessionKind.Returning));

    TestBed.configureTestingModule({
      providers: [
        AuthFlowStore,
        {
          provide: OTP_CHALLENGE_PORTS,
          useValue: {
            ...memoryOtpChallengePorts(),
            requestOtpChallenge: requestChallenge,
            verifyOtpChallenge: verifyChallenge,
          },
        },
      ],
    });
    store = TestBed.inject(AuthFlowStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens on identify', () => {
    expect(store.state().authFlowStep).toBe(AuthFlowStep.Identify);
  });

  it('starts the resend countdown at the server’s 60 s window after a successful initial send (OR-9)', async () => {
    await store.submitIdentifier(requiredIdentifier());

    expect(store.state().authFlowStep).toBe(AuthFlowStep.Otp);
    expect(store.sendCount()).toBe(1);
    // The server's own window (`OtpLimits.ResendWindowSeconds`), never a
    // client figure of its own — the 30 s one is retired (DEP-F8).
    expect(store.resendSecondsLeft()).toBe(60);
    expect(store.resendSecondsLeft()).toBe(WINDOW);
    expect(store.canResend()).toBe(false);
  });

  it('counts the cooldown down to zero, one second at a time', async () => {
    await store.submitIdentifier(requiredIdentifier());

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.resendSecondsLeft()).toBe(WINDOW - 1);

    await vi.advanceTimersByTimeAsync((WINDOW - 1) * 1000);
    expect(store.resendSecondsLeft()).toBe(0);
    expect(store.canResend()).toBe(true);
  });

  it('refuses to resend while the cooldown is running', async () => {
    await store.submitIdentifier(requiredIdentifier());
    expect(requestChallenge).toHaveBeenCalledTimes(1);

    await store.resend();

    expect(requestChallenge).toHaveBeenCalledTimes(1);
  });

  it('resends after the cooldown, restarting it and counting the send', async () => {
    await store.submitIdentifier(requiredIdentifier());
    await vi.advanceTimersByTimeAsync(WINDOW * 1000);
    expect(store.canResend()).toBe(true);

    await store.resend();

    expect(requestChallenge).toHaveBeenCalledTimes(2);
    expect(store.sendCount()).toBe(2);
    expect(store.resendSecondsLeft()).toBe(WINDOW);
  });

  it('turns a throttled resend into a countdown restarted at the server’s figure — no error, the sent code still verifies (OR-9, DEP-F8)', async () => {
    await store.submitIdentifier(requiredIdentifier());
    await vi.advanceTimersByTimeAsync(WINDOW * 1000);
    requestChallenge.mockResolvedValue(Result.err(rateLimited(42)));

    await store.resend();

    expect(requestChallenge).toHaveBeenCalledTimes(2);
    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Otp,
      identifier: requiredIdentifier(),
      error: null,
    });
    expect(store.resendSecondsLeft()).toBe(42);
    expect(store.canResend()).toBe(false);
    // No code went out: the count stands, and the first code still verifies.
    expect(store.sendCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.resendSecondsLeft()).toBe(41);
    await vi.advanceTimersByTimeAsync(41 * 1000);
    expect(store.canResend()).toBe(true);

    await store.submitCode('123456');
    expect(verifyChallenge).toHaveBeenCalledWith('challenge_1', '123456');
  });

  it('waits out the whole window when a throttled resend names no figure', async () => {
    await store.submitIdentifier(requiredIdentifier());
    await vi.advanceTimersByTimeAsync(WINDOW * 1000);
    requestChallenge.mockResolvedValue(Result.err(rateLimited(null)));

    await store.resend();

    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Otp,
      identifier: requiredIdentifier(),
      error: null,
    });
    expect(store.resendSecondsLeft()).toBe(WINDOW);
  });

  it('still returns to identify when a resend fails for any other reason', async () => {
    await store.submitIdentifier(requiredIdentifier());
    await vi.advanceTimersByTimeAsync(WINDOW * 1000);
    const unavailable = PipelineError.bare(PipelineErrorCode.Unavailable);
    requestChallenge.mockResolvedValue(Result.err(unavailable));

    await store.resend();

    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Identify,
      error: unavailable,
    });
  });

  it('escalates from the third send of one identifier on (OR-10)', async () => {
    await store.submitIdentifier(requiredIdentifier());
    expect(store.escalated()).toBe(false);

    await vi.advanceTimersByTimeAsync(WINDOW * 1000);
    await store.resend();
    expect(store.sendCount()).toBe(2);
    expect(store.escalated()).toBe(false);

    await vi.advanceTimersByTimeAsync(WINDOW * 1000);
    await store.resend();
    expect(store.sendCount()).toBe(3);
    expect(store.escalated()).toBe(true);

    // A new destination is a new attempt — the footnote goes with the count.
    store.changeIdentifier();
    await store.submitIdentifier(emailIdentifier('other@example.com'));
    expect(store.sendCount()).toBe(1);
    expect(store.escalated()).toBe(false);
  });

  it('keeps the outstanding challenge alive across change_identifier — an accidental back must not burn the sent code', async () => {
    await store.submitIdentifier(requiredIdentifier());
    await vi.advanceTimersByTimeAsync(5000);

    store.changeIdentifier();

    expect(store.state().authFlowStep).toBe(AuthFlowStep.Identify);
    // Cooldown and send count survive — the code is still in the inbox.
    expect(store.sendCount()).toBe(1);
    expect(store.resendSecondsLeft()).toBe(WINDOW - 5);
  });

  it('rejoins the otp step without a second send when the SAME identifier is resubmitted', async () => {
    await store.submitIdentifier(requiredIdentifier());
    store.changeIdentifier();
    await vi.advanceTimersByTimeAsync(3000);

    await store.submitIdentifier(requiredIdentifier());

    expect(store.state().authFlowStep).toBe(AuthFlowStep.Otp);
    expect(requestChallenge).toHaveBeenCalledTimes(1);
    expect(store.sendCount()).toBe(1);
    expect(store.resendSecondsLeft()).toBe(WINDOW - 3);
  });

  it('still verifies against the original challenge after a back-and-rejoin', async () => {
    await store.submitIdentifier(requiredIdentifier());
    store.changeIdentifier();
    await store.submitIdentifier(requiredIdentifier());

    await store.submitCode('123456');

    expect(verifyChallenge).toHaveBeenCalledTimes(1);
    expect(verifyChallenge.mock.calls[0]![0]).toBe('challenge_1');
  });

  it('resets cooldown and send count for a DIFFERENT identifier — a new destination is a new attempt', async () => {
    await store.submitIdentifier(requiredIdentifier());
    await vi.advanceTimersByTimeAsync(5000);
    store.changeIdentifier();

    requestChallenge.mockResolvedValue(Result.ok(OtpId.of('challenge_2')));
    await store.submitIdentifier(emailIdentifier('other@example.com'));

    expect(store.state().authFlowStep).toBe(AuthFlowStep.Otp);
    expect(requestChallenge).toHaveBeenCalledTimes(2);
    expect(store.sendCount()).toBe(1);
    expect(store.resendSecondsLeft()).toBe(WINDOW);

    await store.submitCode('123456');
    expect(verifyChallenge.mock.calls[0]![0]).toBe('challenge_2');
  });

  it('keeps the server code of a refused verify as the error on the otp step', async () => {
    const refused = PipelineError.fromWire('invalid-argument', {
      errorCode: 'IDENTITY_OTP_WRONG_CODE',
    });
    verifyChallenge.mockResolvedValue(Result.err(refused));
    await store.submitIdentifier(requiredIdentifier());

    const session = await store.submitCode('123456');

    expect(session).toBeNull();
    // The failed call itself, as its struct (pass D §2.11) — its server code
    // is what the otp line words (`wordFlowFailure`).
    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Otp,
      identifier: requiredIdentifier(),
      error: refused,
    });
    expect(refused.serverErrorCode).toBe('IDENTITY_OTP_WRONG_CODE');
  });

  it('refuses a code that is not six digits as a wrong code, without dialling the server', async () => {
    await store.submitIdentifier(requiredIdentifier());

    await store.submitCode('12a');

    expect(verifyChallenge).not.toHaveBeenCalled();
    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Otp,
      identifier: requiredIdentifier(),
      error: IdentityError.otpWrongCode(),
    });
  });

  it('ends the flow blocked when the verify fails on the permission-denied status — the lockout reads the wire status, whatever the code', async () => {
    verifyChallenge.mockResolvedValue(
      Result.err(PipelineError.fromWire('functions/permission-denied', null)),
    );
    await store.submitIdentifier(requiredIdentifier());

    await store.submitCode('123456');

    expect(store.state().authFlowStep).toBe(AuthFlowStep.Blocked);
  });

  it('is not blocked by the lockout code on its own status (resource-exhausted)', async () => {
    const lockedOut = PipelineError.fromWire('resource-exhausted', {
      errorCode: 'IDENTITY_OTP_LOCKED_OUT',
    });
    verifyChallenge.mockResolvedValue(Result.err(lockedOut));
    await store.submitIdentifier(requiredIdentifier());

    await store.submitCode('123456');

    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Otp,
      identifier: requiredIdentifier(),
      error: lockedOut,
    });
    expect(lockedOut.serverErrorCode).toBe('IDENTITY_OTP_LOCKED_OUT');
  });

  it('returns to identify with the server code when the send fails, and the generic code when the server named none', async () => {
    // A throttled FIRST send — no live challenge here, as after a reload of
    // /auth: no countdown to restart, so the refusal is the error, its
    // seconds kept for the words (OR-9).
    const throttled = rateLimited(42);
    requestChallenge.mockResolvedValue(Result.err(throttled));
    await store.submitIdentifier(requiredIdentifier());
    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Identify,
      error: throttled,
    });
    expect(throttled.serverErrorCode).toBe('IDENTITY_OTP_RATE_LIMITED');
    expect(throttled.serverParams).toEqual({ retryAfterSeconds: 42 });
    expect(store.sendCount()).toBe(0);
    expect(store.resendSecondsLeft()).toBe(0);

    // No server code: the failed call is kept as it is — `wordFlowFailure`
    // words it as the generic `IDENTITY_CALL_FAILED` (its spec pins that).
    const unavailable = PipelineError.bare(PipelineErrorCode.Unavailable);
    requestChallenge.mockResolvedValue(Result.err(unavailable));
    await store.submitIdentifier(emailIdentifier('other@example.com'));
    expect(store.state()).toEqual({
      authFlowStep: AuthFlowStep.Identify,
      error: unavailable,
    });
    expect(unavailable.serverErrorCode).toBeNull();
  });

  it('never verifies outside the otp step', async () => {
    const result = await store.submitCode('123456');

    expect(result).toBeNull();
    expect(verifyChallenge).not.toHaveBeenCalled();
  });
});
