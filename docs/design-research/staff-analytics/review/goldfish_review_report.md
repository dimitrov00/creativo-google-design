# Goldfish Annotated Review Report

**Status:** resolved — auto accept, 2026-11-07. 51 fixes applied to lines 1–584 of the target (the feature specification was rewritten in one pass); 0 contested, 0 escalated, 5 declined (Issues 33, 44, 45, 50, 55). The Detailed Implementation Plan carries a "Pending Stage 9" note.

**Target:** `docs/designs/staff-analytics.md` (lines 1–543, the feature specification)
**Round:** Stage 7 critic review, round 1 — reviewers egm-design, egm-structural, egm-style (all
completed). Raw findings: [critic_report.md](critic_report.md).

**Tally:** 56 findings — 2 Blocker, 26 Major, 28 Nit. Suggestions: **PROPOSE FIX 51**,
**CONTEST 0**, **ESCALATE 0**, **DECLINE 5**.

**How the fixes are grouped.** Many findings repeat Stage 5 ([zoom_out_report.md](zoom_out_report.md))
and Stage 6 ([comprehension_report.md](comprehension_report.md)). The fixes below fold those in, so
one revision pass closes all three stages' overlapping items. Five decisions carry most of the
fixes; each is named once here and referenced by id below:

- **D-A (link via `setRoles`)** — drop `linkBarberAccount`, `StaffLinkSystem`, `planBarberLinked`
  and the link sheet. `RolesCall` gains `linkedBarberId`: required when the barber role is
  granted, cleared when it is removed; the erasure pipeline and an account block clear it too.
  `RoleAssignmentSystem.decide` refuses a barber already linked to another _active_ account. The
  picker lives where roles are already set (the client card's roles row), so no
  `users where roles array-contains` query is needed. (Stage 5 M4; design-1-3, 1-4.)
- **D-B (one callable, rows inside the report)** — drop `staffAnalyticsRows`. The report carries
  its day rows (≤31) and, for a single-barber scope, its seat rows (~300 small rows) plus an
  `asOfUtcMs`; the drill-down filters them on the device with a pure function, so rows and hero
  come from the same snapshot. For the shop scope, drill-down is per barber. (Stage 5 M3;
  design-1-11.)
- **D-C (`ChairTimeSystem` on top of `GridLayoutSystem`)** — the new system imports its sibling
  and calls `occupiedIntervals`, `holes`, `sellableAt` unchanged; the schedule's hot path and the
  day summary are not touched; open time = the future part of holes still `sellable`, the rest
  of past holes ≥ 20 min is unsold. The agreement spec proves the day summary equals
  unsold + open. (Stage 5 M2; design-1-10, 1-17; structural-1-5.)
- **D-D (one per-minute partition)** — every rostered minute of a day falls in exactly one part,
  by this precedence: **break → blocked → occupied → hole**. Occupied minutes are the _union_ of
  the chair time of the barber's non-cancelled seats (cancelled seats never occupy, and
  `GridLayoutSystem.occupiedIntervals` is changed to skip cancelled seats in live parties);
  within occupied, a minute covered by several seats takes the first of **worked → no-show →
  unmarked → booked ahead**. Hole minutes split into **slivers** (holes < 20 min), **unsold**
  (past part of the rest) and **open** (future part of holes still sellable; a sellable hole's
  past part is unsold; an unsellable hole's future tail is unsold-to-be, counted as _open, not
  sellable_ — see the catalogue). Closed days contribute 0 rostered minutes and are listed as
  _closed days_ apart; seats outside rostered time count in money and in _worked outside hours_,
  never in the partition. The time bar draws, for the period **up to now**: worked, no-show,
  unmarked, blocked, unsold; booked-ahead and open time from now to the period's end are shown
  under the bar as "still ahead". The slice "not closed" is renamed **unmarked**. (Stage 5 M8;
  Stage 6 #3, #4; design-1-1; style-1-3, 1-4; structural-1-5.)
- **D-E (scope of v1)** — shop reference and first-visit return move to v1.1 (Stage 5 M1, M7;
  design-1-22; style-1-15). "Shop" means the tenant: all its locations and barbers; every
  figure is folded on each appointment's own `localDate`, so no tenant-wide time zone is
  needed, and the admin's shop month reads by `busyKeys` (≤30 keys per query) instead of a
  `utcEpochMs` range (design-1-15). Analytics money is visible to the barber (own) and the
  **admin only**; the sysadmin gets nothing (`Roles.SPEND` precedent). One named set,
  `Roles.ANALYTICS_SELF = [Barber]` and `Roles.ANALYTICS_SHOP = [Admin]`, in `roles.data.ts`
  (Stage 5 M5; design-1-6).

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-design`] - Severity: High

- **Affected Scope:** [Lines 235-283](../../../designs/staff-analytics.md#L235-L283) (Metric catalogue)
- **Discrepancy Description:** The time-bar parts cannot sum to rostered time: overlapping seats are summed, not unioned; break/block order is unstated; seats over a break or block have no rule; "open-today" is ambiguous.
- **Rationale:** A sum property test would fail or force ad-hoc rules.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid; Stage 5 M8 found the same.
- _**Proposed Edit:**_
  - Location: catalogue rows for rostered…open, the identity paragraph, CUJ 1, G1.
  - Change: apply **D-D**; rewrite the identity per day as `rostered = break + blocked + worked + no-show + unmarked + booked ahead + slivers + unsold + open`; define "per worked hour" as takings ÷ the service minutes (`durationMinutes`) of that service's worked seats.

### [Issue 2] [`egm-structural`] - Severity: High

- **Affected Scope:** whole spec; nearest [Lines 312-326](../../../designs/staff-analytics.md#L312-L326), [506-521](../../../designs/staff-analytics.md#L506-L521)
- **Discrepancy Description:** No Risks & Mitigations section.
- **Rationale:** Failure modes (callable failure with no cache, stale cache, timeouts, tenant size, query limits, spend change, data quality) are unstated.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid; the standard requires it.
- _**Proposed Edit:**_
  - Location: new `## Risks & Mitigations` before Alternatives.
  - Change: a Risk | Effect | Mitigation table: first open with no cache and the call fails (error state with retry, no figures shown); cache stale vs new definition (key carries `definitionVersion`); callable time and memory at the largest supported tenant (10 barbers × 3 locations; budget p95 ≤ 1.5 s barber-month, ≤ 4 s shop-month, 512 MiB; above that the shop view drills per barber); `array-contains-any` 30-value limit (chunking); read totals (corrected cost table); client-card spend shift (version bump + backfill, Issue 7); unmarked visits dominating (the slice links to them; success measure on the unmarked share); `bookedFromAppointmentId` only set by «Запиши пак» (Issue 9).

### [Issue 3] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 212-217](../../../designs/staff-analytics.md#L212-L217), [446-448](../../../designs/staff-analytics.md#L446-L448)
- **Discrepancy Description:** Diagram and Alternative E still read the link from `barbers`.
- **Rationale:** Contradicts the user-record link.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (Stage 6 #2).
- _**Proposed Edit:**_
  - Location: diagram reads block; Alternative E cons.
  - Change: diagram reads `users/{caller} (roles, accountStatus, linkedBarberId)`, `barbers (names)`, appointments by `busyKeys`, `bookedFromAppointmentId in`, departures by `(barberId, localDate)`, settings (cancellation policy); Alternative E: "the callable reads the caller's user document anyway".

### [Issue 4] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 306-307](../../../designs/staff-analytics.md#L306-L307)
- **Discrepancy Description:** The picker's `roles array-contains` query has its index switched off.
- **Rationale:** Fails in production.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (`firestore.indexes.json:926-929`).
- _**Proposed Edit:**_ Location: "Which barber the caller is". Change: apply **D-A** — the link is chosen where the barber role is granted, no roles query.

### [Issue 5] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 292-310](../../../designs/staff-analytics.md#L292-L310)
- **Discrepancy Description:** Nothing clears `linkedBarberId` on demotion, block or erasure; stale links block relinking.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid.
- _**Proposed Edit:**_ Apply **D-A** (clear on role removal, block and erasure; uniqueness among active accounts).

### [Issue 6] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 210](../../../designs/staff-analytics.md#L210), [300-303](../../../designs/staff-analytics.md#L300-L303)
- **Discrepancy Description:** The role gate trusts token claims; a demoted admin keeps access up to an hour.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid; `setRoles` judges stored roles.
- _**Proposed Edit:**_ The pipeline reads `users/{caller}` (already needed for the link) and gates on its stored `roles` and `accountStatus`; the token check stays as the cheap first gate. Scope is decided in the pipeline only (Stage 6 #12).

### [Issue 7] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 340-342](../../../designs/staff-analytics.md#L340-L342), [384-388](../../../designs/staff-analytics.md#L384-L388), [508-512](../../../designs/staff-analytics.md#L508-L512)
- **Discrepancy Description:** The sysadmin sees per-client money that `Roles.SPEND` withholds.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (Stage 5 M5).
- _**Proposed Edit:**_ Apply **D-E** role sets; visibility table: sysadmin "nothing"; add "seeing billed takings is not `Roles.MONEY` (spending the shop's money)".

### [Issue 8] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 233](../../../designs/staff-analytics.md#L233), [268-273](../../../designs/staff-analytics.md#L268-L273)
- **Discrepancy Description:** Splitting the discount across worked seats only moves money between seats (a €5 change in a simple bill), not "a cent"; bills that cannot be evaluated are unhandled.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid: with one no-show seat the whole discount landed on the worked seat.
- _**Proposed Edit:**_ `MoneyAllocationSystem` splits the bill's discount pro rata over **all billed seats** by largest remainder; takings sum the WORKED seats' nets. A bill `BillingSystem` cannot evaluate is excluded and counted on the screen ("2 visits not counted"). The client card's spend change is stated as "differs by at most one cent per visit" only after this change, with a `clientStats` projection version bump and backfill (design-1-21).

### [Issue 9] [`egm-design`] + [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 248](../../../designs/staff-analytics.md#L248), [475-485](../../../designs/staff-analytics.md#L475-L485)
- **Discrepancy Description:** Rebooked share only sees bookings made through «Запиши пак» (the only path that sets `bookedFromAppointmentId`); the cancellation clause needs a shop-day conversion; "matches Square" is wrong (Square measures from the visit's end).
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (style-1-1 verified against competitor-research.md:212-213).
- _**Proposed Edit:**_ Rename the figure **"Rebooked at the chair"**: of the barber's appointments A with a WORKED seat, the share with a follow-up F where `F.bookedFromAppointmentId = A.id`, `F.bookedAtUtcMs ≤ A.endUtcMs + 24 h` (`A.endUtcMs = A.utcEpochMs + (A.endMinutes − A.startMinutes) min`), and F not CANCELLED at report time. A shared visit counts once for each barber with a WORKED seat on it. State that bookings a client makes later online are not linked and are not counted. Keep the Square comparison (now measured from the end, as Square does).

### [Issue 10] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 250](../../../designs/staff-analytics.md#L250)
- **Discrepancy Description:** The late-cancel rule differs from `ClientStatsSystem`.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (Stage 5 M6).
- _**Proposed Edit:**_ "Late cancellations: seats `ClientStatsSystem.clientCaused` blames on the client and `ClientStatsPolicy.isLateCancellation` judges late, with the same exclusions as the client card." Add the policy read.

### [Issue 11] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 262-267](../../../designs/staff-analytics.md#L262-L267)
- **Discrepancy Description:** Routing `holes` through `ChairTimeSystem` touches the schedule's hot path and risks an import cycle.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid.
- _**Proposed Edit:**_ Apply **D-C**.

### [Issue 12] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 81-82, 196-198, 318, 342, 347-350](../../../designs/staff-analytics.md#L81-L350)
- **Discrepancy Description:** Live rows cannot match a cached hero.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid.
- _**Proposed Edit:**_ Apply **D-B**; the screen shows the report's age ("as of 14:05") when it comes from the cache.

### [Issue 13] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 347-350](../../../designs/staff-analytics.md#L347-L350), [508-512](../../../designs/staff-analytics.md#L508-L512)
- **Discrepancy Description:** The money cache is not keyed by user nor cleared on sign-out.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (Stage 5 N2).
- _**Proposed Edit:**_ Key `creativo.analytics/<definitionVersion>/<uid>/<scope>/<period>`; one entry per scope; cleared on sign-out and account switch.

### [Issue 14] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Lines 56-61, 326, 355-361](../../../designs/staff-analytics.md#L56-L361)
- **Discrepancy Description:** The `capacity` projection keeps its own free-time number.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid as an unstated gap; the projection answers a different question.
- _**Proposed Edit:**_ Non-Goal: "`capacity` keeps its own number: it is the public 'can a client book' figure, padded by the turnaround and limited to the booking horizon; Analytics reports how the barber's time was used. The two are not compared on any screen."

### [Issue 15] [`egm-design`] - Severity: Medium

- **Affected Scope:** [Line 251](../../../designs/staff-analytics.md#L251)
- **Discrepancy Description:** Booking origin treats `inferredPlacement` as fact.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (`appointment.entity.ts:54`, "never promoted"; Stage 5 N4).
- _**Proposed Edit:**_ A `null` placement counts as "unknown"; `inferredPlacement` is not read.

### [Issue 16] [`egm-design`] + [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 17, 140-141, 253, 320-323](../../../designs/staff-analytics.md#L17-L323)
- **Discrepancy Description:** "Shop" is undefined.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (Stage 5 N7, Stage 6 #17).
- _**Proposed Edit:**_ Apply **D-E**; define "shop" in a Terms section; close Q6 ("v1: a barber's figures combine all locations; the shop is the tenant").

### [Issue 17] [`egm-structural`] - Severity: Medium

- **Affected Scope:** [Lines 96-97, 121-141](../../../designs/staff-analytics.md#L96-L141)
- **Discrepancy Description:** Q1, Q2, Q3, Q5 are decided in the body (Q2 the other way).
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Valid (Stage 5 N1, Stage 6 #1).
- _**Proposed Edit:**_ Replace with `## Decisions` (Q1 → user-record link via `setRoles`; Q2 → "rebooked at the chair"; Q3 → vouchers count in full; Q5 → the callable's log line) and keep Q4 reworded ("does any legacy data exist?") as the only open question.

### [Issue 18] [`egm-structural`] - Severity: Medium

- **Affected Scope:** [Lines 506, 523, 534](../../../designs/staff-analytics.md#L506-L534)
- **Discrepancy Description:** Additional Resources and Future Improvements nested under NFR.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Promote both to `##`.

### [Issue 19] [`egm-structural`] - Severity: Medium

- **Affected Scope:** [Lines 196-197, 268-270, 285-290, 393-502](../../../designs/staff-analytics.md#L196-L502)
- **Discrepancy Description:** Alternatives omit the barber-record link, the worked-seats-only split, and a separate rows callable.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Add Alternative K (link on `barbers` — public, leaks uids), L (discount only on worked seats — moves money between seats), M (separate rows callable — re-reads, and rows can disagree with a cached hero), N (separate `linkBarberAccount` callable — leaves the link when the role is removed).

### [Issue 20] [`egm-structural`] - Severity: Medium

- **Affected Scope:** [Lines 72-73, 227, 235, 243, 255-258, 357-358](../../../designs/staff-analytics.md#L72-L358)
- **Discrepancy Description:** Closed time, worked outside hours and open-today lack catalogue rows; line 358 double-counts today's open time.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Apply **D-D**: add rows _Closed days_, _Worked outside hours_, _Slivers_; drop "open-today"; day summary = unsold + open (by **D-C** unchanged code).

### [Issue 21] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 248](../../../designs/staff-analytics.md#L248), [483-485](../../../designs/staff-analytics.md#L483-L485)
- **Discrepancy Description:** "Matches Square" is wrong: Square measures from the visit's end.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Covered by Issue 9 (measure from the end).

### [Issue 22] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 174-177](../../../designs/staff-analytics.md#L174-L177)
- **Discrepancy Description:** CUJ 4 promises an hour-level view (v1.1) and a side-by-side layout the screen lacks.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ CUJ 4: "she switches the scope picker between barbers… and sees that Thursdays run at 45% fill across the shop" (weekday only); no side-by-side.

### [Issue 23] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 72-73, 152-153, 237-243, 255-256](../../../designs/staff-analytics.md#L72-L256)
- **Discrepancy Description:** The time bar is described three ways; "minus closed days" double-subtracts.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Apply **D-D**; G1 and CUJ 1 reference the catalogue's slice list.

### [Issue 24] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Line 240](../../../designs/staff-analytics.md#L240)
- **Discrepancy Description:** "Not closed" collides with "closed day".
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Rename to **unmarked** («Неотбелязани») everywhere.

### [Issue 25] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 66-67, 90-91, 150-151, 513-518](../../../designs/staff-analytics.md#L66-L518)
- **Discrepancy Description:** "Never waits on the network" fails on first open; "within a second" has no budget.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ G7: "with a cached report the first frame shows it; with none, the screen shows its layout with placeholder figures and fills it when the answer arrives". Budgets: p95 ≤ 1.5 s barber-month, ≤ 4 s shop-month in the deployed function; CUJ 1 "within a second" → "when the answer arrives".

### [Issue 26] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 519-521](../../../designs/staff-analytics.md#L519-L521)
- **Discrepancy Description:** "Nothing is stored" rollback claim is false.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "Rollback removes the route and menu row. What stays: `linkedBarberId` on user documents (harmless, unread), the new discount allocation in client spend (reverted only with its own change and a backfill), and device caches (ignored once the route is gone)."

### [Issue 27] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 98-101](../../../designs/staff-analytics.md#L98-L101)
- **Discrepancy Description:** Success measures lack baseline, target, tolerance.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "≥ 50% of linked barbers call the report in ≥ 3 of 4 weeks, from week 4; unsold hours per barber-week down ≥ 10% from the first full month's baseline after 3 months; reconciliation: takings within 2% of the shop's cash + card total for the month, every difference above €20 explained; unmarked share of past booked time ≤ 5%."

### [Issue 28] [`egm-style`] - Severity: Medium

- **Affected Scope:** [Lines 401-406](../../../designs/staff-analytics.md#L401-L406)
- **Discrepancy Description:** "10–100×" does not match the spec's own numbers.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Show inputs (rebuild per write: 400–4,000 reads × ~4,500 writes/month vs ~0.5M on-demand) and state the ratio the numbers give, rounded ("roughly 20 to 300 times").

### [Issue 29] [`egm-design`] - Severity: Low

- **Affected Scope:** [Line 316](../../../designs/staff-analytics.md#L316)
- **Discrepancy Description:** Rebook lookups need ~20 `in` queries per two spans.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "≤ 10 per span, ≤ 20 with the comparison".

### [Issue 30] [`egm-design`] - Severity: Low

- **Discrepancy Description:** Open time counts holes the schedule would not sell. (L91-92, 243)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Covered by **D-C**.

### [Issue 31] [`egm-design`] - Severity: Low

- **Discrepancy Description:** Comparison-span edges undefined (day 31, today's partial day, week start). (L275-276)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "Running period: days 1..today of this period vs days 1..min(today, length) of the previous one, both up to the current minute of today's weekday-equivalent day; a past period compares in full with the full previous period. Weeks start on Monday (`LocalDate.startOfWeek`)."

### [Issue 32] [`egm-design`] - Severity: Low

- **Discrepancy Description:** The usage log line needs a trace API and a sink. (L96-97, 373-377)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "The pipeline logs `LogEvent.AnalyticsReported` through `LogPorts` with uid, scope, period, counts and digest; the weekly-active measure is a Cloud Logging query over that event (distinct uid per ISO week)."

### [Issue 33] [`egm-design`] - Severity: Low

- **Discrepancy Description:** Alternative E's "stale by design" overstates. (L446-451)
- _**AI Suggestion:**_ DECLINE
- _**Justification:**_ Nit; Issue 3 rewrites the same paragraph's cons, enough.

### [Issue 34] [`egm-design`] - Severity: Low

- **Discrepancy Description:** Stored client spend needs a version bump and backfill. (L271-273)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Covered by Issue 8.

### [Issue 35] [`egm-design`] - Severity: Low

- **Discrepancy Description:** First-visit return breaks "nothing incremental", has no empty state; rows endpoint does not refuse the shop reference. (L23, 252, 386)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Covered by **D-E** (both figures to v1.1) and **D-B** (no rows endpoint).

### [Issue 36] [`egm-structural`] - Severity: Low

- **Discrepancy Description:** Bold lead-ins stand in for headings; the solution sits under The Problem. (L31-94)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ `###` headings inside The Problem; move "The proposed solution" to the end of the Overview.

### [Issue 37] [`egm-structural`] - Severity: Low

- **Discrepancy Description:** Diagram arrows do not trace the call. (L202-223)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Redraw as one top-to-bottom path (screen → cache → callable → wire → pipeline reads → systems → report → screen).

### [Issue 38] [`egm-structural`] - Severity: Low

- **Discrepancy Description:** Statistics design and D16(b) mentioned without links. (L58, 119, 414, 467-471)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Link the statistics design at first mention; D16(b) → `docs/architecture/ecs-migration.md` §9; add a `## Terms` section (laws cited, departures, `ShopNow`, systems/pipelines/ports, "works the book") linking `CLAUDE.md` (Stage 6 #6, #7, #8).

### [Issue 39] [`egm-structural`] - Severity: Low

- **Discrepancy Description:** One figure, several names. (L74-338)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Use catalogue names everywhere.

### [Issue 40] [`egm-structural`] - Severity: Low

- **Discrepancy Description:** Visibility rules appear three times. (L107-111, 300-303, 382-391, 508-512)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ One table in the Technical Plan; others point to it.

### [Issue 41] [`egm-structural`] - Severity: Low

- **Discrepancy Description:** Inconsistent `---` rules; `hypothesis.md` missing from resources. (L8, 504, 523-542)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Delete the rule at L504; add `hypothesis.md`.

### [Issue 42] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Competitor claim overgeneralised. (L48)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Name the products the research covers for each claim.

### [Issue 43] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Law 5 paraphrased inaccurately. (L406)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "Law 5 stores a derived value only when a privacy boundary, a busy screen's read fan-out or a transaction's conflict set requires it."

### [Issue 44] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Alternative H's example shows no edge. (L481-482)
- _**AI Suggestion:**_ DECLINE
- _**Justification:**_ Alternative H is rewritten by Issue 9; the new rule has no shop-day edge to illustrate.

### [Issue 45] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Alternative J's motives unsupported. (L498-500)
- _**AI Suggestion:**_ DECLINE
- _**Justification:**_ Nit; the rejection reason does not depend on the motive.

### [Issue 46] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Visit / appointment / seat mixed units. (L54-402)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Terms: "visit = appointment (one booking, possibly a party); seat = one person's service on it". Rows are seats; a party shows one row per seat of the scoped barber (Stage 6 #15).

### [Issue 47] [`egm-style`] - Severity: Low

- **Discrepancy Description:** "By-category" should be "by-service". (L247)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Rename.

### [Issue 48] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Shop reference's "same figure" unspecified. (L253)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Covered by **D-E** (moved to v1.1, its figures listed there).

### [Issue 49] [`egm-style`] - Severity: Low

- **Discrepancy Description:** UI string mixes Bulgarian and English. (L158)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Gloss every Bulgarian string at first use (Stage 6 #16).

### [Issue 50] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Vague phrases. (L31-463)
- _**AI Suggestion:**_ DECLINE
- _**Justification:**_ The finding names no specific phrase; the concrete ones are covered by Issues 25 and 27.

### [Issue 51] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Undefined jargon (pins, fold, works the book, Law 7 T2). (L85-391)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Covered by the Terms section (Issue 38); cite `flatten-spec.md` §2.3 T2.

### [Issue 52] [`egm-style`] - Severity: Low

- **Discrepancy Description:** "Agrees anywhere else" overclaims. (L20-22)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "agrees with the schedule's day summary (free minutes) and uses the same discount split as the client card's lifetime spend" (Stage 5 N5).

### [Issue 53] [`egm-style`] - Severity: Low

- **Discrepancy Description:** "Three ideas of free time" counts a document as app state. (L56-58)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "two definitions in the code (the schedule's 20-minute floor, the `capacity` projection) and a third proposed by the hypothesis".

### [Issue 54] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Fill formula has an always-zero term; CUJ 4 words fill differently. (L174-177, 246)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Fill (past time only) = (worked + no-show + unmarked) ÷ (rostered − break), blocked and slivers in the denominator; one worked example.

### [Issue 55] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Cache sentence repeats the key. (L347-350)
- _**AI Suggestion:**_ DECLINE
- _**Justification:**_ Rewritten by Issue 13.

### [Issue 56] [`egm-style`] - Severity: Low

- **Discrepancy Description:** Small slips ("a «i»", "this draft", sysadmin omitted). (L191, 339, 528)
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "an «i»" → "an ⓘ button"; "this draft" → "this design"; sysadmin row per **D-E**.

## Also folded in from Stages 5 and 6 (not raised in this round)

Stage 5 N3 (reuse `LocalDate.startOfWeek/startOfMonth`), N6 (expose the uncarved roster windows
from `RosterSystem`), N8 (count the open-hours card's 7-day reads) — applied in the same pass
where they touch lines 1–543; the file-list items wait for Stage 9.
