# Goldfish Review Report: Implementation Readiness, Round 1

**Target:** `docs/designs/staff-analytics.md` (`## Detailed Implementation Plan`, lines 706-970). The specification in lines 1-705 is the source of truth.

**Date:** 2026-11-07

## Reviewer Status

| Reviewer                       | Persona                       | Standard                               | Status    | Raw findings                |
| ------------------------------ | ----------------------------- | -------------------------------------- | --------- | --------------------------- |
| `egm-implementation-readiness` | `implementation_readiness.md` | `implementation-readiness-standard.md` | completed | 4 Blocker, 13 Major, 8 Nit  |
| `egm-codebase-details`         | `codebase_details.md`         | `implementation-readiness-standard.md` | completed | 2 Blocker, 20 Major, 10 Nit |
| `egm-style`                    | `style.md`                    | (persona only)                         | completed | 0 Blocker, 21 Major, 18 Nit |

Each reviewer ran once, in a fresh context. None needed a retry.

**After deduplication:** 6 Blocker, 26 Major, 11 Nit (43 findings).

**How the list was merged:**

- Overlapping findings are merged under one id. The id belongs to the reviewer who gave the fullest account. "Also raised by" lists the other reviewers' raw ids.
- When reviewers disagreed on severity, the higher one was kept and the disagreement is noted.

**Checked by the synthesizer:** three load-bearing claims, against the code on disk.

- `audit.system.ts:882`: `defect('an unchanged role set writes no row (S-L-15)')`.
- `schedule-status-filter.ts:111`: "The grid draws none: its empty space already is the free time".
- `client-erasure.system.ts:341-348`: staff accounts are refused with `PrivacyError.erasureStaffAccount()`.

**Citations the reviewers confirmed exist as cited:**

- `GridLayoutSystem.occupiedIntervals/holes/sellableAt/totalMinutes`, `SHORTEST_SELLABLE_MINUTES = 20`
- `RosterSystem.offeredWindows/offeredCarveOuts/offeredBreaks`, `IntervalSetSystem.normalize`
- `BillingSystem.subtotalOf/totalOf`, `ClientStatsSystem.clientCaused`, `ClientStatsPolicy.isLateCancellation`
- `LocalDate.startOfWeek/startOfMonth`, `Seat.chairTime`, `ZonedTimeSystem.shopNow/toLocal/startOfLocalDay`
- `Roles.SPEND/MONEY/BOOK`
- the `scheduleExceptions (barberId, localDate)` composite index, the default single-field indexes on `bookedFromAppointmentId` and `bookedAtUtcMs`, and `users.roles` with its index off
- the public read on `barbers` and the read rule on `appointments`
- `lib-visit-list`, `SHEET_STAGED`/`climbStages`, `tools/verify/bundle/budgets.json`, the i18n paths and the e2e directory

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 🔴 Blockers

### ir-1-1: The "each step is green on its own" gate cannot pass - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M12) and `egm-style` (M1).
- **Affected Scope:** Lines 708-711 (order and gate), with items 2, 4-5, 7 and 22.
- **Discrepancy Description:** Steps 1 and 3 change types whose consumers are only updated in later steps, so `typecheck` fails in between:
  - **Item 2** adds `GovernanceErrorCode` members. `GOVERNANCE_WIRE: WireTable<GovernanceErrorCode>` (`apps/functions/src/edge.ts:514`) and `EDGE_WIRE` (`:765`) are total maps, and they only change in item 33.
  - **Items 4-5** make `linkedBarberId` a required field of `User`. That breaks every `User` literal, and none of these is listed:
    - `RegistrationSystem` (item 18)
    - `libs/ecs-core/src/testing/identity.fixtures.ts`
    - `tools/seed/fixtures/users.fixtures.ts:90`
    - `apps/web/e2e/support/seed-firestore.ts`
    - `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`
    - `tools/verify/p0/verify-p0.mjs`
  - **Item 7** adds a required field to `RolesCall`. That breaks `set-roles.pipeline.ts`, `governance.wire.ts:116-142` (`decodeSetRoles`), `callables.spec.ts` and the client-card specs.
  - **Item 22** adds `Callables.StaffAnalytics` before `main.ts` exports it, which breaks `apps/functions/src/main.spec.ts` (the `ENDPOINTS` map at 288-364 and the `PIPELINES` list at 36-72).
  - **Order sentence:** "the role link" is named as a stage, but it is spread across Steps 1-6. Step 5 is missing from the sentence.
  - **Gate command:** "touched projects" contradicts `run-many`, which runs every project.
- **Rationale & Recommendation:**
  - Move each consumer into the step that changes its type: edge rows with item 2; registration, fixtures and seed bodies with items 4-5; the wire decoder and `set-roles` with item 7; the `main.ts` export and `main.spec.ts` with item 22.
  - If that is not done, state which projects stay green at each step.
  - Name Steps 1-8 in the order sentence.
  - Use `pnpm nx affected -t typecheck test lint` if "touched projects" is meant.

### ir-1-2: The analytics pipeline's port intersection is elided, and required reads have no port - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M4, M5) and `egm-style` (M10, M11).
- **Affected Scope:** Items 21 and 24 (lines 820-842).
- **Discrepancy Description:**
  - **Elided signature:** the ports are typed `AnalyticsReadPorts & …ReadPorts & ClockPorts & LogPorts`, and item 21 says only "the roster, location and policy read bundles". Law 9 requires exact named bundles.
  - **No port reads barber records:**
    - `ANALYTICS_SCOPE_UNKNOWN` ("an id that is not a barber record") needs one, and so does the shop scope's "one entry per barber record", retired records included.
    - `BarberListPorts.listBarbers` returns the ids of rostered barbers (`firestore-schedules.adapter.ts:23,95-106`; `scheduling.port.ts:344-351`).
    - `ListedCatalogPorts.loadListedCatalog` returns ACTIVE barbers only (`catalog.port.ts:64-76`).
  - **No port reads every location:** `RosterSystem.shopHoursOn` needs all locations, and so does the `ShopNow` for each location.
  - **Next 7 days not read:** item 24 omits the visits and departures for the next 7 days, which the open-hours card needs. The spec requires this read (lines 273-274 and 448).
  - **Policy:** late cancellations also need `ClientStatsPolicy.forBooking(policy)`, which the plan does not mention.
