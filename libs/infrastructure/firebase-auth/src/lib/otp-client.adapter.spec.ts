import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Auth } from 'firebase/auth';
import type { Functions } from 'firebase/functions';
import {
  FIREBASE_AUTH,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';
import { PhoneNumber } from '@creativo/domain/kernel';
import { OtpCode, phoneIdentifier } from '@creativo/domain/identity';
import { CallableOtpClient } from './otp-client.adapter';

const otpCode = OtpCode.create('123456');
if (otpCode.isFailure())
  throw new Error('fixture OTP code failed to construct');
const code = otpCode.value;

const { httpsCallableMock, signInWithCustomTokenMock } = vi.hoisted(() => ({
  httpsCallableMock: vi.fn(),
  signInWithCustomTokenMock: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: signInWithCustomTokenMock,
}));

function createClient(functions: Functions, auth: Auth): CallableOtpClient {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FUNCTIONS, useValue: functions },
      { provide: FIREBASE_AUTH, useValue: auth },
      CallableOtpClient,
    ],
  });
  return TestBed.inject(CallableOtpClient);
}

describe('CallableOtpClient', () => {
  const functions = {} as Functions;
  const auth = {} as Auth;
  const phone = PhoneNumber.create('+359888123456');
  if (phone.isFailure())
    throw new Error('fixture phone number failed to construct');
  const identifier = phoneIdentifier(phone.value);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requestChallenge returns the branded challenge id from the callable', async () => {
    const callable = vi
      .fn()
      .mockResolvedValue({ data: { challengeId: 'challenge-1' } });
    httpsCallableMock.mockReturnValue(callable);
    const client = createClient(functions, auth);

    const result = await client.requestChallenge(identifier);

    expect(result.isSuccess()).toBe(true);
    expect(httpsCallableMock).toHaveBeenCalledWith(
      functions,
      'requestOtpChallenge',
    );
    expect(callable).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'phone', value: '+359888123456' }),
    );
  });

  it('requestChallenge fails when the callable throws', async () => {
    httpsCallableMock.mockReturnValue(
      vi.fn().mockRejectedValue(new Error('boom')),
    );
    const client = createClient(functions, auth);

    const result = await client.requestChallenge(identifier);

    expect(result.isFailure()).toBe(true);
  });

  it('verifyChallenge signs in with the returned custom token and never leaks it', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: { sessionKind: 'returning', customToken: 'secret-token' },
    });
    httpsCallableMock.mockReturnValue(callable);
    signInWithCustomTokenMock.mockResolvedValue({ user: {} });
    const client = createClient(functions, auth);

    const result = await client.verifyChallenge('challenge-1' as never, code);

    expect(signInWithCustomTokenMock).toHaveBeenCalledWith(
      auth,
      'secret-token',
    );
    expect(result.isSuccess()).toBe(true);
    expect(result.isSuccess() && result.value).toEqual({ kind: 'returning' });
  });

  it('verifyChallenge fails when sign-in with the custom token throws', async () => {
    httpsCallableMock.mockReturnValue(
      vi
        .fn()
        .mockResolvedValue({ data: { sessionKind: 'new', customToken: 't' } }),
    );
    signInWithCustomTokenMock.mockRejectedValue(new Error('bad token'));
    const client = createClient(functions, auth);

    const result = await client.verifyChallenge('challenge-1' as never, code);

    expect(result.isFailure()).toBe(true);
  });

  it('completeRegistration forwards the identifier and fields', async () => {
    const callable = vi.fn().mockResolvedValue({ data: undefined });
    httpsCallableMock.mockReturnValue(callable);
    const client = createClient(functions, auth);

    const result = await client.completeRegistration(identifier, {
      firstName: 'Ivan',
      lastName: 'Petrov',
    });

    expect(result.isSuccess()).toBe(true);
    expect(callable).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: { firstName: 'Ivan', lastName: 'Petrov' },
      }),
    );
  });
});
