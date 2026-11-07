# Goldfish Review Report: critic round 1

**Target:** `docs/designs/staff-analytics.md` (lines 1-543: the feature specification, from the top through the line before `## Detailed Implementation Plan` at line 544). The Detailed Implementation Plan was not reviewed.

**Date:** 2026-11-07

## Reviewer Status

| Reviewer         | Persona            | Standard                   | Status    | Raw findings                |
| ---------------- | ------------------ | -------------------------- | --------- | --------------------------- |
| `egm-design`     | `design_critic.md` | `feature-spec-standard.md` | completed | 1 Blocker, 16 Major, 9 Nit  |
| `egm-structural` | `structural.md`    | `feature-spec-standard.md` | completed | 1 Blocker, 4 Major, 6 Nit   |
| `egm-style`      | `style.md`         | persona only               | completed | 0 Blocker, 12 Major, 19 Nit |

Every reviewer completed on its first attempt, so none needed a retry.

**After deduplication: 56 findings.**

| Severity | Count |
| -------- | ----- |
| Blocker  | 2     |
| Major    | 26    |
| Nit      | 28    |

## How findings were merged

- Each finding keeps the id of the reviewer that reported it most fully (`<reviewer>-1-<n>`). The other reports are listed under "Also raised by".
- Where reviewers rated the same issue differently, the higher rating stands:
  - The missing Risks section is a **Blocker**. Design rated it Major; structural rated it Blocker. The standard requires the section, and the sibling spec's critic report rated the same gap a Blocker.
- Where a lower-rated finding was merged into a higher-rated one, the higher rating stands:
  - design N7 went into style-1-3.
  - style N4 went into design-1-9.
  - style N7 went into design-1-15.
  - design M10 went into structural-1-5.
- The synthesizer checked two claims against the files themselves:
  - **style-1-1:** `competitor-research.md:212-213` says "booked within 24 hours of the current one ending".
  - **design-1-3:** `firestore.indexes.json:926-929` sets `users.roles` to `"indexes": []`.

---

## Blockers

### design-1-1: The time-bar parts cannot sum to rostered time as defined. Severity: Blocker

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 235-247, 255-258, 281-283
- **Discrepancy:** Line 255 says `rostered = breaks + blocked + worked + no-show + not closed + booked ahead + unsold + open-today + slivers` and that a spec proves this for every fixture day. The definitions do not make these parts mutually exclusive, for four reasons.
  1. **Overlapping seats are counted twice.** Worked, no-show, not closed and booked ahead each sum the chair time of their seats. Staff may place overlapping visits on one chair (`grid-layout.system.ts:315-317`). The schedule takes the union of those intervals (`occupiedIntervals` → `IntervalSetSystem.normalize`, `grid-layout.system.ts:224-241`); the spec adds them.
  2. **Breaks and blocks are carved in the opposite order to the schedule.** Line 237 reads "Blocked time … minus breaks". `RosterSystem.buildDayBreaks` subtracts blocks from breaks instead (`roster.system.ts:600-603`). Capacity counts blocks but not breaks, so the order changes the denominator, and the "shared system" would disagree with what the schedule draws.
  3. **Seats placed over a break or block are not handled.** Staff are allowed to place them (`roster.system.ts:557`). Worked time is clipped by breaks and blocks, so a barber who works through lunch shows those minutes as break. "Takings per worked hour" (line 247) does not say whether it uses the clipped or the unclipped worked time.
  4. **"open-today" is ambiguous.** The identity uses it (line 256), but the catalogue defines "open" over 7 days (line 243).
- **Recommendation:** Define a strict precedence and build the partition from it.
  1. Start from rostered time.
  2. Carve out breaks and blocks in the same order `RosterSystem` uses.
  3. Take the union of occupied time and give each minute exactly one state, in a fixed order (for example worked > no-show > not closed > booked ahead).
  4. Everything left is a hole.

  Then say how seats over carve-outs and seats outside hours are counted, and what time base "per worked hour" divides by. Until this is done, the property test in lines 281-283 cannot pass.

### structural-1-1: There is no Risks & Mitigations section. Severity: Blocker