- **Rationale & Recommendation:**
  - Write the full intersection with real names, e.g. `AnalyticsReadPorts & ShopDayReadPorts & PolicyReadPorts & <BarberRecordReadPorts> & <LocationListPorts> & ClockPorts & LogPorts`.
  - Declare the new `LoadBarber`/`ListBarberRecords`/`ListLocations` function types in `analytics.port.ts`.
  - State whether retired records appear in the shop scope.
  - Add the next-7-days reads, and the roster, location and policy reads, as numbered sub-steps of item 24.

### ir-1-3: The `setRoles` link semantics cannot be executed as written - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M9, M13) and `egm-style` (M13, M16).
- **Affected Scope:** Items 7, 16, 17, 25, 31 and 44 (lines 740, 805-811, 843-847, 861, 911-914).
- **Discrepancy Description:**
  - **A link-only change throws a defect:**
    - `AuditSystem.planRolesChanged` throws when `!rolesChanged` (`audit.system.ts:881-883`, confirmed).
    - `set-roles.pipeline.ts:136-137` writes nothing when the roles are unchanged.
    - `RolesCall.Changed.rolesChanged: false` means "nothing was written" (`roles-call.data.ts:57`), so the answer cannot report a link-only commit.
  - **Revoke rule conflict:**
    - The pipeline revokes sessions after every admitted call, unchanged ones included, so that a retry can finish a failed revoke (`set-roles.pipeline.ts:51-53,178`).
    - The plan says a link-only change does not revoke, but never reconciles the two rules.
    - The card's `RoleAssignmentSystem.saveOf` returns false unless `rolesChanged || revokePending` (`role-assignment.system.ts:195-197`), so the card cannot save a link-only change. Item 16 changes only `decide`.
  - **Undefined edge cases:**
    - The barber role kept with a `null` link.
    - A link sent without the barber role.
    - `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED` declared with "context: barberId", although no barber id exists when the link is missing.
  - **Wire:**
    - `RolesCall` has no guard; decoding lives in `apps/functions/src/wire/governance.wire.ts:116` (`decodeSetRoles`).
    - Absent and `null` mean different things on the wire. An older web client that omits the field would unlink on every role edit.
  - **Transaction reads (item 25):**
    - It does not say whether `barbers/{id}` is read to check that the record exists.
    - A relink must release the old record's lock and take the new one. Item 25 names one lock only.
    - Item 16 says `decide` takes "the barber record's lock", while item 25 "passes the link".
  - **Ambiguous test case (item 31):** "linking … twice to one barber record" can be read two ways.
- **Rationale & Recommendation:**
  - Add a decision table covering every (role delta, link delta) pair. For each, state whether it commits, which audit action and row it writes, whether it revokes, and the answer fields (`RolesCall.Changed` gains the link and a `linkChanged` flag).
  - Name the edits to `changeOf`/`saveOf`, `planRolesChanged`, `RolesCall.Changed`/`decodeChanged` and `decodeSetRoles`.
  - Item 25 reads the existence of `barbers/{id}`, the old lock and the new lock, and deletes the old one.
  - Define absent versus `null` on the wire.
  - Reword the item 31 test case as "a second account linking to a record already linked is refused with `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED`".

### ir-1-4: Clearing the link on erasure names the wrong pipeline, and the path can never run - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M11), who rated it Major; the higher severity is kept because the item points at a file with no write path.
- **Affected Scope:** Items 19 and 26 (lines 814-815, 848-849). Spec line 434.
- **Discrepancy Description:**
  - **Wrong file:** `complete-client-erasure.pipeline.ts` is the browser loop that calls `ports.eraseClient` repeatedly (lines 31-45) and has no write path. The `users/{uid}` erasure writes are planned by `ClientErasureSystem.stampWrites` (`client-erasure.system.ts:493-534`) and committed in `erase-client.pipeline.ts:500`.
  - **Unreachable:** `ClientErasureSystem.refusalOf` refuses every staff account (`client-erasure.system.ts:341-348`, confirmed; `:483` "its roles stay — a staff account is refused before"). A linked account always holds the barber role, so erasure never reaches it.
- **Rationale & Recommendation:** Decide one of two options and write it into the plan.
  - (a) Drop items 19 and 26. Record the invariant that a link is cleared only by removing the barber role, which erasure already requires, and back it with a spec.
  - (b) Keep a defence-in-depth clear in `stampWrites` and `erase-client.pipeline.ts`: `linkedBarberId: null` plus a `WriteOp.delete` of the lock, with the old link read inside the stamp transaction.

