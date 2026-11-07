# Stage 6 — Comprehension Test: `docs/designs/staff-analytics.md`

- **Reviewer:** egm-comprehension (fresh context), no document standard; test = self-containment
- **Ranges:** FeatureRange 1–543, DetailedRange 544–809
- **Date:** 2026-11-07
- **Verdict:** No blockers — every section could be paraphrased. 9 majors, 8 nits.

### What this proposes

The design adds one staff screen, «Анализи». A barber uses it to see their own figures for a
week or a month: takings (the billed price after discounts, with tips shown separately), a
breakdown of rostered time, open hours over the next 7 days, takings by service and per worked
hour, and rebooking and no-show figures. The admin (owner) sees the same figures for each barber
and for the whole shop, plus fill by weekday, where bookings came from, and how many first-time
clients came back. Each figure is defined in a versioned metric catalogue and opens to the rows
behind it, and those rows add up to it. Two server callables compute the figures when asked,
using pure "systems" over stored appointments, rosters and schedule exceptions. One callable
returns the report and the other returns the rows behind one figure. Nothing is stored or counted
up incrementally. The phone shows the last cached report straight away and then refreshes it. A
new link on the user record (`linkedBarberId`, set by an admin-only callable) tells the server
which barber a signed-in account is. The schedule's day summary and the client card's lifetime
spend move onto the same two new systems: `ChairTimeSystem` for time and `MoneyAllocationSystem`
for splitting a bill's discount across seats. That way every screen agrees to the cent and the
minute.

### How the existing system works, per this document

