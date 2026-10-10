---
paths:
  - '**/*.system.ts'
  - '**/*.system.spec.ts'
---

# Systems — pure mathematics only

Law 3 of `CLAUDE.md`. A system is a module of pure functions that turns
component slices into new component slices or decisions.

## Shape (`interval-collision.system.ts`)

```ts
import { TimeInterval } from '../components/time-interval.data';

export type Collision = {
  readonly candidateIndex: number;
  readonly busyIndex: number;
};

export const IntervalCollisionSystem = {
  /**
   * Linear scan over two sorted-by-start arrays. O(n + m), no allocation
   * beyond the result array; both inputs are read, never written.
   */
  findCollisions(
    candidates: readonly TimeInterval[],
    busy: readonly TimeInterval[],
  ): readonly Collision[] {
    const out: Collision[] = [];
    let j = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] as TimeInterval;
      while (j < busy.length && (busy[j] as TimeInterval).endMs <= c.startMs)
        j++;
      for (let k = j; k < busy.length; k++) {
        const b = busy[k] as TimeInterval;
        if (b.startMs >= c.endMs) break;
        if (TimeInterval.overlaps(c, b))
          out.push({ candidateIndex: i, busyIndex: k });
      }
    }
    return out;
  },
} as const;
```

## Rules

- **Inputs in, outputs out.** `now` is a parameter (`nowMs: number`), ids come
  from a `nextId: () => string` parameter supplied by the pipeline, digests
  from a `hash: (input: string) => string` parameter, randomness is a
  parameter. Never `Date.now()`, `new Date()`, `Math.random()`, `crypto`.
- **Time zones are native `Intl`, in one place.** Zone math (instant to
  wall clock, wall clock to instant, day keys, DST transitions) lives only in
  `zoned-time.system.ts`, built on `Intl.DateTimeFormat(…).formatToParts`.
  Every other system takes epoch ms, minutes-of-day and a precomputed day
  table. No Luxon, no Moment, no date library. The one sanctioned module
  state in any system is that file's `Map<zone, Intl.DateTimeFormat>`
  formatter cache — construction is expensive and the output is pure.
- **No I/O of any kind** — no Firestore, no fetch, no logging, no Angular, no
  port imports. If a system needs data, the pipeline loads it first.
- **Never mutate an argument.** Return new arrays/objects; `readonly` on every
  parameter type. Sorting copies first (`[...xs].sort(...)`).
- **Arrays of structs, scanned linearly.** Sort once, then `for` loops with
  index access; avoid `map/filter/reduce` chains in hot paths that allocate
  intermediate arrays. Early `break`/`continue` on sorted data. A `Map`/`Set` allocated once per call is fine; `new Date` and SDK constructors never are.
- **Lazy, procedural computation.** Derive availability windows, totals and
  summaries from intervals on demand. Do not materialize slot grids.
- **Decisions, not side effects.** A system that would "write" returns a write
  plan (`readonly writes: WriteOp[]`) for the pipeline to commit.
- **Errors are values.** Return `Result<T, E>` with plain error structs.

## Spec contract (`*.system.spec.ts`)

Every system spec must include, besides its math cases:

```ts
it('is pure: same input → same output, inputs untouched', () => {
  const a = deepFreeze(fixtureA()); // test-only helper, never production
  const b = deepFreeze(fixtureB());
  const once = System.fn(a, b);
  const twice = System.fn(a, b);
  expect(twice).toEqual(once);
});
```

Property tests with `fast-check` are welcome for interval algebra and for
"sorted linear scan equals brute-force O(n·m)" equivalence. Performance
assertions, when present, compare operation counts or use large synthetic
arrays — never wall-clock thresholds that flake in CI.
