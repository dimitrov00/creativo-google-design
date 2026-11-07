# Goldfish Review Report: Critic Round 2

**Target:** `docs/designs/staff-analytics.md` (lines 1-584, the feature specification; the Detailed Implementation Plan was not reviewed)
**Date:** 2026-11-07
**Standard:** `resources/document_standards/feature-spec-standard.md` (design and structural lenses); style persona only (style lens)

## Reviewer Status

| Reviewer         | Status    | Raw findings    |
| ---------------- | --------- | --------------- |
| `egm-design`     | completed | 6 Major, 9 Nit  |
| `egm-structural` | completed | 3 Major, 11 Nit |
| `egm-style`      | completed | 9 Major, 28 Nit |

No reviewer needed a retry. The five findings declined in round 1 were not raised again.

**After deduplication:** 0 Blocker, 16 Major, 44 Nit (60 findings).

Merged duplicates:

- style M1 is merged into `design-2-1`.
- style M6 is merged into `structural-2-3`.
- style N9 is merged into `structural-2-4`.
- style N4 is merged into `structural-2-7`.
- style N1 is merged into `structural-2-14`.
- style N18 is merged into `structural-2-1`.

Each merged finding keeps the id of the more substantive report. Cross-references point out findings that are related but distinct.

**Standard compliance (structural lens):** all five areas the standard requires are present: Problem, Goals and Non-Goals, Architecture, Alternatives with reasons, and Risks. Headings, tables, the code block and the CUJ Given/When/Then form are sound. Every relative link and anchor in scope resolves.

---

## Blockers

None.

---

## Major

### design-2-1 Changing `occupiedIntervals` breaks G5 and CUJ 2; the doc also says the schedule is untouched - Severity: Major

