import { describe, expect, it } from 'vitest';
import { RepositoryError, RepositoryErrorCode } from './repository.error';

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

  it('guard() knows a port’s refusal from a throw — the one guard of the attempt verdict (pass C, P-24)', () => {
    for (const refusal of [
      RepositoryError.readFailed('appointments/a1', 'unavailable'),
      RepositoryError.writeFailed(null, null),
      RepositoryError.alreadyExists('auditLog/a1'),
      RepositoryError.malformed('users/u1', 'timeInterval'),
      RepositoryError.unavailable(),
    ]) {
      expect(RepositoryError.guard(refusal)).toBe(true);
    }
    // A throw: an SDK error carries a `code`, never this shape.
    expect(
      RepositoryError.guard(
        Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
      ),
    ).toBe(false);
    expect(RepositoryError.guard(null)).toBe(false);
    expect(RepositoryError.guard(undefined)).toBe(false);
    expect(RepositoryError.guard('REPOSITORY_READ_FAILED')).toBe(false);
    // Another domain's error, even one naming a path, is not a port refusal.
    expect(
      RepositoryError.guard({ errorCode: 'MEDIA_NOT_FOUND', path: 'a/1' }),
    ).toBe(false);
    expect(
      RepositoryError.guard({
        errorCode: 'GOVERNANCE_AUDIT_ENTRY_EMPTY_ACTION',
        path: null,
        reason: null,
      }),
    ).toBe(false);
    // A repository code without the rest of the shape is not one either.
    expect(
      RepositoryError.guard({ errorCode: RepositoryErrorCode.ReadFailed }),
    ).toBe(false);
  });
});
