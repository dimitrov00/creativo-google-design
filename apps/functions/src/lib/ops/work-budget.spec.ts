import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CALLABLE_CLIENT_TIMEOUT_SECONDS,
  UNBOUNDED_BUDGET,
  budgetMsFor,
  callableBudgetMs,
  timeBudget,
  walkWithin,
} from './work-budget';

/** A clock that reads `step` ms later every time it is read — a slow run, instantly. */
function slowClock(step: number): () => number {
  let now = 1_000_000;
  return () => (now += step);
}

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

describe('timeBudget', () => {
  it('is spent once the injected clock has moved past the limit', () => {
    let now = 0;
    const budget = timeBudget(() => now, 1_000);
    expect(budget.spent()).toBe(false);
    now = 999;
    expect(budget.spent()).toBe(false);
    now = 1_000;
    expect(budget.spent()).toBe(true);
  });
});

describe('walkWithin', () => {
  it('walks everything in chunks while the budget lasts', async () => {
    const seen: number[][] = [];
    const walked = await walkWithin(
      [1, 2, 3, 4, 5],
      2,
      UNBOUNDED_BUDGET,
      async (chunk) => {
        seen.push([...chunk]);
        return chunk.length;
      },
    );
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
    expect(walked).toEqual({ handled: 5, results: [2, 2, 1] });
  });

  it('takes no new chunk once a slow run spends the budget, but always the first', async () => {
    // Every clock read costs 600 ms against a 1 s budget: the start, then
    // one look per chunk after the first — the second look is past it.
    const budget = timeBudget(slowClock(600), 1_000);
    const walked = await walkWithin(
      [1, 2, 3, 4, 5, 6],
      2,
      budget,
      async (chunk) => chunk,
    );
    expect(walked.handled).toBe(4);
    expect(walked.results).toEqual([
      [1, 2],
      [3, 4],
    ]);

    const spent = await walkWithin(
      [1, 2, 3],
      2,
      { spent: () => true },
      async (chunk) => chunk.length,
    );
    expect(spent).toEqual({ handled: 2, results: [2] });
  });

  it('handles a prefix, never skipping an item, whatever the budget does', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer(), { maxLength: 30 }),
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.boolean(), { minLength: 1 }),
        async (items, size, looks) => {
          let look = 0;
          const budget = {
            spent: () => looks.at(look++ % looks.length) ?? true,
          };
          const walked = await walkWithin(items, size, budget, async (c) => [
            ...c,
          ]);
          expect(walked.results.flat()).toEqual(items.slice(0, walked.handled));
          if (items.length > 0) expect(walked.handled).toBeGreaterThan(0);
        },
      ),
    );
  });
});
