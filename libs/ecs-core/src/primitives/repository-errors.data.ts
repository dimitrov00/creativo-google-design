/**
 * Why a read or write through a storage port failed — the `E` of every
 * `Observe*` / `Load*` / `Page*` port (`Result<X, RepositoryError>`), in place
 * of the application layer's `RepositoryError extends Error` and the web
 * client's `repository.unavailable` (values SCREAMING under `REPOSITORY_`,
 * flatten-spec §4.2). Every non-`errorCode` field is an i18n
 * parameter: a scalar or `null`.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const RepositoryErrorCode = {
  /** The store refused or failed a read. */
  ReadFailed: 'REPOSITORY_READ_FAILED',
  /** The store refused or failed a write. */
  WriteFailed: 'REPOSITORY_WRITE_FAILED',
  /**
   * A `Create` met a document already there (Firestore's ALREADY_EXISTS) —
   * a lost create race or a replay; nothing of the plan was applied.
   */
  AlreadyExists: 'REPOSITORY_ALREADY_EXISTS',
  /** A document was read but is not the entity's shape. */
  Malformed: 'REPOSITORY_MALFORMED',
  /** The adapter itself could not be loaded (a lazy chunk failed). */
  Unavailable: 'REPOSITORY_UNAVAILABLE',
} as const;
export type RepositoryErrorCode =
  (typeof RepositoryErrorCode)[keyof typeof RepositoryErrorCode];

/** One shape for every code, so every error shares one hidden class. */
export type RepositoryError = {
  readonly errorCode: RepositoryErrorCode;
  /** The document or collection path involved (`appointments/a1`), if known. */
  readonly path: string | null;
  /** The store's own reason (`permission-denied`, a missing field name), if any. */
  readonly reason: string | null;
};

export const RepositoryError = {
  readFailed(path: string | null, reason: string | null): RepositoryError {
    return { errorCode: RepositoryErrorCode.ReadFailed, path, reason };
  },

  writeFailed(path: string | null, reason: string | null): RepositoryError {
    return { errorCode: RepositoryErrorCode.WriteFailed, path, reason };
  },

  /** The document `path` a refused `Create` named; the store's reason is the code itself. */
  alreadyExists(path: string | null): RepositoryError {
    return { errorCode: RepositoryErrorCode.AlreadyExists, path, reason: null };
  },

  malformed(path: string | null, reason: string | null): RepositoryError {
    return { errorCode: RepositoryErrorCode.Malformed, path, reason };
  },

  unavailable(): RepositoryError {
    return {
      errorCode: RepositoryErrorCode.Unavailable,
      path: null,
      reason: null,
    };
  },

  is(error: RepositoryError, code: RepositoryErrorCode): boolean {
    return error.errorCode === code;
  },

  /**
   * The one predicate a pipeline reads a replay with (flatten-spec §6.3): the
   * commit met a document its `Create` meant to write — a deterministic id's
   * replay, or a lost create race — and applied nothing.
   */
  isAlreadyExists(error: RepositoryError): boolean {
    return error.errorCode === RepositoryErrorCode.AlreadyExists;
  },
} as const;
