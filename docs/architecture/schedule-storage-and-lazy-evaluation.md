# Schedule storage, memory and cost — what to store, what to work out when read

> Status: REVISED after review (2026-11-07). The review is
> [`review/schedule-storage/consolidated_review_report.md`](review/schedule-storage/consolidated_review_report.md);
> its five stage reports sit beside it. Builds on
> [`decisions/2026-11-06-breaks-live-on-the-roster.md`](decisions/2026-11-06-breaks-live-on-the-roster.md)
> and [`performance-cost-audit.md`](performance-cost-audit.md). Read that
> audit with its own review, [`review/zoom_out_report.md`](review/zoom_out_report.md):
> the review corrected the audit's figure for ten times the planning scale
> from "a few dollars" to $13–26 a month (finding 11).

## 1. Problem and answer

The owner asked four things about the schedule (weekly hours, breaks, day
changes, appointments):

- does it follow the data-oriented design laws ([`CLAUDE.md`](../../CLAUDE.md)
  Laws 3, 5 and 6);
- how much memory, storage, reads and writes it costs;
- whether shifts, schedules and appointments should be **worked out when
  read** instead of **stored ahead**;
- how to keep Firestore reads and writes low.

The question became concrete on 2026-11-06. A repeating lunch break was
first built as one stored document per future day: 131 documents and 262
trigger runs for one weekday lunch. It was rebuilt as a field of the weekly
hours, which costs one write.

**Answer.**