### cd-1-1: The analytics adapter bypasses the read-time guard for appointments and the query-limit lint - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (M3).
- **Affected Scope:** Items 28-29 (lines 854-857). Spec line 456.
- **Discrepancy Description:**
  - **Unguarded reads:**
    - `apps/functions/src/adapters/firestore-ports.ts:64-73,129-142` says `firestorePorts` is the only production construction site for adapters that read `appointments`. Each such adapter is given `StoredDocumentSystem.guardOf` and `telemetry.log` (e.g. `:136`).
    - `firestoreAnalyticsPorts(db)` takes neither, so malformed visits would reach the systems unrefused and unlogged.
    - The pattern to follow is `admitStored` (`firestore-privacy.adapter.ts:153-163`) and `BarberDayRead.unreadableCount`.
  - **Lint:** the busyKeys, follow-up `in`-chunk and `bookedAtUtcMs` range queries have no limit and no `// unbounded-ok:` reason, so they fail `creativo/query-needs-limit` (`.claude/rules/firestore-layout.md`). The shop range returns about 2,000 documents.
  - **Follow-up filter:** "filtered to follow-ups" does not say where the filter runs. An in-memory filter needs no index. A `where(bookedFromAppointmentId != null)` would need a composite index, which contradicts item 36's "no change".
  - **Wiring:** `AnalyticsReadPorts` must also join the `FirestorePorts` type and `firestore-ports.spec.ts`. Neither is listed.
- **Rationale & Recommendation:**
  - Make the signature `firestoreAnalyticsPorts(db, guardOf, log)`, wired inside `firestorePorts`.
  - State whether a refused document fails the report or is counted as excluded.
  - Give each query a limit or an unbounded-ok reason.
  - State "in-memory follow-up filter; single-field range only".

### cd-1-2: `free=1` changes nothing in `view=day`, and the route inputs live in a different file - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-codebase-details` (M16), `egm-implementation-readiness` (M9) and `egm-style` (M20).
- **Affected Scope:** Item 46 (lines 919-923). The deep link in CUJ 2 (spec line 212) and G8.
- **Discrepancy Description:**
  - **Grid draws nothing:**
    - `schedule-status-filter.ts:106-114` says free time is drawn as rows in the list, and "The grid draws none" (confirmed).
    - `staff-dashboard.ts:1583-1593` applies `freeTimeShown()` only inside the `agenda` computed.
    - So `/staff/schedule?day=…&view=day&barber=ivan&free=1` opens a grid with nothing new on it.
    - The gap menu «Нов час · Блокирай време» ("New visit · Block time") that the spec promises belongs to the agenda.
  - **Wrong file:** `day`/`view`/`barber` are route-bound inputs in `staff-dashboard/staff-dashboard.ts:806-815`, which has uncommitted edits on disk. They are not in `staff-day.store.ts`.
  - **Filter state:** `ScheduleStatusFilter` is `providedIn: 'root'` and persists through `store()` (`schedule-status-filter.ts:90-154`).
  - **Param survives navigation:** `publishQuery` uses `queryParamsHandling: 'merge'` (`staff-day.store.ts:951-959`), so `free=1` stays in the URL after in-page navigation. "This page load only" has no stated rule.
  - **Terminology:** the plan says "route parameter" where the spec says `?free=1` URL (query) parameter.
- **Rationale & Recommendation:**
  - Either link to `view=agenda`, or add a separate item for drawing gaps in the grid, with its files and specs.
  - Add `free = input<string | null>(null)` in `staff-dashboard.ts`.
  - Add a `ScheduleStatusFilter` method that sets `freeTime` without `store(FREE_TIME_KEY, …)`.
  - State when `free=1` is removed from the URL, and what the filter sheet's Apply does afterwards.
  - Call it a query parameter.

### 🟡 Major

### ir-1-5: ChairTimeSystem does not pin which windows feed `holes()`, so G5 agreement can fail - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M1).
- **Affected Scope:** Item 13 (lines 769-782).
- **Discrepancy Description:**
  - **Holes inputs:**
    - The schedule computes `GridLayoutSystem.holes(geo.rostered, occupied)` with `geo.rostered = RosterSystem.offeredWindows`, the carved windows (`staff-day.store.ts:411,1727`; `roster.system.ts:553-563`).
    - Its `occupied` includes the barberBusy blocks (`staff-day.store.ts:323-334,420`).
    - The plan defines rostered time as the uncarved union, then says holes are "unchanged". It never states which windows or which `busy` reach `holes()`.
    - Analytics does not read barberBusy.
  - **`closedDayMinutes`:** this needs the roster re-run without the CLOSED exception. The plan does not say so.
  - **`outsideHours`:** this should use `IntervalSetSystem.hull`.
- **Rationale & Recommendation:**
  - State `holes(offeredWindows, occupiedIntervals(dayVisits, barberId, []))` and justify `busy = []`.
  - Use the uncarved union only for the `rostered` total.
  - Add a spec case proving the result matches the schedule where barberBusy exists.
  - Define the `closedDayMinutes` derivation.

### cd-1-3: The plan rebuilds `RosterSystem.atWork` and `laneGeometryOf`, and its agreement spec cannot reach the schedule's path - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-style` (N1).
- **Affected Scope:** Items 13 and 48 (lines 769-782, 931-934).
- **Discrepancy Description:**
  - **`atWork` exists:** `RosterSystem.atWork` (`roster.system.ts:447-474`) already returns `normalize(rostered ∪ blocks ∪ breaks)`.
  - **`laneGeometryOf` exists:** `laneGeometryOf` (`staff-day.store.ts:395-423`) is the schedule's single composition of the offered windows, carve-outs, breaks and hours.
  - **Agreement spec cannot test the real path:**
    - An agreement spec in ecs-core cannot import feature code, so it would compare GridLayoutSystem against itself.
    - The schedule sums gap rows from `lane.entries` (`staff-dashboard.ts:1746-1762`), not raw `sellableAt`.
    - Unsold minutes include past parts of holes, so "over `sellableAt`" misstates the equation.
- **Rationale & Recommendation:**
  - Use `RosterSystem.atWork`.
  - Lift `laneGeometryOf` into an ecs-core system that both the dashboard and ChairTimeSystem call. Otherwise, put the agreement spec in `libs/features/staff/dashboard`, where `laneGeometryOf` is exported for its spec.
  - Word the equation as "the gap rows the day summary draws (holes ≥ 20 min)".

