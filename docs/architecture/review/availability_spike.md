# Spike: availability search recall (F-01)

Run on 2026-11-02 against commit `86870b9d`. The fix has since landed in
`libs/ecs-core/src/systems/availability.system.ts`. **"As landed" below supersedes
the prototype's numbers and its "What landing needs" list.**

## As landed

Three changes came out of landing:

- **Node budget 100,000, down from 200,000.** The worst case measured takes about 15 ms
  on this Mac, down from 28.5 ms at the old budget.
- **A second round.** A new four-line check against the reference found a start
  that needed more than its even share, while later starts left nodes unused. Starts
  still without a seating now get what the others left.
- **Riders are placed before any seat.** A client's move knows where its carried seats
  go once the start is known, so a start they cannot fit costs nothing and seats avoid
  them, rather than a leaf rejecting them after the search.

**Evidence on the final code:**

- 6,000 random days at up to 3 lines (1,124 with options, 806 of those with a rider) and
  500 at 4 lines (102 with options) match the unbudgeted reference search: no start missing,
  none longer, none exhausted. These were one-off larger runs. The committed spec
  keeps 150 runs at up to 3 lines and 20 pinned runs at 4.
- The extra e2e journey books a party of four on the real dev catalogue, in the afternoon, and
  the server files one appointment with four seats. **On the old search the same journey
  fails** with no afternoon time on offer, so the defect was real on the dev catalogue too.
- The full gate of `HANDOFF.md` §4 is green, including the emulator journeys.

**Still weak, unchanged:** at the extreme, tightness can stay unproven. Ten barbers with
five mixed lines: 2 of 30 starts run 45 minutes longer on average. One person with three
services plus one with two, at ten barbers: 14 of 23 starts run 98 minutes longer, and
`exhausted` is true although no real start is missing. No start was lost in any measured
case. Nothing has been measured on a real phone or against real rosters.

`exhausted` still has no reader outside specs, which is deliberate: it can over-report, so
no message shows it.

The sections below are the spike as it was run.

## Result

The defect is fixable inside the existing search, with no change to its callers
or its data. Across every case measured, no start time was lost, and answers match
the unbudgeted reference search wherever the budget is enough to finish.

## The design

`availableStarts` now settles one party start at a time, earliest first, instead of
walking the whole day depth-first:

1. **List the candidates.** A party's earliest seat always stands on its gap's grid,
   so the possible starts can be listed before any search. This relies on services
   having a positive duration.
2. **Share the budget.** Each start gets an even share of the nodes left, so a dense
   morning cannot spend the afternoon's budget.
3. **Find any seating first.** Once one exists, the start cannot be lost.
4. **Then tighten.** Widen the allowed envelope from the shortest possible until a
   pass finds a seating. That pass ranks everything inside it, so its winner is the
   tightest arrangement, with today's tie-break.

`availableOptions` still uses the old walk. Nothing in production calls it.

## Measurements

**Real availability code on this Mac.** Synthetic days: 30 min services, 15 min step,
09:00–19:00, any barber. Letters in the party column are people, so `aabb` is two
people with two services each.

| Barbers | Appts per barber | Party   | Old starts, last | New starts, last | New nodes | New time |
| ------- | ---------------- | ------- | ---------------- | ---------------- | --------- | -------- |
| 3       | 4                | `abc`   | 28, 18:30        | 28, 18:30        | 504       | 0.5 ms   |
| 3       | 4                | `aabb`  | 1, 09:30         | 26, 18:00        | 14,162    | 5.8 ms   |
| 5       | 5                | `abc`   | 14, 14:15        | 25, 18:30        | 2,200     | 0.3 ms   |
| 5       | 5                | `aabb`  | 1, 09:30         | 23, 18:00        | 140,054   | 7.9 ms   |
| 5       | 5                | `aabbc` | 1, 09:30         | 23, 18:00        | 184,115   | 16.6 ms  |
| 10      | 6                | `abc`   | 7, 12:50         | 18, 18:20        | 14,814    | 1.6 ms   |
| 10      | 3                | `aabb`  | 1, 09:30         | 28, 17:55        | 187,148   | 7.6 ms   |
| 10      | 6                | `abcde` | 1, 09:30         | 18, 18:20        | 200,000   | 28.5 ms  |