- **Reviewer Lens:** `egm-design` (also `egm-style`)
- **Affected Scope:** lines 117-119 (G5), 306, 326-330, 403-407
- **Discrepancy:** The doc contradicts itself:
  - Lines 327-328 say "the schedule's own code and hot path are not touched", and line 405 says "The schedule is unchanged".
  - Lines 328-330 change `GridLayoutSystem.occupiedIntervals`, which the schedule calls: a `CANCELLED` seat in a live party no longer occupies the chair.

  The two rules then disagree. The schedule's "occupied" is the seats plus the `barberBusy` blocks, and the busy projection keeps cancelled seats inside a live root. For today and future days, analytics would call time open or bookable while the schedule draws it as taken and the collision rule holds it. G5's equality (unsold + open = the schedule's free minutes) fails, and the open-hours card and CUJ 2's emptiest day point at held time.

- **Evidence:**
  - `staff-day.store.ts:1718` calls `occupiedOn(..., geo.busy)`, with `geo.busy` taken from `busyDay.blocks` (`:420`).
  - `busy.system.ts:236-264`: `rebuild` pushes `Seat.chairTime` for every seat of a live root.
  - `busy.system.ts:200-202`: "a split party's chair whose seats were cancelled inside a live root still holds it".
- **Recommendation:** Choose one rule and apply it everywhere. Option one: keep today's semantics, where a cancelled seat in a live root occupies the chair and counts as "occupied" in the partition. Option two: also change `BusySystem.rebuild` and `chairOccupants`, and state the effect on `/book` and on collisions. With either option:
  - Rewrite lines 327-330 and 405 so they no longer claim the schedule is untouched. Style's suggested wording: "One change reaches the schedule: ...".
  - Add the case "live party, one `CANCELLED` seat, day ≥ today, busy doc present" to the G5 agreement fixture.

### design-2-2 "Rebooked at the chair" also counts clients' own online repeat bookings - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 162-163, 311, 438, 505-506
- **Discrepancy:** Line 311 says only «Запиши пак» sets `bookedFromAppointmentId`, so "a client who books the next visit online later is not counted". That is false: the client app's "the same again" flow sets the link too. The ⓘ text, the Risks mitigation (line 438) and Alternative H's "measures the act at the chair" are therefore wrong.
- **Evidence:**
  - `libs/features/client/booking/src/lib/booking-flow.store.ts:538-553` (`_bookedFrom`, set by `repeat`) and `:874` (`bookedFromAppointmentId: this._bookedFrom()?.appointmentId ?? null`).
  - `client-booking.ts:210-219` (`landRepeat`).
  - `booking-decision.system.ts:816-834` stores the link on every commit.
- **Recommendation:** Add `F.placement === Placement.Staff` (`placement-kind.data.ts:6`) to the definition. Alternatively, rename the figure and rewrite the ⓘ text, line 438 and Alternative H to match.

### design-2-3 The 24-hour rebooking window is not on Law 7's closed list of elapsed-time rules - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 96-101, 311, 505-506
- **Discrepancy:** Line 311 calls the window "an elapsed-time rule under Law 7". The doc's own Terms (lines 99-100) restrict stored-instant comparison to the rules listed in flatten-spec §2.3 T2. That list has no rebooking window. The definition also adds wall-clock minutes to an instant (`A.utcEpochMs + (A.endMinutes − A.startMinutes)`).
- **Evidence:** `docs/architecture/flatten-spec.md:539-540`: "These rows, and ONLY these, compare or add `UtcEpochMs` values". The listed statistics are `latenessMinutes`, `bookingLeadTimeMinutes` and achievements on-time.
- **Recommendation:** Either record an owner amendment that adds "staff-analytics rebooking window" to T2, and list it under Decisions, or state the rule on the shop wall clock: F booked by `(LocalDate.addDays(A.localDate, 1), A.endMinutes)`. The wall-clock form needs F's booking point as a shop-local coordinate, which is the cost Alternative H cites. State that trade-off whichever form is chosen.

### design-2-4 `setRoles` cannot change a link when the role set is unchanged, and the audit row cannot record it - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 354-361
- **Discrepancy:** The doc says `RolesCall` gains `linkedBarberId` "with the same transaction and single audit row as today". Today an unchanged role set:
  - writes nothing;
  - cannot produce an audit row;
  - leaves the card's Save disabled.

  The audit row carries only the role sets. Consequences:
  - An admin who picked the wrong chair cannot re-link without revoking and re-granting the barber role.
  - Each link edit revokes the barber's sessions.
  - It is undefined whether `linkedBarberId: null` on a call that keeps `barber` means "keep" or "clear".
  - `decide` reads only the two user documents, never `barbers/{id}`.

- **Evidence:**
  - `set-roles.pipeline.ts:136-137` (`if (!assignment.rolesChanged) return ... writes: []`), `:121` and `:178`.
  - `audit.system.ts:881-883` (an unchanged set is a defect) and `:892-897` (the row holds only `profileRolesFrom` and `profileRolesTo`).
  - `role-assignment.system.ts:195-197` (`saveOf` sends only a changed set).
- **Recommendation:**
  - Define `RoleAssignment.linkChanged` and make "changed" mean the roles or the link.
  - Add `profileLinkedBarberFrom` and `profileLinkedBarberTo` to the audit row.
  - Update `saveOf`.
  - Define the null-versus-keep semantics.
  - State whether a link-only change revokes sessions.
  - Require `decide` to read `barbers/{linkedBarberId}` and refuse an unknown or inactive barber.

### design-2-5 "One account per barber" cannot be enforced as described, because concurrent grants race - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 355-361
- **Discrepancy:** `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED` needs a query over `users` by `linkedBarberId`. The doc never mentions that query, and line 360 says "No query over users by role is needed". Inside a transaction, a query with an empty result locks no document. Two admins, or one double submit, can therefore link the same barber to two accounts, and both commits succeed. `RoleAssignmentSystem.decide` (`role-assignment.system.ts:116-123`) takes no such input today.
- **Evidence:** firestore transaction semantics; `role-assignment.system.ts:116-123`.
- **Recommendation:** Use a lock document that the same transaction reads and writes, for example `barberLinks/{barberId} = { userId }`, written by the Admin SDK only, with rules that deny all client access. Pass the lock document to `decide`, declare the new read and the new collection, and add the race to the Risks table.

### design-2-6 CUJ 2 and G8 need a schedule change the doc says is not happening - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 126-127 (G8), 190-194 (CUJ 2), 405
- **Discrepancy:** CUJ 2 promises "The schedule opens on Tuesday in day view with free time shown". Free time on the schedule:
  - is off by default;
  - is a per-device `localStorage` setting;
  - has no URL parameter.

  The schedule's deep link carries only `day`, `view` and `barber`.

- **Evidence:**
  - `schedule-status-filter.ts:25-26` ("Free time drawn, its own key, OFF by default") and `:74`.
  - `staff-day.store.ts:953-957`.
  - `staff-dashboard.ts:1738-1740`.
- **Recommendation:** Specify a mechanism, for example a `free=1` query parameter that turns gaps on for that visit without changing the stored setting. List it under "Existing screens" as a schedule change, and add a CUJ 2 test for it.

### structural-2-1 A cached report outlives "loses access at once", and the States list omits the error states - Severity: Major

- **Reviewer Lens:** `egm-structural` (also `egm-style` N18)
- **Affected Scope:** lines 182, 239, 275-276, 382, 393-398, 413-415
- **Discrepancy:** Lines 275-276 say "a demoted or blocked account loses access at once". This is not true on the device:
  - The first frame always paints the cached report (lines 182 and 239).
  - The cache is cleared only on sign-out or account switch (line 398).
  - The route guard checks token roles (line 382).

  A demoted admin therefore keeps seeing cached shop-wide takings. The States list (lines 393-394) also has no entry for:
  - `ANALYTICS_FORBIDDEN`
  - `ANALYTICS_PERIOD_OUT_OF_RANGE`
  - `ANALYTICS_SCOPE_UNKNOWN`
  - `ANALYTICS_UNAUTHENTICATED`
  - "call failed while a cache is shown"

  Style separately flags "at once" as vague.

- **Evidence:** standard, Risks & Limits: "must identify potential failure modes ... and how they will be mitigated".
- **Recommendation:**
  - Add a States entry for each `AnalyticsErrorCode` and one for "call failed, cache shown".
  - Specify that a FORBIDDEN or NOT_LINKED answer deletes that uid's cached entries.
  - Reword lines 275-276, for example: "the server refuses on its next request; the device cache is dropped on the first refused answer".

### structural-2-2 The Risks table has no security rows - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 427-439; related text at 144-146, 472, 552-554
- **Discrepancy:** All nine risk rows cover latency, cost, query limits, data quality or recomputation. The security surface this spec adds is discussed only in prose and has no risk row:
  - A wrong or stale `linkedBarberId` link.
  - Shop-wide money cached in `localStorage` on a shared front-desk device. Alternative D (line 472) rejects "the whole shop's money held in every staff browser", yet the admin's shop report is cached the same way.
  - Token roles that pass the route guard while the stored roles refuse.
- **Evidence:** standard, Risks & Mitigations: "Identified security, scalability, or complexity risks"; "must explicitly call out ... security implications".
- **Recommendation:** Add a Risk / Effect / Mitigation row for each of the three, and point NFR Security & Privacy to those rows. Resolve the line 472 inconsistency together with `style-2-28`. See also `design-2-8` (cache size and client names at rest) and `design-2-5` (the link race).

### structural-2-3 The catalogue table does not have the shape G3 promises - Severity: Major

- **Reviewer Lens:** `egm-structural` (also `egm-style` M6)
- **Affected Scope:** lines 113-114 (G3), 300-315
- **Discrepancy:** G3 promises "formula, base, inclusions, exclusions" for every figure, but the table has only Figure | Definition | Shown as. The base and exclusions are scattered or missing:
  - Tips (line 309) states no base or exclusions.
  - Booking origin (line 314) does not say whether CANCELLED visits count.
  - Seats by service (line 310) does not say whether no-show seats count toward the hours.
  - Late cancellations (line 313) points to "the client card's exclusions" without listing them.
- **Evidence:** G3 itself; the standard's core principle that a fresh engineer can understand the proposed feature.
- **Recommendation:** Split Definition into Formula | Base | Includes | Excludes columns, or give each figure a definition block with those four labels. Write the late-cancellation exclusions out in full, or name the exact `ClientStatsSystem` function that applies them. If neither is done, reword G3 to match the table.

### style-2-1 The "takings per service hour" formula has the wrong unit and disagrees with the Overview - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 310; lines 15-16
- **Discrepancy:** "takings ÷ the `durationMinutes` of those seats" gives takings per minute, not per hour. The Overview's "earn the most per hour of their time" reads as chair time (setup + service + cleanup, line 80), but the formula uses service minutes only.
- **Recommendation:** Line 310: "takings ÷ (Σ `durationMinutes` ÷ 60); the base is service minutes only, without setup or cleanup". Lines 15-16: "per hour of service".

### style-2-2 "Rows in a drill-down are seats" contradicts the day rows - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 78; lines 116 and 391
- **Discrepancy:** Line 78 says drill-down rows are always seats. Line 116 says time figures list their days, and line 391 says "or days with their parts".
- **Recommendation:** "A money or count figure drills down to seat rows; a time figure drills down to day rows."

### style-2-3 "Chair" carries three meanings and is never defined - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 13, 179, 186, 221-223, 265, 357, 359 (the barber record); 46, 518 (a physical chair); 80 ("Chair time")
- **Discrepancy:** "His account is linked to his chair", "a barber grant without a chair" and "a chair picker" refer to the barber record. "Which chairs ... are underused" and "a 2-6 chair shop" refer to the physical station. "Chair time" adds a third sense.
- **Recommendation:** Add a Terms entry: "**Chair**: a barber's record (`barbers/{id}`); an account links to one chair". Alternatively, write "barber record" wherever the link is meant.

### style-2-4 "Left out and counted" reads as a contradiction - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 308
- **Discrepancy:** "A visit whose bill `BillingSystem` cannot evaluate is left out and counted".
- **Recommendation:** "... is excluded from takings; the number of excluded visits is shown beside the figure ("2 visits not counted")."

### style-2-5 "Emptiest day" is used as a figure but never defined - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 127, 306
- **Discrepancy:** The doc gives no measure and no tie rule.
- **Recommendation:** Line 306: "plus the day with the most open minutes (ties go to the earliest day)".

### style-2-6 G6's states claim has no acceptance criterion and does not match the States list - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 120-121; 393-394
- **Discrepancy:** G6 says "First-month and empty states are designed", but the States list has no empty state, such as a period with zero seats or no rostered time. Related: `structural-2-1` (the missing error states).
- **Recommendation:** Line 121: "First-month (CUJ 5) and empty-period states are specified under [The screen](#the-screen)". Add an "empty period" entry at line 393.

### style-2-7 The small-sample motivation is unquantified and does not support the base-20 gate - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 66-67
- **Discrepancy:** The doc says "Over a week a rate such as the no-show share moves a lot on one or two visits". At the stated 8-15 visits a day, a week holds about 40-75 visits, so one visit moves a rate by only 1.3-2.5 points, and the base already exceeds the gate of 20. "Moves a lot" cannot be checked.
- **Recommendation:** "A rate on fewer than 20 visits moves at least 5 points per visit. This happens for a new barber, a weekly rebooking base, or one service's seats."

---

## Nit

### design-2-7 Blocking does not clear the link today, and clearing it on a temporary block would be wrong - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 358
- **Discrepancy:** The doc says "Blocking an account and erasing it clear the link too". No ecs-core code writes a block (`AccountLifecycle.block` appears only in fixtures and in `client-erasure.system.ts:235`). Temporary blocks expire without a write (`account-status.data.ts:88-104`). A barber blocked for a week would return unlinked and land in CUJ 6.
- **Recommendation:** Drop "blocking"; the stored `accountStatus` check (lines 274-276) already shuts a blocked account out. Clear the link on erasure only, and name the erasure pipeline that does it.

### design-2-8 The localStorage cache has no size cap or eviction and stores client names - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 397-398, 552-554
- **Discrepancy:** "One entry per scope" contradicts a cache key that includes `<period>`. A barber-month holds about 300 seat rows, and an admin browsing 12 months across 10 or more scopes nears the 5 MB quota, where `setItem` throws `QuotaExceededError`. Client names sit unencrypted on shared devices. Related: `structural-2-2`.
- **Recommendation:**
  - Change the wording to "one entry per scope and period".
  - Cap the cache at the most recent N entries, evicting the oldest first.
  - Catch quota errors.
  - Note the client data at rest under Security & Privacy.

### design-2-9 When a break and a block overlap, analytics and the schedule disagree - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 287-288 (and 307)
- **Discrepancy:** The partition ranks Break before Blocked. The schedule draws breaks minus blocks (`roster.system.ts:595-607`, `buildDayBreaks` subtracts `carveOutsOn`), so on the schedule the block wins. The overlap also shifts the fill denominator.
- **Recommendation:** Order Blocked before Break, or state the difference on purpose.

### design-2-10 The running-month comparison can compare spans of different lengths - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 316-319
- **Discrepancy:** On 31 March, days 1..31 are compared with February's 28 days, and "today's counterpart" (February 31) does not exist.
- **Recommendation:** Define what happens when the counterpart is missing (clip to the shorter month, or compare daily averages), and add an example.

### design-2-11 The shop-scope money drill-down crosses two snapshots, so G4 does not hold - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 115-116, 236, 390-392
- **Discrepancy:** A shop figure drills down to the per-barber split, and from there to a second call taken at a different moment. That is the mismatch Alternative M (lines 536-541) rejects.
- **Recommendation:** State that the split is the evidence for a shop figure and that a barber's report may have moved since. Alternatively, carry the per-barber seat rows inside the shop report when they fit the size limit.

### design-2-12 The staging helpers the screen reuses are private to the dashboard library - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 399-401
- **Discrepancy:** `SHEET_STAGED` and `climbStages` live in `libs/features/staff/dashboard/src/lib/staged-render.ts:20,32`. The library barrel exports only `staff-dashboard` (`index.ts:1`).
- **Recommendation:** Name the shared UI or feature-utility library they move to, so that `libs/features/staff/analytics` does not import a sibling feature's internals.

### design-2-13 Alternative I is costed for one barber only; the shop scope needs about 300 `in` queries per open - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 370-371, 508-513
- **Discrepancy:** About 4,000 worked visits ÷ 30 per `in` query is about 150 queries; doubled for the comparison span, that is about 300 queries per shop open, inside a 4 s p95. The rejection reason cites only "≤ 20 small queries per barber-month".
- **Recommendation:** Cost the shop case. Consider a single range query over follow-ups (`bookedFromAppointmentId != null`, `bookedAtUtcMs` within [period start, period end + 24 h], with a declared composite index) joined in memory.

### design-2-14 An owner who is both admin and barber cannot link their own account - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 267-268, 354-361
- **Discrepancy:** `role-assignment.system.ts:132-134` refuses `target === caller` (`GOVERNANCE_ROLES_SELF`), while `roles.data.ts:5-6` notes that owners commonly hold both roles. CUJ 6's "ask the owner" makes no sense for the owner.
- **Recommendation:** State that an admin-barber needs no link, because they see everything as admin, and that the barber-grant rule does not apply to them. Related: `structural-2-9`.

### design-2-15 Adding `StaffLink` to `User` touches every user writer, and the doc lists none - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 353
- **Discrepancy:** `User` is written "with EVERY key present" (`user.entity.ts:58-64`), and optional properties are banned.
- **Recommendation:** List the writers that must now write `linkedBarberId: null`: `RegistrationSystem.provision`, `register`, and the erasure's pseudonymised body. State how existing documents are read: backfill them, or read a missing field as `null` at the adapter.

### structural-2-4 Code spans broken across lines leave column-0 continuation lines - Severity: Nit

- **Reviewer Lens:** `egm-structural` (also `egm-style` N9)
- **Affected Scope:** lines 89-91, 339-340, 382-383
- **Discrepancy:** Lines 90, 340 and 383 start at column 0 inside indented list items and split an inline code span across the line break. Some renderers and linters end the list item there.
- **Recommendation:** Keep each code span on one line, or indent the continuation lines two spaces.

### structural-2-5 The Rebooked cell mixes rationale into the definition and sets an unreadable table width - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** line 311 (duplicated at 438 and 505-506)
- **Discrepancy:** The "why 24 h" rationale and the «Запиши пак» limitation sit inside the definition cell, which is about 600 characters wide, and both repeat Alternative H and the Risks table.
- **Recommendation:** Trim the cell to formula, base, includes and excludes. Leave the rationale to Alternative H and the limitation to the Risks table. Line 311 also changes under `design-2-2` and `design-2-3`.

### structural-2-6 Normative content sits under bold run-in labels rather than headings - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 25, 129, 284, 316
- **Discrepancy:** "How success is measured", "Time: one partition ..." and "Comparison span" cannot be linked to and do not show in the outline.
- **Recommendation:** Promote "How success is measured" to an H3 under Goals, and "Time partition" and "Comparison span" to H4s under the catalogue.

### structural-2-7 The release staging appears three times, and the copies diverge - Severity: Nit

- **Reviewer Lens:** `egm-structural` (also `egm-style` N4)
- **Affected Scope:** lines 32-34, 151-153, 576-583
- **Discrepancy:** The three copies disagree:
  - The Overview's v1.1 says "a receptionist view", while Future Improvements says "the receptionist's forward open-time card".
  - The Overview's v2 lists earnings only, while lines 153 and 583 add CSV export and sealing closed periods.
  - The Overview uses "shop reference", "first-visit return" and "overdue regulars", which are defined only at line 576.
- **Recommendation:** Keep the full list only in Future Improvements. In Non-Goals write "Deferred: see Future Improvements". Make the Overview a one-line pointer that uses the same terms.

### structural-2-8 The NFR performance entry is only a pointer, and NFR sits apart from the architecture - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 550-559 (555)
- **Discrepancy:** The entry reads "Performance & Latency: see G7 and the Risks table".
- **Recommendation:** State the budgets here (16.7 ms frame, p95 1.5 s / 4 s, 512 MiB), or drop the entry. Consider moving NFR next to Risks.

### structural-2-9 The Visibility table has no precedence for multi-role accounts and no rows for blocked or out-of-scope requests - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 263-269, 275-276, 413-415
- **Discrepancy:** Roles are sets (`roles.data.ts:5-7`), so a barber+receptionist account matches row 1 (own chair) and row 5 (FORBIDDEN). The table also has:
  - no row or error code for a blocked `accountStatus`;
  - no row for a linked barber who asks for another barber's chair (is that FORBIDDEN or SCOPE_UNKNOWN?).
- **Recommendation:** Add the sentence "rows are read top-down; the first row whose role the caller holds applies". Add a "blocked or erased account" row and a "barber asking for another chair" row, each with its error code. Related: `design-2-14`.

### structural-2-10 The client-spend function is misnamed, and the current discount split is mis-described - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 70, 333-335
- **Discrepancy:**
  - `moneyOf` is a module-private function (`client-stats.system.ts:787`), not `ClientStatsSystem.moneyOf`.
  - Line 70 says there is "no per-seat split", but the code already splits pro rata per visit (`:804-805`). What is missing is an exact largest-remainder split.
- **Recommendation:** Write "the private `moneyOf` in client-stats.system.ts". Reword line 70: "the client card rounds a pro-rata share per visit; there is no exact per-seat split, so per-barber totals would not add up to the bill".

### structural-2-11 The rebooking formula does not handle a null `bookedAtUtcMs` - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** line 311
- **Discrepancy:** `appointment.entity.ts:91-99` types `bookedAtUtcMs` as `UtcEpochMs | null`. Late cancellations inherit a rule that a null stamp is never late (`client-stats.system.ts:723-726`); rebooking states no rule for null.
- **Recommendation:** Add "an F with no booking stamp is not counted" to the exclusions.

### structural-2-12 Alternative E's revisit trigger depends on this very spec - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 481-482
- **Discrepancy:** Alternative E says to revisit "when the roster rule's TODO (`firestore.rules:63`) is narrowed". But rules lines 63-70 narrow it "the moment `Barber ↔ User` lands", which is the link this spec adds (line 353). Each waits on the other, and the doc never says whether `mayEditRoster` is narrowed in v1.
- **Recommendation:** Add the Non-Goal "`mayEditRoster` stays `worksTheBook()` in v1; narrowing it needs a rules `get()` on users or a claim (Alternative E)", and point Alternative E's trigger at it.

### structural-2-13 Two decisions have no rationale or rejected alternative - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 164, 167
- **Discrepancy:** "Vouchers → a payment, not a discount" and "Multi-location barbers → one combined view" are stated without a reason. The standard's Alternatives Rule asks for specific, documented reasons.
- **Recommendation:** Add a short Alternative for each (vouchers as a discount; per-location views), or give a one-line reason inline.

### structural-2-14 The Status line uses undefined process jargon - Severity: Nit

- **Reviewer Lens:** `egm-structural` (also `egm-style` N1)
- **Affected Scope:** line 4
- **Discrepancy:** "In Review (Stage 7 fixes applied 2026-11-07)": the doc never defines "Stage 7".
- **Recommendation:** "In Review (review fixes applied 2026-11-07; see [review/](...))".

### style-2-8 "Free minutes" is not a catalogue figure - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 21-22
- **Discrepancy:** "The free minutes agree with the schedule's day summary".
- **Recommendation:** "Unsold plus open minutes for a barber-day equal the schedule's day-summary free minutes."

### style-2-9 "From the device" and "at once" are vague - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 29-30
- **Discrepancy:** "shows the last report from the device at once".
- **Recommendation:** "The screen first shows the report cached on the device, then replaces it when the callable answers."

### style-2-10 The problem framing is informal and unmeasurable - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 38, 49
- **Discrepancy:** The heading "cannot see how it is going" and the phrase "set by feel ... goes unnoticed until the month is over".
- **Recommendation:** Heading: "Staff have no figures for takings, time use or rebooking". Line 49: "... set without measured figures; unsold time is visible only day by day in the schedule".

### style-2-11 An absolute claim beyond the research scope - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 61
- **Discrepancy:** "Only theCut, a barber-only app, puts ...".
- **Recommendation:** "Of the products surveyed, only theCut ...".

### style-2-12 "Simple" in a heading is vague - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 64
- **Discrepancy:** "Why a simple dashboard is not enough".
- **Recommendation:** "Why totals alone are not enough".

### style-2-13 "Folded" is undefined jargon - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 76, and lines 25-29, 280, 336, 377, 448, 570, 577
- **Discrepancy:** "Every figure is folded on each appointment's own shop date".
- **Recommendation:** Add the Terms entry "**Fold**: aggregate records into totals in one pass". Line 76: "Every figure groups appointments by their own shop date (`localDate`)."

### style-2-14 "Today" is ambiguous - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 103, 277
- **Discrepancy:** "can read every appointment today" can be read as "only today's appointments".
- **Recommendation:** "can currently read every appointment"; "as they are now".

### style-2-15 Goal names are subjective - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 120, 122
- **Discrepancy:** "Honest about small numbers." and "No lag."
- **Recommendation:** "G6: Rates gated on sample size"; "G7: First frame within one frame budget".

### style-2-16 The success measures leave terms implicit - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 131, 135
- **Discrepancy:** "From week 4" (of what?) and "(visits get closed)" ("closed" is undefined).
- **Recommendation:** "From the fourth week after launch"; "(seats are marked worked or no-show)".

### style-2-17 The non-goal heading is hard to parse - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 148
- **Discrepancy:** "**One free-time number for `capacity`.**"
- **Recommendation:** "**Merging Analytics' open time with the `capacity` figure.**"

### style-2-18 "Age" is the wrong word for a clock time - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 182, 239, 393
- **Discrepancy:** "with its age ("as of 09:12")": the example shows a time of day, not an age.
- **Recommendation:** "with the time it was computed ("as of 09:12")".

### style-2-19 "Hero" is undefined UI jargon - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 183, 386, 399, 540
- **Recommendation:** Define it once ("the hero: the top block with takings, the change chip and tips"), or write "the top figure".

### style-2-20 "Normally" is vague - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 215
- **Discrepancy:** "Takings, tips and the time breakdown show normally".
- **Recommendation:** "show as for any barber".

### style-2-21 A convoluted sentence about `Roles.MONEY` - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 273-274
- **Discrepancy:** "Seeing billed takings is not `Roles.MONEY`, which is about spending the shop's money".
- **Recommendation:** "`Roles.MONEY` does not apply: it gates spending the shop's money (discounts, vouchers), not reading takings."

### style-2-22 "The part from now" is ambiguous - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 295, 306
- **Recommendation:** "the part at or after the current minute".

### style-2-23 "Random days" is imprecise - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 298, 344
- **Discrepancy:** "A spec proves it for random days."
- **Recommendation:** "A property-based spec checks it over generated days."

### style-2-24 A sentence fragment - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 358
- **Discrepancy:** "The same transaction and single audit row as today."
- **Recommendation:** "The link is written in the same transaction, with the same single audit row, as today's `setRoles`." The substance of this sentence is wrong too; see `design-2-4`.

### style-2-25 Vague and rhetorical phrasing in Observability - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 421, 425
- **Discrepancy:** "a digest of the report's totals" (a hash or a list?) and "they are the evidence".
- **Recommendation:** "a hash of the report's totals", or name the fields; "A questioned figure is checked by opening its rows, which sum to it."

### style-2-26 Vague mitigations in the Risks table - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 433, 435
- **Discrepancy:** "above budget the shop view drills per barber" and "re-checked at each new tenant size".
- **Recommendation:** "if the shop view exceeds budget, it loads per-barber reports on demand"; "re-measured when a tenant exceeds 10 barbers".

### style-2-27 Alternative A's figures disagree with the Reads table, and Law 5 is misstated - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 446-452
- **Discrepancy:** The text gives "~400 ... ~4,000 reads per write", but lines 370-371 give ~300 and ~4,500. The test in Law 5 is whether a privacy boundary, a read fan-out or a conflict set requires the stored value; cost alone is not the test. "Far more reads" also hides numbers the same paragraph gives.
- **Recommendation:** Align the figures with the table (~300 and ~4,500). Give the reason as: "it costs 30-70 times the reads of folding on demand, so no read fan-out justifies it under Law 5, and it cannot hold the clock-dependent figures."

### style-2-28 Alternative D: a money con that contradicts the rest of the doc, and an anthropomorphic verb - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 472-473
- **Discrepancy:** "the whole shop's money held in every staff browser by design" contradicts lines 144-146, which say every role that works the book can already read it. The admin's shop report is also cached in the browser (`structural-2-2`). "The device the no-lag goal protects" is anthropomorphic.
- **Recommendation:** Drop the money clause, or reword it as "every open downloads the whole period's appointments". Give the reason as "it puts the fold on the device's main thread, against G7". Resolve this together with `structural-2-2`.

### style-2-29 Alternative F's rejection reason contains a non-reason - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 489-490
- **Discrepancy:** "any money that is derived and stored later goes in a `restricted/` subdocument" is a future rule, not a reason for rejecting F.
- **Recommendation:** Move the clause to Non-Goals or NFR Security. Keep "contradicts how the shop works today" as the reason.

### style-2-30 Alternative L's example is not shown - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 533
- **Discrepancy:** "(€5 on a simple 2-seat bill)" does not show the arithmetic, and "simple" is vague.
- **Recommendation:** "(a €10 discount on two €25 seats puts €5 on each; if one seat is a no-show, all €10 lands on the other barber)".

### style-2-31 A vague dependency - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 577-578
- **Discrepancy:** "so it waits for the cost budget".
- **Recommendation:** "so it ships only after the shop fold's read cost is measured against the ~0.6M reads/month budget".
