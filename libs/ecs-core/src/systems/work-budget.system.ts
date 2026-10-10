/**
 * How long a piece of operational work may keep TAKING work — the
 * arithmetic of `apps/functions/src/lib/ops/work-budget.ts:16-97`, shared by
 * the backfill callable and the policy-change recompute, the two handlers
 * whose input is the size of the book rather than one document.
 *
 * The platform's timeout is not a budget: when it fires the process is
 * killed and nothing after the kill runs. So a handler spends only a share
 * of its timeout on new work, looks at the budget between units (a chunk of
 * appointments, a page of clients), and uses the rest to finish the unit in
 * hand. The budget never interrupts a unit: every unit is state-based, so
 * stopping BETWEEN them is always safe to resume.
 *
 * Pure: the clock is the caller's (`nowMs`, `startedMs`), and the one
 * question that reads it — "is the budget spent?" — is a `spent` thunk the
 * caller supplies, asked only when the answer can matter.
 */

/** The share of the timeout spent taking new work; the rest is the unit in hand plus the bookkeeping. */
const WORK_BUDGET_SHARE = 0.7;

/**
 * How long the Firebase callable client SDK waits for an answer unless its
 * caller configures otherwise — `HttpsCallableOptions.timeout`, "Default is
 * 70000" (`@firebase/functions`). The most impatient client a callable has.
 */
const CALLABLE_CLIENT_TIMEOUT_SECONDS = 70;

/** One chunk of a budgeted walk: items `[start, end)` of the list. */
export type ChunkRange = {
  readonly start: number;
  readonly end: number;
};

export const WorkBudgetSystem = {
  WORK_BUDGET_SHARE,
  CALLABLE_CLIENT_TIMEOUT_SECONDS,

  /** Milliseconds of new-work budget for a handler with this timeout. */
  budgetMsFor(timeoutSeconds: number): number {
    return Math.floor(timeoutSeconds * 1000 * WORK_BUDGET_SHARE);
  },

  /**
   * Milliseconds of new-work budget for a CALLABLE: a share of whichever
   * gives up first — the platform, which kills the handler, or the client,
   * which stops listening. A client that stops listening does not stop the
   * work, so the answer must come well inside the client's wait.
   */
  callableBudgetMs(
    platformTimeoutSeconds: number,
    clientTimeoutSeconds: number = CALLABLE_CLIENT_TIMEOUT_SECONDS,
  ): number {
    return WorkBudgetSystem.budgetMsFor(
      Math.min(platformTimeoutSeconds, clientTimeoutSeconds),
    );
  },

  /** A budget of `limitMs` started at `startedMs` is used up at `nowMs` — take no new unit. */
  isSpent(startedMs: number, nowMs: number, limitMs: number): boolean {
    return nowMs - startedMs >= limitMs;
  },

  /** The width a walk takes its chunks at: whole, and at least one. */
  chunkSize(raw: number): number {
    return Math.max(1, Math.floor(raw));
  },

  /**
   * The next chunk of a list of `length` items once `handled` are done, at
   * `size` a chunk — `null` once nothing is left. Never skips an item: the
   * chunk starts exactly where the last one ended.
   */
  nextChunk(length: number, size: number, handled: number): ChunkRange | null {
    if (handled >= length) return null;
    return { start: handled, end: Math.min(handled + size, length) };
  },

  /**
   * May the walk take another chunk? Always the first, so every invocation
   * moves the walk forward; after it, only while the budget lasts. `spent`
   * is asked only for a chunk after the first — a clock read is the
   * caller's, and one it did not need is never taken.
   */
  takesChunk(handled: number, spent: () => boolean): boolean {
    return handled === 0 || !spent();
  },
} as const;