### ir-1-6: The systems take one `now`, but `ShopNow` exists per location - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M5), `egm-style` (M4, N13) and `egm-implementation-readiness` (N6).
- **Affected Scope:** Items 8, 13, 15 and 24 (lines 745-746, 770, 795, 836-837).
- **Discrepancy Description:**
  - **One `now` everywhere:** `report(input, now)`, `dayBreakdown(…ShopNow)`, `weekOf/monthOf`, `comparedDays(period, now)` and `isWithinReach(period, now)` each take one `now`. Item 24 derives a `ShopNow` per location.
  - **Location not stated** for:
    - a barber-day with windows at two locations
    - the period's "today"
    - the hero's current minute
    - converting a follow-up's `bookedAtUtcMs` (the follow-up's own `locationId`, or the original visit's?)
  - **Seat instant:** it is unstated which instant `isLateCancellation` uses, the seat's start or the appointment's `utcEpochMs`.
  - **Range bounds:** it is unstated how the shop-scope `bookedAtUtcMs` range bounds are derived. `SearchWindowSystem.boundsOf` (`search-window.system.ts:55-66`) is the existing helper.
- **Rationale & Recommendation:**
  - Name the rule, e.g. "the location of the day's first rostered window, else `DefaultLocationPorts.defaultLocationId`".
  - Type the parameters (`now: ShopNow` or `nowByLocation: ReadonlyMap<LocationId, ShopNow>`).
  - State the zone used for follow-ups, the seat instant, and the range-bound helper.

### cd-1-4: The report component breaks Law 1 and Law 6, and several of its types are never declared - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (M5) and `egm-style` (M5, N6).
- **Affected Scope:** Items 9-10 and 13-15 (lines 748-763, 769-799).
- **Discrepancy Description:**
  - **Law 1:**
    - `analytics-report.data.ts` exports about eleven top-level names, while Law 1 allows one root type, one companion and one namespace.
    - `analytics-call.data.ts` exports `ReportCommand`; the precedent is a call component such as `RolesCall`/`RosterCall`.
  - **Law 6.1:**
    - `AnalyticsReport` nests 1-to-1 sub-objects in a wire struct: `period`, `scope`, `parts`, `money`, `heroComparison`, `rebooked`/`noShows: RateFigure` and `bookableOpen{…}`.
    - Flattening `RateFigure` twice would collide on `count`/`base`/`rate`.
    - `scope` needs a domain-prefixed discriminator (`creativo/no-generic-discriminator`).
  - **Undeclared types:**
    - `ChairDayInput`, `ChairDay`, `SeatNet` and `StaffAnalyticsInput` have no file and no fields.
    - The ten partition fields are not named.
    - `ServiceRow`, `WeekdayFill`, `OriginShare` and the `AnalyticsFigure` members are not listed.
    - The contents of `seatRows`/`barbers` in the other scope are not stated.
    - `ReportCommand.period` is untyped.
  - **Ambiguous `null`:** the meaning of `scopeBarberId: null` is unstated for an admin who also holds the barber role.
- **Rationale & Recommendation:**
  - Name the call component `AnalyticsCall`, holding `AnalyticsCall.ReportCommand`.
  - Flatten the report with prefixed fields (`rebookedCount`, `rebookedBase`, `noShowCount`, …), as in `ClientPrivacyCall.ErasurePreview = {…} & ErasureCensus` (`client-privacy-call.data.ts:249-257`).
  - Move the remaining names into namespace members or into their own files.
  - List every type's fields and home file.
  - Have the type-spec assert `NoNested`/`AllTrue` from `@core/testing`.

### cd-1-5: `AnalyticsPeriod` re-declares `DateRange`, and its range check has no defined boundary - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-style` (M3) and `egm-implementation-readiness` (N5).
- **Affected Scope:** Item 8 (lines 742-747). Also lines 499 and 834.
- **Discrepancy Description:**
  - **Duplicate slice:** `components/date-range.data.ts` already provides `fromLocalDate`/`toLocalDate` with `of`/`contains`.
  - **Unclear range:** `isWithinReach` ("≤ 12 months back, not after today") does not say which date the 12 months are measured from. It does not say how a week that straddles the boundary is treated, and "not after today" could reject the current period.
  - **Name drift:** "reach" does not match `ANALYTICS_PERIOD_OUT_OF_RANGE`.
- **Rationale & Recommendation:**
  - Define `AnalyticsPeriod = DateRange & { analyticsSpan }`.
  - Rename the check to `isWithinRange(period, today)` with the rule "`fromLocalDate ≤ today` and `fromLocalDate ≥ startOfMonth(today) − 12 months`".

### cd-1-6: MoneyAllocationSystem copies a private helper, and `seatNets` has two return types - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (M5, N7) and `egm-style` (M7).
- **Affected Scope:** Item 14 (lines 783-793).
- **Discrepancy Description:**
  - **Copied helper:** "The conversion copied from ClientStatsSystem's `inEuroCents`" is a copy of a private function (`client-stats.system.ts:677-681`). `BGN_PER_EUR` is already exported (`:899`).
  - **Reassembled bill:** the bill is rebuilt from `subtotalOf`/`totalOf` instead of reusing `BillingSystem.evaluate` (`billing.system.ts:376-412`) or `ClientStatsSystem.billedHistory` (`client-stats.system.ts:993-1015`).
  - **Two return types:** `seatNets(appointment): readonly SeatNet[]` also "returns an `excluded` marker".
  - **Other currencies:** handling of currencies other than EUR/BGN, where `inEuroCents` returns `null`, is undecided.
