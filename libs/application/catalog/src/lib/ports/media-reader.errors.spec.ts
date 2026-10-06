import { describe, expect, it } from 'vitest';
import { DomainError } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import { MediaUnavailableError } from './media-reader.errors';

describe('MediaUnavailableError', () => {
  it.each([
    ['not_found', 'catalog.media.not_found'],
    ['forbidden', 'catalog.media.forbidden'],
  ] as const)('carries a stable code per reason (%s)', (reason, code) => {
    const cause = new Error(`storage/${reason}`);
    const error = new MediaUnavailableError(reason, 'services/fade.jpg', cause);

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
    expect(error.reason).toBe(reason);
    expect(error.path).toBe('services/fade.jpg');
    expect(error.params).toEqual({ reason, path: 'services/fade.jpg' });
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('services/fade.jpg');
  });

  it('is never mistaken for the transient failure', () => {
    // The retry decision reads the class: a transient `RepositoryError` must
    // not pass as permanent, whatever its message says.
    expect(new RepositoryError('storage/object-not-found')).not.toBeInstanceOf(
      MediaUnavailableError,
    );
  });
});
