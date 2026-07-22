import { Observable } from 'rxjs';
import type { Unsubscribe } from 'firebase/firestore';
import { Result, ok, fail } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

export interface SubscribeWithRetryOptions {
  /** Backoff schedule; the last entry repeats once exhausted. */
  readonly retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [
  500, 1000, 2000, 5000, 10_000,
];

/**
 * Wraps a raw Firestore `onSnapshot`-style live subscription into an
 * `Observable<Result<T, RepositoryError>>` that never completes on error —
 * it surfaces the failure once (`Result.fail`) and keeps retrying the
 * underlying subscription on a backoff schedule, resetting the schedule as
 * soon as a snapshot succeeds again. This is the one place every
 * `observe*` repository/reader method in `libs/infrastructure/firestore`
 * goes through, so reconnect behavior (offline blips, emulator restarts)
 * is defined exactly once.
 */
export function subscribeWithRetry<T>(
  subscribe: (
    onNext: (value: T) => void,
    onError: (error: unknown) => void,
  ) => Unsubscribe,
  options: SubscribeWithRetryOptions = {},
): Observable<Result<T, RepositoryError>> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  return new Observable<Result<T, RepositoryError>>((subscriber) => {
    let unsubscribeSnapshot: Unsubscribe | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const start = (): void => {
      unsubscribeSnapshot = subscribe(
        (value) => {
          attempt = 0;
          subscriber.next(ok(value));
        },
        (error) => {
          subscriber.next(
            fail(new RepositoryError('Live query failed', error)),
          );
          scheduleRetry();
        },
      );
    };

    const scheduleRetry = (): void => {
      if (disposed) return;
      const index = Math.min(attempt, retryDelaysMs.length - 1);
      const delayMs = retryDelaysMs.at(index) ?? 0;
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