**Seed catalogue (3 barbers).** The digests for parties of one, two and three match
the legacy engine's. The fourth and fifth lines were added for this spike.

| Lines | Legacy nodes | New nodes | Starts | Digest                 |
| ----- | ------------ | --------- | ------ | ---------------------- |
| 1     | 61           | 84        | 42     | same                   |
| 2     | 2,938        | 235       | 39     | same                   |
| 3     | 167,690      | 1,521     | 39     | same                   |
| 4     | not recorded | 7,231     | 38     | same as an open budget |
| 5     | not recorded | 10,968    | 37     | same as an open budget |

**Against the unbudgeted reference search.** In a temporary spec, since deleted:

- 3,000 random days at up to 3 lines and 3 barbers: answers identical, and never
  exhausted. Only 533 of those days had any option at all, so the rest only prove that
  the search agrees there is none.
- 203 random days at 4 lines: answers identical.

## What is still weak

- **Tightness at the extreme.** With 10 barbers and five lines, a start's share can run
  out before the tightest arrangement is proven. The start is kept, but some answers
  are longer than the true tightest: 2 of 30 starts by 45 minutes on average for five
  separate people with mixed services, and 14 of 23 by 98 minutes for one person with
  three services plus one with two. The second means a real wait for that party.
- **CPU.** 28.5 ms on this Mac at the full budget, against about 9 ms before. At the
  earlier ×5 estimate that is about 140 ms on a phone, for the largest party only. A
  budget of 100,000 gave the same lost and longer counts as 200,000 in every case, at
  about half the time.
- **`exhausted` can over-report.** In the one-person-three-services case it was true
  although no real start was missing: a start with no seating could not be proven
  impossible within its share.
- **The fixtures.** No real roster or traffic data exists. No browser or phone run was
  done, and rendering cost was not measured.

## Alternatives

| Alternative                               | Decision | Reason                                                                                                           |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Raise the node budget                     | Rejected | The worst case already needs 12.7 million nodes with this pruning. Without it, the old walk has no useful bound. |
| Per-start quota taking the first seating  | Rejected | Keeps every start but gives up tightness. It is step 3 above with no step 4.                                     |
| Grid checks feasibility, tightest on pick | Rejected | Changes what the grid returns, so every caller and the pinned digests change. Not needed for this result.        |
| Show a message when `exhausted`           | Rejected | Rare after this fix, and it can over-report, so it would warn about nothing.                                     |

## What landing needs

The full `ecs-core` suite gives 7,133 passed and 3 failed. All three failures pin the
old walk. Each keeps its intent in a new form:

| Spec                                         | Today                                    | Change to                                                                  |
| -------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `availableStarts equals the naive reference` | Equal at small budgets, in no more nodes | Equal to the unbudgeted reference on small days, first `maxOptions` starts |
| `never tries more than nodeBudget`           | Exactly 500 nodes                        | At most 500; options stay valid                                            |
| `a single seat: ... in no more nodes`        | At most 61 nodes                         | A new ceiling of 84, and new ceilings for parties of two and three         |

Also to add: recall specs from the table above, with the fixture committed, and parties of
four and five on the seed catalogue. `nodesVisited` ceilings replace the "see WS-1" budget.

The two users of this search change as follows:

- **Waitlist:** `WaitlistSystem.match` passes `maxOptions: 1`, so it now gets the earliest
  start with its tightest arrangement. Its 96 specs pass.
- **Booking commit:** it does not call this search. `dayOptions` and `optionsForDay` are
  used only by the two booking screens and the waitlist. A newly offered start is still
  checked at commit by the placement rules, which this spike did not exercise. An e2e
  journey for a party of four should prove it.

`ecs-core` lint passes and its typecheck ran; the prototype adds about 120 lines to the search.
