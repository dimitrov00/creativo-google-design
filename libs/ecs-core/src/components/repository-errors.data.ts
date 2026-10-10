/**
 * Why a read or write through a storage port failed — the `E` of every
 * `Observe*` / `Load*` / `Page*` port (`Result<X, RepositoryError>`), in place
 * of the application layer's `RepositoryError extends Error` and the web
 * client's `repository.unavailable`. Every non-`code` field is an i18n
 * parameter: a scalar or `null`.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const RepositoryErrorCode = {
  /** The store refused or failed a read. */
  ReadFailed: 'repo.read_failed',
  /** The store refused or failed a write. */
  WriteFailed: 'repo.write_failed',
  /** A document was read but is not the entity's shape. */
  Malformed: 'repo.malformed',
  /** The adapter itself could not be loaded (a lazy chunk failed). */
  Unavailable: 'repository.unavailable',
} as const;
export type RepositoryErrorCode =
  (typeof RepositoryErrorCode)[keyof typeof RepositoryErrorCode];

/** One shape for every code, so every error shares one hidden class. */
export type RepositoryError = {
  readonly code: RepositoryErrorCode;
  /** The document or collection path involved (`appointments/a1`), if known. */
  readonly path: string | null;
  /** The store's own reason (`permission-denied`, a missing field name), if any. */
  readonly reason: string | null;
};

export const RepositoryError = {
  readFailed(path: string | null, reason: string | null): RepositoryError {
    return { code: RepositoryErrorCode.ReadFailed, path, reason };
  },

  writeFailed(path: string | null, reason: string | null): RepositoryError {
    return { code: RepositoryErrorCode.WriteFailed, path, reason };
  },

  malformed(path: string | null, reason: string | null): RepositoryError {
    return { code: RepositoryErrorCode.Malformed, path, reason };
  },

  unavailable(): RepositoryError {
    return { code: RepositoryErrorCode.Unavailable, path: null, reason: null };
  },

  is(error: RepositoryError, code: RepositoryErrorCode): boolean {
    return error.code === code;
  },
} as const;