- **Reviewer lens:** `egm-structural`
- **Also raised by:** `egm-design` (M14, rated Major)
- **Affected scope:** the whole spec. The closest content is lines 312-326 (Reads and cost) and lines 506-521 (Non-Functional Requirements).
- **Discrepancy:** The standard requires a section that names failure modes, security implications and scalability limits, with a mitigation for each. No such heading exists, and neither "risk" nor "mitigation" appears anywhere in lines 1-543. These gaps go unaddressed:
  - **Failure states:** what the screen shows when the callable fails or the device is offline with an empty cache; a stale or corrupt cached report; an "updating" mark that never clears; a query that fails partway.
  - **Load limits:** the admin shop-month reads about 10,000 documents (lines 317, 516), but no memory, timeout or p95 budget is set. `main.ts:593-599` reserves `LARGE_MEMORY` for "handlers whose input is the size of the book". No limit is given for tenants above 10 barbers (a 30-chair tenant is about 30,000 reads per call). The 30-key cap on `in` / `array-contains-any` (lines 213-214, 320-323) is not discussed.
  - **Read count omissions:** the estimate leaves out drill-down calls (which repeat the full report reads), the next 7 days needed for open time, the first-visit-return lookups, and repeated opens "between clients". Cost stays small even at 10×, so the real risk is latency and memory, not money.
  - **Data quality:** visits never marked worked or no-show (the "not closed" share), and the rebook dependency described in design-1-9.
  - **Changes that removing the route does not undo:** the client card's spend change (lines 271-273).
  - **Security:** the visibility rule is a product rule, not a security boundary (lines 107-109).
- **Evidence:** The standard (Risks & Limits) says: "must identify potential failure modes, security implications, scalability limits, and how they will be mitigated." The sibling spec `docs/designs/staff-search-spotlight.md:374` has a `## Risks and Mitigations` table, and its critic report rated the same omission a Blocker (`docs/designs/staff-search-review/critic_report.md:31`).
- **Recommendation:** Add `## Risks and Mitigations` between the Technical Plan (ends line 391) and the Alternatives (line 393), as a Risk | Effect | Mitigation table. Cover at least:
  - callable failure and offline with an empty cache;
  - a stale or corrupt cache;
  - admin latency and memory, with the memory and timeout for both callables, a p95 target, the largest supported tenant and the plan beyond it (Alternative C);
  - the 30-key query limit;
  - the full read count, including drill-downs and the forward days;
  - the client-card spend change;
  - the visibility rule being a product rule;
  - `ANALYTICS_BARBER_NOT_LINKED`;
  - a `definitionVersion` bump;
  - the data-quality risks, and how each one shows up on screen.

---

## Major

### design-1-2: The diagram and Alternative E still read the account link from the public barber record. Severity: Major

- **Reviewer lens:** `egm-design`
- **Also raised by:** `egm-style` (M3, M4)
- **Affected scope:** lines 212-217, 446-448
- **Discrepancy:** The diagram reads "barbers (names, accountUserId)" (line 216). Lines 287-290 put the link on `users/{uid}` precisely because `barbers/*` is publicly readable (`firestore.rules:562-565`). The diagram also leaves out two reads:
  - the user read, counted in the reads table at line 316;
  - the `clientStats` read (line 252).

  It shows only `busyKeys` queries, although line 321 uses a `utcEpochMs` range query for a shop-month. Alternative E (line 448) says "the callable reads the barber document anyway", which contradicts the user-document design.

- **Recommendation:** In the diagram:
  - replace `accountUserId` with a `users/{caller}` read (`linkedBarberId`, roles);
  - add the `clientStats` read;
  - show both appointment query shapes.

  Reword line 448 as "the callable reads the caller's user document (`linkedBarberId`) anyway".

### design-1-3: The account picker needs a query the index config turns off. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 306-307
- **Discrepancy:** The «Свържи акаунт» picker lists "accounts holding the barber role", which needs `users where roles array-contains 'barber'`. `firestore.indexes.json:926-929` sets `users.roles` to `"indexes": []`, so production refuses that query. The emulator does not enforce indexes (CLAUDE.md §5), so the query would pass locally and fail once deployed.
- **Recommendation:** Either:
  - remove the field override, and say why the roles array is now queried; or
  - serve the picker from a server callable with a dedicated query.

### design-1-4: What happens to the account-to-barber link over time is undefined. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 292-310
- **Discrepancy:** Nothing clears `linkedBarberId`:
  - `setRoles` changes roles and revokes sessions, but leaves the link alone (`set-roles.pipeline.ts:143-146`);
  - neither account blocking nor `eraseClient` touches it.

  As a result:
  - a demoted or erased account keeps its link;
  - `ANALYTICS_BARBER_ALREADY_LINKED` then blocks linking the barber to a new account;
  - re-granting the barber role silently restores the old link.

- **Recommendation:** Say which callables clear or keep the link: `setRoles` removing the barber role, block, and erase. Have the uniqueness check ignore holders who are no longer active barbers. Consider a deterministic per-barber link document, which turns uniqueness into a single-document transaction instead of a query.

