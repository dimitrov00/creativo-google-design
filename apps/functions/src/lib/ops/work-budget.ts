import { UtcEpochMs, WorkBudgetSystem, defect } from '@creativo/ecs-core';

/**
 * How long a piece of operational work may keep TAKING work — shared by the
 * backfill callable and the policy-change recompute, the two handlers whose
 * input is the size of the book rather than one document.
 *
 * The platform's timeout is not a budget: when it fires the process is
 * killed, and nothing after the kill runs — no audit row, no progress
 * write, no record of where the walk stopped. So each handler spends only
 * a share of its timeout on new work, checks between units (a chunk of
 * appointments, a page of clients), and uses the rest to finish the unit in
 * hand and say where it stopped. The budget never interrupts a unit: every
 * unit is state-based, so stopping BETWEEN them is always safe to resume.
 *
 * Phase 2 shim: the arithmetic is `WorkBudgetSystem` in `@creativo/ecs-core`;
 * this file keeps the legacy names for its callers and the awaiting walk,
 * and reads the injected epoch-ms clock as `UtcEpochMs` instants.
 */

/** The share of the timeout spent taking new work; the rest is the unit in hand plus the bookkeeping. */
export const WORK_BUDGET_SHARE = WorkBudgetSystem.WORK_BUDGET_SHARE;

/** Milliseconds of new-work budget for a handler with this timeout. */
export function budgetMsFor(timeoutSeconds: number): number {
  return WorkBudgetSystem.budgetMsFor(timeoutSeconds);
}

/**
 * How long the Firebase callable client SDK waits for an answer unless its
 * caller configures otherwise — `HttpsCallableOptions.timeout`, "Default is
 * 70000" (`@firebase/functions`). The most impatient client a callable has.
 */
export const CALLABLE_CLIENT_TIMEOUT_SECONDS =
  WorkBudgetSystem.CALLABLE_CLIENT_TIMEOUT_SECONDS;

/**
 * Milliseconds of new-work budget for a CALLABLE: a share of whichever gives
 * up first — the platform, which kills the handler, or the client, which
 * stops listening. A trigger has only the first; a callable has both, and
 * the second is usually the shorter.
 *
 * A client that stops listening does not stop the work: the handler runs on
 * with nobody to hear its answer, and a runner looping on it calls again on
 * top of it. So the answer must come well inside the client's wait, not
 * merely inside the platform's — the platform's timeout can stay long, as
 * the reserve the unit in hand is never killed inside.
 */
export function callableBudgetMs(
  platformTimeoutSeconds: number,
  clientTimeoutSeconds: number = CALLABLE_CLIENT_TIMEOUT_SECONDS,
): number {
  return WorkBudgetSystem.callableBudgetMs(
    platformTimeoutSeconds,
    clientTimeoutSeconds,
  );
}

/** One invocation's allowance, started when the handler starts. */
export interface WorkBudget {
  /** True once the allowance is used up: take no new page, chunk or subject. */
  spent(): boolean;
}

/**
 * A budget of `limitMs` from now, on `clockMs` — injected, so a spec can
 * run a "slow" invocation on a clock that jumps instead of waiting.
 */
export function timeBudget(clockMs: () => number, limitMs: number): WorkBudget {
  const startedAtUtcMs = instantOf(clockMs());
  return {
    spent: () =>
      WorkBudgetSystem.isSpent(startedAtUtcMs, instantOf(clockMs()), limitMs),
  };
}

/**
 * A clock reading as an instant. The legacy clocks are `Date.now`-shaped,
 * so a reading that is not one is a defect of the caller.
 */
function instantOf(ms: number): UtcEpochMs {
  const instant = UtcEpochMs.of(ms);
  if (!instant.ok) defect(`unreachable: a clock read ${ms}`);
  return instant.value;
}

/** A budget that never runs out — for a caller that bounds its work some other way. */
export const UNBOUNDED_BUDGET: WorkBudget = { spent: () => false };

/** What a budgeted walk got through. */
export interface Walked<R> {
  /** Items handled, from the front: the walk never skips one. */
  readonly handled: number;
  /** One result per chunk handled, in order. */
  readonly results: readonly R[];
}

/**
 * Hand `items` to `work` a chunk at a time, taking no new chunk once the
 * budget is spent — but always the first, so every invocation moves the
 * walk forward. A chunk in hand is finished, never cut: the caller's
 * cursor is then the last item handled, and nothing between it and the
 * next call is half done.
 */
export async function walkWithin<T, R>(
  items: readonly T[],
  chunkSize: number,
  budget: WorkBudget,
  work: (chunk: readonly T[]) => Promise<R>,
): Promise<Walked<R>> {
  const size = WorkBudgetSystem.chunkSize(chunkSize);
  const spent = (): boolean => budget.spent();
  const results: R[] = [];
  let handled = 0;
  for (;;) {
    const range = WorkBudgetSystem.nextChunk(items.length, size, handled);
    if (range === null || !WorkBudgetSystem.takesChunk(handled, spent)) break;
    const chunk = items.slice(range.start, range.end);
    results.push(await work(chunk));
    handled += chunk.length;
  }
  return { handled, results };
}
