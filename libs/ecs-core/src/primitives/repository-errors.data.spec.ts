import { describe, expect, it } from 'vitest';
import { RepositoryError, RepositoryErrorCode } from './repository-errors.data';

describe('RepositoryError', () => {
  it('uses the codes the ports and the lazy loader raise', () => {
    expect(Object.values(RepositoryErrorCode)).toEqual([
      'REPOSITORY_READ_FAILED',
      'REPOSITORY_WRITE_FAILED',
      'REPOSITORY_ALREADY_EXISTS',
      'REPOSITORY_MALFORMED',
      'REPOSITORY_UNAVAILABLE',
    ]);
  });

  it('builds one plain shape for every code', () => {
    expect(
      RepositoryError.readFailed('appointments/a1', 'permission-denied'),
    ).toEqual({
      errorCode: 'REPOSITORY_READ_FAILED',
      path: 'appointments/a1',
      reason: 'permission-denied',
    });
    expect(
      RepositoryError.writeFailed('barberBusy/b_ivan__2026-10-07', null),
    ).toEqual({
      errorCode: 'REPOSITORY_WRITE_FAILED',
      path: 'barberBusy/b_ivan__2026-10-07',
      reason: null,
    });
    expect(RepositoryError.alreadyExists('auditLog/a1')).toEqual({
      errorCode: 'REPOSITORY_ALREADY_EXISTS',
      path: 'auditLog/a1',
      reason: null,
    });
    expect(RepositoryError.malformed('users/u1', 'timeInterval')).toEqual({
      errorCode: 'REPOSITORY_MALFORMED',
      path: 'users/u1',
      reason: 'timeInterval',
    });
    expect(RepositoryError.unavailable()).toEqual({
      errorCode: 'REPOSITORY_UNAVAILABLE',
      path: null,
      reason: null,
    });
  });

  it('is() compares the code', () => {
    const error = RepositoryError.unavailable();
    expect(RepositoryError.is(error, RepositoryErrorCode.Unavailable)).toBe(
      true,
    );
    expect(RepositoryError.is(error, RepositoryErrorCode.ReadFailed)).toBe(
      false,
    );
  });

  it('isAlreadyExists reads a replay — and nothing else', () => {
    expect(
      RepositoryError.isAlreadyExists(RepositoryError.alreadyExists('a/1')),
    ).toBe(true);
    expect(
      RepositoryError.isAlreadyExists(
        RepositoryError.writeFailed('a/1', 'already-exists'),
      ),
    ).toBe(false);
  });
});