### design-1-5: The role gate trusts token claims, while scope is read from stored data. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 210, 300-303
- **Discrepancy:** The wire gate checks "role ∈ {barber, admin, sysadmin}" from the token, while scope comes from stored data. `setRoles` deliberately judges the caller's stored roles, "never the token's" (`set-roles.pipeline.ts:47-48`). Revoking refresh tokens does not end an ID token that has already been issued, so a just-demoted admin keeps whole-shop money access for up to an hour.
- **Recommendation:** The pipeline already reads the caller's user document. Gate on its stored `roles` and `accountStatus` as well as on the claims, as `setRoles` does.

### design-1-6: The sysadmin sees per-client money that the codebase keeps from it. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 340-342, 384-388, 508-512
- **Discrepancy:** `Roles.SPEND = [Admin]` excludes the sysadmin from client spend, as "a support role with no business in a client's spend" (`roles.data.ts:74-81`; `firestore.rules:450-457`). The visibility table gives the sysadmin drill-downs that list each visit's client and its takings, which amounts to per-client spend. The NFR does not mention this.
- **Recommendation:** Either:
  - limit money drill-downs to the admin, matching `Roles.SPEND`; or
  - record an explicit owner ruling that an analytics drill-down is not client spend.

### design-1-7: The discount split rule is ambiguous, and the "at most a cent" claim is false under one reading. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 233, 268-273
- **Discrepancy:** Today `moneyOf` takes `net = round(own × total / subtotal)` over all seats (`client-stats.system.ts:796-806`; `billing.system.ts:303-326`), so a no-show seat absorbs its share of the discount. The spec instead splits the discount "across WORKED seats".
  - **Example:** a €60 party (two €30 seats) with a €10 fixed discount and one no-show. Today the worked seat nets €25. Splitting across worked seats gives €20.
  - That is a €5 difference, not "at most a cent per visit".
  - "The bill's total for worked seats" is not a figure `BillingSystem` produces.
  - Mixed-currency or seatless bills are refused by `evaluate` and dropped by `billedHistory` (`client-stats.system.ts:987-999`). The spec does not say how such visits appear in takings, which matters for the reconciliation gate (lines 99-101).
- **Recommendation:** Pin the rule: pro-rata over all of the bill's seats with largest remainder, keeping the worked seats. Restate the client-card impact from that rule. Add a counted "excluded visits" line for bills that cannot be evaluated.

### design-1-8: The late-cancellation rule differs from the client card's. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** line 250
- **Discrepancy:** Analytics counts `cancelledBy = CLIENT` inside the window. `ClientStatsSystem` behaves differently:
  - it decides by reason first (`clientCaused`, `client-stats.system.ts:910-930`), so a staff-entered `CLIENT_CHANGED_PLANS` counts as the client's;
  - it never counts a row with `bookedAtUtcMs = null` as late;
  - it falls back to the current policy when `cancellationWindowHours` is null (`client-stats.system.ts:723-735`; `seat-outcome.data.ts:40-44`).

  The two screens will disagree, which contradicts G5.

- **Recommendation:** Define late cancellation as `ClientStatsSystem.clientCaused` plus `ClientStatsPolicy.isLateCancellation`, with the same null-stamp exclusions, and add it to the cross-screen spec.

### design-1-9: Rebooked share depends on one button, and its cancellation clause needs the conversion Alternative H rejects. Severity: Major

- **Reviewer lens:** `egm-design`
- **Also raised by:** `egm-style` (N4)
- **Affected scope:** lines 248, 475-485
- **Discrepancy:**
  - **Only one path sets the link.** The visit editor's «Запиши пак» sets `bookedFromAppointmentId` (`staff-dashboard.ts:3447-3453`), and a reschedule forces it to `null` (`reschedule-appointment.pipeline.ts:618`). A next visit booked from a free gap or from «Нов час» carries no link. The figure therefore measures use of one button, not rebooking, and the spec never states this.
  - **The cancellation clause is unclear and needs a time-zone conversion.** "Not cancelled before the visit's day ended" does not say whose cancellation or which day. It also needs the shop-day-to-instant conversion that Alternative H gives as its reason for rejecting "same shop day".
- **Recommendation:** List every booking path and whether it sets `bookedFromAppointmentId`. Then either set the field on all staff paths, or state the undercount. Rewrite the clause as a pure stamp rule, for example "not cancelled within 24 h of `bookedAtUtcMs`". Otherwise, admit the boundary conversion and revisit Alternative H.

