# Stage 6 — Comprehension Test

**Target:** `docs/architecture/schedule-storage-and-lazy-evaluation.md`

- FeatureRange: lines 1–243
- DetailedRange: lines 244–292

**Reviewer:** egm-comprehension, run in a fresh context with no document standard. It read the target and the two documents the target links to. It did not open `review/`, because that link does not name a file.

## What this proposes

One rule for schedule data: work a value out when it is read, unless one of three reasons applies.

1. A privacy boundary.
2. A read fan-out on a hot path.
3. A small, fixed conflict set needed by a transaction.

A value that is stored is stored as a projection: derived, rebuildable from its source, and with an expiry. The rule forbids storing one document per future day to express a repeating pattern.

Applied to each item, the rule keeps today's split:

- **Stored:** busy days and capacity months.
- **Computed when read:** weekly hours, breaks, bookable windows and free start times.

Seven changes follow:

- **C1:** skip writing a projection that did not change.
- **C2:** the staff week view reads each chair's exceptions with one range query instead of seven.
- **C3:** the staff schedule stops listening to busy days, because the appointments it already reads cover them.
- **C4:** `/book` reads day documents only for the barbers the cart accepts.
- **C5:** the `/book` calendar reads its three capacity months once instead of live.
- **C6:** log capacity transaction retries before reshaping capacity.
- **C7:** refuse a roster with more than 200 versions.

The plan delivers these in four commits.

## How the existing system works, per this document

**Truth** lives in four collections:

- the roster (`barberSchedules`): versioned weekly shifts and breaks, written only by two callables;
- per-day departures (`scheduleExceptions`);
- `appointments`;
- `waitlistRequests`.

**Derived** data lives in two collections:

- `barberBusy`: merged busy blocks per chair-day. The booking transaction writes it, and the `rebuildBusy` trigger rewrites it after every appointment write.
- `capacity/{YYYY-MM}`: one shared document per month, listing free minutes per (day, barber, shop). Triggers and a nightly sweep rebuild it, four months per barber.

**Who reads what:**

- Anonymous `/book` clients read busy days and capacity, because they may not read appointments.
- The commit re-checks busy days inside its transaction.
- Staff screens hold live listeners: 4 per chair in the day view and 22 per chair in the week view.

Cost today is about $1–2 a month. The goal is a reusable rule and removing waste, not an emergency saving.

## Findings

No Blockers: the reviewer could paraphrase every section.

### Major

**M1. The rule cannot decide three of the eight items in its own table (lines 88–123).**

- **Problem:** Three items are stored for reasons that are not among the rule's three:
  - a departing day is "the truth";
  - appointments and waitlist requests are "the record";
  - repeating blocks with an end are "rare", capped at 366.
    The last one also breaks the "never store per future day" clause.
- **Fix:** State that the rule decides only derivable values, and that truth is always stored. Then either explain why a bounded repeat is not a repeating pattern, or list it as an accepted exception with its cap explained.

**M2. The laws the owner asked about are never stated, so the compliance answer cannot be checked (lines 14–15, 53, 192–201).**

- **Problem:**
  - `CLAUDE.md` is not linked.
  - Law 3, the lazy-evaluation law that §5 refines, is never quoted.
  - The compliance list has no answer per law.
  - "DOD", "root-key writes", "pure systems" and `unbounded-ok` are undefined.
- **Fix:**
  - Quote Laws 3, 5 and 6, or link them.
  - Answer compliance per law.
  - Say whether §5 extends Law 3.
  - Define the terms.

**M3. Goal 1's rule has no home after this document (lines 38–39 vs 244–292).**

- **Problem:** No phase writes the rule anywhere the team reads.
- **Fix:** Add a step that amends Law 3 or a review checklist, or declare this document as the rule's home.

**M4. Memory and storage were asked about, but neither is answered nor ruled out (lines 14–17, 36–42, 203–210).**

- **Problem:** The document gives no document counts and no byte sizes per collection, and no memory figure beyond listener counts.
- **Fix:**
  - Add a size column to §3.
  - Add a held-documents figure per view.
  - Or add a non-goal saying why these are not quantified.

