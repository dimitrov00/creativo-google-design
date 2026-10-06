/**
 * The data layer's ONE reconnect schedule: how long to wait before trying
 * again to reach data that failed to arrive — a live query the SDK gave up
 * on (`subscribeWithRetry` in `@creativo/infrastructure/firestore`) or a lazy
 * data chunk that failed to load (`provideLazyPort`, ./lazy-port.ts).
 *
 * Bounded exponential backoff: the waits roughly double up to a 10 s
 * ceiling, and the last entry repeats for as long as someone is still
 * listening. There is no attempt cap on purpose: the listeners that retry
 * are the app's long-lived streams (the catalogue, the menu's
 * notifications), and a cap would leave them dark for the rest of the
 * session after one bad stretch of network — the very failure the retry
 * exists to heal. A retry ends when its subscriber unsubscribes.
 *
 * It lives here, the lowest Firebase infrastructure lib, so every retrying
 * piece above it reads the same numbers rather than growing its own policy.
 */
export const DATA_RETRY_DELAYS_MS: readonly number[] = [
  500, 1_000, 2_000, 5_000, 10_000,
];

/**
 * The wait before retry number `attempt` (0 for the first retry after a
 * failure): that entry of `schedule`, its last entry once exhausted.
 */
export function retryDelayMs(
  attempt: number,
  schedule: readonly number[] = DATA_RETRY_DELAYS_MS,
): number {
  const index = Math.min(Math.max(attempt, 0), schedule.length - 1);
  return schedule.at(index) ?? 0;
}