- **Rationale & Recommendation:**
  - Export the conversion from a Money/Currency companion and call it from both systems.
  - Reuse `BillingSystem.evaluate`.
  - Return a union with a domain-prefixed discriminator, or a `Result`, and count excluded visits in a named field.

### cd-1-7: There is no refusal code for a malformed payload - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (M4).
- **Affected Scope:** Items 1 and 30 (lines 717-723, 859-860).
- **Discrepancy Description:** Every wire decoder answers `*_INVALID_INPUT` with the offending field (e.g. `apps/functions/src/wire/roster.wire.ts:70-71`, `SchedulingError.rosterInvalidInput`). `AnalyticsErrorCode` has no such code, so the payload guard has nothing to return for a bad period string or scope.
- **Rationale & Recommendation:** Add `ANALYTICS_INVALID_INPUT { field }`, with its edge mapping and its `errors.ANALYTICS_INVALID_INPUT` i18n entry.

### ir-1-7: The callable wiring is underspecified - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M14, M15, N5) and `egm-style` (M15).
- **Affected Scope:** Items 10, 22, 30, 32 and 33 (lines 761-763, 828-829, 859-866).
- **Discrepancy Description:**
  - **Answer decoder:** no answer decoder is defined, but `CALLABLE_ANSWER_DECODERS` (`ports/callables.ts:327-364`) needs one. Decoders live on the call component, e.g. `RolesCall.decodeChanged`. Item 22 puts it in `callables.ts`, and item 10 omits it.
  - **Total maps:** `OPERATION_ID_FIELD` and `CALLABLE_APP_CHECK_TOKEN` need explicit entries. Today's only `null` operation id carries an OR-34 rationale.
  - **Item 32 omits:**
    - `memory: LARGE_MEMORY` (`main.ts:599`). The NFR requires 512 MiB (spec line 675), and copying `amendRosterBreaks` gives the default.
    - `LOG_DIGEST_SECRETS`.
    - The `root.*` bundle to use.
    - The `main.spec.ts` changes: the "exactly the 53 functions" assertion (`:1214`) and the `ENDPOINTS`/`PIPELINES` entries (`:1260`).
  - **Item 33 omits:**
    - an `ANALYTICS_WIRE: WireTable<AnalyticsErrorCode>`
    - adding the dictionary to the edge code list and the `EdgeCode` union (`edge.ts:110-163`)
    - the `HttpsError` code for each code (precedent `edge.ts:542,644-647`)
    - `WIRE_PARAM_ALLOWLIST` rows (`errors/pipeline.error.ts:126`)
- **Rationale & Recommendation:**
  - Add `AnalyticsCall.decodeReport` with a spec.
  - Give explicit `OPERATION_ID_FIELD` and App Check entries, with the rationale for the operation id.
  - Add `memory: LARGE_MEMORY` and the `main.spec.ts` changes.
  - Write the code-to-`HttpsError` table into item 33. Suggested mapping:
    - `UNAUTHENTICATED` → `unauthenticated`
    - `FORBIDDEN` and `BARBER_NOT_LINKED` → `permission-denied`
    - `PERIOD_OUT_OF_RANGE` and `INVALID_INPUT` → `invalid-argument`
    - `SCOPE_UNKNOWN` → `not-found`

### cd-1-8: The lock document is a new stored archetype with no type - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (B4).
- **Affected Scope:** Item 25 (lines 843-847). Spec "Which barber the caller is" (lines 405-443).
- **Discrepancy Description:** `barbers/{id}/restricted/link = { userId }` has no slice, entity, FIXED doc-id brand or `Subcollections` entry. The precedent is `Subcollections.Restricted` and `CLIENT_MONEY_DOC = ClientMoneyStatsId.FIXED` (`entities/collections.ts:106-122`). Law 5 says a document body is the flat entity minus id.
- **Rationale & Recommendation:** Add a `BarberLink` slice and entity, `BARBER_LINK_DOC`, a seed body and a rules case, all in Step 1, Step 3 and Step 5.

### ir-1-8: The audit row change touches files the plan omits, and item 36's "no change" is wrong - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M9).
- **Affected Scope:** Items 17 and 36 (lines 810-811, 878-880).
- **Discrepancy Description:**
  - **Unlisted files:**
    - The roles-changed tags live in the `AuditContext.Profile` variant (`components/audit-context.data.ts:188-194, 596-603`, plus `NO_TAGS` and `profileWithTags`).
    - `AuditedProfileField` (`audited-profile-field.data.ts`) needs a member.
  - **Naming:** every tag field is `profile*`-prefixed (Law 6.2), so `linkedBarberIdFrom/To` should be `profileLinkedBarberIdFrom/To`.
  - **Indexes:** every profile tag field has a `fieldOverrides … indexes: []` entry (`firestore.indexes.json:665-684`). The new fields need entries too.
  - **Duplicate audit row:** the link write must stamp `profileEditedAtUtcMs`, or the `auditProfileChanges` trigger writes a second row (`user.entity.ts:28-37`).
- **Rationale & Recommendation:**
  - List the audit-context and audited-field files.
  - Rename the fields to `profileLinkedBarberIdFrom/To`.
  - Change item 36 to add the two `fieldOverrides` entries.
  - State the `profileEditedAtUtcMs` stamp.

### ir-1-9: Business decisions sit in the pipeline, the store and the presenter instead of in systems - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M5, M20).
- **Affected Scope:** Item 24 (lines 833-842) and item 38 (lines 888-904).
- **Discrepancy Description:** Each of these is a decision, which Laws 3, 4 and 10.2 place in systems:
  - In the pipeline: "decide scope by the visibility table", grouping visits into per-barber-day `ChairDay` inputs, and choosing follow-up candidates.
  - In the store: the 5-minute reuse rule, a staleness budget under T2.
  - In the presenter: the time bar's "other = held + short gaps" grouping.