### design-1-10: Routing the schedule's holes through `ChairTimeSystem` puts the clock in a hot path. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 262-267
- **Discrepancy:** `GridLayoutSystem` documents this as hot path #3: `holes` "takes no clock and re-runs on data change only; the minute tick reaches `sellableAt` alone" (`grid-layout.system.ts:196-198`). Making `holes` and `sellableAt` thin calls into `dayBreakdown(…, ShopNow)` re-runs the whole breakdown on every minute tick. That undoes the recent staged-sheet performance work. It also risks a Law 8 cycle if `ChairTimeSystem` imports `SHORTEST_SELLABLE_MINUTES` from `GridLayoutSystem` while `GridLayoutSystem` calls `ChairTimeSystem`.
- **Recommendation:** Split `ChairTimeSystem` into:
  - a fold with no clock (holes and parts);
  - a separate clock step (the past/future split).

  Keep the schedule's split between work done on data change and work done each minute. Move the 20-minute constant to the lowest module.

### design-1-11: Drill-down rows can't match a cached figure, and nothing guarantees they will. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 81-82, 196-198, 318, 342, 347-350
- **Discrepancy:** G4 promises "the listed rows add up to the figure shown". But the figure shown is often a cached report from an earlier read, while `staffAnalyticsRows` re-reads and re-folds live data. Staff record outcomes all day, so any outcome or tip recorded in between makes the footer differ from the hero figure. The cached report also shows no age.
- **Recommendation:** Return a `digest` or `asOfUtcMs` in both answers. Show the drill-down's own total, and when the digests differ, replace the hero figure with it. Stamp the cached report "as of HH:MM".

### design-1-12: The device cache of money figures is not tied to the signed-in user. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 347-350, 508-512
- **Discrepancy:** The cache key is `(scopeKey, periodKey, definitionVersion)`: it has no uid and is not cleared on sign-out. On a shared shop device, the admin's shop and per-barber reports stay in web storage after sign-out. The NFR promise that "a barber's report never contains another barber's figure" covers the wire, not the device.
- **Recommendation:** Add the uid to the cache key. Clear the cache on sign-out and on account switch, and state this as the posture.

### design-1-13: The third definition of "free time" (the `capacity` projection) is left in place. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 56-61, 326, 355-361
- **Discrepancy:** The Problem section names three conflicting ideas of free time, one of them "the `capacity` projection's padded minutes with no floor". Only the day summary and the client card move onto the shared systems. `capacity/{YYYY-MM}` keeps its own number, so the disagreement the spec claims to remove survives wherever capacity is shown.
- **Recommendation:** Either:
  - move the capacity rebuild onto `ChairTimeSystem`; or
  - list it in Non-Goals with the reason (padding for `/book` versus real chair time), and say on which screens its number can differ.

### design-1-14: Booking origin counts the backfill's guess as fact. Severity: Major

- **Reviewer lens:** `egm-design`
- **Affected scope:** line 251
- **Discrepancy:** `inferredPlacement` is "the backfill's reconstruction — carried through every rewrite, never promoted" (`appointment.entity.ts:54-55`). `ClientStatsSystem` leaves it out on purpose (`client-stats.system.ts:120-123`). The admin's origin split counts it the same as a stamp the commit wrote.
- **Recommendation:** Either show "inferred" as its own bucket, or count only `placement` and put the rest under "unknown".

### design-1-15: "Shop" scope is undefined, which affects queries, indexes and period boundaries. Severity: Major

