# Stage 6 — Comprehension Test (round 2)

**Target:** `docs/architecture/schedule-storage-and-lazy-evaluation.md`

- FeatureRange: lines 1–359
- DetailedRange: lines 360–397

**Reviewer:** egm-comprehension, in a fresh context, with no document standard. It read the target, the files the target links to, `CLAUDE.md`, `capacityWrites`, and the two comments the target quotes.

## What this proposes

The document answers four questions the owner asked about the schedule:

- Does it follow data-oriented Laws 3, 5 and 6?
- What does it cost in memory, storage, reads and writes?
- What should be worked out when read instead of stored ahead?
- How can Firestore traffic be kept low?

Its answer is that the current split is right, and it writes the split down as one rule:

- Store the truth as a weekly pattern, plus one document for each day that departs from it.
- Work every derived value out when read, unless one of three conditions forces a stored projection that can be rebuilt and that expires:
  - a privacy boundary;
  - a busy screen whose reads would fan out;
  - a transaction that needs a small, fixed conflict set.

It proposes this rule as a Law 3 sentence for the owner to accept or reject.

It makes one code change now (C1): a capacity month whose entries did not change is not rewritten. The change needs a new pure `CapacitySystem.sameEntries`, a skip in `capacityWrites`, and two corrected comments. Every other saving is either held until the first week's bill and a trace of the staff grid (§9), or dropped because it would break something (§10).

Three questions go to the owner:

1. the 366-day cap on repeating blocks with an end date;
2. the week view's default chair;
3. the Law 3 sentence.

## How the existing system works, per this document

**Truth:**

- Each barber has one roster document (`barberSchedules/{barberId}`), written only through callables. It holds dated versions of the weekday shifts and breaks.
- A day that departs from the roster has one day-change document (`scheduleExceptions/{barberId}__{localDate}`). Its effect is one of `CLOSED`, `HOURS`, `BLOCKED` or `ROSTERED`.
- Appointments and waitlist requests are their own documents.

**Two stored projections:**

- `barberBusy` holds one barber-day's merged busy times, with no names. Anonymous `/book` visitors can read it, and the booking transaction uses it as its conflict set.
- `capacity/{YYYY-MM}` holds the sorted free minutes per (day, barber, shop). With it, the `/book` calendar reads about 3 documents instead of hundreds.

**Capacity is rebuilt per barber in three ways:**

- **Day:** after a busy-day or day-change write.
- **Roster:** after a roster write, over a 4-month span.
- **Sweep:** nightly, for every barber.

Today, every rebuild rewrites each planned month in full, even when nothing changed.

**Worked out when read**, in pure systems: bookable windows, free start times, free gaps in the staff lanes, breaks, and the repeating weekly hours.

**Cost:** about $1–2 a month at the planning scale (2 shops, 10 barbers, 100 bookings a day), as an estimate.

## Findings

No Blockers: the reviewer could paraphrase every section, and the C1 plan can be built from the document as written.

### Major

**M1. The Gate B reference points to the wrong section (line 97).**

- **Problem:** The document says Gate B is in the audit's §6. In the audit, §6 is "The checks". Gate B and its step 6 are in §11. §2, §9 and §11 of the document all depend on "Gate B step 6", so a reader who follows the reference lands in the wrong place.
- **Fix:** Change the reference to "§11, Gate B", and quote step 6 inline.

**M2. "The commit" is undefined and goes by four names (lines 107, 111, 138, 164–169, 286, 341, 362).**

- **Problem:** "The commit" appears as a reader in §4, as a reason in §6, and in the risk table ("the commit re-checks"). It is named as the `commitBooking` transaction only inside the proposed comment text. The same thing is also called "the booking transaction" and "the commit re-check". Then the plan says "one commit", meaning a git commit.
- **Fix:** Define it in §3 and use one name throughout.

**M3. "Repeating block" is never defined, and it gets confused with "break" (lines 180, 186–194, 350–353).**

- **Problem:** A reader new to the repository cannot tell three things:
  - what a staff member does to create one;
  - which day-change effect its documents get;
  - how it differs from a weekly roster break.

  Owner question 1 depends on all three.

- **Fix:** Define it in §3: the «Повтаряне» page, with an end date, one `BLOCKED` day change per day, while «Без край» becomes a roster break instead.

**M4. The reasons in §9 and §10 rely on undefined booking and staff-screen terms (lines 302–306, 321).**

- **Problem:** The undefined terms are:
  - the read guard;
  - a visit the read guard rejects;
  - a phantom busy block;
  - unreadable visits;
  - a companion booked with another barber;
  - the barbers the cart accepts;
  - an "anyone" cart.
- **Fix:** Explain each one in a clause where it is used, or link the round-1 consolidated report's A1–A4.

### Nits

| #   | Lines                 | What is unclear                                                                                                         |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| N1  | 63 vs 98              | Gate B step 6 is "defined in §3", but §3 only summarises it.                                                            |
| N2  | 143–144               | "Audit-log entry" is undefined and collides with "the audit" (the cost audit).                                          |
| N3  | 228, 240, 289         | `unbounded-ok` is not explained: it is the comment the query-limit lint rule requires.                                  |
| N4  | 98, 128, 141–142, 243 | One screen has four names: staff schedule, staff grid, day/week view, staff lanes. "Lane" is undefined.                 |
| N5  | 85                    | `/book` is described only at line 161. Define it in §3.                                                                 |
| N6  | 147–149               | The gap between reads and listeners also includes catalogue reads.                                                      |
| N7  | 86–87, 139            | "2–3 capacity months" conflicts with "the calendar shows 3".                                                            |
| N8  | 196–205               | The 100–250 and 7 figures are not derived. Give one line of arithmetic for each.                                        |
| N9  | 263–282, 323, 332     | C1 saves money only if Firestore bills an identical `set`. State that, and say the source is documentation, not a test. |
| N10 | 268–272               | Say that `sameEntries` compares by position, and why the order matches.                                                 |
| N11 | 241, 289, 303         | `rebuildBusy` and `rebuildBusyOnAppointmentChange` name one trigger. Gloss "busy key".                                  |
| N12 | 112                   | "The nightly lead-time sample" is unexplained.                                                                          |
| N13 | 298                   | "Token and binding" is Angular jargon.                                                                                  |
| N14 | 324–325               | Two dropped items were never proposed in this version. Say they came from the first draft.                              |
| N15 | 362                   | "Specs that prove today's behaviour first" does not match the listed specs. Say which cases pin today's behaviour.      |
| N16 | 386                   | "A Sweep over unchanged input" is vague. Say how the spec sets it up.                                                   |

The comments the target quotes match the current source, and its description of `capacityWrites` matches the code.