Appointments hold one or more "seats" (one person's service), each with a barber, price, tip,
chair time and attendance state (WORKED, NO_SHOW, SCHEDULED, CANCELLED). Discounts apply to the
whole bill, and no payment is recorded. Barbers have rosters (`barberSchedules`) and per-day
exceptions (`scheduleExceptions`, also called "departures") of three kinds: CLOSED, BLOCKED and
HOURS. Only the effect is stored, not the reason. The schedule draws "holes" of at least 20
minutes as sellable time and shows a day summary. The client card computes lifetime spend with its
own per-seat rounding. Every barber and receptionist can read every appointment, prices included.
The `Barber` record has no link to a user account, and the auth token carries only roles.
Bookings carry `bookedFromAppointmentId` / `bookedAtUtcMs` and a `placement`. The app records no
analytics events today. The only per-call record is a `callable.completed` log line.

---

## Findings

**Blocker:** none.

### Major

1. **Open Questions are stale and contradict the plan** (lines 121–141 vs 248, 233, 285–310,
   371–377). Q1 frames the brief's barber-side field + token claim, which the plan rejected; Q2
   suggests "end of the shop day", which Alternative H rejected; Q3 (vouchers) and Q5 (usage
   event) are already decided. → Mark Q1, Q2, Q3, Q5 resolved with pointers; keep Q4 and Q6 or
   reword them.
2. **Two account-link designs appear** (lines 216, 447, 123–126). The diagram reads
   `barbers (names, accountUserId)`; Alternative E says "the callable reads the barber document";
   the plan puts the link on `users/{uid}.linkedBarberId`. → Diagram `users (linkedBarberId)`,
   `barbers (names)`; fix Alternative E.
3. **The time bar's parts do not reconcile** (lines 14, 72–73, 151–153, 240–245, 255–258, 358).
   G1/CUJ 1 name four slices summing to "rostered minus closed days"; the catalogue adds "not
   closed"; the identity adds breaks, booked ahead, "open-today" (undefined) and slivers; a CLOSED
   day is already 0 rostered minutes, so "minus closed days" looks double-counted; for a running
   month the future part of the period has no stated home; line 358 and item 41 disagree on the
   day summary's formula. → State once which parts the bar draws, whether it covers the period or
   only up to now, define or drop "open-today", and align G1, CUJ 1, line 358 and item 41.
4. **"Not closed" clashes with "closed"** (lines 235, 240, 72–73, 153). → Rename the slice
   ("unmarked" / "outcome not recorded").
5. **The cost table omits the shop reference's reads** (lines 253, 314–326, 386), and the
   `clientStats` and user-document reads. → Add them and recheck the ~0.5M/month total.
6. **Laws and decisions are cited but not explained or linked** (lines 119, 248, 343, 406, 414,
   470, 564, 731): Law 5, 6, 7 T2, 10, D16(b), "§4.3". → A short glossary or link to `CLAUDE.md`,
   one line per cited rule; link the earlier statistics design at first mention.
7. **Project vocabulary is undefined** (lines 191–223, 260–283, 292, 343–352, 621, 663, 673,
   688, 696): systems/components/entities/pipelines/ports/wire/edge, flat slice, intersection,
   companion, commit sandwich, `ShopNow`, `ZonedTimeSystem`, `RosterSystem`, `IntervalSetSystem`,
   `BillingSystem`, `wiredCallable(plain(…))`, `callerWorksTheBook`, `SHEET_STAGED`/`climbStages`,
   `lib-visit-list`, App Check `Standard`, the `capacity` projection, "spread, never mapped",
   `store-answer.ts`. `ShopNow` carries the past/future split and is never described. → A "Terms
   and existing building blocks" section, or a link to the architecture document.
8. **"Departures" is never defined** (lines 193, 215, 235–237, 316). → One sentence: a
   departure is a per-day roster exception (`scheduleExceptions`) of kind CLOSED, BLOCKED or HOURS,
   with an example of each.
9. **Rebooking is still ambiguous** (lines 16, 248, 483). The Overview promises "booked before
   leaving"; the catalogue uses 24 h after `utcEpochMs` (its meaning as the start is only in
   Alternative H); "not cancelled before the visit's day ended" names neither visit nor day; a
   visit shared by two barbers has no credit rule. → Align the Overview and G1; write the rule with
   names (`F.bookedFromAppointmentId = A.id`, `A.start ≤ F.bookedAtUtcMs ≤ A.start + 24h`, F not
   cancelled before the end of A's shop day); state how shared visits count.

### Nit

10. **Fill formula** (line 246): "− open" over past time is 0 or means something unstated;
    whether blocked and slivers are in the denominator is unclear. → Name the denominator's parts
    and add a worked example.
11. **Smaller undefined terms**: what infers `inferredPlacement` (251); where
    `cancellationWindowHours` is set (250); what `clientStats` "first-visit facts" are (252, 634);
    which roles "work the book" (289, 390); "the old system" (135); why BGN amounts exist (233);
    line 58 attributes the third free-time idea to the earlier statistics design, the brief to the
    hypothesis.
12. **Where scope is decided** (210, 300, 663–665, 692–694): diagram and line 300 say the wire,
    item 19 says the pipeline, item 25 gives the wire only the role gate. → Pick one layer.
13. **Comparison span for past periods** (151–152, 276, 569): unclear for periods reached with ‹
    and for 31- vs 30-day months. → Past periods compare in full; state the shorter-month rule.
14. **Names differ between the plan and the file list** (605, 612, 675–677): `sellable(...)` vs
    `sellableAt`; `StaffLinkSystem.decide` and `AuditSystem.planBarberLinked` are only in item 20.
15. **Rows: visit vs appointment vs seat** (168, 229, 580): CUJ 3 lists visits with services,
    `AnalyticsRow` is per seat. → Say rows are seats, or how a party visit is shown and totalled.
16. **Bulgarian strings without a gloss** (12, 149, 158, 161, 307, 332). → Gloss at first use.
17. **"Shop", "location", "tenant"** (17, 192–194, 253, 140–141) used interchangeably. → Define
    "shop" once.

## Author's note (Elephant)

Findings 1, 2, 5 and 14 overlap the Stage 5 report (stale questions, the leftover barber-side
link, the shop reference's reads, the link pipeline that Stage 5 M4 proposes to remove). Finding 3
overlaps Stage 5 M8 (the sum identity). The new material is the reader-facing gaps: vocabulary,
laws, departures, the rebooking rule's exact form, and the "not closed" name.
