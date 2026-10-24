import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UtcEpochMs } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { WorkBudgetSystem } from './work-budget.system';

/*
 * The cases of apps/functions/src/lib/ops/work-budget.spec.ts, copied (the
 * legacy spec ran against its shim until a flip deleted it). `timeBudget`
 * is re-targeted
 * to `isSpent` over a clock the case reads itself — instants as
 * `UtcEpochMs` (flatten-spec T2) — and `walkWithin` to the pure chunk steps
 * it is built from, driven by `walk` below exactly as the shim drives them —
 * the awaiting stays with the caller.
 */

const {
  CALLABLE_CLIENT_TIMEOUT_SECONDS,
  budgetMsFor,
  callableBudgetMs,
  isSpent,
} = WorkBudgetSystem;

/** An instant literal in epoch ms. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

/** A clock that reads `step` ms later every time it is read — a slow run, instantly. */
function slowClock(step: number): () => UtcEpochMs {
  let now = 1_000_000;
  return () => at((now += step));
}

/** A budget of `limitMs` from the clock's first read — `timeBudget`, over `isSpent`. */
function budgetOn(
  clockUtcMs: () => UtcEpochMs,
  limitMs: number,
): () => boolean {
  const startedAtUtcMs = clockUtcMs();
  return () => isSpent(startedAtUtcMs, clockUtcMs(), limitMs);
}

/** The walk `run-backfill.pipeline.ts`'s `walkWithin` runs, synchronously, over the system's steps. */
function walk<T, R>(
  items: readonly T[],
  chunkSize: number,
  spent: () => boolean,
  work: (chunk: readonly T[]) => R,
): { handled: number; results: R[] } {
  const size = WorkBudgetSystem.chunkSize(chunkSize);
  const results: R[] = [];
  let handled = 0;
  for (;;) {
    const range = WorkBudgetSystem.nextChunk(items.length, size, handled);
    if (range === null || !WorkBudgetSystem.takesChunk(handled, spent)) break;
    const chunk = items.slice(range.start, range.end);
    results.push(work(chunk));
    handled += chunk.length;
  }
  return { handled, results };
}

const NEVER_SPENT = (): boolean => false;

describe('budgetMsFor', () => {
  it('leaves the last 30 % of the timeout for the unit in hand and the bookkeeping', () => {
    expect(budgetMsFor(540)).toBe(378_000);
    expect(budgetMsFor(60)).toBe(42_000);
  });
});

describe('callableBudgetMs', () => {
  it('answers inside the client SDK’s 70 s wait, however long the platform allows', () => {
    expect(CALLABLE_CLIENT_TIMEOUT_SECONDS).toBe(70);
    expect(callableBudgetMs(540)).toBe(49_000);
    // A shorter platform timeout is the tighter bound.
    expect(callableBudgetMs(60)).toBe(budgetMsFor(60));
    // A client configured to wait longer only helps up to the platform.
    expect(callableBudgetMs(540, 600)).toBe(budgetMsFor(540));
  });

  it('never outlasts either bound', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3_600 }),
        fc.integer({ min: 1, max: 3_600 }),
        (platform, client) => {
          const budget = callableBudgetMs(platform, client);
          expect(budget).toBeLessThan(platform * 1000);
          expect(budget).toBeLessThan(client * 1000);
        },
      ),
    );
  });
});

describe('isSpent (timeBudget)', () => {
  it('is spent once the injected clock has moved past the limit', () => {
    let now = 0;
    const spent = budgetOn(() => at(now), 1_000);
    expect(spent()).toBe(false);
    now = 999;
    expect(spent()).toBe(false);
    now = 1_000;
    expect(spent()).toBe(true);
  });
});

describe('the budgeted walk (walkWithin)', () => {
  it('walks everything in chunks while the budget lasts', () => {
    const seen: number[][] = [];
    const walked = walk([1, 2, 3, 4, 5], 2, NEVER_SPENT, (chunk) => {
      seen.push([...chunk]);
      return chunk.length;
    });
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
    expect(walked).toEqual({ handled: 5, results: [2, 2, 1] });
  });

  it('takes no new chunk once a slow run spends the budget, but always the first', () => {
    // Every clock read costs 600 ms against a 1 s budget: the start, then
    // one look per chunk after the first — the second look is past it.
    const spent = budgetOn(slowClock(600), 1_000);
    const walked = walk([1, 2, 3, 4, 5, 6], 2, spent, (chunk) => chunk);
    expect(walked.handled).toBe(4);
    expect(walked.results).toEqual([
      [1, 2],
      [3, 4],
    ]);

    const always = walk(
      [1, 2, 3],
      2,
      () => true,
      (chunk) => chunk.length,
    );
    expect(always).toEqual({ handled: 2, results: [2] });
  });

  it('handles a prefix, never skipping an item, whatever the budget does', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 30 }),
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.boolean(), { minLength: 1 }),
        (items, size, looks) => {
          let look = 0;
          const spent = () => looks.at(look++ % looks.length) ?? true;
          const walked = walk(items, size, spent, (c) => [...c]);
          expect(walked.results.flat()).toEqual(items.slice(0, walked.handled));
          if (items.length > 0) expect(walked.handled).toBeGreaterThan(0);
        },
      ),
    );
  });
});

describe('the chunk steps', () => {
  it('takes chunks of at least one whole item', () => {
    expect(WorkBudgetSystem.chunkSize(25)).toBe(25);
    expect(WorkBudgetSystem.chunkSize(2.9)).toBe(2);
    expect(WorkBudgetSystem.chunkSize(0)).toBe(1);
    expect(WorkBudgetSystem.chunkSize(-4)).toBe(1);
  });

  it('starts each chunk where the last ended, clipped to the list, and stops at its end', () => {
    expect(WorkBudgetSystem.nextChunk(5, 2, 0)).toEqual({ start: 0, end: 2 });
    expect(WorkBudgetSystem.nextChunk(5, 2, 4)).toEqual({ start: 4, end: 5 });
    expect(WorkBudgetSystem.nextChunk(5, 2, 5)).toBeNull();
    expect(WorkBudgetSystem.nextChunk(0, 2, 0)).toBeNull();
  });

  it('never looks at the budget before the first chunk', () => {
    let looks = 0;
    const spent = () => {
      looks++;
      return true;
    };
    expect(WorkBudgetSystem.takesChunk(0, spent)).toBe(true);
    expect(looks).toBe(0);
    expect(WorkBudgetSystem.takesChunk(3, spent)).toBe(false);
    expect(looks).toBe(1);
  });
});

describe('purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const items = deepFreeze([1, 2, 3, 4, 5]);
    const once = walk(items, 2, NEVER_SPENT, (chunk) => chunk.length);
    const twice = walk(items, 2, NEVER_SPENT, (chunk) => chunk.length);
    expect(twice).toEqual(once);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(callableBudgetMs(540, 70)).toBe(callableBudgetMs(540, 70));
    expect(isSpent(at(0), at(10), 5)).toBe(isSpent(at(0), at(10), 5));
    expect(isSpent(at(0), at(10), 5)).toBe(true);
  });
});
