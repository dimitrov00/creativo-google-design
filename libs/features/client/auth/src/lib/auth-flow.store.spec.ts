import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Identifier,
  OTP_CLIENT,
  createIdentifier,
  ok,
} from '@creativo/application/identity';
import { AuthFlowStore, RESEND_COOLDOWN_SECONDS } from './auth-flow.store';

function requiredIdentifier(): Identifier {
  const result = createIdentifier({
    kind: 'email',
    value: 'client@example.com',
  });
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

describe('AuthFlowStore', () => {
  const requestChallenge = vi.fn();
  const verifyChallenge = vi.fn();
  let store: AuthFlowStore;

  beforeEach(() => {
    vi.useFakeTimers();
    requestChallenge.mockReset().mockResolvedValue(ok('challenge_1'));
    verifyChallenge
      .mockReset()
      .mockResolvedValue(ok({ kind: 'returning' as const }));

    TestBed.configureTestingModule({
      providers: [
        AuthFlowStore,
        {
          provide: OTP_CLIENT,
          useValue: {
            requestChallenge,
            verifyChallenge,
            completeRegistration: () => Promise.resolve(ok(undefined)),
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
    expect(store.state().kind).toBe('identify');
  });

  it('starts the resend cooldown after a successful initial send', async () => {
    await store.submitIdentifier(requiredIdentifier());

    expect(store.state().kind).toBe('otp');
    expect(store.sendCount()).toBe(1);
    expect(store.resendSecondsLeft()).toBe(RESEND_COOLDOWN_SECONDS);
    expect(store.canResend()).toBe(false);
  });

  it('counts the cooldown down to zero, one second at a time', async () => {
    await store.submitIdentifier(requiredIdentifier());

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.resendSecondsLeft()).toBe(RESEND_COOLDOWN_SECONDS - 1);

    await vi.advanceTimersByTimeAsync((RESEND_COOLDOWN_SECONDS - 1) * 1000);
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
    await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1000);
    expect(store.canResend()).toBe(true);

    await store.resend();

    expect(requestChallenge).toHaveBeenCalledTimes(2);
    expect(store.sendCount()).toBe(2);
    expect(store.resendSecondsLeft()).toBe(RESEND_COOLDOWN_SECONDS);
  });

  it('resets cooldown and send count on change_identifier — a new destination is a new attempt', async () => {
    await store.submitIdentifier(requiredIdentifier());

    store.changeIdentifier();

    expect(store.state().kind).toBe('identify');
    expect(store.sendCount()).toBe(0);
    expect(store.resendSecondsLeft()).toBe(0);
    expect(store.canResend()).toBe(true);
  });

  it('never verifies outside the otp step', async () => {
    const result = await store.submitCode('123456');

    expect(result).toBeNull();
    expect(verifyChallenge).not.toHaveBeenCalled();
  });
});
