# Goldfish Annotated Review Report — Stage 7, round 2

**Status:** resolved — auto accept, 2026-11-07. 54 fixes applied to the feature specification (lines 1–657 after the rewrite); 6 declined; 0 contested or escalated.

**Target:** `docs/designs/staff-analytics.md` (lines 1–584, the feature specification)
**Round:** 2 — reviewers egm-design, egm-structural, egm-style (all completed). Raw findings:
[critic_report_round2.md](critic_report_round2.md). None of round 1's five declined findings
returned.

**Tally:** 60 findings — 0 Blocker, 16 Major, 44 Nit. Suggestions: **PROPOSE FIX 54**,
**CONTEST 0**, **ESCALATE 0**, **DECLINE 6** (Issues 28, 39, 41, 44, 46, 49). Round clean? **No** (16 unsettled Majors).

**Elephant checks.** Verified before categorising: `busy.system.ts:196-206` (a cancelled seat in
a live visit still holds the chair — the server's collision rule), `booking-flow.store.ts:874`
(the client app's «book again» also sets `bookedFromAppointmentId`), `flatten-spec.md:533-545`
(the T2 list of stamp comparisons is closed: "these rows, and ONLY these").

**Three decisions carry most fixes:**

- **R-A (cancelled seats)** — keep the schedule's and server's rule: a `CANCELLED` seat on a live
  visit still holds the chair. `occupiedIntervals` is **not** changed. In the partition such a
  minute is its own part, **held** (after booked ahead), so the schedule's holes and the
  analytics holes stay identical and G5 holds. (design-2-1)
- **R-B (rebooking, law-compliant)** — rename back to **Rebooked**: a follow-up F linked by
  `bookedFromAppointmentId` (by the barber's «Запиши пак» or the client's «book again» in the
  app), booked **no later than the end of the shop day after A's day**, and not `CANCELLED` at
  report time. The pipeline converts `F.bookedAtUtcMs` to the shop date once at its boundary
  (`ZonedTimeSystem`, as Law 7 allows at ingestion) and hands the system a `LocalDate`; the
  system compares shop dates only — no stamp comparison, no T2 amendment. A null
  `bookedAtUtcMs` is excluded. Square's 24 h is noted as close but not identical. (design-2-2,
  2-3, structural-2-11)
- **R-C (the link, race-free)** — a non-public lock document
  `barbers/{barberId}/restricted/link = { userId }` is read and written in the same `setRoles`
  transaction as `users/{uid}.linkedBarberId`; uniqueness is that document, not a query.
  `RolesCall` carries `linkedBarberId`; `RoleAssignmentSystem.decide` gains a `linkChanged`
  outcome so a link-only change commits even when the role set is unchanged; the audit row gains
  `linkedBarberIdFrom`/`linkedBarberIdTo`; a link-only change does not revoke sessions; an admin
  may change **their own link only** (roles self-change stays refused); the link clears when the
  barber role is removed and on erasure, **not** on a block. (design-2-4, 2-5, 2-7, 2-14)

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 117-119, 306, 326-330, 403-407](../../../designs/staff-analytics.md#L117-L407)
- **Discrepancy Description:** The spec changes `occupiedIntervals` while saying the schedule is untouched; cancelled seats in a live party still hold the chair through `barberBusy`.
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ **R-A**; G5 fixture gains a split party with one cancelled seat.

### [Issue 2] [`egm-design`] - Severity: Medium

- **Discrepancy Description:** "Rebooked at the chair" also counts the client app's own «book again». (L162-163, 311, 438, 505-506)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ **R-B** (rename, ⓘ text, risk row, Alternative H).

### [Issue 3] [`egm-design`] - Severity: Medium

- **Discrepancy Description:** The 24-hour window compares stamps outside Law 7's closed T2 list. (L96-101, 311, 505-506)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ **R-B** (shop-date rule; Terms entry for Law 7 corrected).

### [Issue 4] [`egm-design`] - Severity: Medium

- **Discrepancy Description:** `setRoles` commits nothing for an unchanged role set; its audit row has no link field. (L354-361)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ **R-C**.

### [Issue 5] [`egm-design`] - Severity: Medium

- **Discrepancy Description:** One-account-per-barber races: an empty query locks nothing. (L355-361)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ **R-C** lock document; risk row.

### [Issue 6] [`egm-design`] - Severity: Medium

- **Discrepancy Description:** CUJ 2's "free time shown" has no deep link (free time is a per-device setting; the URL carries day, view, barber). (L126-127, 190-194, 405)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ the schedule accepts `?free=1`, which shows free time for that visit without changing the stored preference; listed under Existing screens.

### [Issue 7] [`egm-structural`] - Severity: Medium

- **Discrepancy Description:** A cached report outlives "loses access at once"; states lack the error codes and "call failed, cache shown". (L182, 239, 275-276, 382, 393-398, 413-415)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ states table: cached / first open / refreshed / call failed with cache (figures + "could not update") / call failed without cache / `ANALYTICS_FORBIDDEN` or `ANALYTICS_BARBER_NOT_LINKED` (cache for that uid deleted) / period out of range / empty period / small sample. "Loses access at once" → "the next request is refused and the cached copy is deleted".

### [Issue 8] [`egm-structural`] - Severity: Medium

- **Discrepancy Description:** Risks table lacks security rows. (L427-439)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ rows: a wrong or stale link (lock document + audit row; the admin sees the link on the client card); shop money cached on a shared device (cache keyed by uid, cleared on sign-out, admin shop scope not cached — see Issue 18); token roles vs stored roles (pipeline judges stored roles).

### [Issue 9] [`egm-structural`] - Severity: Medium

- **Discrepancy Description:** The catalogue lacks the formula / base / includes / excludes G3 promises; late-cancel exclusions unstated. (L113-114, 300-315)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ table columns Figure · Formula · Includes · Excludes · Shown as; late cancellations list the client card's exclusions (seats with no `bookedAtUtcMs`; cancellations the reason blames on the shop; window from the seat, else the current policy).

### [Issue 10] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** "Per service hour" divides by minutes; the Overview implies chair time. (L310, 15-16)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ takings ÷ (Σ `durationMinutes` ÷ 60), "per hour of service" everywhere.

### [Issue 11] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** "Rows are seats" contradicts day rows. (L78)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ "money and count figures drill down to seats; time figures to days".

### [Issue 12] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** "Chair" has three meanings. (L13, 46, 80, 179-359)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ Terms: "chair = a barber record (`BarberId`); a linked account is linked to a barber record". Use "barber record" in the link text.

### [Issue 13] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** "Left out and counted" reads as a contradiction. (L308)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ "excluded from takings; the number excluded is shown".

### [Issue 14] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** "Emptiest day" undefined. (L127, 306)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ "the day with the most bookable open minutes; a tie goes to the earliest day".

### [Issue 15] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** G6's empty state is missing from the states list. (L120-121, 393-394)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ covered by Issue 7 (empty period state), linked from G6.

### [Issue 16] [`egm-style`] - Severity: Medium

- **Discrepancy Description:** The small-sample motivation is unquantified. (L66-67)
- _**AI Suggestion:**_ PROPOSE FIX — _**Proposed Edit:**_ "below 20 visits one visit moves a rate by 5 points or more; the gate is set where one visit moves it by at most 5".

### [Issues 17–60] Nits

| #   | Id              | Scope                    | Suggestion  | Edit or reason                                                                                                                                                                                   |
| --- | --------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 17  | design-2-7      | L358                     | PROPOSE FIX | **R-C**: a block does not clear the link                                                                                                                                                         |
| 18  | design-2-8      | L397-398, 552-554        | PROPOSE FIX | one entry per (scope, period), at most 6; quota errors ignored; the admin's shop scope is not cached (money of every barber at rest); note under Security                                        |
| 19  | design-2-9      | L287-288                 | PROPOSE FIX | precedence Blocked before Break, matching the schedule                                                                                                                                           |
| 20  | design-2-10     | L316-319                 | PROPOSE FIX | days past the shorter period's end compare with nothing; example: 31 March vs February → days 1–28 compared, 29–31 shown without a change                                                        |
| 21  | design-2-11     | L115-116, 236, 390-392   | PROPOSE FIX | state it: in shop scope, the per-barber drill-down is a fresh request; its time is shown                                                                                                         |
| 22  | design-2-12     | L399-401                 | PROPOSE FIX | `staged-render.ts` moves to `libs/ui/layout` (shared)                                                                                                                                            |
| 23  | design-2-13     | L370-371, 508-513        | PROPOSE FIX | shop scope reads follow-ups with one `bookedAtUtcMs` range query (period start to end + 1 day) and filters linked ones; barber scope keeps the `in` chunks; cost table and Alternative I updated |
| 24  | design-2-14     | L267-268, 354-361        | PROPOSE FIX | **R-C**: an admin may set their own link                                                                                                                                                         |
| 25  | design-2-15     | L353                     | PROPOSE FIX | every user writer writes the field (registration stub, complete-registration, updateProfile, setRoles, erasure, seed); greenfield, no backfill                                                   |
| 26  | structural-2-4  | L89-91, 339-340, 382-383 | PROPOSE FIX | keep code spans on one line                                                                                                                                                                      |
| 27  | structural-2-5  | L311                     | PROPOSE FIX | covered by Issue 9 (rationale moved out of the cell)                                                                                                                                             |
| 28  | structural-2-6  | L25, 129, 284, 316       | DECLINE     | the bold labels introduce one paragraph each; headings would fragment short sections                                                                                                             |
| 29  | structural-2-7  | L32-34, 151-153, 576-583 | PROPOSE FIX | staging only in Future Improvements; Overview and Non-Goals point to it                                                                                                                          |
| 30  | structural-2-8  | L555                     | PROPOSE FIX | state the budgets in the NFR                                                                                                                                                                     |
| 31  | structural-2-9  | L263-269                 | PROPOSE FIX | top-down rule (admin wins over barber); rows "blocked account" and "barber asking for another barber"                                                                                            |
| 32  | structural-2-10 | L70, 333-335             | PROPOSE FIX | "the private `moneyOf` already splits pro rata per visit; the new system splits per seat and is exported"                                                                                        |
| 33  | structural-2-11 | L311                     | PROPOSE FIX | covered by **R-B**                                                                                                                                                                               |
| 34  | structural-2-12 | L481-482                 | PROPOSE FIX | Non-Goal: `mayEditRoster` unchanged in v1                                                                                                                                                        |
| 35  | structural-2-13 | L164, 167                | PROPOSE FIX | one-line reasons for vouchers and multi-location                                                                                                                                                 |
| 36  | structural-2-14 | L4                       | PROPOSE FIX | "In Review (review fixes applied, see review/)"                                                                                                                                                  |
| 37  | style-2-8       | L21-22                   | PROPOSE FIX | "unsold + open"                                                                                                                                                                                  |
| 38  | style-2-9       | L29-30                   | PROPOSE FIX | "shows the report cached on the device, then replaces it"                                                                                                                                        |
| 39  | style-2-10      | L38, 49                  | DECLINE     | the framing is the owner's problem statement; measurable goals follow in G1–G8                                                                                                                   |
| 40  | style-2-11      | L61                      | PROPOSE FIX | "Of the products surveyed, only theCut…"                                                                                                                                                         |
| 41  | style-2-12      | L64                      | DECLINE     | the heading is a section title; the body says what is missing                                                                                                                                    |
| 42  | style-2-13      | L76                      | PROPOSE FIX | Terms: "fold = compute totals from the stored records on request"                                                                                                                                |
| 43  | style-2-14      | L103, 277                | PROPOSE FIX | "currently"                                                                                                                                                                                      |
| 44  | style-2-15      | L120, 122                | DECLINE     | goal names are labels; each goal's text is measurable                                                                                                                                            |
| 45  | style-2-16      | L131, 135                | PROPOSE FIX | "from the fourth week after release"; "visits marked worked or no-show"                                                                                                                          |
| 46  | style-2-17      | L148                     | DECLINE     | the heading reads correctly with the sentence that follows                                                                                                                                       |
| 47  | style-2-18      | L182, 239, 393           | PROPOSE FIX | "the time it was computed"                                                                                                                                                                       |
| 48  | style-2-19      | L183, 386, 399, 540      | PROPOSE FIX | Terms: "hero = the large takings figure at the top"                                                                                                                                              |
| 49  | style-2-20      | L215                     | DECLINE     | "normally" is followed by the list of what shows                                                                                                                                                 |
| 50  | style-2-21      | L273-274                 | PROPOSE FIX | rewrite the `Roles.MONEY` sentence                                                                                                                                                               |
| 51  | style-2-22      | L295, 306                | PROPOSE FIX | "at or after the current minute"                                                                                                                                                                 |
| 52  | style-2-23      | L298, 344                | PROPOSE FIX | "a property-based spec over generated days"                                                                                                                                                      |
| 53  | style-2-24      | L358                     | PROPOSE FIX | covered by **R-C** rewrite                                                                                                                                                                       |
| 54  | style-2-25      | L421, 425                | PROPOSE FIX | "digest" → the totals (takings, tips, minutes per part) as fields; "check: the footer total equals the figure"                                                                                   |
| 55  | style-2-26      | L433, 435                | PROPOSE FIX | triggers: shop view p95 over 4 s for a week → per-barber drill; reads over 1M/month → Alternative C                                                                                              |
| 56  | style-2-27      | L446-452                 | PROPOSE FIX | align Alternative A's figures with the reads table; quote Law 5                                                                                                                                  |
| 57  | style-2-28      | L472-473                 | PROPOSE FIX | Alternative D: "the whole shop's appointments loaded into every staff browser on each open" (not "money by design")                                                                              |
| 58  | style-2-29      | L489-490                 | PROPOSE FIX | move the `restricted/` rule to Non-Goals                                                                                                                                                         |
| 59  | style-2-30      | L533                     | PROPOSE FIX | worked example: two seats at €20, €10 off, one no-show → worked-only split gives the worked seat €10 of discount (takings €10); pro rata gives €5 (takings €15)                                  |
| 60  | style-2-31      | L577-578                 | PROPOSE FIX | "waits until a shop-month report stays under 4 s p95 with the reference included"                                                                                                                |
