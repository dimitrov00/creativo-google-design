/**
 * The canonical code of any SDK failure — the Admin SDK's numeric gRPC
 * status, or a `firestore/…`, `auth/…`, `storage/…` or `SCREAMING_CASE`
 * string — read without trusting the failure's shape. It is an external
 * vocabulary (`unavailable`, `aborted`, …), never an `errorCode` of ours:
 * every adapter records it as its `RepositoryError` `reason`, and the retry
 * verdict (`TriggerAttemptSystem`) judges a failed attempt by it.
 *
 * The answer is always one of the sixteen gRPC canonical names or
 * `unknown`, never the thrown value's own text: a `code` is whatever the
 * thrower put there (a Node `ECONNRESET`, an SDK's private spelling, a value
 * someone's text reached), and the answer lands in log lines and in the
 * stored `triggerFailures` letters (R36: no foreign text in a record). A
 * product code outside the set (`auth/user-not-found`) is read by its own
 * adapter where it is an answer (`authCodeOf`), never through here. A port
 * refusal's recorded `reason` is no thrown value: it is the adapter's own
 * answer — a code this reader gave it, or one of our error codes — and
 * {@link FailureCodeSystem.reasonCodeOf} reads it whole.
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

/** The canonical names a string code may read as — {@link GRPC_CODE_NAMES}' values. */
const CANONICAL_NAMES: readonly string[] = Object.values(GRPC_CODE_NAMES);

/** A code in its canonical spelling: no product prefix, kebab-case, lower case. */
function spelled(code: string): string {
  return code
    .replace(/^[a-z]+\//, '')
    .replace(/_/g, '-')
    .toLowerCase();
}

/** The `code` a thrown value carries, read without trusting its shape. */
function rawCodeOf(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  return 'code' in error ? error.code : undefined;
}

export const FailureCodeSystem = {
  UNKNOWN_CODE,

  /**
   * A failure's canonical code — a numeric (Admin SDK) status by its name, a
   * string in any common spelling when it names a canonical status, and
   * `unknown` for anything else.
   */
  codeOf(error: unknown): string {
    const code = rawCodeOf(error);
    if (typeof code === 'number') {
      return Object.hasOwn(GRPC_CODE_NAMES, code)
        ? (GRPC_CODE_NAMES[code] as string)
        : UNKNOWN_CODE;
    }
    if (typeof code === 'string') {
      const name = spelled(code);
      return CANONICAL_NAMES.includes(name) ? name : UNKNOWN_CODE;
    }
    return UNKNOWN_CODE;
  },

  /**
   * A port refusal's recorded `reason` as a code (`RepositoryError.reason`):
   * the adapter's own answer — a canonical code {@link FailureCodeSystem.codeOf}
   * gave it, or one of our error codes (`CATALOG_LOCATION_ZONE_UNKNOWN` when
   * no location is stored) — so it is trusted and only spelled the canonical
   * way; `unknown` when the refusal recorded none.
   */
  reasonCodeOf(reason: string | null): string {
    return reason === null || reason.length === 0
      ? UNKNOWN_CODE
      : spelled(reason);
  },
} as const;