- **Rationale & Recommendation:**
  - Add `StaffAnalyticsSystem.scopeOf(caller, cmd, barberExists, nowUtcMs): Result<AnalyticsScope, AnalyticsError>` and `daysOf(...)`, and move the visibility-row cases into their specs.
  - Put the freshness rule in a component or system, as `SearchWindowSystem.isStale` (`search-window.system.ts:74-85`) does.
  - Emit the "other" part as a system output.

### ir-1-10: The web tokens, cache and session clearing are undefined or point at things that do not exist - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M15, M18) and `egm-style` (M17, M18, M19).
- **Affected Scope:** Items 38-42 (lines 883-908).
- **Discrepancy Description:**
  - **Tokens and barrels:** no item adds the `ANALYTICS_CALL_PORTS`/`ANALYTICS_CACHE_PORTS` tokens to `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts` (precedent `ROLES_ADMIN_PORTS` at `:226`). No item names the barrel exports.
  - **Missing hooks:** "clear … with the existing session hooks" names hooks that do not exist.
    - Sign-out is `AUTH_SESSION_PORTS.signOut()`, called from `site-menu.component.ts:328-332`, and nothing in the app listens for it.
    - `staff-search-recents.ts:6` says "no sign-out hook".
  - **Account switch:** clearing on account switch is omitted (spec lines 484 and 548).
  - **Undefined cache details:**
    - the `<scope>` in the cache key when a barber sends `null`
    - which of the 6 entries is evicted
    - the port signatures
    - where seat rows are stripped
  - **Cache input not validated:** the cache read from `localStorage` is foreign input and must pass through the answer decoder, not just a try/catch.
  - **Scope-unknown fallback:** the states table's fallback to the shop scope on `ANALYTICS_SCOPE_UNKNOWN` is not planned.
- **Rationale & Recommendation:**
  - Name the token file and the barrels.
  - Design the sign-out and account-switch clearing (e.g. a uid-change effect on the auth state) and give it a file.
  - Define the cache key, the eviction rule ("a seventh entry removes the oldest `computedAtUtcMs`") and validation through `AnalyticsCall.decodeReport`.
  - State that a barber sends `scopeBarberId: null`.

### cd-1-9: The web source of `linkedBarberId` is unnamed and may cross a module boundary - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (M8).
- **Affected Scope:** Item 38 (lines 890-892).
- **Discrepancy Description:** The only live `users/{uid}` reader is `libs/features/client/account-state/src/lib/account-state.service.ts:130`, which sits in a client-scope library.
- **Rationale & Recommendation:** Name the source, check it against `@nx/enforce-module-boundaries`, and state that a missing `linkedBarberId` is read as `null`.

### cd-1-10: The menu row also needs a change in its parent component - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`.
- **Affected Scope:** Item 43 (lines 909-910).
- **Discrepancy Description:** `SiteMenuComponent` receives its role flags as inputs from the header (`site-menu.component.ts:96-103`; `site-header.component.html:73-74`).
- **Rationale & Recommendation:** Add `libs/features/shared/shell/src/lib/header/site-header.component.ts|html` and the new input to item 43.

### cd-1-11: The client-card picker is incomplete, and an existing e2e test will break - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`. Also raised by `egm-implementation-readiness` (M11) and `egm-style` (N16).
- **Affected Scope:** Items 44 and 50 (lines 911-914, 938-940).
- **Discrepancy Description:**
  - **Broken test:** `apps/web/e2e/staff-client-roles.spec.ts:110-157` grants the barber role with no link, so it will fail on `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`.
  - **Missing pieces:**
    - a port that lists barber records for the picker
    - how the target account's current link reaches the card
    - the roles row's files (`client-card.html`, `client-pages.vm.ts`)
    - the `changeOf`/`saveOf` change
- **Rationale & Recommendation:**
  - Name these files and the source of the barber list (e.g. `CATALOG_PORTS.observeBarbers`, which shows active barbers only).
  - Update `staff-client-roles.spec.ts` in item 50.

### ir-1-11: Not every user writer, fixture and seed is listed - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M12) and `egm-style` (M14).
- **Affected Scope:** Items 18 and 37 (lines 812-813, 881-882). Item 50.
- **Discrepancy Description:**
  - **Seed bodies:** the user bodies come from `tools/seed/fixtures/users.fixtures.ts` (`staffAccountBody`, `clientUserBody`). `seed-dev-catalog.mjs:530-552` only writes them.
  - **Missing writer:** the spec's third writer, the provisioning stub (spec lines 413-414), has no item.
  - **e2e seeds:** the e2e accounts (a linked Ivan, an unlinked barber, a free record for the admin to link) need `apps/web/e2e/support/seed-firestore.ts`.
  - **Also unlisted:** `verify-p0.mjs` and the registration specs.
- **Rationale & Recommendation:** List every writer and fixture file with its new bodies, and name the file that writes the provisioning stub.

### ir-1-12: Verification does not name the Nx targets or test files - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (N1, N4, N6, N7) and `egm-style` (N18).
- **Affected Scope:** Items 12, 34, 35, 36 and 50, and the Verification Plan (lines 946-970).
- **Discrepancy Description:**
  - **Targets and files not named:**
    - the server integration spec target (`pnpm nx run functions:test-integration`)
    - the rules target and its test file (`libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`)
    - the e2e command (`pnpm run e2e:web`)
    - the CSP build configuration
    - the touched projects for each step
  - **Wrong checks attributed:** `verify-tools:layering` does not run the no-Pick/Omit or presenter-purity checks; they run under `lint`. The emulator does not enforce indexes, so the integration spec proves nothing about them (CLAUDE.md §5).
  - **Unlisted specs:** `log-event.data.spec.ts` pins the `LogEvent` dictionary (lines 48 and 109). The unit-test list also omits the specs for the governance errors, roles, roles call and user type.