- **The laws hold.** The few gaps are in §7.
- **The current split between stored and worked out is right**, and §5
  states the rule that decides it:
  - weekly hours, breaks, open windows and free times are already worked
    out when read;
  - only two things are stored ahead, each for a named reason: busy days
    (privacy, and the booking transaction's conflict set) and capacity
    months (a busy screen would otherwise read many documents).
- **Cost is about $1–2 a month** at the planning scale (2 shops,
  10 barbers, 100 bookings a day). Most possible savings are fractions of
  a cent.
- **One change is worth making now** (§8): a capacity month is not
  rewritten when its contents did not change.
- Everything else waits for post-deploy billing data (§9) or is dropped
  because it would break something (§10).

All figures in this document are estimates from the code paths, with
Firestore prices from memory. There are no production traces or bills yet.

## 2. Goals and non-goals

### Goals

1. One written rule for "store it" versus "work it out when read", and the
   reason each schedule collection is on its side.
2. An answer to the compliance, memory and storage questions.
3. The changes that rule calls for, each with its saving and its risk.

### Non-goals

- Tuning listeners and reads before there is billing data. The audit's
  "Waits for evidence" list already holds that work until after the first
  deploy (Gate B step 6, defined in §3).
- Prices, regions and abuse limits (the audit's Gate B).
- Moving availability to a server API.
- Changing appointment documents or the booking flow's rules.
- Hosting, images and bundle size (audit F-17–F-20, F-24).

## 3. Terms

- **Chair**: one barber's column on the staff schedule. A barber may work
  at several shops; their busy time is one set across all of them.
- **Roster**: a barber's weekly hours, `barberSchedules/{barberId}`. It
  holds dated versions; each version lists the weekday shifts and the
  weekday breaks.
- **Day change**: a day that departs from the roster,
  `scheduleExceptions/{barberId}__{localDate}`. Its effect is one of:
  - `CLOSED`: the barber does not work that day;
  - `HOURS`: different hours that day;
  - `BLOCKED`: the roster's hours, with ranges blocked off;
  - `ROSTERED`: the roster's hours, with that day's own breaks
    (`dayBreakRanges`).
- **Projection**: a stored document derived from other documents. It can
  be rebuilt from its source at any time and it expires.
- **Horizon**: how far ahead a client may book, 2 months by default
  (`BookingPolicy.horizonMonths`). The `/book` calendar shows the 3 months
  that span it. The capacity rebuilds cover today through the horizon,
  extended to the end of the following month: 4 months
  (`CapacitySystem.horizonSpanEnd`).
- **B**: the number of active barbers.
- **Capacity rebuilds**:
  - Day: one barber's days, after a busy-day or day-change write;
  - Roster: one barber's horizon, after a roster write;
  - Sweep: every barber's horizon, nightly at 03:00, and after a shop or
    policy change.
- **Gate B**: the audit's checklist before the first production deploy
  ([`performance-cost-audit.md`](performance-cost-audit.md) §6). Its
  step 6 is the first week's bill and a browser trace of the staff grid.

## 4. The data today

Every collection is flat: the document is the entity minus its id, every
one-to-one field is at the root, and arrays exist only for one-to-many.

| Collection                                   | One document                                                      | Truth or projection                             | Written by                                                                | Read by                                                              | Expires                   |
| -------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| `barberSchedules/{barberId}`                 | `turnaroundMinutes`, `versions[]` (shifts and breaks per version) | Truth                                           | the callables `setRosterWeek` and `amendRosterBreaks` (no client writes)  | every screen that shows availability, the commit, capacity, waitlist | never                     |
| `scheduleExceptions/{barberId}__{localDate}` | the day's effect, its ranges, `dayBreakRanges`                    | Truth                                           | staff, from the web, in a transaction                                     | as above                                                             | never                     |
| `appointments/{appointmentId}`               | the visit: time, status, contact, `seats[]`, `busyKeys[]`         | Truth                                           | callables only                                                            | the staff schedule, the client's own visits, triggers                | never                     |
| `waitlistRequests/{requestId}`               | who waits, for which days (at most 7), the cart                   | Truth                                           | a callable                                                                | the busy-change trigger                                              | 7 days after the last day |
| `barberBusy/{barberId}__{localDate}`         | merged busy `blocks[]` for one chair-day; no names                | Projection of appointments                      | the booking transaction (merge) and the `rebuildBusy` trigger (recompute) | `/book`, the commit, the staff schedule, capacity, waitlist          | 30 days after the day     |
| `capacity/{YYYY-MM}`                         | `entries[]`: free minutes per (day, barber, shop), sorted         | Projection of roster, day changes and busy days | the capacity rebuilds                                                     | the `/book` calendar; the nightly lead-time sample                   | 40 days after the month   |

**Rough sizes:**

- **Roster:** under 10 KB. Each version holds about 15 small shift and
  break structs.
- **Busy day:** under 1 KB.
- **Capacity month:** about 620 entries at the planning scale (31 days ×
  10 barbers × 2 shops), roughly 50 KB. All three are far below
  Firestore's 1 MiB document limit.

**Worked out when read, never stored:**

- a chair's bookable windows for a day (`RosterSystem.buildDayWindows`);
- the free start times a client is offered (`AvailabilitySystem`,
  `BookingCartSystem.dayOptions`);
- the staff lanes' free gaps (`laneGeometryOf`);
- breaks and repeating weekly hours.

## 5. What one action costs today

These are document reads and writes as Firestore bills them, from the code
paths in the audit (§5.4), re-checked on 2026-11-07.

| Action                               | Reads               | Writes | Listeners           | Notes                                                                                                                                           |
| ------------------------------------ | ------------------- | ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A client books one seat              | ≈ 43                | ≈ 7    | —                   | commit, `rebuildBusy`, the Day rebuild, waitlist match, client stats                                                                            |
| A client opens `/book`               | ≈ 76                | 0      | 2–3 capacity months | services, barbers and shops, the policy, 2–3 capacity months, then 3 per barber for the days shown (audit §5.4); the capacity part is 2–3 reads |
| A client opens a day on `/book`      | 3 per active barber | 0      | —                   | roster, busy day, day change                                                                                                                    |
| Staff opens the day view, 10 chairs  | ≈ 140               | 0      | 40                  | per chair: the day's appointments, busy day, day change, roster                                                                                 |
| Staff opens the week view, 10 chairs | ≈ 300               | 0      | 220                 | per chair: 7 days × 3, plus the roster                                                                                                          |
| Staff changes the weekly hours       | ≈ 50                | ≈ 6    | —                   | one roster write, one audit-log entry, then a Roster rebuild of 4 months                                                                        |
| Staff removes one day's break        | ≈ 6                 | ≈ 3    | —                   | one day change, one month, one audit-log entry                                                                                                  |
| Nightly Sweep, 10 barbers            | ≈ 500               | 40     | —                   | every barber's 4 months rewritten, changed or not                                                                                               |

The read counts on open are larger than the listener counts because a
query listener bills one read per document it returns (a day's
appointments), and a document listener bills one.

## 6. The rule

**Truth is stored as a pattern.** Store a repeating pattern once, plus one
document only for a day that departs from it. Never store one document per
future day to express a repeat.

**Derived values are worked out when read**, from the pattern and the few
documents it depends on, unless one of three reasons applies:

1. **Privacy boundary.** A reader may not see the source. `/book` is
   anonymous, and Firestore rules cannot hide fields, so a client may not
   read `appointments`. It reads `barberBusy`, which holds times only.
2. **Reads that fan out on a busy screen.** Working the value out reads
   many documents on a screen opened far more often than the value
   changes.
3. **A small, fixed conflict set for a transaction.** The commit must
   re-check atomically that the chair is still free. One busy document per
   (barber, day) is a small, fixed set. Re-reading every appointment of the
   day inside the transaction is possible, since `rebuildBusy` does it, but
   it is larger and it grows with the day.

When a reason applies, store a projection.

### Applied to each item

| Item                                          | Kind    | Decision                                          | Reason                                                                    |
| --------------------------------------------- | ------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| Weekly hours and breaks                       | Truth   | One roster document                               | The pattern                                                               |
| A day that departs from the roster            | Truth   | One day change per such day                       | A departure                                                               |
| Repeating blocks with an end                  | Truth   | One day change per day, at most 366, written once | A recorded exception (below)                                              |
| Appointments, waitlist requests               | Truth   | One document each                                 | The record itself                                                         |
| Bookable windows, free start times, free gaps | Derived | Worked out when read                              | No reason applies; every reader already loads the few documents they need |
| Busy days                                     | Derived | Projection                                        | Reasons 1 and 3                                                           |
| Capacity months                               | Derived | Projection                                        | Reason 2                                                                  |

**The recorded exception.** A repeating block with an end date is written
day by day, at most 366 days, as the breaks decision kept it (ruling 3).
It is written once and costs nothing day to day. It cannot be two roster
versions (add the break at the start, remove it the day after the end):
the hours editor's `ScheduleVersion.replaceFrom` drops every later
version, so an hours save before the end date would drop the end, and the
break would silently become permanent. Removing the break after the end
would also strip an identical standing break. Whether the cap stays at 366
days is an open question (§12).

**Why capacity is stored.** Working the `/book` calendar out when read
would use range queries on the existing `barberBusy` and
`scheduleExceptions` indexes (`barberId`, `localDate`). Those return only
the days that exist: about 100–250 reads per visit at the planning scale,
plus B rosters, against 3 month documents today. Storing costs about
7 reads and 1 write per booking, plus the nightly Sweep (about 500 reads
and 40 writes): about 1,200 reads and 140 writes a day at 100 bookings a
day. Working it out when read costs about 100–250 reads per visit, so
storing wins once the calendar is opened more than about 10 times a day.
A shop taking 100 bookings a day has many times that. Busy days cannot be
worked out when read at all: that would break the privacy boundary.

### Proposed Law 3 sentence (for the owner)

> Truth is stored as a pattern, plus one document per day that departs
> from it — never one document per future day. A derived value is worked
> out when read unless a privacy boundary, a busy screen's read fan-out or
> a transaction's conflict set requires it; then it is stored as a
> projection that can be rebuilt and that expires.

If the owner adopts it, a decision record in `docs/architecture/decisions/`
records the ruling, and `CLAUDE.md` and `AGENTS.md` change together in
their own commit.

## 7. Compliance, memory and storage

**Compliance.**

- **Law 3 (pure systems, lazy evaluation):** every computation is a pure
  system; windows and free times are worked out on demand and never
  stored.
- **Law 5 (zero-mapper layout):** documents are the flat entity, every
  query is bounded or carries an `unbounded-ok` reason, and the two
  projections expire.
- **Law 6 (flat archetypes):** every one-to-one field is at the root, and
  writes target root fields.

**Gaps:**

- `capacity.entries[]` and the roster's `versions[]` have no enforced
  bound. Both are far from the 1 MiB limit (§4, §11).
- The `barberBusy` rules comment (`firestore.rules:643-645`) says only the
  booking transaction writes it; the `rebuildBusy` trigger writes it too
  (fixed in §8).
- The `unbounded-ok` reason at `rebuild-busy.pipeline.ts:106` says "one
  shop day"; a busy key covers the barber's whole day at every shop (fixed
  in §8).
- The staff store's comments say the week view opens on one chair; the
  code opens all chairs (audit F-25; an owner question, §12).

**Memory.** The web app holds listeners, not copies: 4 per chair in the
day view and 22 per chair in the week view, each keeping its latest
documents. Derived lanes are recomputed from them on change. The
persistent IndexedDB cache keeps the documents between reloads. No server
function keeps state between calls.

**Storage.** Truth grows with use: one roster per barber, one day change
per departing day, one document per appointment. The projections are
bounded by their expiry: one busy day per chair-day with a visit, kept
30 days after the day, and about 4 live capacity months, each kept 40 days
after the month.

## 8. Changes now

The test for "now": the change fixes a defect, or removes waste with no
risk and no new read, port or index.

**C1. Do not rewrite a capacity month that did not change.** Today
`capacityWrites` (`rebuild-capacity.pipeline.ts`) sets every planned month
whole, even when its entries match the stored ones. The rebuild already
reads the stored month, so comparing costs no extra read.

- A new `CapacitySystem.sameEntries(a, b)` is true when both lists have
  the same length and every pair of entries matches on `localDate`,
  `barberId`, `locationId` and `freeMinutes`. `CapacityEntry.compare`
  cannot be reused: it orders by the first three and ignores
  `freeMinutes`.
- `capacityWrites` skips the `set` when the new entries match the stored
  ones. A month never stored, whose new entries are empty, is also
  skipped: `/book` reads a missing month as empty
  (`observeCapacityEntries`).
- The expiry is stamped from the month itself (`firestore-ttl.adapter.ts`),
  so a skipped write leaves the same expiry a write would have stamped.

_Saves:_ most of the nightly Sweep's 40 writes, and the unchanged months
of every Roster rebuild. _Risk:_ none found. A skipped write leaves exactly
the bytes a write would have.

**Two comment fixes.**

- `firestore.rules:643-645`: "Written by the `commitBooking` transaction
  (merge) and the `rebuildBusyOnAppointmentChange` trigger (recompute),
  both Admin SDK, which bypasses rules."
- `rebuild-busy.pipeline.ts:106`: "unbounded-ok: one barber's day at every
  shop: as many visits as fit in a day".

## 9. Waits for evidence

Each item moves to the audit's evidence list. It is revisited after the
first week's bill and the staff-grid trace (Gate B step 6).

- **Exceptions in one range query per chair** in the week view, instead of
  7 listeners. _Saves_ 60 listeners at 10 chairs. _Needs_ a new port,
  adapter, token and binding. _Trigger:_ the trace shows the week view's
  listeners as a cost or a slowdown.
- **The staff schedule stops listening to busy days**, since appointments
  cover the same time. _Saves_ 10 listeners in the day view and 70 in the
  week view. _Blocked on:_ a visit the read guard rejects would then show
  as free time, and a phantom busy block the commit refuses would become
  invisible. It also reverses the store's documented design
  (`staff-day.store.ts`). _Trigger:_ as above, and a design for unreadable
  visits.
- **An appointments week query** instead of 7 per-day queries per chair.
  _Needs_ a composite index, and the switched-off single-field indexes on
  `appointments.barberIds` (`firestore.indexes.json:445-449`) turned back
  on. _Trigger:_ as above.
- **Capacity per barber** instead of one shared month document (audit
  F-14). It would end contention between parallel Day rebuilds, but turn
  the calendar's 3 reads into 3 × B. _Trigger:_ observed transaction
  retries, or more than 30 barbers.

## 10. Dropped

| Change                                                            | Why it is dropped                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/book` reads day documents only for the barbers the cart accepts | A reschedule can carry a companion booked with another barber. That barber's documents would not be read, so every start time would be refused. It also saves nothing for an "anyone" cart, the common case.                                        |
| The `/book` calendar reads its months once instead of live        | With the persistent cache, the one read can return data days old, or a failure, and leave the calendar blank or wrong. A false "full" day hides a freed slot, which is a lost booking. It saves a fraction of a cent.                               |
| Skipping unchanged busy-day writes                                | Reading the stored busy day inside the rebuild turns a malformed document into a refusal that is never retried. That ends the busy day's only self-repair. It costs one read to save one write, and an identical write fires no downstream trigger. |
| Refusing a roster above 200 versions                              | Once reached, the hours could never change again. The history grows by about one version per distinct day a change takes effect (`replaceFrom` drops later versions), so the limit is decades away (§11).                                           |
| Logging capacity transaction attempts                             | `CommitPlan` exposes no attempt count, and the post-deploy evidence answers the same question.                                                                                                                                                      |

## 11. Alternatives and risks

**Alternatives for C1:**

- **Compare in the trigger, from the event's before and after bodies.**
  Rejected: an identical `set` fires no event, so there is nothing to
  compare at that edge.
- **Compare in the pipeline inline.** Rejected: the comparison is a
  decision, and decisions belong in a pure system (Law 4).

**Risks:**

| Area          | Risk                                                                     | Mitigation                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| C1            | A wrong equality skips a needed write, and `/book` shows stale free time | `sameEntries` compares all four fields, with a spec for entries that differ only in `freeMinutes`; the commit re-checks every booking anyway |
| Projections   | A projection drifts from its source after a missed trigger               | the nightly Sweep rebuilds capacity; busy days are rebuilt on every appointment write; C1 changes neither                                    |
| Roster size   | `versions[]` grows without a bound                                       | about one version of about 15 small structs per distinct effective day; revisit at about 100 KB                                              |
| Capacity size | `entries[]` grows with days × barbers × shops                            | about 620 entries today; revisit with capacity per barber (§9)                                                                               |
| Security      | —                                                                        | no rules or index change; the rules edit is a comment                                                                                        |
| Figures       | every cost figure is an estimate                                         | Gate B adds budget alerts, and its step 6 brings the first bill                                                                              |

## 12. Owner questions

1. **The cap on repeating blocks with an end:** keep 366 days, or refuse
   an end date past the horizon? Refusing would lose nothing a client can
   book today, but would lose every day past the horizon if the horizon
   grows later, since there is no job that writes ahead.
2. **The week view's default (F-25):** change the comments to say "all
   chairs", or define and build a one-chair default? The store keeps the
   chair only in links, for a shared front-desk iPad, and the audit's
   readiness review already removed this change as undefined.
3. **The Law 3 sentence in §6:** adopt it as written?

## Detailed Implementation Plan

One phase, one commit. Specs that prove today's behaviour are written
before the code changes. The phase ends green on the gate:
`pnpm nx run-many -t typecheck`, `pnpm nx run-many -t test`,
`pnpm nx run-many -t lint`, `pnpm nx run verify-tools:layering`,
`pnpm nx build web`, `pnpm nx build functions`.

**Phase 1 — skip unchanged capacity months, fix two comments.**

1. **Modify** `libs/ecs-core/src/systems/capacity.system.ts`: add
   `sameEntries(a: readonly CapacityEntry[], b: readonly CapacityEntry[]):
boolean` as defined in §8, a linear scan with no allocation.
2. **Modify** `libs/ecs-core/src/systems/capacity.system.spec.ts`, cases:
   - two equal lists are the same;
   - lists of different length are not;
   - lists that differ only in one entry's `freeMinutes` are not;
   - lists that differ only in one entry's `locationId` are not;
   - two empty lists are the same;
   - the inputs are unchanged after the call.
3. **Modify** `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.ts`:
   in `capacityWrites`, compare the new `entries` with
   `stored?.entries ?? []` through `sameEntries`, and push no `WriteOp`
   when they match.
4. **Modify** `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.spec.ts`,
   cases:
   - a Sweep over unchanged input commits no capacity write;
   - a change to one day's busy time writes exactly that day's month;
   - a month never stored, with no entries, is not written;
   - a month never stored, with entries, is written.
5. **Modify** `firestore.rules`, lines 643–645: the comment text in §8.
   No rule changes.
6. **Modify** `libs/ecs-core/src/pipelines/rebuild-busy.pipeline.ts`,
   line 106: the comment text in §8.

**Acceptance:** the pipeline spec shows a Sweep over unchanged input
committing zero capacity writes; the gate is green; no document shape,
rule or index changes.
