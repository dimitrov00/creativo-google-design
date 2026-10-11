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
import type { MinuteOfDay } from '../primitives/minute-of-day.primitive';

/** The slice this system reads — any entity carrying it is accepted as is (Law 3). */
export type MinuteSpan = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: MinuteOfDay;
};

export type Collision = {
  readonly candidateIndex: number;
  readonly busyIndex: number;
};

export const IntervalCollisionSystem = {
  /**
   * Linear scan over two sorted-by-start arrays of ONE shop day's local
   * coordinates (Law 7: collision math never touches UtcEpochMs). O(n + m),
   * no allocation beyond the result array; both inputs are read, never written.
   */
  findCollisions(
    candidates: readonly MinuteSpan[],
    busy: readonly MinuteSpan[],
  ): readonly Collision[] {
    const out: Collision[] = [];
    let j = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] as MinuteSpan;
      while (
        j < busy.length &&
        (busy[j] as MinuteSpan).endMinutes <= c.startMinutes
      )
        j++;
      for (let k = j; k < busy.length; k++) {
        const b = busy[k] as MinuteSpan;
        if (b.startMinutes >= c.endMinutes) break;
        if (c.startMinutes < b.endMinutes)
          out.push({ candidateIndex: i, busyIndex: k });
      }
    }
    return out;
  },
} as const;
```

## Rules

- **Zero inbound mapping (Law 6).** A system takes the slice it needs
  (`readonly TimeCoordinate[]`) or the whole entity, by structural typing —
  never `.map()` to strip, rename or re-nest properties before calling it.
- **Narrow on the domain discriminator** (`bookingStatus`, `paymentMethod`,
  `attendanceState`) with plain `===` against the dictionary value; never a
  generic `kind`/`type` field.
- **Inputs in, outputs out.** `now` is a parameter — `now: ShopNow` when the
  system compares now with local coordinates, `nowUtcMs: UtcEpochMs` when it
  only stamps (or, under G-1(a), compares) lifecycle instants (flatten-spec
  T4) — never `nowMs: number`; ids come
  from a `nextId: () => string` parameter supplied by the pipeline, digests
  from a `hash: (input: string) => string` parameter, randomness is a
  parameter. Never `Date.now()`, `new Date()`, `Math.random()`, `crypto`.
- **Time is local integers; the zone is touched once (Law 7).** Collision
  math, schedule packing, availability sweeps and calendar grids run only on
  the shop wall clock — `LocalDate` + `MinuteOfDay` — never on
  `UtcEpochMs`, which exists for indexes, crons, `.ics`, lifecycle stamps and
  the elapsed-time rules of `flatten-spec.md` §2.3 T2 (expiries, the
  cancellation window, cooldowns, budgets) — never placement math. Zone math
  (wall clock ↔ instant, DST gap rejection, fall-back resolution to the
  earlier offset) lives only in `zoned-time.system.ts` on native
  `Intl.DateTimeFormat(…).formatToParts`, and only the ingestion boundary (a
  pipeline or callable edge) calls it, with the location's `timeZone`. "Now"
  arrives as `ShopNow = { localDate, currentMinute, utcEpochMs }`: compute
  only with `localDate` + `currentMinute`; `utcEpochMs` exists to stamp
  lifecycle instants (`confirmedAtUtcMs`). A spring-forward gap time is the
  error `DST_GAP_INVALID_TIME`; a fall-back repeat resolves to the earlier
  offset.
  No `Date`, no Luxon, no Moment, no date library. The one sanctioned module
  state is that file's `Map<TimeZone, Intl.DateTimeFormat>` formatter cache.
- **Branded in, branded out (Law 7).** Parameters and results are branded
  primitives (`MinuteOfDay`, `PriceCents`, `BarberId`, …), never raw
  `number`/`string` for a coordinate, amount or id. Arithmetic goes through
  the primitive's companion helpers, which keep the brand.
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
- **Errors are values.** Return `Result<T, E>` whose error is a flat struct
  discriminated by `errorCode` (Law 7). `throw` only for a programmer defect.

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