- **Rationale & Recommendation:**
  - Name each target and spec file.
  - Attribute the lint rules to `lint`.
  - Replace the index claim with "every composite query appears in `firestore.indexes.json`, reviewed".

### ir-1-13: There is no rollout or rollback step, and legacy user documents are not handled - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`.
- **Affected Scope:** Step 8 and the Verification Plan (lines 925-970). Spec lines 430 and 533-550.
- **Discrepancy Description:**
  - **Deploy order:** no step gives the order, functions before hosting. Older web clients send `setRoles` without the field.
  - **Rollback:** the spec's rollback (remove the route and the menu row) has no step.
  - **Legacy documents:** accounts created before release have no `linkedBarberId` field, so `LoadCaller` and the web must read an absent field as `null`.
- **Rationale & Recommendation:** Add a rollout and rollback item, and state the absent-as-`null` read rule wherever `User` is decoded.

### ir-1-14: The pipeline's log line drops fields the spec requires - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-style` (M11).
- **Affected Scope:** Item 24 (lines 838-839) and line 963. Spec lines 148 and 526.
- **Discrepancy Description:** "log … (counts and minutes, no money)" drops uid, scope, period, `definitionVersion`, appointment count and duration. The success measure needs uid, and the p95 check reads "the `AnalyticsReported` duration field", which requires two clock reads.
- **Rationale & Recommendation:** List the exact `LogEvent.AnalyticsReported` fields, and state where the two clock reads happen.

### style-1-1: The "callable-only" JSDoc on the role sets contradicts their use - Severity: Major

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Item 3 (lines 736-738).
- **Discrepancy Description:** `Roles.ANALYTICS_SELF/SHOP` are described as callable-only. The same sets also gate the route (line 466, item 41), the menu row (item 43) and the wire's token check (item 30).
- **Rationale & Recommendation:** Reword the JSDoc to "used by the `staffAnalytics` wire and pipeline, the `staff/analytics` route guard and the menu row; the sysadmin is excluded as in `SPEND`; reading billed takings does not require `MONEY`".

### style-1-2: The `filter` parameter of `rowsFor` is undefined - Severity: Major

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Item 15 (lines 801-804). Spec line 397.
- **Discrepancy Description:** `StaffAnalyticsSystem.rowsFor(report, figure, filter)` gives the `filter` parameter no type and no meaning.
- **Rationale & Recommendation:** Define it, e.g. `filter: { barberId?: BarberId; serviceId?: ServiceId; localDate?: LocalDate }`.

### style-1-3: The sweep wording files blocked and break under the occupied parts - Severity: Major

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Item 13 (lines 774-776). Spec lines 320-336.
- **Discrepancy Description:** The plan says "the occupied parts come from one sorted sweep … worked → no-show → unmarked → booked ahead → held, then blocked, then break". In the catalogue, blocked and break are separate parts that come after occupied, not occupied parts.
- **Rationale & Recommendation:** Rewrite as two rules. The sweep assigns each occupied minute to the first of worked, no-show, unmarked, booked ahead and held. Each remaining minute is blocked if it is inside a `BLOCKED` range, else break if it is inside a roster break, else hole.

### style-1-4: "A cancelled seat on a completed visit" drifts from the spec - Severity: Major

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Lines 780-781 and 928. Spec lines 329 and 402.
- **Discrepancy Description:** The spec says a `CANCELLED` seat on a visit that is not wholly cancelled. A test written from "completed" would miss future visits that are not wholly cancelled.
- **Rationale & Recommendation:** Use the spec's wording in both places.

### style-1-5: The visibility cases are incomplete, although line 957 claims full coverage - Severity: Major

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Item 24 (lines 840-842) and line 957.
- **Discrepancy Description:** The case list omits `content_manager`, client, admin with the barber role, and signed out.
- **Rationale & Recommendation:** Add the missing rows, and state that the signed-out row is covered by the wire spec (item 30). If ir-1-9 is adopted, the cases move to the system spec.

### style-1-6: "Shop" is used where "location" is meant - Severity: Major

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Line 930. Spec Terms and line 346.
- **Discrepancy Description:** The plan says "a day at a shop the schedule does not offer". The Terms section defines Shop as the tenant, meaning all its locations.
- **Rationale & Recommendation:** Write "a day at a location the schedule does not offer".

### style-1-7: Item 35's rules change is vague - Severity: Major

- **Reviewer Lens:** `egm-style`. Also raised by `egm-codebase-details` (N6).
- **Affected Scope:** Item 35 (lines 876-877). Spec line 410.
- **Discrepancy Description:** "`linkedBarberId` added to the documented user key set" does not say whether this is a comment or a `keys().hasOnly` change. The spec requires that only audited callables write the field.
- **Rationale & Recommendation:** Name the rule. State that client writes to the field are denied, and add a case for it in `firestore.rules.integration.spec.ts`.

### 🟢 Nits

### ir-1-15: The fixture file does not follow the naming convention - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (N8).
- **Affected Scope:** Item 47.
- **Discrepancy Description:** `testing/analytics-fixtures.ts` breaks the `*.fixtures.ts` convention (`identity.fixtures.ts`), and `testing/index.ts` needs an export.
- **Rationale & Recommendation:** Rename the file `analytics.fixtures.ts` and add the export.

### ir-1-16: The `User` type-spec is not named - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (N2).
- **Affected Scope:** Item 5.
- **Discrepancy Description:** "its type-spec" refers to a file the plan does not name. The file is `entities/identity-entities.type-spec.ts:72-76`.
- **Rationale & Recommendation:** Name the file.

