# Goldfish Review Report: Critic Round 3

**Target:** `docs/designs/staff-analytics.md` (lines 1-657, the feature specification; the Detailed Implementation Plan from line 658 was not reviewed)
**Date:** 2026-11-07
**Standard:** `resources/document_standards/feature-spec-standard.md` (design and structural lenses); style persona only (style lens)

## Reviewer Status

| Reviewer         | Status    | Raw findings    |
| ---------------- | --------- | --------------- |
| `egm-design`     | completed | 11 Major, 6 Nit |
| `egm-structural` | completed | 2 Major, 5 Nit  |
| `egm-style`      | completed | 5 Major, 15 Nit |

No reviewer needed a retry. No settled finding from rounds 1-2 was raised again.

**After deduplication:** 0 Blocker, 17 Major, 23 Nit (40 findings).

Merged duplicates:

- `style-3-16` and `design-3-16` are merged into `structural-3-1` (visibility table first-match order; no row for a barber asking for the shop).
- `style-3-4` is merged into `design-3-11` (the read estimates disagree: 300 vs 4,500 / 10 appointments).
- `style-3-9` is merged into `design-3-1` ("live" is used but not defined, in the Occupied/held text).
- The line 69 bullet of `style-3-20` is merged into `structural-3-7` (unlinked hypothesis reference).

Each merged finding keeps the id of the more substantive report. Ids keep the reviewer's own numbering, so the gaps (`design-3-16`, `style-3-4`, `style-3-9`, `style-3-16`) are the merged findings.

**Standard compliance (structural lens):** all five areas the standard requires are present: Problem, Goals and Non-Goals, Architecture, Alternatives A-N (each with Pros / Cons / Reason for Rejection), and Risks (12 rows, now including security rows). Headings nest without skipped levels. Every relative link and in-page anchor in scope resolves, and the cited code locations (`firestore.rules:63`, `:297`, `:562-565`, `firestore.indexes.json:926-929`, `Roles.SPEND`/`MONEY`/`BOOK`) match.

**Verified as accurate (design lens):** the `restricted/link` lock is covered by the default deny (`firestore.rules:197-199`); `bookedAtUtcMs` and `bookedFromAppointmentId` have default single-field indexes; `moneyOf` splits pro rata per visit; `sellableAt` and `totalMinutes` match the unsold, open and bookable definitions; the late-cancellation inputs match `statsOf`; the cancellation window is on the T2 list; `SHEET_STAGED` / `climbStages` exist.

---

## Blockers

None.

---

## Major

### design-3-1 "Held" uses "live" in a sense the code does not, so cancelled seats on completed visits fall out of the partition - Severity: Major

- **Reviewer Lens:** `egm-design` (also `egm-style` 9)
- **Affected Scope:** lines 307-313, 319-320 (and "live" at 372)
- **Discrepancy:** Occupied comes from `occupiedIntervals`, which counts every seat of a visit that is not wholly cancelled. "Held" is defined as a "`CANCELLED` seat on a live visit", and in the code "live" means PENDING or CONFIRMED only. A cancelled seat on a COMPLETED or NO_SHOW visit therefore holds the chair but matches none of the five occupied parts. Past visits are mostly COMPLETED, so this is common, and the identity at line 319 and its property spec (line 320) would fail. Style adds that "live visit" and "live party" are never defined, and the Occupied parenthetical nests three clauses.
- **Evidence:** `grid-layout.system.ts:233` skips only `BookingStatus.Cancelled`; `booking-lifecycle.data.ts:188-193` (`isLive` = PENDING or CONFIRMED); `busy.system.ts:199-202`.
- **Recommendation:** Define held as "a `CANCELLED` seat on a visit that is not wholly cancelled", and do not use "live" unless it means PENDING or CONFIRMED. Split the Occupied parenthetical: "inside the union of the chair time of the seats that hold the barber's chair (`GridLayoutSystem.occupiedIntervals`, unchanged). Every seat of a visit that is not wholly cancelled holds the chair, a cancelled one included, as in the server's busy projection."

