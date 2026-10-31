/**
 * The canonical code of any SDK failure — the Admin SDK's numeric gRPC
 * status, a `firestore/…` or `SCREAMING_CASE` string, Auth's `auth/…`,
 * Storage's `storage/…` — read without trusting the failure's shape. It is
 * an external vocabulary (`unavailable`, `aborted`, …), never an
 * `errorCode` of ours: every adapter records it as its `RepositoryError`
 * `reason`, and the retry verdict (`TriggerAttemptSystem`) judges a failed
 * attempt by it.
 */

/** What a code is called when nothing names it. */
const UNKNOWN_CODE = 'unknown';

/** gRPC status numbers as the Admin SDK reports them, by canonical name. */
const GRPC_CODE_NAMES: { readonly [status: number]: string } = {
  1: 'cancelled',
  2: 'unknown',
  3: 'invalid-argument',
  4: 'deadline-exceeded',
  5: 'not-found',
  6: 'already-exists',
  7: 'permission-denied',
  8: 'resource-exhausted',
  9: 'failed-precondition',
  10: 'aborted',
  11: 'out-of-range',
  12: 'unimplemented',
  13: 'internal',
  14: 'unavailable',
  15: 'data-loss',
  16: 'unauthenticated',
} as const;

/** The `code` a thrown value carries, read without trusting its shape. */
function rawCodeOf(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  return 'code' in error ? error.code : undefined;
}

export const FailureCodeSystem = {
  UNKNOWN_CODE,

  /** A failure's canonical code — numeric (Admin SDK) or string, `unknown` otherwise. */
  codeOf(error: unknown): string {
    const code = rawCodeOf(error);
    if (typeof code === 'number') {
      return Object.hasOwn(GRPC_CODE_NAMES, code)
        ? (GRPC_CODE_NAMES[code] as string)
        : UNKNOWN_CODE;
    }
    if (typeof code === 'string' && code.length > 0) {
      return code
        .replace(/^[a-z]+\//, '')
        .replace(/_/g, '-')
        .toLowerCase();
    }
    return UNKNOWN_CODE;
  },
} as const;