### ir-1-17: Error context fields and error unions are underspecified - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (N3) and `egm-style` (N2).
- **Affected Scope:** Items 1-2 (lines 717-735).
- **Discrepancy Description:**
  - The plan does not give the context fields for each code.
  - It names no `StaffAnalyticsError = AnalyticsError | RepositoryError` union (precedent `governance.error.ts:399-409`).
  - The new governance codes also go into the `GovernanceError` union, namespace and factories.
- **Rationale & Recommendation:** Add a table of code to context fields, the union, and the factory list.

### ir-1-18: `LoadCaller` duplicates `LoadProfile` - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (M4, as part of a Major).
- **Affected Scope:** Item 21.
- **Discrepancy Description:** `LoadProfile` (`accounts.port.ts:59-61`) already reads `users/{uid}`. `AccountLifecycle.isBlockedAt` (`role-assignment.system.ts:128`) already checks for a block.
- **Rationale & Recommendation:** Reuse both (reuse, never copy).

### ir-1-19: The drill-down mapping, the staging fallback and the route export are unspecified - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`. Also raised by `egm-codebase-details` (N9, N10).
- **Affected Scope:** Items 38-39 and lines 485-488 and 960-962.
- **Discrepancy Description:**
  - The mapping from `AnalyticsSeatRow` to `VisitSectionVm`/`VisitRowVm` for `lib-visit-list` (`visit-list.ts:103-104`) is not named.
  - Moving `staged-render.ts` into `libs/ui/layout` is a conditional step with no files.
  - "Exports the routes only" conflicts with the `loadComponent` pattern (`app.routes.ts:136-142`).
- **Rationale & Recommendation:** Name the presenter's mapping function and the files for the fallback, and follow the `loadComponent` pattern.

### cd-1-12: Departures could be read by key instead of by range - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`.
- **Affected Scope:** Items 21 and 28.
- **Discrepancy Description:** Departures are keyed by `BusyKey` (`scheduling.port.ts:311-319`), so a `getAll` over the period's keys could replace the range query.
- **Rationale & Recommendation:** Consider it, or record why the range query is kept.

### style-1-8: The item template and step headings are inconsistent - Severity: Nit

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Lines 715-944.
- **Discrepancy Description:**
  - Only item 1 has "Type / Scope".
  - Many items say "+ spec" without naming the file.
  - Some items are one-line em-dash entries, others use sub-bullets.
  - Item 36 has no Create/Modify tag.
  - Steps 5 and 6 give no path prefix.
- **Rationale & Recommendation:** Use one template for every item: path (Create/Modify/No change), Proposed Changes, Spec. Give each step heading its path prefix.

### style-1-9: Inline code spans break across lines - Severity: Nit

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Lines 736-737, 800-801, 832-833 and 854-855.
- **Discrepancy Description:** Line wraps fall inside backtick spans.
- **Rationale & Recommendation:** Keep each code span on one line, or move signatures into fenced `ts` blocks.

### style-1-10: Names drift from the spec - Severity: Nit

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Lines 740, 810, 821-827 and 911-917.
- **Discrepancy Description:**
  - "the `setRoles` command" should be `RolesCall`.
  - "the roles-changed row" should be the audit row of `setRoles`.
  - "Web bundles" reads like JavaScript bundles.
  - `from, to` is untyped next to `fromUtcMs, toUtcMs`.
  - "by-service rows" should be seats by service.
  - "rates" sits beside the late-cancellation count, which is not a rate.
  - "the two governance codes" are not named.
- **Rationale & Recommendation:** Use the spec's names throughout.

### style-1-11: Several phrases are vague or telegraphic - Severity: Nit

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Lines 731, 776-777, 798, 808-809, 836-837, 857, 860 and 938-940.
- **Discrepancy Description:**
  - "a guard for foreign input" should be named `StaffLink.parse`.
  - "no per-element allocation in the loop" is vague.
  - "follow-ups' booking shop dates handed in" is vague.
  - "a link-only change is a change (it commits)" is awkward.
  - "once" has no unit.
  - "Bodies spread, never mapped" is telegraphic.
  - "the cheap first gate" names no refusal codes.
  - In CUJ 6 the antecedent of "their figures" is unclear.
- **Rationale & Recommendation:** Apply `egm-style`'s rewrites N7-N10, N13, N14 and N17.

### style-1-12: Parts of the Verification Plan are cryptic - Severity: Nit

- **Reviewer Lens:** `egm-style`.
- **Affected Scope:** Lines 948-966.
- **Discrepancy Description:**
  - "(templates)" does not say what the build checks.
  - "first frame from cache within the tap's frame" does not match NFR line 673.
  - The p95 sentence has no verb and no thresholds.
  - The scope of "run alone" is unclear.
  - "voucher draws" is undefined.
  - The reconciliation gate has no owner.
- **Rationale & Recommendation:**
  - Write "(compiles the Angular templates)".
  - Use the NFR's wording for the first frame.
  - State the p95 thresholds: ≤ 1.5 s for a barber-month and ≤ 4 s for a shop-month.
  - Define "voucher draws".
  - Name the gate's owner.

---

## Severity Breakdown

| Severity   | Count | Ids                                                 |
| ---------- | ----- | --------------------------------------------------- |
| 🔴 Blocker | 6     | ir-1-1, ir-1-2, ir-1-3, ir-1-4, cd-1-1, cd-1-2      |
| 🟡 Major   | 26    | ir-1-5…ir-1-14, cd-1-3…cd-1-11, style-1-1…style-1-7 |
| 🟢 Nit     | 11    | ir-1-15…ir-1-19, cd-1-12, style-1-8…style-1-12      |