- **Reviewer lens:** `egm-design`
- **Also raised by:** `egm-style` (N7: shop, tenant and location are used interchangeably)
- **Affected scope:** lines 17, 140-141, 253, 320-323
- **Discrepancy:** Line 321 calls the shop-month query "a `utcEpochMs` range query instead, already indexed". That holds only for a tenant-wide range with no other filter. If "the shop" means one location (Q6, and the admin's scope), the query becomes `locationId == X` plus a `utcEpochMs` range, which needs a composite index that is not declared. Month boundaries in `utcEpochMs` also depend on each location's time zone. Line 253 also mixes "tenant" (in "averaged over the other barbers of the tenant") with "shop reference".
- **Recommendation:** Say whether shop scope means the tenant or one location, and use that one word throughout. If it means a location, declare the `(locationId, utcEpochMs)` composite index in the same change. State how period boundaries become instants.

### structural-1-2: Open Questions lists decisions the body has already made, one of them the other way. Severity: Major

- **Reviewer lens:** `egm-structural`
- **Also raised by:** `egm-design` (M9), `egm-style` (M2)
- **Affected scope:** lines 96-97, 121-141
- **Discrepancy:** Four questions are presented as open but are settled later in the spec:

  | Question           | Asks                                                     | Settled at                                 | Decision                                 |
  | ------------------ | -------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- |
  | Q1 (lines 123-126) | Where the claim is written                               | lines 287-305                              | user-record link, "No token claim in v1" |
  | Q2 (lines 127-131) | Which rebooking definition, with a same-shop-day example | line 248 and Alternative H (lines 475-485) | 24 hours; same shop day rejected         |
  | Q3 (lines 132-134) | Vouchers                                                 | line 233                                   | counted in full                          |
  | Q5 (lines 137-139) | Usage signal                                             | lines 373-377                              | the log line                             |

  Line 96-97 still points to Open Questions for the usage event. A fresh reader cannot tell which wording is binding.

- **Recommendation:** Keep only Q4 and Q6 as open. Move Q1, Q2, Q3 and Q5 into a short `## Decisions` list, as the sibling spec has at line 78, each pointing at the section that decides it. Point lines 96-97 at Observability.

### structural-1-3: Additional Resources and Future Improvements are filed under Non-Functional Requirements. Severity: Major

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 506, 523, 534
- **Discrepancy:** `### Additional Resources` and `### Future Improvements` are H3 children of `## Non-Functional Requirements`, but neither is a non-functional requirement. In an outline, the roadmap and the reference list appear as parts of the NFRs. The section also mixes bold-label bullets with H3s.
- **Recommendation:** Make both of them `##` headings. Put Future Improvements beside Non-Goals or at the end of the spec, and Additional Resources last, before the `---` at line 542.

### structural-1-4: The Alternatives section leaves out choices the spec makes, including one that changes the brief. Severity: Major

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 196-197, 268-270, 285-290, 393-502
- **Discrepancy:** The brief put the account link on the barber record. The spec moves it to `users/{uid}` and justifies this only inline (lines 287-290); Alternative E covers only the token claim. Two more choices are stated with no rejected option recorded:
  - the largest-remainder discount split (lines 268-270);
  - a separate `staffAnalyticsRows` callable (lines 196-197).

  The Alternatives Rule fails "a single path without proving that other viable designs were considered and rejected."

- **Recommendation:** Add "Alternative K: link field on the barber record (the brief's choice)" in the Pros / Cons / Reason for Rejection format. Add short entries for the discount allocation rule and for the separate rows callable, or say why each has no viable alternative.

### structural-1-5: The metric catalogue claims to be complete, but several shown figures and terms have no entry. Severity: Major

- **Reviewer lens:** `egm-structural`
- **Also raised by:**
  - `egm-style` (M7, N11);
  - `egm-design` (B1 item 4; M10, which this finding absorbs).
- **Affected scope:** lines 72-73, 227, 235, 243, 255-258, 357-358
- **Discrepancy:** Line 227 says "Every figure the v1 screen prints is defined here", and G3 promises a catalogue entry for each figure. But:
  - _closed time_ is italicised as a term, yet appears only inside the Rostered time row (line 235);
  - _worked time outside hours_ is "a separate line" with no row (lines 257-258);
  - `open-today` (line 256) and "today's open" (line 358) are never defined;
  - line 243 does not say whether "the next 7 shop days from today" includes today.

  The day summary formula "(unsold + open + today's open)" at line 358 counts today's future holes twice. Today's `daySummary` is the plain sum of whole holes of 20 minutes or more, "sellable and elapsed alike" (`staff-dashboard.ts:1751-1759`; `grid-layout.system.ts:252-264, 407-414`), which equals unsold + open for that day.

- **Recommendation:**
  - Add rows for Closed time, Worked time outside hours and Open today, each with a definition, source fields and the "Shown as" column.
  - State whether the 7-day window includes today.
  - Define the day summary as `unsold + open` for that one day, which equals the whole holes of 20 minutes or more, and pin it in the cross-screen spec.
  - Use one term everywhere.

### style-1-1: The rebooking rule is credited to Square, but Square measures from the visit's end. Severity: Major

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 248, 483-485
- **Discrepancy:** The catalogue measures 24 hours from the visit's start (`utcEpochMs`), says it "matches Square's definition", and calls it "comparable with a published benchmark". The linked research says "booked within 24 hours of the current one ending" (`competitor-research.md:212-213`, checked by the synthesizer) and "Benchmarks are only comparable when the definition matches" (line 572).
- **Recommendation:** Either measure from the visit's end and keep the attribution, or keep the start and drop "matches Square's definition" and the benchmark claim. If a benchmark claim stays, name the benchmark.

### style-1-2: CUJ 4 promises a figure and a layout that v1 does not have. Severity: Major

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 174-177
- **Discrepancy:** Two promises in CUJ 4 don't hold in v1:
  - Seeing that "Thursdays after a given hour run under 50%" needs the weekday × hour grid, which lines 112 and 536 defer to v1.1. v1 shows fill by weekday only (line 246).
  - "Side by side" contradicts "She switches between barbers" and the single-select scope picker (line 334).
- **Recommendation:**
  - Drop "after a given hour".
  - Replace "side by side" with "for each barber in turn", or add a comparison layout to the screen section.

### style-1-3: The time bar is described three different ways, and the CUJ 1 sum cannot hold. Severity: Major

- **Reviewer lens:** `egm-style`
- **Also raised by:** `egm-design` (N7)
- **Affected scope:** lines 72-73, 152-153, 237-243, 255-256
- **Discrepancy:** The three descriptions don't match:
  - G1 and CUJ 1 list four parts: worked, no-show, blocked and unsold.
  - The catalogue also gives "Not closed" its own amber slice (line 240).
  - The identity at line 255 adds breaks, booked ahead, open-today and slivers.

  Four parts therefore cannot sum to rostered hours. "Minus closed days" (line 152) also subtracts twice, because Rostered time is already 0 on a CLOSED day (line 235; `roster.system.ts:261`). Sending the "pattern's minutes" to closed time also requires re-running the roster without the absence, which `RosterSystem` does not expose today.

- **Recommendation:** List every slice the time bar draws exactly once, in one place, and reference that list from G1 and CUJ 1. State the sum only against capacity or against the full identity. Say how the pattern minutes of a closed day are computed.

### style-1-4: The label "Not closed" collides with "closed". Severity: Major

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 240, against lines 73, 118, 235, 368 and 540
- **Discrepancy:** Everywhere else, "closed" means a CLOSED departure, closed days, closed time, or sealing closed periods. "Not closed" means visits whose outcome nobody recorded. Readers will take it to mean "not a closed day".
- **Recommendation:** Rename it "Unmarked" or "Outcome pending" throughout.

### style-1-5: "Never waits on the network" is an absolute claim, but the first open has no cache. Severity: Major

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 66-67, 90-91, 150-151, 513-518
- **Discrepancy:**
  - There is no cached report on the first open on any device, or after a `definitionVersion` bump (line 350). CUJ 5, a barber in his first week, is exactly this case, and no state is specified for it.
  - CUJ 1 promises "within a second they refresh", but the NFR sets no server latency budget, and the admin view reads about 10,000 documents.
- **Recommendation:** Limit the claim to "when a cached report exists", and specify the state the screen shows without a cache. Either set a p95 target in the NFR that matches CUJ 1, or remove "within a second".

### style-1-6: The rollback claim overstates what removing the route undoes. Severity: Major

- **Reviewer lens:** `egm-style`
- **Also raised by:** `egm-structural` (inside F1)
- **Affected scope:** lines 519-521
- **Discrepancy:** The spec says "nothing is stored, so there is no data to undo". But v1 does store data, and it changes other screens:
  - it stores `linkedBarberId` and the link audit rows (lines 297-299, 308-310);
  - it moves the day summary and the client-card spend onto the new systems (lines 357-359).

  Removing the route reverts none of this.

- **Recommendation:** Rewrite the claim: "Rollback removes the menu row and the route. The `linkedBarberId` field and the link audit rows stay and are harmless. The day-summary and client-spend changes revert separately."

### style-1-7: The success measures have no threshold, baseline or tolerance. Severity: Major

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 98-101
- **Discrepancy:** Neither measure can be checked as written:
  - "Unsold hours … trend down over three months" has no baseline, target or attribution.
  - The reconciliation gate ("within the known gaps") has no numeric tolerance, yet it decides whether earnings ship.
- **Recommendation:**
  - Give the unsold-hours measure a baseline period and a target, for example −15% against the first four weeks.
  - Give the gate a numeric tolerance, for example within 1% after the listed exclusions.

### style-1-8: The cost ratio in the Alternatives does not match its own numbers. Severity: Major

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 401-406
- **Discrepancy:**
  - 9M–170M against 0.5M is about 18 to 340 times, not "10–100 times".
  - The 9M–170M range has no derivation (how many writes per visit is not stated).
  - "Costs … the reads it saves" is muddled.
- **Recommendation:** Show the inputs (writes per month and reads per write). Restate the ratio to match, for example "18–340 times the reads of folding on demand".

---

## Nits

### design-1-16: The rebook query count is undercounted. Severity: Nit

- **Lens:** `egm-design`
- **Also raised by:** `egm-style` (N19, the "≤10" ambiguity)
- **Scope:** line 316
- **Issue:** About 300 appointments each for the period and for the comparison span need about 20 `in` queries of 30 keys, not "≤10".
- **Recommendation:** Correct the count, or say "≤10 per span", or limit rebook lookups to the current span.

### design-1-17: Open time counts holes that the schedule would not offer. Severity: Nit

- **Lens:** `egm-design`
- **Scope:** lines 91-92, 243
- **Issue:** The schedule offers a hole only when at least 20 minutes of it are still ahead (`sellable`, `grid-layout.system.ts:276-286`). The catalogue counts any future part of a 20-minute hole. At 13:20, a 13:00-13:30 hole shows 10 open minutes that the schedule cannot sell.
- **Recommendation:** Use the `sellable` rule for open time.

### design-1-18: The edges of the comparison span are undefined. Severity: Nit

- **Lens:** `egm-design`
- **Scope:** lines 275-276
- **Issue:** The spec does not say how day 31 compares against a 28-day month, how today's partial day is compared, or which day a week starts on.
- **Recommendation:** Define each of these cases.

### design-1-19: The usage measure needs plumbing that does not exist yet. Severity: Nit

- **Lens:** `egm-design`
- **Scope:** lines 96-97, 373-377
- **Issue:** Today the edge's `callable.completed` trace offers only `noteInputDigest` (`main.ts:526-531`), so adding report fields needs a new trace API. Weekly usage over four weeks also needs a log-based metric or sink, because default log retention is short.
- **Recommendation:** Name the trace API addition and the metric or sink.

### design-1-20: Alternative E's rejection reason is overstated. Severity: Nit

- **Lens:** `egm-design`
- **Scope:** lines 446-451
- **Issue:** `setRoles` already handles stale claims by revoking sessions, so "stale by design" overstates the problem. Rules can also read the link through `get(/users/$(uid))` without a claim.
- **Recommendation:** Tighten the reason for rejection.

### design-1-21: The client-spend change needs a recompute of the stored projection. Severity: Nit

- **Lens:** `egm-design`
- **Scope:** lines 271-273
- **Issue:** `clientStats/{id}/restricted/money` is a stored projection. Without a version bump and a recompute or backfill, the client card keeps its old totals.
- **Recommendation:** State the bump and the backfill.

### design-1-22: First-visit return and the rows endpoint leave gaps. Severity: Nit

- **Lens:** `egm-design`
- **Scope:** lines 23, 252, 386
- **Issue:**
  - Reading the trigger-built `clientStats` projection goes against "nothing is counted up incrementally" (line 23).
  - For "this month" the figure stays empty until 60 days have passed, and no screen state is designed for that.
  - The visibility table does not say that `staffAnalyticsRows` must refuse the shop-reference figure to a barber.
- **Recommendation:** Address each of the three points: state the exception to line 23, design the empty state, and add the refusal to the visibility table.

### structural-1-6: Bold lead-ins act as headings, and the solution summary sits under The Problem. Severity: Nit

- **Lens:** `egm-structural`
- **Scope:** lines 31, 44, 54, 62-67, 94
- **Issue:** The bold lead-ins never appear in an outline. "The proposed solution" (lines 62-67) sits under The Problem and repeats the Overview.
- **Recommendation:**
  - Make "How success is measured" an `### Success Metrics` under Goals.
  - Move the solution summary into Overview or the Technical Plan.

### structural-1-7: The diagram's arrows do not trace the call. Severity: Nit

- **Lens:** `egm-structural`
- **Scope:** lines 202-223
- **Issue:** The "2. call" arrow lands at column 77, so `callableClient` has no outgoing edge. The return `──► screen` has no path back to the screen box.
- **Recommendation:** Draw one vertical path: screen → callableClient → onCall → pipeline → report → screen.

### structural-1-8: Some internal references are not links. Severity: Nit

- **Lens:** `egm-structural`
- **Scope:** lines 58, 119, 414, 467-471
- **Issue:** "The earlier statistics design" (lines 58, 414, including §4.3) and D16(b) are named in plain text.
- **Recommendation:** Link `../design-research/availability-and-statistics-design.md` inline, with the anchor. Link D16(b) to §9 of `docs/architecture/ecs-migration.md`.

### structural-1-9: The same figures go by different names. Severity: Nit

- **Lens:** `egm-structural`
- **Also raised by:** `egm-style` (N8)
- **Scope:** lines 74, 176, 184, 247, 248, 337, 338
- **Issue:** The rebooking figure appears as "rebooking share", "Rebooked share" and "rebooked". Takings per hour appears as "takings per worked hour" and "per hour".
- **Recommendation:** Use the catalogue's name everywhere.

### structural-1-10: The visibility rules are stated three times, with the table last. Severity: Nit

- **Lens:** `egm-structural`
- **Scope:** lines 107-111, 300-303, 382-391, 508-512
- **Issue:** The rules appear as prose, then as a table, then again in the NFR. The table, which is the authoritative form, comes last.
- **Recommendation:** Move the table to "Which barber the caller is" (line 285) and have the NFR point to it.

### structural-1-11: Horizontal rules and resource links are inconsistent. Severity: Nit

- **Lens:** `egm-structural`
- **Scope:** lines 8, 504, 523-532, 542
- **Issue:**
  - The `---` at line 504 cuts the NFR off for no structural reason.
  - Additional Resources leaves out `hypothesis.md` and the `review/` reports.
  - The Alternatives' openings are uneven: some start with a context sentence, others go straight to Pros.
- **Recommendation:** Delete line 504, and keep rules only between the metadata, the spec and the plan. Add the missing resources.

### style-1-9: The competitor claim is overgeneralised. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** line 48
- **Issue:** The text says "In every product, trust breaks…", but the source cites only Square and Booksy.
- **Recommendation:** Name the two products.

### style-1-10: Law 5 is paraphrased inaccurately. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** line 406
- **Issue:** The text says the law allows a stored derived value "only when it reduces reads". Law 5 names three triggers: a privacy boundary, a busy screen's read fan-out, and a transaction's conflict set.
- **Recommendation:** Quote the law, or name the trigger that applies.

### style-1-11: The Alternative H example does not show the edge case. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 481-482
- **Issue:** 19:55, 20:05 and 19:50 all fall on the same shop day, so the example shows no difference.
- **Recommendation:** Use a pair that crosses midnight or closing time.

### style-1-12: Alternative J's motives are unsupported. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 498-500
- **Issue:** "Sells well", "causes friction" and "fifty reports" have no source.
- **Recommendation:** Cite the research, or reword in factual terms.

### style-1-13: Visit, appointment and seat are mixed as units. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 54, 86, 147-185, 229, 314, 402
- **Issue:**
  - "Visit" is never defined.
  - The reads table assumes "15 seats/day", while line 402 says "15 visits".
  - The rate gates count different units: visits, seats and appointments.
- **Recommendation:** Define "visit" beside "seat", and use one unit per figure.

### style-1-14: "By-category rows" should read "by-service rows". Severity: Nit

- **Lens:** `egm-style`
- **Scope:** line 247
- **Issue:** The rows group by `serviceId`, not by category.
- **Recommendation:** Write "by-service rows".

### style-1-15: The shop reference's "same figure" is unspecified. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** line 253
- **Issue:** The row does not say which figures get a shop reference. Line 335 implies takings only.
- **Recommendation:** List the figures.

### style-1-16: A UI string mixes Bulgarian and English. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** line 158
- **Issue:** "6 ч 30 мин open in the next 7 days…" mixes the two languages.
- **Recommendation:** Give the Bulgarian copy, or mark the line as a paraphrase.

### style-1-17: Some phrases are subjective or vague. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 31, 41, 55, 86, 88, 349, 400, 411, 449, 463
- **Issue:** Examples: "set by feel", "move a lot", "designed, not blank", "quiet 'updating' mark", "trivial reads".
- **Recommendation:** Replace each with the measurable fact, for example "one visit moves the rate 2.5 points".

### style-1-18: Some jargon is undefined. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 85, 195, 248, 289, 391
- **Issue:** "pins", "fold", "works the book" and "Law 7 T2" are used without definition.
- **Recommendation:**
  - Define "fold" and "works the book" once.
  - Write "asserts" instead of "pins".
  - Cite flatten-spec §2.3 T2 instead of "Law 7 T2".

### style-1-19: "Agrees to the cent … anywhere else" overclaims. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 20-22
- **Issue:** Most figures, such as fill and booking origin, appear nowhere else in the app.
- **Recommendation:** Name the figures that do agree (takings, tips, free minutes) and the screens they agree with.

### style-1-20: "Three ideas of free time" counts a document as app state. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 56-58
- **Issue:** The third idea is an earlier design proposal, not something the app holds.
- **Recommendation:** Write "two in code and a third in the earlier design".

### style-1-21: The fill formula has a term that is always zero, and CUJ 4 words fill differently. Severity: Nit

- **Lens:** `egm-style`
- **Also raised by:** `egm-design` (N2)
- **Scope:** lines 174-177, 246
- **Issue:** Open time is future-only, so "capacity − open" over past time is just capacity. CUJ 4 calls fill "the share of rostered time worked", but the formula includes no-show and not-closed time.
- **Recommendation:** Write "(worked + no-show + unmarked) / capacity, over past time", and match CUJ 4 to it.

### style-1-22: The cache sentence repeats the key. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 347-350
- **Issue:** The key already includes `definitionVersion`, so "older than the current definition version is ignored" restates it.
- **Recommendation:** Merge the two: "keyed by definition version, so a version change discards it".

### style-1-23: Small wording slips. Severity: Nit

- **Lens:** `egm-style`
- **Scope:** lines 191, 339, 528
- **Issue:**
  - Line 339: "a «i»" should be "an «i»".
  - Line 528: "this draft" conflicts with "Status: Proposed".
  - Line 191: "for the admin" omits the sysadmin.
- **Recommendation:** Fix each slip.
