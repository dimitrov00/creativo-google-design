import { DomainError } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

/** Why Storage will never serve this object as things stand. */
export type MediaUnavailableReason = 'not_found' | 'forbidden';

/**
 * Storage's PERMANENT answer about one media object: it is not there
 * (`not_found`), or the rules will not let this caller read it
 * (`forbidden`). Asking again returns the same answer, so a caller shows
 * the placeholder and stops asking.
 *
 * Everything else a resolve can meet (a dropped connection, an exhausted
 * quota, a server error) stays a `RepositoryError`: transient, worth a
 * bounded retry. The split is the whole point of the type: one missing
 * cover used to cost four requests a session, because the two were one
 * error.
 *
 * The codes differ per reason on purpose: a dangling `MediaRef` is a
 * catalogue-data problem, a forbidden one is a Storage-rules problem, and
 * a log line should say which.
 */
export class MediaUnavailableError extends DomainError {
  readonly code: `catalog.media.${MediaUnavailableReason}`;

  constructor(
    readonly reason: MediaUnavailableReason,
    readonly path: string,
    override readonly cause?: unknown,
  ) {
    super(
      reason === 'not_found'
        ? `No media object at "${path}"`
        : `Not allowed to read the media object at "${path}"`,
      { reason, path },
    );
    this.code = `catalog.media.${reason}`;
  }
}

/** What `MediaReader.resolve` can fail with: permanent, or worth a retry. */
export type MediaReadError = MediaUnavailableError | RepositoryError;
