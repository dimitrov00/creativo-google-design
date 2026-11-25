import { describe, expect, it, vi } from 'vitest';
import type { Auth, User } from 'firebase/auth';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import type { ReadAsClaims } from '@core/components';
import { readAsSessionPorts } from './read-as-session.adapter';

const { onIdTokenChangedMock, signInWithCustomTokenMock } = vi.hoisted(() => ({
  onIdTokenChangedMock: vi.fn(),
  signInWithCustomTokenMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: onIdTokenChangedMock,
  signInWithCustomToken: signInWithCustomTokenMock,
}));

const AUTH = {} as Auth;

function user(claims: Record<string, unknown>): User {
  return {
    uid: 'u-owner',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
  } as unknown as User;
}

/** Every value `observeReadAs` emitted for the users the listener is handed, in turn. */
async function emitted(users: readonly (User | null)[]) {
  onIdTokenChangedMock.mockImplementation(
    (_auth: Auth, listener: (u: User | null) => void) => {
      for (const u of users) listener(u);
      return () => undefined;
    },
  );
  const seen: (ReadAsClaims | null)[] = [];
  readAsSessionPorts(AUTH)
    .observeReadAs()
    .subscribe((value) => seen.push(value));
  await vi.waitFor(() => expect(seen).toHaveLength(users.length));
  return seen;
}

describe('readAsSessionPorts (OR-24)', () => {
  it('reads the read-as claims off the ID token', async () => {
    expect(
      await emitted([
        user({
          stage: 'active',
          roles: ['admin'],
          imp: 'imp-1',
          impBy: 'u-support',
          impScope: 'READ',
          impExp: 1_800_000_000_000,
        }),
      ]),
    ).toEqual([
      {
        readAsSessionId: 'imp-1',
        readAsByUserId: 'u-support',
        readAsScope: 'READ',
        readAsExpiresAtUtcMs: 1_800_000_000_000,
      },
    ]);
  });

  it('reads none on a plain session, and none with nobody signed in', async () => {
    expect(
      await emitted([user({ stage: 'active', roles: ['admin'] })]),
    ).toEqual([null]);
    expect(await emitted([null])).toEqual([null]);
  });

  it('signs in with the read-as token, and answers a refused sign-in as a failure', async () => {
    signInWithCustomTokenMock.mockResolvedValueOnce({});
    const ports = readAsSessionPorts(AUTH);
    expect((await ports.signInWithReadAsToken('read-as-token')).ok).toBe(true);
    expect(signInWithCustomTokenMock).toHaveBeenCalledWith(
      AUTH,
      'read-as-token',
    );

    signInWithCustomTokenMock.mockRejectedValueOnce(new Error('auth/invalid'));
    expect(await ports.signInWithReadAsToken('bad')).toEqual({
      ok: false,
      error: PipelineError.bare(PipelineErrorCode.Unknown),
    });
  });
});
