# Schedule storage, memory and cost — what to store, what to work out when read

> Status: PHASE 1 BUILT and PHASE 2 RULED (2026-11-07; the Law text is in `CLAUDE.md`,
> [`decisions/2026-11-07-truth-is-a-pattern.md`](decisions/2026-11-07-truth-is-a-pattern.md)). Reviewed in two rounds:
> [`review/schedule-storage/consolidated_review_report.md`](review/schedule-storage/consolidated_review_report.md)
> (round 1) and
> [`review/schedule-storage/round-2/consolidated_review_report.md`](review/schedule-storage/round-2/consolidated_review_report.md)
> (round 2). Builds on
> [`decisions/2026-11-06-breaks-live-on-the-roster.md`](decisions/2026-11-06-breaks-live-on-the-roster.md)
> and [`performance-cost-audit.md`](performance-cost-audit.md).

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

- **The laws hold.** The gaps are four stale comments and two lists with no
  enforced bound, far from any limit (§7).
- **The current split between stored and worked out is right.** §6 states
  the rule that decides it:
  - the weekly hours and breaks are stored once, as a pattern. The days
    they produce are worked out when read, and so are bookable windows and
    free start times;
  - only two **derived** things are stored ahead, each for a named reason:
    - busy days, for privacy and for the booking transaction's conflict
      set;
    - capacity months, because a busy screen would otherwise read many
      documents;
  - one kind of truth is written day by day: a series with an end date,
    at most 366 days. It is written once and is the rule's one recorded
    departure (§6).
- **Memory and storage are small.**
  - **Memory:** the largest screen, the staff week view at 10 chairs,
    holds about 850 small documents (§7).
  - **Storage:** the largest single document is a capacity month, at about
    70–90 KB (§4).
- **Cost is about $1–2 a month** at the planning scale (2 shops,
  10 barbers, 100 bookings a day; audit §5.4). Every possible saving found
  is worth less than a cent a month.
- **One change now** (§8): stop rewriting a capacity month whose contents
  did not change, and fix the stale comments. It is hygiene, done because
  the owner asked for no redundant writes; it saves about $0.002 a month.
- **Everything else** waits for post-deploy billing data (§9), or is
  dropped (§10), mostly because it would break something.

All figures are estimates from the code paths. The Firestore prices are
from memory: about $0.06 per 100,000 reads and $0.18 per 100,000 writes.
There are no production traces or bills yet.

## 2. Goals and non-goals

### Goals

1. One written rule for "store it" versus "work it out when read", and the
   reason each schedule collection is on its side (§6).
2. An answer to the compliance, memory and storage questions (§4, §7).
3. The changes that pass the test "fixes a defect, or removes waste with
   no risk and no new read, port or index", each with its saving and risk
   (§8–§10).

### Non-goals

- Tuning listeners and reads before there is billing data. The audit's
  "Waits for evidence" list holds that work until after the first deploy
  (Gate B step 6, §3).