**M5. The booking horizon is never stated, though it drives every cost figure (lines 62, 84, 86, 100–102, 137, 169–173).**

- **Problem:** The document uses four spans: 90 days, 3 months, 4 months, and a 2-month default. Nothing connects them.
- **Fix:** State the horizon, and explain why the calendar shows 3 months and the rebuilds cover 4.

**M6. C1 contradicts the audit it cites, and the trigger chain is never shown (lines 134–143, 231–234; plan 249–259).**

- **Problem:**
  - Audit §9 says an identical Set fires **no** event, so the claimed downstream saving may not exist.
  - Audit §8 rejected skipping `rebuildBusy` (F-13) to keep self-repair.
  - The chain for one booking is never shown.
- **Fix:**
  - Show the chain.
  - Give the saving under both assumptions (an identical Set fires an event, or it does not).
  - State that C1 keeps the recompute and drops only equal writes.

**M7. C2's "see C6" points to an unrelated change (lines 149–152).**

- **Problem:** C6 measures capacity retries, not appointment week queries.
- **Fix:** Say "deferred: per-day queries stay", or add the measurement.

**M8. C3's own quotation says the two sources sometimes differ, and the planned check cannot test the stated risk (lines 154–162, 235–237; plan 269–274).**

- **Problem:**
  - The quote is unattributed.
  - The cases where only one source exists are not listed.
  - The rules on cross-shop staff reads are not stated.
  - Why the busy listener exists today is not said.
  - A pure lane spec cannot prove what a query or the rules return.
- **Fix:**
  - Attribute the quote.
  - List the cases where only one source exists.
  - State the rules position.
  - Add a rules or adapter spec.

**M9. "Chair" and "barber" are used as synonyms but never defined (lines 58–62, 80–81, 145–162, 205–209).**

- **Problem:** "A booking at another shop for the same chair" only makes sense if a chair is a barber who works at several shops.
- **Fix:** Define chair as one barber's column, say a barber may work at several shops, and use one term.

**M10. C5's risk bound depends on cache behaviour the document does not address (lines 169–175, 205–208; plan 280–283).**

- **Problem:** `take(1)` on a persistent-cache listener can return last week's month.
- **Fix:** Read from the server, or restate the risk.

**M11. C7's cap leaves legitimate long-term use at a dead end (lines 186–190; plan 287–288).**

- **Problem:** Ordinary use reaches the cap: weekly edits reach 200 in about four years. The document gives no message for staff and no way to recover.
- **Fix:** Give the expected growth rate, the user-facing message and the recovery path, for example pruning instead of refusing.

### Nits

| #   | Lines         | What is unclear                                                                                                                                                |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | 9, 27         | Which `review/` file reviews the audit; what "corrected" the cost figure.                                                                                      |
| N2  | 59            | `CLOSED` / `HOURS` / `BLOCKED` / `ROSTERED` are undefined.                                                                                                     |
| N3  | 60            | `busyKeys`, "party size, default 5" and "lines" need a gloss.                                                                                                  |
| N4  | 62, 79, 137   | "Lead-time sample" and the Day / Roster / Sweep rebuilds are undefined.                                                                                        |
| N5  | 68, 118       | "Lane" and "holes" are undefined.                                                                                                                              |
| N6  | 82, 164–167   | "Active barber" and "accepted by the cart" are undefined.                                                                                                      |
| N7  | 86            | "40 month writes" against "one shared document" needs explaining.                                                                                              |
| N8  | 100–102       | The 90 × B × 3 arithmetic counts the roster per day; it should be 90 × B busy days + B rosters.                                                                |
| N9  | 116           | "Lazy (stored once)" reads as a contradiction.                                                                                                                 |
| N10 | 131           | C2 has no risk; C6 and C7 state no saving and no risk.                                                                                                         |
| N11 | 170, 172, 238 | The month document is shared across shops; "day sheet" is undefined.                                                                                           |
| N12 | 140, 252      | Does C1 compare the whole body or only `entries[]`?                                                                                                            |
| N13 | 247–289       | Unnamed builds, an open `applyPlan`/caller choice, an unexplained `limit 31`, no acceptance line for Phase 3, a log with no reader, and an unnamed rules file. |
