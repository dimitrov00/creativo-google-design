# Consolidated review — schedule storage, memory, cost and lazy evaluation

**Target:** [`docs/architecture/schedule-storage-and-lazy-evaluation.md`](../../schedule-storage-and-lazy-evaluation.md), drafted 2026-11-07.

- FeatureRange: lines 1–243
- DetailedRange: lines 244–292

**Mode:** consolidated, all five stages, no stops between them. Each reviewer ran in a fresh context and read the code.

**Stage reports:**

- [`zoom_out_report.md`](zoom_out_report.md) (stage 5)
- [`comprehension_report.md`](comprehension_report.md) (stage 6)
- [`critic_report.md`](critic_report.md) (stage 7: design, structure, style)
- [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (stage 8)
- [`implementation_readiness_report.md`](implementation_readiness_report.md) (stage 9: readiness, codebase details, style)

The draft has not been edited during the review.

## The answer to the question that was asked

**Data-oriented design.** The schedule data follows the laws:

- Documents are flat and writes target root fields (Laws 5 and 6).
- Every computation is a pure system, and projections are rebuilt from their sources.
- Every query is bounded or carries a stated reason.

The gaps are small:

- `capacity.entries[]` and the roster's `versions[]` have no enforced bound, but both are far from the 1 MiB document limit.
- The `barberBusy` rules comment is stale.
- One `unbounded-ok` reason is inaccurate.
- The staff store's comments contradict its code on the week view's default.

**Lazy versus stored.** The current split is right, and the review confirms it (stage 8). The rule, in its final form:

- **Truth is stored as a pattern.** Store the pattern once, plus a document only for a day that departs from it. Never store one document per future day for a repeat.
- **Derived values are worked out when read**, unless one of three reasons applies:
  - a privacy boundary;
  - reads that would fan out on a busy screen;
  - a small, fixed conflict set for a transaction.

  When one applies, store a projection that can be rebuilt and that expires.

**What that rule decides:**

- Weekly hours, breaks, open windows and free times are worked out when read. They already are.
- Busy days are stored, because of privacy and the booking transaction's conflict set.
- Capacity months are stored, because of reads that would fan out on a busy screen. The draft overstated the cost of working them out when read: it is about 100–250 reads per visit, not about 2,700. Storing still wins once visits outnumber bookings.

**Memory and cost.**

- About $1–2 a month at today's planning scale; $13–26 at ten times that scale. Both are estimates from memory; there is no billing data yet.
- The web app holds 4 listeners per chair in the day view and 22 per chair in the week view.
- Most proposed savings are fractions of a cent.

## Verdict

**Not ready as drafted.**

- **Direction:** sound.
- **Change list:** too long, and it partly contradicts the cost audit, which already holds listener and read tuning until there is post-deploy evidence.
- **Harmful changes:** four would break things if built (the Blockers below).
- **Plan:** not buildable without design decisions.

The review recommends reframing to one short change.

## Actions, by priority

### 🔴 Blockers — do not build these as drafted

| ID  | Action                                                  | Why                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Drop C4** (`/book` reads only the cart's barbers).    | It breaks moves that carry a companion with another barber: their documents are not read, so every start is refused. It also targets the wrong file, misses the day sheet's read, and saves nothing for "anyone" carts.                                                     |
| A2  | **Drop C5** (calendar read once).                       | With the persistent cache, `take(1)` can freeze a calendar that is days old or failed. A false "full" day hides a freed slot, which is a lost booking. It saves a fraction of a cent.                                                                                       |
| A3  | **Defer C3** (staff page stops listening to busy days). | Visits the read guard rejects would show as free time (fail-open). It also reverses the store's documented design, and a phantom busy block that the commit refuses would become invisible.                                                                                 |
| A4  | **Drop the busy half of C1.**                           | Reading the stored busy day inside the rebuild turns a malformed document into a refusal that is never retried. That ends the busy day's only self-repair. It also costs one read to save one write, and the trigger it claims to save does not fire on an identical write. |

### 🟡 Major — revise the document

| ID  | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A5  | **Reframe.** Put the answer first ("the split stays, here is why"), then the rule. §6 becomes three short lists: _now_, _waits for evidence_ and _dropped, with reasons_.                                                                                                                                                                                                                                                                                                                                                               |
| A6  | **Fix the rule's own contradiction**: split the table into truth and derived values, and add the truth clause. List repeating blocks with an end as a recorded, bounded exception carried over from ruling 3 (up to 366 documents, written once, no daily cost). Ask the owner whether the cap should stay at 366 or the end date be refused past the booking horizon. **Do not** encode it as two roster revisions: an hours save before the end date would drop the end, and the break would silently become permanent (stage 8, I2). |
| A7  | **Keep one change now**: C1, capacity half only. Add `CapacitySystem.sameEntries` comparing all four fields; `CapacityEntry.compare` ignores `freeMinutes`, so do not reuse it. The pipeline skips the `set` when the entries match. Specs go in `capacity.system.spec.ts` and `rebuild-capacity.pipeline.spec.ts`. Also fix the stale `firestore.rules:643-645` comment, with the given text.                                                                                                                                          |
| A8  | **Move C2, C3 and capacity sharding (C6) to "waits for evidence"**, each with its saving and its trigger: the audit's post-deploy billing data, Gate B step 6.                                                                                                                                                                                                                                                                                                                                                                          |
| A9  | **Drop C7** (the 200-version refusal) and do not build compaction either. Replace it with one risk line: the history grows by about one version per distinct effective day, each version holds about 15 small structs, revisit at about 100 KB.                                                                                                                                                                                                                                                                                         |
| A10 | **Record F-25 as an owner question, not a phase.** The week view's code shows all chairs, while its comments say one. The store's front-desk iPad note explains why the chair lives only in links, and the audit's readiness review already removed this change as undefined.                                                                                                                                                                                                                                                           |
| A11 | **Fix the cost table**: `/book` open is about 76 reads, not 3. State the horizon once: 2 months by default; the calendar shows 3 and the rebuilds cover 4. Correct the lazy-calendar figure with one break-even sentence. Label every figure as an estimate.                                                                                                                                                                                                                                                                            |
| A12 | **Answer what was asked**: three lines on Laws 3, 5 and 6; a short paragraph of rough sizes (roster under 10 KB, busy day under 1 KB, capacity month about 620 entries); listeners, not documents, held per view.                                                                                                                                                                                                                                                                                                                       |
| A13 | **Give the rule a home**: propose one Law 3 sentence for the owner to rule on, and a decision record. Do not edit `CLAUDE.md` or `AGENTS.md` in a phase.                                                                                                                                                                                                                                                                                                                                                                                |
| A14 | **One terms list** (chair, roster, day change, projection, horizon, B), then one name per idea. "Audit-log entry" means a log row, not the cost audit.                                                                                                                                                                                                                                                                                                                                                                                  |
| A15 | **Write alternatives and risks only for the changes that remain.** C1 capacity: reject comparing at the trigger, because the event does not fire. One risk register, including a security line: no rules change.                                                                                                                                                                                                                                                                                                                        |
| A16 | **Rewrite the plan as one phase**: files marked Create, Modify or Delete; named specs and their cases; the named gate (typecheck, test, lint, `verify-tools:layering`, `nx build web`, `nx build functions`).                                                                                                                                                                                                                                                                                                                           |

### 🟢 Nits

- **N1.** Link the exact `review/` file, and say which audit figures were corrected.
- **N2.** Non-goal: "F-17–F-20, F-24".
- **N3.** Use `###` headings for Goals and Non-goals.
- **N4.** Use one id-placeholder form.
- **N5.** Use one approximation marker.
- **N6.** Use one verdict pattern for each alternative.
- **N7.** Define `CLOSED`/`HOURS`/`BLOCKED`/`ROSTERED`, the Day/Roster/Sweep rebuilds and "Gate B".
- **N8.** Correct the `unbounded-ok` reason at `rebuild-busy.pipeline.ts:106`: a busy key covers the barber's whole day, not one shop.
- **N9.** For the deferred appointments week query, note that `appointments.barberIds` single-field indexes are switched off.

## Owner decisions this review needs

1. **The cap on repeating blocks with an end:** keep 366 days, or refuse an end date past the booking horizon?
2. **Week-view default (F-25):** fix the comments to say "all chairs", or define and build a one-chair default?
3. **The Law 3 amendment:** adopt the truth and derived rule as written above?

## Traceability matrix

| Action | Raw findings                                                 |
| ------ | ------------------------------------------------------------ |
| A1     | Z2, K3, R2, R3, I7, comprehension N6                         |
| A2     | Z3, K4, R4, I7, comprehension M10                            |
| A3     | Z7, K5, R5, I5, comprehension M8                             |
| A4     | Z6, K6, R1, I4, comprehension M6                             |
| A5     | I1, I6, I10, structural M3                                   |
| A6     | Z1, K1, I2, comprehension M1, style M1/M2, structural M4     |
| A7     | K6, R6, I4, readiness N (rules text)                         |
| A8     | Z4, Z8, K7, K12, R7, R8, R9, I1, I5, comprehension M7        |
| A9     | Z5, K8, R11, I8, comprehension M11, style M10                |
| A10    | Z4, I3                                                       |
| A11    | K2, K13, K15, I11, comprehension M5, style M5                |
| A12    | K10, I6, comprehension M2/M4, design N1                      |
| A13    | comprehension M3, I6                                         |
| A14    | K14, comprehension M9, style M3/M4                           |
| A15    | K9, I6, structural M7/M8                                     |
| A16    | R10, R12, R13, I9, I11, Stage 9 style                        |
| Nits   | Z10, structural N1–N6, style nits, design N3–N5, codebase N4 |
