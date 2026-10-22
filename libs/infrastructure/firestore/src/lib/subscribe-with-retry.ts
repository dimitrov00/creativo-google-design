import { Observable } from 'rxjs';
import type { Unsubscribe } from 'firebase/firestore';
import { retryDelayMs } from '@creativo/infrastructure/firebase-app';
import { type RepositoryError, Result } from '@core/primitives';

/**
 * The only error codes a re-listen can actually heal.
 *
 * An allowlist, deliberately, because BOTH kinds of unlisted error must stop:
 *
 * - The web SDK's `onSnapshot` error callback fires only for TERMINAL errors
 *   — transient network trouble is retried inside the SDK before we ever
 *   hear about it. A missing composite index (`failed-precondition`) or a
 *   rule denial (`permission-denied`) is a deployment defect, and
 *   re-listening every 10s turns one misconfiguration into an infinite
 *   billed retry loop per open tab.
 * - Adapters also route DOMAIN-mapping failures through `onError` (a doc
 *   that refuses to parse). Those carry no Firestore `code` at all, and
 *   re-reading the collection cannot fix a malformed document — under the
 *   old always-retry contract one bad doc meant re-billing the full result
 *   set every 10s forever.
 *
 * `unavailable` / `internal` / `resource-exhausted` genuinely heal (backend
 * blip, emulator restart), so they keep the backoff schedule.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'unavailable',
  'internal',
  'resource-exhausted',
  'deadline-exceeded',
  'aborted',
]);

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

/**
 * Wraps a raw Firestore `onSnapshot`-style live subscription into an
 * `Observable<Result<T, RepositoryError>>` — the flat port `Result` — that
 * never completes on error: it surfaces the failure once (`onError(cause)`,
 * the caller's `RepositoryError` naming what it read) and, for the healable
 * codes in {@link RETRYABLE_CODES} only, retries the underlying subscription
 * on the data layer's ONE backoff schedule (`retryDelayMs`,
 * `DATA_RETRY_DELAYS_MS`), resetting it as soon as a snapshot succeeds
 * again. Everything else surfaces once and stops: retrying a rule denial, a
 * missing index or an unparseable document re-bills the same defect
 * forever. This is the one place every live read of the web data layer goes
 * through (`observe.ts`, the visit photos), so reconnect behaviour (offline
 * blips, emulator restarts) is defined exactly once.
 */
export function subscribeWithRetry<T>(
  subscribe: (
    onNext: (value: T) => void,
    onError: (error: unknown) => void,
  ) => Unsubscribe,
  onError: (cause: unknown) => RepositoryError,
): Observable<Result<T, RepositoryError>> {
  return new Observable<Result<T, RepositoryError>>((subscriber) => {
    let unsubscribeSnapshot: Unsubscribe | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const start = (): void => {
      unsubscribeSnapshot = subscribe(
        (value) => {
          attempt = 0;
          subscriber.next(Result.ok(value));
        },
        (error) => {
          subscriber.next(Result.err(onError(error)));
          if (isRetryable(error)) scheduleRetry();
        },
      );
    };

    const scheduleRetry = (): void => {
      if (disposed) return;
      const delayMs = retryDelayMs(attempt);
      attempt += 1;
      retryTimeoutId = setTimeout(() => {
        unsubscribeSnapshot?.();
        start();
      }, delayMs);
    };

    start();

    return () => {
      disposed = true;
      if (retryTimeoutId !== null) {
        clearTimeout(retryTimeoutId);
      }
      unsubscribeSnapshot?.();
    };
  });
}