### design-3-2 Worked minutes inside a block or break disappear from every figure - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 302-316, 326, 330
- **Discrepancy:** Blocked and Break come before Occupied, so a `WORKED` seat placed over a lunch break or inside a blocked range counts as break or blocked. "Worked outside hours" covers only time outside rostered hours, so those minutes appear nowhere, and fill and the worked segment under-report a barber who works through lunch, which staff may do. G5 does not need this order: the schedule's holes are rostered windows minus blocks, breaks and occupied time, in any order.
- **Evidence:** `roster.system.ts:556-557` ("staff may still place a visit over one"); `staff-day.store.ts:318-321, 411`.
- **Recommendation:** Put Occupied first, or add a "worked during break/block" figure beside "worked outside hours". State in the catalogue how fill treats those minutes.

### design-3-3 Shop-scope appointment reads can return the same visit twice - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 258-261, 410-419
- **Discrepancy:** A party served by two barbers carries one busy key per barber per day. The shop scope splits about 310 keys into `in` groups of 30, so `A__D` and `B__D` can land in different queries and return the same visit twice. The spec never says rows are merged by appointment id, so the party's takings, tips and counts double in the shop view. The "next 7 days" read also overlaps the running period's remaining days.
- **Evidence:** `appointment-index.system.ts:117-119` (one `BusyKey` per seat's barber); `client-stats.system.ts:327-346` (`collectVisits`: "a caller merging two reads must not be able to double it").
- **Recommendation:** State that the pipeline merges all appointment reads by id before calling the systems, and add a spec case for a two-barber party split across chunks. Merge or reuse the overlap between the period read and the next-7-days read.

### design-3-4 Rebooked is biased low for a running period - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 334; lines 343-348
- **Discrepancy:** A visit on day d has until the end of day d+1 to be rebooked. In a running period, today's and yesterday's visits have not had their full window, while the comparison span's matching days have, so the change chip is skewed against the current period. The base-20 gate does not correct a bias.
- **Recommendation:** Leave out of the base, and of its counterpart in the comparison span, every visit whose window has not closed (shop date ≥ today − 1), or mark the figure provisional. Put the rule in the catalogue and the ⓘ text.

### design-3-5 G4 ("every figure opens to its source") does not hold in shop scope - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 124; lines 247-248, 283, 366-367, 432-435
- **Discrepancy:** Seat rows exist only for a single-barber scope, and only money figures get a shop drill-down (the per-barber split). Booking origin, rebooked, no-shows, late cancellations and fill by weekday have no source rows defined in shop scope. The per-barber drill-down is a fresh request with its own computed time, so its rows need not add up to the shop figure that was tapped.
- **Recommendation:** Narrow G4 to single-barber scope and state what each shop figure opens to, or carry per-barber split rows for every shop figure inside the same report snapshot, with opening a barber's full report as a separate, separately timestamped step.

### design-3-6 The base-20 rate gate is undefined for fill and takings per hour - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 127-128, 330, 333, 366
- **Discrepancy:** G6 says "A rate appears only when its base reaches 20", but the catalogue applies the gate only to rebooked and no-shows. Fill (one day per weekday in a week period) and "takings per hour of service" (one seat yields an €/h figure) are rates on small bases with no stated base or gate, so the rule "rate is `null` below it" in `StaffAnalyticsSystem` cannot be implemented unambiguously.
- **Recommendation:** For every rate-like figure, state the base unit (visits, seats, barber-days) and whether the gate applies; or narrow G6 to the count-based rates and say why fill and €/h are exempt.

### design-3-7 CUJ 2's deep link does not name the barber - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 203 (CUJ 2, lines 198-206); the "Existing screens" text
- **Discrepancy:** `/staff/schedule?day=<Tuesday>&view=day&free=1` carries no `barber`. Without it the schedule scopes to everyone, and the day summary is not shown at all without a single scope. Ivan lands on every chair's Tuesday, not his own empty afternoon; the same holds when the admin taps the card in a barber scope.
- **Evidence:** `staff-dashboard.ts:807-815` (the `barber` input, absent means everyone); `staff-dashboard.ts:1742-1747` (`daySummary` returns `null` without a scope).
- **Recommendation:** Add `&barber=<linkedBarberId or the scoped barber>` to the link in CUJ 2 and in "Existing screens".

### design-3-8 The admin's self-link has no way in, and its purpose is unstated - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 392-399
- **Discrepancy:** The spec lets an admin change their own link through the client card's roles row. That path does not exist: `RoleAssignmentSystem.decide` refuses a self-target first, and `offerOf` hides the roles block on the viewer's own account. The spec names neither change. Because the admin row matches before the barber row in the visibility table, the link also changes nothing the admin can see, so the reason for weakening the self-refusal guard is unclear.
- **Evidence:** `role-assignment.system.ts:132-134`; `role-assignment.system.ts:161-171` (`subject.id !== viewerUserId`); doc lines 280-284.
- **Recommendation:** Name the changes to `decide` and `offerOf` and the screen where the admin picks their own barber record, and state what the self-link achieves. If it achieves nothing, drop the exception.

### design-3-9 The barber-role ⇔ barber-record invariant is incomplete - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 233-236 (CUJ 6), 386-397
- **Discrepancy:** If granting the barber role requires a barber record and `setRoles` is the only roles writer, it is unclear how CUJ 6's unlinked barber arises (dev seed, pre-existing grants, an admin clearing the link while keeping the role, a retired barber record). The spec does not say whether "role kept, link null" is allowed, nor what happens to `linkedBarberId` and the lock when a barber record is deleted or deactivated; a dangling link would make `ANALYTICS_SCOPE_UNKNOWN` or an empty report look like a working link.
- **Recommendation:** State the invariant ("barber role ⇒ link present, except …"), list the transitions that produce the unlinked state, and specify barber-record retirement: clear the link and the lock, or refuse the retirement while linked.

### design-3-10 Client names stay in `localStorage` with no expiry - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 451-454, 499, 622-623
- **Discrepancy:** Cached barber reports hold seat rows with client names, evicted only past 6 entries or on sign-out or account switch. A barber who stays signed in keeps them indefinitely; server-side revocation (`setRoles` revokes refresh tokens) clears nothing until the screen opens again; an erased client's name (GDPR Art. 17, `eraseClient`) survives on staff devices with no bound. The Risks table covers shared devices but not retention or erasure.
- **Evidence:** `set-roles.pipeline.ts:178`.
- **Recommendation:** Persist only figures and day rows and keep seat rows in memory; or store client ids and resolve names when the drill-down opens; or add a short TTL (e.g. 24 h) and clear on any refusal or session loss. Add a Risks row for retention and erasure.

### design-3-11 The read and cost model assumes one open per day and its counts disagree - Severity: Major

- **Reviewer Lens:** `egm-design` (also `egm-style` 4)
- **Affected Scope:** lines 406-419, 493, 506-509, 534
- **Discrepancy:** About 0.7M reads a month assumes each barber and the admin open the screen once a day. The screen is meant to be checked between clients (CUJ 1), every open is a fresh call, the shop scope is not cached (~15,000 reads per open), and scope or period switches (CUJ 4) cost ~800 reads per tap, none of it counted. The counts are also inconsistent: ~300 appointments per barber-month is 15 × 20 days, while ~4,500 for the shop is 10 × 15 × 30 days (450 per barber); "~4,500 appointment writes … plus edits" is already exactly 10 × 15 × 30 before edits; and the header says "seats" while the cells count appointments. The money is trivial, but the Risks table makes "above 1M a month" the trigger for Alternative C, and realistic use passes it early.
- **Recommendation:** Model a stated number of opens per day per role plus scope and period switches, use one working-day count for both rows and Alternative A, say "appointments" in the header, and fix "plus edits". Consider a short server-side reuse window keyed by (scope, period, `definitionVersion`), or a "no recompute if the cached report is younger than N minutes" rule, then re-derive the 1M trigger.

### structural-3-1 The visibility table's first-match rule gives the wrong answer and misses the shop case - Severity: Major

- **Reviewer Lens:** `egm-structural` (also `egm-style` 16, `egm-design` 16)
- **Affected Scope:** lines 277-287
- **Discrepancy:** Line 277 says "the first that matches decides". Row 3 (`barber, linked | their own barber record | the report with rows`) puts the scope in "May ask for", while row 4 (`barber, linked, asking for another barber | — | ANALYTICS_FORBIDDEN`) puts it in the Caller column. Read literally, row 3 already matches a linked barber asking for a colleague, so row 4 is never reached. No row covers a linked barber asking for the shop scope. This table enforces the money boundary (line 155).
- **Recommendation:** Use explicit condition columns (Caller roles/status | Requested scope | Result) with a value in every scope cell, e.g. "barber, linked | own record | report" and "barber, linked | another barber or the shop | `ANALYTICS_FORBIDDEN`"; or place the refusal row above row 3. Add the admin row for an unknown barber id (see `structural-3-2`).

### structural-3-2 The error list, the visibility table and the States table cover different codes - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 280-287, 436-447, 471-473
- **Discrepancy:** Five codes are listed. `ANALYTICS_SCOPE_UNKNOWN` has no stated trigger (unlike `ANALYTICS_PERIOD_OUT_OF_RANGE`) and appears in no visibility row and no screen state. `ANALYTICS_UNAUTHENTICATED` has no screen state and no visibility row; it appears only as "signed in?" in the diagram.
- **Recommendation:** Give `ANALYTICS_SCOPE_UNKNOWN` its trigger at line 473 (e.g. "a barber id that is not a barber record of the tenant"). Map every error code to exactly one screen state (even "falls under Call failed" or "the route guard redirects to sign-in") and add the matching visibility rows.

### style-3-1 "Visit of the page" reuses a defined term for a page load - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 204, 464
- **Discrepancy:** "free time shown for this visit of the page" and "shows free time for that visit of the page". Terms (line 79) defines "Visit" as one appointment, and CUJ 2 is about booking a visit.
- **Recommendation:** "for this page load only (his stored free-time preference is not changed)" at 204; "for that page load only" at 464.

### style-3-2 "Linked" names two different relations - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 171, 418, 496 against 77-78, 139, 189
- **Discrepancy:** Terms uses "linked" for an account tied to a barber record. "A linked follow-up booked by the end of the next shop day", "filtered to linked bookings" and "Only linked bookings count as rebooked" use it for a booking with `bookedFromAppointmentId` set.
- **Recommendation:** Add the Terms entry "**Follow-up**: a visit booked from an earlier visit (`bookedFromAppointmentId` set)" and write "a follow-up booked by …" (171), "filtered to follow-ups" (418), "Only follow-ups count as rebooked" (496).

### style-3-3 "Proves" overstates what a spec does - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 320, 462-463
- **Discrepancy:** "A property-based spec over generated days proves it." and "the agreement spec proves it". A property spec samples inputs, and G5 (line 126) says the agreement spec runs on one fixture.
- **Recommendation:** "… checks it." and "the agreement spec checks it on a fixture."

### style-3-5 The base-20 rationale counts visits, but the gated rates count seats - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 65-67
- **Discrepancy:** "A barber does 8–15 visits a day. Below 20 visits, one visit moves a rate such as the no-show share by 5 points or more". The no-show base is seats (line 335) and CUJ 5 counts "9 worked seats"; only rebooked uses visits. The daily figure does not connect to week or month reports.
- **Recommendation:** "Below a base of 20, one seat moves a rate such as the no-show share by 5 points or more, so a percentage on a small base misleads; a new barber's first week (CUJ 5) or a quiet week stays under 20." Drop or move the 8-15 sentence.

---

## Nit

### design-3-12 The log event records each barber's money - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 478-481
- **Discrepancy:** `AnalyticsReported` carries takings and tips per uid. The stated purposes (weekly-active measure, duration) do not need money, and the spec keeps the vendor's sysadmin out of shop figures while vendor-operated Cloud Logging receives them.
- **Recommendation:** Log period, scope, `definitionVersion`, counts, duration and the appointment count only.

### design-3-13 The running-period comparison rule is ambiguous for the hero total - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 343-348
- **Discrepancy:** It is not said whether the hero's change chip compares March 1-31 with February 1-28, or March 1-28 with February 1-28 ("days 29-31 show without a change" only makes sense per day). On 1 April the month becomes past and compares 31 days with 28, so the chip jumps overnight.
- **Recommendation:** State the formula for the total and whether the past-period rule truncates the same way.

### design-3-14 G5's equality depends on the offered-shops filter, which is not named - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 352-357, 461-463
- **Discrepancy:** The schedule uses `RosterSystem.offeredWindows`, filtered to the shops the day offers. The spec's new export is "windows before carve-outs" (`windowsOf(..., CARVE_NONE)`), which is unfiltered.
- **Evidence:** `roster.system.ts:624-637`; `staff-day.store.ts:377-381, 411`.
- **Recommendation:** Specify that `ChairTimeSystem` applies the same filter with the same `shopHoursOn(locations, date)` input, and add a hidden-shop case to the agreement spec.

### design-3-15 "Billed seats" is undefined - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 331, 594-601
- **Discrepancy:** `BillingSystem.subtotalOf` sums every seat, cancelled and no-show included, so the pro-rata base is all seats, which Alternative L relies on; the term is never defined, nor where currency conversion happens.
- **Evidence:** `billing.system.ts:303-326`; `client-stats.system.ts:676-681`.
- **Recommendation:** Define "billed seat" as every seat in `appointment.seats`, as `subtotalOf` sums them, and state the conversion point (BGN → EUR after the split).

### design-3-17 The reconciliation gate ignores tips and voucher draws - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 145-147
- **Discrepancy:** Takings exclude tips and include voucher-funded seats in full; the shop's cash + card total includes card tips and excludes voucher redemptions. Card tips alone (5-10%) can break the 2% threshold by construction.
- **Recommendation:** Define the comparison, e.g. takings + recorded card tips − voucher draws, against cash + card.

### structural-3-3 The architecture diagram's return arrow is detached from the pipeline line - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 253-272
- **Discrepancy:** The vertical line sits at about column 59; the closing `◄┘` on line 272 sits at about column 98, and the "AnalyticsReport (definitionVersion, computedAtUtcMs, rows)" label crosses the vertical.
- **Recommendation:** End the vertical at line 271 with `┘` in its own column, draw the return as `◄──────┘` from there, and put the label on its own line.

### structural-3-4 The performance budgets are stated in four places - Severity: Nit

- **Reviewer Lens:** `egm-structural` (also the "512 MiB" bullet of `egm-style` 20)
- **Affected Scope:** lines 131-133 (G7), 491, 624-626, 650; Overview 19-22
- **Discrepancy:** "≤ 1.5 s / ≤ 4 s", the 16.7 ms / 4× frame budget and 512 MiB are restated each time and can drift; the bare "512 MiB" at 626 has no label. NFR also sits after Alternatives, apart from the plan and risks it summarises.
- **Recommendation:** Keep the numbers in one place (NFR Performance & Latency or G7) and link to it; label it "callable memory 512 MiB". Consider moving NFR after the Technical Plan.

### structural-3-5 Two catalogue rows misuse their columns - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 327, 330
- **Discrepancy:** Fill puts its worked example in "Shown as"; the time bar puts its displayed parts in "Formula" though it has no formula.
- **Recommendation:** Move the Fill example under the table ("Shown as" = "% per weekday"); for the time bar, put "—" in Formula and the parts in "Shown as", or move the row to "The screen".

### structural-3-6 The Terms entry defines "callable" but its label omits it - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 99-102
- **Discrepancy:** The entry "System / pipeline / port" also defines _callable_, used throughout (155, 242, 619).
- **Recommendation:** Relabel it "System / pipeline / port / callable", or give callable its own entry.

### structural-3-7 Several cross-references are plain text while their targets are linked elsewhere - Severity: Nit

- **Reviewer Lens:** `egm-structural` (also `egm-style` 20, line 69)
- **Affected Scope:** lines 69, 125, 171, 521, 587
- **Discrepancy:** "the brainstorm hypothesis" (69), `MoneyAllocationSystem` before its definition (125), "see the catalogue" (171), "the earlier statistics design (§4.3)" (521), "(the brief's choice)" (587) are unlinked.
- **Recommendation:** Link 69 → `../design-research/staff-analytics/hypothesis.md`; 125 → `#new-and-changed-systems-coresystems-pure`; 171 → `#the-metric-catalogue-version-1`; 521 → `../design-research/availability-and-statistics-design.md` (§4.3); 587 → `../design-research/staff-analytics/concepts_brief.md`.

### style-3-6 "Open" has too many meanings - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 15, 134, 205, 211, 316, 328, 429, 440
- **Discrepancy:** "bookable hours", "Bookable open hours", "the open-hours card", "Each open gap", the partition part **open**, plus the verb ("opens to the seats", "She opens Niko", "First open"). "Open hours" reads like opening hours (48), and the figure differs from the part (it drops holes under 20 minutes).
- **Recommendation:** Call the figure "bookable time (next 7 days)" and the card "the bookable-time card"; "free gap" at 205; "She selects Niko in the scope picker" at 211.

### style-3-7 "Hole" and "gap" name the same thing - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 90, 205, 314, 461-462
- **Discrepancy:** Terms defines "Hole", then "short gaps (holes under 20 minutes)", "Each open gap", "gap rows" use an undefined synonym.
- **Recommendation:** Use "hole" throughout ("short holes"); keep "gap rows" only if it is the schedule's UI name, and say so once.

### style-3-8 The unsold and open definitions attach "of holes" to the wrong noun - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 314-316, 328
- **Discrepancy:** "the part before the current minute of holes of 20 minutes or more"; line 328 has the same order.
- **Recommendation:** "**unsold** (the part of a hole of 20 minutes or more that lies before the current minute) and **open** (the part of such a hole at or after the current minute)".

### style-3-10 Square's definition is quoted three ways - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 59, 340-341, 563
- **Discrepancy:** "within 24 hours of the visit ending", "… of the visit's end", "… of the end", each in quotation marks.
- **Recommendation:** Use the competitor-research wording in all three, or drop the quotation marks after the first.

### style-3-11 The Takings "Excludes" cell says "excluded" twice - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 331
- **Recommendation:** "visits `BillingSystem` cannot evaluate (their count is shown)".

### style-3-12 "Worked outside hours" uses the wrong reference point and unit - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 326
- **Discrepancy:** "visits placed before opening or after closing" suggests location hours and counts visits, while the formula measures seats outside rostered time.
- **Recommendation:** "`WORKED` seats placed before the barber's rostered start or after the rostered end".

### style-3-13 "Window" is undefined in Late cancellations - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 336
- **Recommendation:** "the seat's stored cancellation window, else the current policy's window".

### style-3-14 "Running period" is undefined - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 343
- **Recommendation:** "For the current (unfinished) period", pairing with "A past period" at 346.

### style-3-15 "Nothing is written" contradicts the log step - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 247 (diagram line 270)
- **Recommendation:** "Nothing is written to Firestore."

### style-3-17 "Is refused" does not hold for a demoted account - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 291-294
- **Discrepancy:** "a demoted or blocked account's next request is refused": an admin demoted to a linked barber is still served their own report. "On purpose" (291) is filler.
- **Recommendation:** "a blocked account's next request is refused, and a demoted account's next request is judged on its new roles; on a refusal the screen deletes the cached report for that account." Drop "on purpose". Related: `design-3-10`.

### style-3-18 The backfill reasoning conflicts with "greenfield" - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 362-363, 384, 494 against 183
- **Discrepancy:** "Greenfield, so there is no backfill." (a fragment) versus a `clientStats` version bump with a backfill and a "client's total changes by cents" risk.
- **Recommendation:** Give the reason for the backfill (e.g. dev and staging data) or drop it and the risk row; rewrite 384 as "The repository is greenfield, so the link needs no backfill."

### style-3-19 Wording in the Risks table and Alternatives - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 495, 512-513, 536, 606, 614
- **Discrepancy and recommendation:**
  - 495: "Unmarked dominates the bar" is vague and a success measure is not a mitigation. Effect: "Unmarked time takes a large share of the bar"; Mitigation: "The unmarked slice opens to its visits; the success measures track it at ≤ 5% of past booked time."
  - 512-513: the Law 5 quote repeats 104-105 verbatim. "Law 5 permits a stored derived value only for privacy, read fan-out or a conflict set; here storing multiplies the reads …".
  - 536: "moves heavy work onto the device" is unquantified. "it folds up to ~4,500 appointments on the main thread of the device the no-lag goal protects."
  - 606: "(~800 or ~15,000 reads)" includes the comparison span and next-7-days reads a drill-down would not need. "(~330 or ~4,800 reads)". Related: `design-3-11`.
  - 614: "copy `setRoles`' transaction, audit and gate": "duplicate", and name the check ("role check").

### style-3-20 Small wording fixes - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 13, 173, 445, 482-483, 648-650 (line 69 merged into `structural-3-7`, line 626 into `structural-3-4`)
- **Discrepancy and recommendation:**
  - 13: "what their visits took (takings)" can mean time. "the money their worked seats brought in (takings)".
  - 173: "the client did receive the service" → "the client received the service".
  - 445: "the switcher stops at 12 months back and today" describes behaviour. "nothing; the switcher does not offer periods past 12 months back or after today".
  - 482-483: "Correctness checks: the partition spec, the agreement spec, and the drill-down footer, whose total must equal the figure."
  - 648-650: move "it ships once a shop-month report with the reference stays under 4 s p95" into its own sentence.
