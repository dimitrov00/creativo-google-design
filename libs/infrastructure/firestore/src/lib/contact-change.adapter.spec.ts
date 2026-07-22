import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Email } from '@creativo/domain/accounts';
import {
  ConfirmationCode,
  ContactChangeTarget,
} from '@creativo/application/accounts';
import { UserId } from '@creativo/domain/accounts';
import { FIREBASE_FUNCTIONS } from '@creativo/infrastructure/firebase-app';
import { CallableContactChangeAdapter } from './contact-change.adapter';

const callableMock = vi.fn();

vi.mock('firebase/functions', async () => {
  const actual =
    await vi.importActual<typeof import('firebase/functions')>(
      'firebase/functions',
    );
  return {
    ...actual,
    httpsCallable: vi.fn(() => callableMock),
  };
});

function requireUserId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture id');
  return result.value;
}

function requireEmail(raw: string): Email {
  const result = Email.create(raw);
  if (result.isFailure()) throw new Error('bad fixture email');
  return result.value;
}

function requireCode(raw: string): ConfirmationCode {
  const result = ConfirmationCode.create(raw);
  if (result.isFailure()) throw new Error('bad fixture code');
  return result.value;
}

function createAdapter(): CallableContactChangeAdapter {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FUNCTIONS, useValue: {} },
      CallableContactChangeAdapter,
    ],
  });
  return TestBed.inject(CallableContactChangeAdapter);
}

describe('CallableContactChangeAdapter', () => {
  it('requestChange calls the requestContactChange callable and returns its id', async () => {
    callableMock.mockResolvedValueOnce({ data: { requestId: 'req-1' } });
    const { httpsCallable } = await import('firebase/functions');
    const adapter = createAdapter();
    const target: ContactChangeTarget = {
      kind: 'email',
      email: requireEmail('new@example.com'),
    };

    const result = await adapter.requestChange(requireUserId('user-1'), target);

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'requestContactChange',
    );
    expect(callableMock).toHaveBeenCalledWith({
      userId: 'user-1',
      target: { kind: 'email', email: 'new@example.com' },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value as string).toBe('req-1');
    }
  });

  it('confirmChange calls the confirmContactChange callable', async () => {
    callableMock.mockResolvedValueOnce({ data: undefined });
    const { httpsCallable } = await import('firebase/functions');
    const adapter = createAdapter();

    const result = await adapter.confirmChange(
      requireUserId('user-1'),
      'req-1' as never,
      requireCode('123456'),
    );

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'confirmContactChange',
    );
    expect(callableMock).toHaveBeenCalledWith({
      userId: 'user-1',
      requestId: 'req-1',
      code: '123456',
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('maps a callable rejection to a failed Result', async () => {
    callableMock.mockRejectedValueOnce(new Error('functions/unavailable'));
    const adapter = createAdapter();
    const target: ContactChangeTarget = {
      kind: 'email',
      email: requireEmail('new@example.com'),
    };

    const result = await adapter.requestChange(requireUserId('user-1'), target);

    expect(result.isFailure()).toBe(true);
  });
});
