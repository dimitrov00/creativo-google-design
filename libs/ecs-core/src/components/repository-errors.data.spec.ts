import { describe, expect, it } from 'vitest';
import { RepositoryError, RepositoryErrorCode } from './repository-errors.data';

describe('RepositoryError', () => {
  it('uses the codes the ports and the lazy loader raise', () => {
    expect(Object.values(RepositoryErrorCode)).toEqual([
      'repo.read_failed',
      'repo.write_failed',
      'repo.malformed',
      'repository.unavailable',
    ]);
  });

  it('builds one plain shape for every code', () => {
    expect(
      RepositoryError.readFailed('appointments/a1', 'permission-denied'),
    ).toEqual({
      code: 'repo.read_failed',
      path: 'appointments/a1',
      reason: 'permission-denied',
    });
    expect(
      RepositoryError.writeFailed('barberBusy/b_ivan__2026-10-07', null),
    ).toEqual({
      code: 'repo.write_failed',
      path: 'barberBusy/b_ivan__2026-10-07',
      reason: null,
    });
    expect(RepositoryError.malformed('users/u1', 'timeInterval')).toEqual({
      code: 'repo.malformed',
      path: 'users/u1',
      reason: 'timeInterval',
    });
    expect(RepositoryError.unavailable()).toEqual({
      code: 'repository.unavailable',
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
});