- Prices, regions and abuse limits (the audit's Gate B).
- Moving availability to a server API.
- Changing appointment documents or the booking flow's rules.
- Hosting, images and bundle size (audit F-17–F-20, F-24).

## 3. Terms

- **`/book`**: the public booking page. Visitors are anonymous.
- **Chair**: one barber's column on the staff schedule. In data, the same
  thing is a **barber-day**: one barber on one date, across every shop
  they work at.
- **Staff schedule**: the staff screen of time grids. Its day view has one
  column per chair. Its week view has one column per day.
- **Appointment**: the stored record of a booking. A **seat** is one
  person's place in it (a party books several seats).
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
- **Series**: blocked time repeated from the block sheet's «Повтаряне»
  page with an end («На дата» or «След брой пъти»). The browser works out
  its days (`RecurrenceSystem.series`) and writes one `BLOCKED` day change
  per day, at most 366 of them (`RecurrenceRule.MAX_OCCURRENCES`). A
  repeat with no end («Без край») is not a series: it becomes a roster
  break.
- **Projection**: a stored document derived from other documents. It can
  be rebuilt from its source at any time, and it expires.
- **Busy day**: `barberBusy/{barberId}__{localDate}`, one barber-day's
  merged busy times, with no names. Its id is the **busy key** that each
  appointment lists in `busyKeys[]`.
- **Capacity month**: `capacity/{YYYY-MM}`, one document per month that
  every barber and shop shares. It holds the free minutes per (day,
  barber, shop).
- **Booking transaction**: the transaction inside each booking callable
  (`commitBooking`, `rescheduleAppointment`, `staffEditAppointment`,
  `transitionAppointment`). It re-checks that the barber-day is still free
  and merges the change into the busy days.
- **Horizon**: how far ahead a client may book, 2 months by default
  (`BookingPolicy.horizonMonths`). The `/book` calendar shows the 3 months
  that span it.
- **Rebuild span**: today through the horizon, extended to the end of the
  month after the horizon's last day (`CapacitySystem.horizonSpanEnd`):
  4 months by default.
- **Capacity rebuilds**:
  - **Day:** one barber's days, after a busy-day or day-change write;
  - **Roster:** one barber's rebuild span, after a roster write;
  - **Sweep:** every barber's rebuild span, nightly at 03:00 and after a
    shop or policy change.

  Each barber's rebuild rewrites the shared month documents its days fall
  in.

- **B**: the number of active barbers.
- **Audit-log entry**: the row the audit trigger writes for each change to
  a governed document. It is unrelated to the cost audit.
- **Gate B**: the audit's checklist before the first production deploy
  ([`performance-cost-audit.md`](performance-cost-audit.md) §11). Its
  step 6 reads: "one browser trace of the staff grid on a mid-range phone,
  real cold starts, the first week's bill. Then revisit the next list."

## 4. The data today

Every collection is flat ([`CLAUDE.md`](../../CLAUDE.md) Laws 5 and 6):
the document holds the record's fields minus its id, each single-valued
field sits at the top level, and arrays exist only for one-to-many.

| Collection                     | One document                                                      | Truth or projection                             | Written by                                                                                    | Read by                                                                                        | Expires                   |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| roster                         | `turnaroundMinutes`, `versions[]` (shifts and breaks per version) | Truth                                           | the callables `setRosterWeek` and `amendRosterBreaks` (no client writes)                      | every screen that shows availability, the booking transaction, capacity, waitlist              | never                     |
| day change                     | the day's effect, its ranges, `dayBreakRanges`                    | Truth                                           | staff, from the web, in a transaction                                                         | as above                                                                                       | never                     |
| `appointments/{appointmentId}` | the appointment: time, status, contact, `seats[]`, `busyKeys[]`   | Truth                                           | callables only                                                                                | the staff schedule, the client's own appointments, triggers                                    | never                     |
| `waitlistRequests/{requestId}` | who waits, for which days (at most 7), the cart                   | Truth                                           | a callable                                                                                    | the busy-change trigger                                                                        | 7 days after the last day |
| busy day                       | merged busy `blocks[]` for one barber-day; no names               | Projection of appointments                      | the booking transactions (merge) and the `rebuildBusyOnAppointmentChange` trigger (recompute) | `/book`, the booking transaction, the staff schedule, capacity, waitlist                       | 30 days after the day     |
| capacity month                 | `entries[]`: free minutes per (day, barber, shop), sorted         | Projection of roster, day changes and busy days | the capacity rebuilds                                                                         | the `/book` calendar; the nightly lead-time sample (a statistic of how far ahead clients book) | 40 days after the month   |

**Rough sizes** (Firestore counts field names in a document's size):

- **Roster:** about 1 KB per version, so under 10 KB today.
- **Busy day:** under 1 KB.
- **Capacity month:** up to about 620 entries at the planning scale (31
  days × 10 barbers × 2 shops, if every barber works at both shops). At
  about 110 bytes an entry, that is about 70–90 KB. At ten times the scale
  it is about 6,200 entries, or 0.5–0.7 MiB: still under the 1 MiB
  document limit, but close. §9's per-barber split is revisited well
  before then.

## 5. What one action costs today

These are document reads and writes as Firestore bills them, from the
audit's formulas (§5.4, with the week view corrected below) and the code,
re-checked on 2026-11-07. The planning scale assumes about 10 appointments
per barber-day.

| Action                               | Reads                                               | Writes | Listeners           | Notes                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------- | ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A client books one seat              | ≈ 43                                                | ≈ 7    | 0                   | the booking transaction, `rebuildBusy`, the Day rebuild (≈ 7 reads: the shops, roster, busy range, exception range, month), waitlist match, client stats               |
| A client opens `/book`               | ≈ 76                                                | 0      | 3                   | services, barbers, shops and the policy, then 2–3 capacity months (2 when the horizon ends inside the second month), then 3 per barber for the days the calendar shows |
| A client opens a day on `/book`      | 3 per active barber                                 | 0      | 3 per active barber | roster, busy day, day change                                                                                                                                           |
| Staff opens the day view, 10 chairs  | ≈ 140                                               | 0      | 40                  | per chair: the day's appointments (≈ 10), busy day, day change, roster                                                                                                 |
| Staff opens the week view, 10 chairs | ≈ 850 (≈ 1,000 counting the day view it opens from) | 0      | 220                 | per chair: 7 days × (≈ 10 appointments + busy day + day change) + roster = 85. The audit's "about 300" assumed few appointments                                        |
| Staff changes the weekly hours       | ≈ 50                                                | ≈ 6    | 0                   | one roster write, one audit-log entry, then a Roster rebuild over 4 months                                                                                             |
| Staff removes one day's break        | ≈ 6                                                 | ≈ 3    | 0                   | one day change, one month, one audit-log entry                                                                                                                         |
| Nightly Sweep, 10 barbers            | ≈ 500                                               | 40     | 0                   | each barber's rebuild rewrites the 4 shared month documents: 10 × 4 = 40, changed or not                                                                               |

Reads on open exceed listeners because a query listener bills one read
per document it returns (a day's appointments), and catalogue reads come
on top.

## 6. The rule

**Repeating truth is stored as a pattern.** Store a repeating pattern
once, plus one document only for a day that departs from it. Never write
an open-ended repeat ahead day by day. The one recorded departure is the
series, below.

**Derived values are worked out when read**, from the pattern and the few
documents it depends on, unless one of three reasons applies:

1. **Privacy boundary.** A reader may not see the source. `/book` is
   anonymous, and Firestore rules cannot hide fields, so a client may not
   read `appointments`. It reads busy days, which hold times only.
2. **Reads that fan out on a busy screen.** Working the value out would
   read many documents on a screen opened far more often than the value
   changes. The break-even below puts a number on "many".
3. **A small, fixed conflict set for a transaction.** The booking
   transaction must re-check atomically that the barber-day is still
   free. One busy day per barber-day is a small, fixed set. Re-reading
   every appointment of the day inside the transaction is possible, since
   `rebuildBusy` does it, but that set is larger and grows with the day.

When a reason applies, store a projection.

### Applied to each item

| Item                                                                                             | Kind    | Decision                                          | Reason                                                                   |
| ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Weekly hours and breaks                                                                          | Truth   | One roster document                               | The pattern                                                              |
| A day that departs from the roster                                                               | Truth   | One day change per such day                       | A departure                                                              |
| A series                                                                                         | Truth   | One day change per day, at most 366, written once | The recorded departure (below)                                           |
| Appointments, waitlist requests                                                                  | Truth   | One document each                                 | Each is a record, not a pattern                                          |
| The days the roster produces, bookable windows, free start times, the staff schedule's free gaps | Derived | Worked out when read                              | No reason applies; every reader already loads the few documents it needs |
| Busy days                                                                                        | Derived | Projection                                        | Reasons 1 and 3                                                          |
| Capacity months                                                                                  | Derived | Projection                                        | Reason 2                                                                 |

### The recorded departure: a series

A series is written day by day, as the breaks decision kept it
([ruling 3](decisions/2026-11-06-breaks-live-on-the-roster.md)).

- **What is capped:** the number of days (366 occurrences), not the span.
  A weekly series may run about 7 years; a monthly one about 30.
- **What it costs, once:**
  - one web transaction of up to 366 reads and 366 writes
    (`scheduling.adapter.ts`);
  - then up to 366 Day rebuilds, at about 7 reads and 1 write each;
  - then up to 366 audit-log entries.

  In all, up to about 3,000 reads and 1,100 writes: roughly half a cent,
  once. Nothing recurs day to day.

- **Why it is accepted:**
  - a series is rare, and the cap bounds it;
  - it cannot be two roster versions (add the break at the start, remove
    it the day after the end): the hours editor's
    `ScheduleVersion.replaceFrom` drops every later version, so an hours
    save before the end date would drop the end, and the break would
    silently become permanent;
  - removing the break after the end would also strip an identical
    standing break.
- **Days past the rebuild span:** a series reaching years ahead makes its
  Day rebuilds write small capacity months years ahead. Nobody reads them:
  `/book` and the lead-time sample read only the horizon's months, the
  Sweep rewrites those every night, and the far-future months expire
  40 days after their month.

### Why capacity is stored

Working the `/book` calendar out when read would use range queries on the
existing busy-day and day-change indexes (`barberId`, `localDate`). Those
return only the days that exist. At 100 bookings a day, most barber-days
in the 2–3 months shown have a busy day: up to about 10 × 60 = 600 reads,
plus day changes and B rosters. That is about 100–600+ reads per open,
against 3 month documents today.

Storing costs, per day:

| Source                                             | Reads       | Writes    |
| -------------------------------------------------- | ----------- | --------- |
| Day rebuilds, 100 bookings × (≈ 7 reads + 1 write) | ≈ 700       | ≈ 100     |
| The Sweep                                          | ≈ 500       | ≈ 40      |
| **Total**                                          | **≈ 1,200** | **≈ 140** |

With writes priced at about 3 reads each, that is about 1,600
read-equivalents a day. Working it out when read breaks even at about 3–16
calendar opens a day. Every booking starts with at least one open, so
opens are at least 100 a day, and storing wins by a wide margin.

Busy days cannot be worked out when read at all: that would cross the
privacy boundary.

### Where the rule lives (Phase 2, ruled 2026-11-07)

The rule is about storage, so it belongs mainly in Law 5. Law 3 keeps its
own concrete words, which agents rely on, and points to Law 5.

**Law 3, today** ([`CLAUDE.md`](../../CLAUDE.md), lines 93–94):

> - Lazy evaluation: compute availability windows and derived views on demand
>   from intervals; never pre-generate or persist slot grids.

**Law 3, proposed** (replaces that bullet):

> - Lazy evaluation: compute availability windows, free times and other
>   derived views on demand from the stored pattern and its departures;
>   never pre-generate or persist slot grids. A derived value is stored only
>   as a Law 5 projection.

**Law 5, proposed** (a new bullet, after "Store what systems compute on"):

> - **Truth is a pattern plus its departures.** Store a repeating pattern
>   once, plus one document per day that departs from it; never write an
>   open-ended repeat ahead day by day. A series with an end date writes at
>   most 366 days, once. A derived value is stored only when a privacy
>   boundary, a busy screen's read fan-out or a transaction's conflict set
>   requires it, and then as a projection that triggers rebuild and a TTL
>   expires.

## 7. Compliance, memory and storage

**Compliance**, checked by reading the schedule's systems, pipelines and
adapters and by the repo's own checks (`creativo/query-needs-limit`, the
layering verifier):

- **Law 3 (pure systems, lazy evaluation):** every schedule computation is
  a pure system. Windows and free times are worked out on demand and never
  stored.
- **Law 5 (the Firestore layout):** documents are the flat records. Every
  schedule query is bounded or carries an `unbounded-ok` comment, the
  stated reason the lint rule requires above a query with no limit. Both
  projections expire.
- **Law 6 (flat records):** every single-valued field is at the top
  level, and writes target top-level fields.

**Gaps** (all fixed in §8 unless stated):

- `capacity.entries[]` and the roster's `versions[]` have no enforced
  bound. Both are far from the 1 MiB limit (§4, §11); not fixed, by
  design.
- The busy-day rules comment (`firestore.rules`, "Written ONLY by the
  `commitBooking` transaction") misses three booking callables and the
  `rebuildBusyOnAppointmentChange` trigger.
- Three `unbounded-ok` reasons say "one barber's one shop day", but a busy
  key covers the barber's day at every shop.
- Two recurrence comments say a series writes at most "a year" of days.
  The cap counts occurrences.
- Two staff store comments say the multi-day views default to one chair.
  The code opens every chair, following the 2026-09-23 ruling that keeps
  the chair in links only, for a shared front-desk iPad
  (`staff-day.store.ts`, the `_view` comment). This is audit F-25.

**Memory.** The web app holds one cached copy of each document it listens
to, and recomputes the staff schedule's lanes from them on change:

| View, 10 chairs | Listeners    | Documents held |
| --------------- | ------------ | -------------- |
| Day view        | 4 per chair  | about 140      |
| Week view       | 22 per chair | about 850      |

At 1–2 KB per document, the week view holds roughly 1–2 MB. The persistent
IndexedDB cache keeps the documents between reloads. No server function
keeps state between calls.

**Storage.**

- **Truth grows with use:** one roster per barber, one day change per
  departing day, one document per appointment.
- **The projections are bounded by their expiry:**
  - one busy day per barber-day with an appointment, kept 30 days after
    the day;
  - about 4 capacity months inside the rebuild span, plus small months
    further ahead that hold only series days. Each is kept 40 days after
    its month.

## 8. Changes now

The test for "now": the change fixes a defect, or removes waste with no
risk and no new read, port or index.

**C1. Stop rewriting a capacity month whose contents did not change.**

Today `capacityWrites` (`rebuild-capacity.pipeline.ts`) sets every
planned month whole, even when its entries match the stored ones. The
rebuild already reads the stored month inside its transaction, so the
comparison costs no extra read. C1 covers the "sweep writes even when
nothing changed" part of audit F-14; the shared document itself stays on
the evidence list (§9).

- **`CapacitySystem.sameEntries(a, b)`** is true when both lists have the
  same length and every pair at the same position matches on `localDate`,
  `barberId`, `locationId` and `freeMinutes`.
  - Comparing by position is valid because both lists are sorted by
    `CapacityEntry.compare`.
  - `CapacityEntry.compare` itself cannot be reused: it ignores
    `freeMinutes`.
- **`CapacitySystem.monthUnchanged(stored, month, entries)`** holds the
  whole decision, so the pipeline decides nothing (Law 4). It is true when
  either:
  - the month was never stored and its new entries are empty (`/book`
    reads a missing month as empty); or
  - the stored document's `month` equals `month` and `sameEntries` holds.

  The `month` check matters because the document's expiry is stamped from
  `month` (`firestore-ttl.adapter.ts`). A stored document whose `month`
  is wrong is rewritten.

- **`capacityWrites`** skips the `set` when `monthUnchanged` is true.
- **The fold starts from the planned month.** `capacityWrites` hands
  `applyPlan` the stored entries under `monthPlan.month`, not the stored
  document's own `month`. `applyPlan` drops plan entries of any other month,
  so a document whose `month` field was wrong used to be "repaired" into an
  empty month (found while building Phase 1).

_Saves:_ most of the Sweep's 40 writes a night and the unchanged months of
every Roster rebuild. That is about 1,200 writes a month, or about $0.002;
the reason is the owner's "no redundant writes", not money. _Risk:_ see
§11.

**C2. Correct the stale comments** (exact texts in the plan):

- the busy-day rules comment in `firestore.rules`;
- three `unbounded-ok` reasons;
- the four comments in the capacity code that say every month is written
  whole;
- two recurrence comments and one spec title that say "a year";
- two staff store comments that say "one chair by default".

**C3. Bring the audit up to date** in the same commit:

- the week view row;
- F-14 (C1 done, sizes, citation);
- F-25 (the comments fixed, the citation);
- the "Waits for evidence" list (§9's items).

## 9. Waits for evidence

Each item stays on the audit's "Waits for evidence" list (C3 updates it).
All are revisited after Gate B step 6: the first week's bill and a trace
of the staff schedule.

- **Day changes in one range query per chair** in the week view, instead
  of 7 listeners.
  - _Saves:_ 60 listeners at 10 chairs.
  - _Needs:_ a new port, adapter, web `InjectionToken` and its provider.
  - _Risk:_ the range must not include the far-off probe day the store
    also watches.
  - _Revisit when:_ the trace shows the week view's listeners as a cost or
    a slowdown.
- **The staff schedule stops listening to busy days**, since appointments
  cover the same time.
  - _Saves:_ 10 listeners in the day view and 70 in the week view.
  - _Needs:_ a design for unreadable appointments.
  - _Risks:_
    - the store's read guard drops an appointment document it cannot
      decode, so that time would show as free;
    - a phantom busy block (a busy range with no live appointment behind
      it), which the booking transaction refuses, would become invisible;
    - it reverses the store's documented design.
  - _Revisit when:_ as above.
- **An appointments week query** instead of 7 per-day queries per chair.
  - _Saves:_ 6 listeners per chair.
  - _Needs:_ a new port and adapter only: `busyKeys array-contains-any` on
    the chair's 7 busy keys uses the existing single-field index.
  - _Risk:_ the 30-value limit of `array-contains-any` caps one query at
    4 chairs in the all-chairs view.
  - _Revisit when:_ as above.
- **Capacity per barber** instead of one shared month document (audit
  F-14).
  - _Saves:_ contention between parallel Day rebuilds, and the growing
    document.
  - _Needs:_ a new document shape.
  - _Risk:_ the calendar's 3 reads become 3 × B.
  - _Revisit when:_ transaction retries are observed, or there are more
    than 30 barbers.
- **A series save and rebuild failures.**
  - _Revisit when:_ capacity rebuild failures (`CapacitySweepFailed` or a
    Day rebuild refusal) follow a series save.

## 10. Dropped

| Change                                                            | Why it is dropped                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/book` reads day documents only for the barbers the cart accepts | A reschedule can carry a companion (a second person in the same booking) served by another barber. That barber's documents would not be read, so every start time would be refused. It also saves nothing for an "anyone" cart (no barber chosen), the common case. |
| The `/book` calendar reads its months once instead of live        | With the persistent cache, the one read can return data days old, or a failure, and leave the calendar blank or wrong. A false "full" day hides a freed slot, which is a lost booking. It saves under a cent a month.                                               |
| Skipping unchanged busy-day writes                                | Reading the stored busy day inside the rebuild turns a malformed document into a refusal that is never retried, which ends the busy day's only self-repair. It costs one read to save one write, and an identical write fires no downstream trigger.                |
| A one-year span limit on a series                                 | It fixes no defect: the number of days is already capped, and far-future capacity months are unread and expire (§6). It would need a new refusal code, strings and page text, and would stop legitimate long series.                                                |
| Day rebuilds skip days past the rebuild span                      | The span needs the policy, so it adds one read to every Day rebuild (about 3,000 a month) to trim a one-off burst, and it does not remove the contention.                                                                                                           |
| Size warning logs (capacity entries, roster versions)             | Nobody reads warnings before Gate B adds alerting. A document over the limit already fails loudly (`CapacitySweepFailed`). The capacity trigger in §9 needs no code.                                                                                                |
| Refusing a roster above 200 versions (first draft)                | Once reached, the hours could never change again. The history grows by about one version per distinct effective day (§11).                                                                                                                                          |
| Logging capacity transaction attempts (first draft)               | `CommitPlan` exposes no attempt count, and the post-deploy evidence answers the same question.                                                                                                                                                                      |

## 11. Alternatives and risks

**Alternatives to the rule.** Storing everything per day ahead, working
everything out when read (including busy days and capacity), and storing a
series as two roster versions are each rejected in §6, for the reasons
given there. A server function answering availability would move the work
to Cloud Functions, at the cost of a call, cold starts and a new abuse
surface for every day a client looks at; it stays a non-goal (§2).

**Alternatives for C1:**

- **Leave as is.** It costs about $0.002 a month. Rejected because the
  owner asked for no redundant writes, and the change is small and
  testable in memory.
- **Compare in the trigger, from the event's before and after bodies.**
  Rejected: an identical `set` fires no event, so there is nothing to
  compare there.
- **Compare inline in the pipeline.** Rejected: the comparison is a
  decision, and decisions belong in a pure system (Law 4).

**Risks:**

| Area          | Risk                                                                                                       | Mitigation                                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1            | A wrong equality skips a needed write, and `/book` shows stale free time                                   | `sameEntries` has a spec case for each of the four fields and for order. A month cleared to empty is still written. The booking transaction re-checks every booking.                                                                                                     |
| C1            | A field added to the month document later is never picked up by unchanged months                           | `monthUnchanged`'s doc comment says that any new body field must join the check                                                                                                                                                                                          |
| C1            | Firestore's billing of an identical `set` and its "no event" behaviour come from documentation, not a test | C1 removes the write either way; the post-deploy bill confirms the saving                                                                                                                                                                                                |
| Busy days     | A busy day drifts from its appointments                                                                    | The booking transaction merges the busy day in the same commit. The recompute trigger runs with `retry: true`. Leftover drift (from a missed cancel or move) can only make a slot look taken, never cause a double booking. No periodic repair exists; this is accepted. |
| Capacity      | A capacity month drifts after a missed trigger                                                             | The nightly Sweep rebuilds every barber's rebuild span; C1 does not change that                                                                                                                                                                                          |
| Roster size   | `versions[]` grows without a bound                                                                         | At one hours or break change a month, it reaches 100 KB (about 100 versions) in about 8 years, and the 1 MiB limit in about 80. Revisit at about 100 KB.                                                                                                                 |
| Capacity size | `entries[]` grows with days × barbers × shops                                                              | About 70–90 KB today. Revisit with capacity per barber at more than 30 barbers (§9).                                                                                                                                                                                     |
| Security      | A rules edit could change access                                                                           | The `firestore.rules` change is comments only; the acceptance check confirms it. No index changes.                                                                                                                                                                       |
| Figures       | Every cost figure is an estimate                                                                           | Gate B adds budget alerts, and its step 6 brings the first bill                                                                                                                                                                                                          |

## 12. Owner questions

None of these blocks Phase 1. Each has a recommended answer, which this
document is built on until the owner rules otherwise.

1. **The cap on a series.**
   - **Recommended:** keep 366 occurrences, with no span limit. Fix the
     two comments that promise "a year" (Phase 1).
   - **The alternatives:**
     - **Refuse an end date past the horizon:** staff would re-create a
       long series every couple of months, and nothing writes days ahead,
       so blocks would be lost if the horizon grows.
     - **A one-year span limit:** costs a new refusal code, strings and
       page text, and saves nothing measurable (§10).
   - **If the owner wants a limit anyway:** one year from the start, as
     its own change.
2. **The week view's default (F-25).**
   - **Recommended:** all chairs, as the code does. Fix the comments
     (Phase 1).
   - **Why:** the code follows the 2026-09-23 ruling, which keeps the
     chair only in links because a shared front-desk iPad has no chair of
     its own.
   - **The alternative:** a one-chair default, which needs a rule for
     choosing that chair on a shared device. That would reopen the ruling,
     and it would be its own design.
3. **The Law text.**
   - **Recommended:** adopt the Law 3 / Law 5 split in §6.
   - **On a yes:** Phase 2 edits `CLAUDE.md` and `AGENTS.md` together
     (they are byte-for-byte mirrors) and records the ruling in a decision
     record.
   - **On a no:** this document stays the rule's only home.

## 13. Implementation plan

### Phase 1: C1, C2 and C3, one commit

**Order:** write each new spec case first and confirm that it fails (or,
for a new function, that it does not compile). Then change the code.

**The check suite:**

```bash
pnpm nx run-many -t typecheck
pnpm nx run-many -t test
pnpm nx run-many -t lint
pnpm nx run verify-tools:layering
pnpm nx build web
pnpm nx build functions
pnpm nx run functions:test-integration   # emulator lane, outside run-many
```

**Fixtures used below** (from `@core/testing`):

- `FIXTURE_TODAY` is Monday 2026-09-28.
- The fixture roster works Monday to Friday.
- The spec file's `rig`, `seeded`, `run(today)`, `MONTH`, `MONTH_PATH`,
  `entry(…)` and `barberBusyDayFixture()` are its existing helpers.

#### Step 1. Modify `libs/ecs-core/src/systems/capacity.system.spec.ts`

Add two `describe` blocks. Each comparison case uses separate arrays.

**`sameEntries`:**

- returns `true` for two separate arrays whose entries match on all four
  fields;
- returns `true` for two empty arrays;
- returns `false` when the lengths differ, including one empty array and
  one non-empty array;
- returns `false` when one entry differs only in `localDate`;
- returns `false` when one entry differs only in `barberId`;
- returns `false` when one entry differs only in `locationId`;
- returns `false` when one entry differs only in `freeMinutes`;
- returns `false` for the same entries in a different order;
- on `deepFreeze`d inputs, does not throw and returns the same answer
  twice. This follows the purity cases at `capacity.system.spec.ts:423-441`.

**`monthUnchanged`:**

- `true` for `stored = null` with empty entries;
- `false` for `stored = null` with entries;
- `true` for a stored month with the same `month` and equal entries;
- `false` for a stored month with the same `month` and different entries;
- `false` for a stored month with equal entries but a different `month`;
- `false` for a stored month with entries, whose new entries are empty.

#### Step 2. Modify `libs/ecs-core/src/systems/capacity.system.ts`

Add these two functions to the `CapacitySystem` companion, beside
`applyPlan`:

```ts
sameEntries(a: readonly CapacityEntry[], b: readonly CapacityEntry[]): boolean
monthUnchanged(
  stored: Pick<CapacityMonth, 'month' | 'entries'> | null,
  month: CapacityMonthId,
  entries: readonly CapacityEntry[],
): boolean
```

- `sameEntries` is one linear `for` scan with no allocation.
- `monthUnchanged` is defined as in §8. Its doc comment ends: "A field
  added to the month document must join this check."
- `CapacityMonth` comes from `@core/entities`, which systems may import
  (Law 8).

#### Step 3. Modify `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.spec.ts`

1. **Rewrite the idempotence case** (starts "is idempotent — a redelivered
   busy write…", about line 259):
   - New title: "is idempotent — a redelivered busy write plans no second
     write and leaves the identical month document (edge-hardening D-5)".
   - Replace `expect(tx.plans[1]).toEqual(tx.plans[0])` with
     `expect(tx.plans[1]).toEqual([])`.
   - Keep every other assertion.
2. **Add four cases:**
   - **A Sweep over a store it already rebuilt returns no capacity
     `WriteOp`.** Run the Sweep, then run it again. Every plan from the
     second run is `[]` (one per barber), and the stored months are
     unchanged.
   - **A Sweep after one busy day changes writes only that day's month.**
     Run the Sweep. Store a busy day for `IVAN` on Monday 2026-10-05, then
     run the Sweep again. The second run's only capacity `WriteOp` is the `set` of
     `capacity/2026-10`.
   - **A month never stored, with no entries, is not written.** Run a Day
     rebuild on Saturday 2026-10-03, a day off on the fixture roster.
     `tx.plans` is `[[]]`.
   - **A stored month whose `month` field is wrong is rewritten.** Seed
     `MONTH_PATH` with `{ month: '2026-08', entries: <what the rebuild
produces> }` and run `today`. The plan holds one `set` with `month:
MONTH`.
3. **Update the file header** (starts "The capacity rollup's rebuild",
   about lines 40–47): after "of every month it touches — replace, never
   merge", add "— and none for a month whose document would not change".

#### Step 4. Modify `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.ts`

1. **In `capacityWrites`:** after `entries` is computed and before `body`
   is built, add
   `if (CapacitySystem.monthUnchanged(stored, monthPlan.month, entries)) continue;`.
2. **`capacityWrites` doc comment** (starts "The month documents of one
   barber's plan"): append ", and only when it differs from the stored
   document (`CapacitySystem.monthUnchanged`)".
3. **File header** (starts "whose plan is a full sorted `entries[]` `Set`
   per month", about line 63): after "never `arrayUnion`)", add ", and no
   `Set` for a month whose document would not change".

#### Step 5. Modify `libs/ecs-core/src/entities/capacity-month.entity.ts`

In the doc comment (starts "The calendar's cost ceiling"), after "never
one barber's plan alone.", add: "A month whose entries did not change is
not written at all (`CapacitySystem.monthUnchanged`)."

#### Step 6. Modify `firestore.rules`

Comment only. In `match /barberBusy/{dayDocId}`, replace the three comment
lines that start "Written ONLY by the `commitBooking` transaction" with
these lines, at the block's indentation:

```
// Written only by Cloud Functions (Admin SDK, which bypasses rules): the
// booking callables merge into it inside their transactions, and
// `rebuildBusyOnAppointmentChange` recomputes it. A client that could
// widen its own busy projection could hide a barber's free time from
// everyone else.
```

The rules-text specs strip comments, so no spec changes.

#### Step 7. Modify three `unbounded-ok` comments

Each stays on one line: `creativo/query-needs-limit` reads only the `//`
line directly above the statement. Each currently reads "unbounded-ok:
one barber's one shop day: as many visits as fit in a day".

| File (about line)                                                      | New text                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `libs/ecs-core/src/pipelines/rebuild-busy.pipeline.ts` (106)           | `// unbounded-ok: one barber's day at every shop, live statuses only: as many visits as fit in a day`      |
| `libs/ecs-core/src/pipelines/transition-appointment.pipeline.ts` (176) | the same text                                                                                              |
| `libs/infrastructure/firestore/src/lib/appointments.adapter.ts` (291)  | `// unbounded-ok: one barber's day at every shop, every status: the day's visits, cancelled ones included` |

#### Step 8. Modify the recurrence comments

| File (about line)                                            | Starts                                             | Change                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `libs/ecs-core/src/components/recurrence-rule.data.ts` (114) | "The most days one series may write"               | Replace the comment with `/** The most days one series may write: 366 occurrences, with no limit on span. */`              |
| `libs/ecs-core/src/systems/recurrence.system.ts` (327–328)   | "so no call materialises more than a year of days" | Replace with "so no call materialises more than {@link RecurrenceRule.MAX_OCCURRENCES} days, however far apart they fall." |
| `libs/ecs-core/src/systems/recurrence.system.spec.ts` (301)  | the case title "…and more than a year of days"     | Change it to "…and more than 366 days"                                                                                     |

#### Step 9. Modify `libs/features/staff/dashboard/src/lib/staff-day.store.ts`

Comments only.

| About line | Starts                                                                           | Change                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 182–184    | "is thirty-five columns and unreadable, so these narrow to one chair by default" | After "unreadable,", replace the rest of the sentence with "so they open on every chair merged with attribution, and narrow to one when a chair is picked (the chair lives in links only; see `_view`)." |
| 1101–1102  | "It is also why the multi-day views default to one chair."                       | Replace that sentence with "It is also why a multi-day view narrowed to one chair is cheaper."                                                                                                           |

#### Step 10. Modify `docs/architecture/performance-cost-audit.md`

| Location                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5.4 table, "Staff grid, week view" row (about line 260) | "about 300" becomes "about 850 (7 × (10 + 1 + 1) + 1 per chair at 10 appointments a barber-day)"                                                                                                                                                                                                                                                                                                   |
| F-14 (about lines 292–296)                               | Change "about 130 KB at 30 barbers" to "about 100–200 KB at 30 barbers (about 110 bytes an entry, one or two shops each)". Change the citation `:194-202` to the write loop's new lines (`:201-212` once built). Replace "and the nightly sweep writes 4 months per barber even when nothing changed." with "Since 2026-11 (schedule storage C1) a rebuild no longer rewrites an unchanged month." |
| F-25 (about lines 397–404)                               | Change `staff-day.store.ts:940` to `staff-day.store.ts:1032`. Replace "the comment's 'default to one chair' is not enforced" with "the store opens every chair, as the 2026-09-23 ruling intends (its comments were corrected in 2026-11)".                                                                                                                                                        |
| "Waits for evidence" (about lines 569–571)               | **F-14:** "the shared document; its sweep point is done". **F-25:** replace "although `staff-day.store.ts` says it does" with "by design". Then add one bullet: "Schedule storage §9: day-change range queries, dropping the staff busy-day listeners, an appointments week query, capacity per barber; each with its trigger there."                                                              |

Prettier runs on `*.md` when you commit and will re-pad the table; expect
that in the diff.

#### Acceptance

- The check suite passes, the emulator lane included.
- The diff touches only the files in steps 1–10.
- The `firestore.rules` diff changes comment lines only.
- `firestore.indexes.json` is unchanged.
- The first new case in step 3 shows a Sweep over an already-rebuilt store
  returning no capacity `WriteOp`.

### Phase 2: the Law text (done 2026-11-07)

On a yes to §12 question 3, do the following in one commit:

- edit `CLAUDE.md` and `AGENTS.md` identically, with the Law 3 and Law 5
  text in §6;
- add `docs/architecture/decisions/2026-11-07-truth-is-a-pattern.md`,
  recording the ruling and linking this document.

Phase 2 is not part of Phase 1's commit.
