# Goldfish Review Report — Stage 9 Implementation Readiness Test, round 2

**Target:** `docs/designs/staff-analytics-v2.md` (`1033–1543`, "## Detailed Implementation Plan" to the end; boundary re-checked — the header is at line 1033, the file ends at line 1543)

**Mode:** REVIEW. Round 2 of the Stage 9 test on the revised document. Every reviewer read the document fresh; no round-1 report was shared with them. Lines 1–1032 were read for context only; every finding below sits in the DetailedRange.

## Reviewer Status

| Reviewer                       | Status    | Raw findings                                                |
| ------------------------------ | --------- | ----------------------------------------------------------- |
| `egm-implementation-readiness` | completed | 3 Blockers, 13 Majors, 14 Nits                              |
| `egm-codebase-details`         | completed | 1 Blocker, 8 Majors, 8 Nits, plus the verified-correct list |
| `egm-style`                    | completed | 0 Blockers, 11 Majors, 27 Nits                              |

After deduplication: **3 Blockers, 28 Majors, 42 Nits.** Ids are stable (`<reviewer>-9b-<n>`); where two or three reviewers raised the same point the finding carries the lens that stated it most precisely and names the others.

**Verdict:** not ready to implement as written. PRs 1–3 are close (two name corrections and one item-ordering fix); PR 4a carries all three blockers — the stored-day writer's transaction boundary, the recompute job's contract and the e2e recompute harness are each left to the implementer — and PR 4b/6/7 carry decisions (the `toLocalDate` rule, the radar's "best", the goal callable's wiring, the shop CSV's data source) the author must make.

---

## Blockers

### readiness-9b-1 — The recompute e2e harness has no defined mechanism — 🔴 Blocker

- **Reviewer lens:** `egm-implementation-readiness`; also `egm-codebase-details` (its finding 1) and `egm-style` (its M9).
- **Affected scope:** items 78–79 (lines 1393–1399); PR 4b's gate (line 1047); Verification Plan "E2E/Integration" (lines 1529–1535).
- **Discrepancy:** item 78 asks for "an `@emulatorOnly` export `runAnalyticsRecomputeNow`" in `apps/functions/src/main.ts` and adds `'analyticsRecompute'` to `JobName` in `apps/web/e2e/support/run-job.ts`; item 79's YEAR/CUSTOM e2e calls `runJob('analyticsRecompute', now)`. In the repository `runJob()` throws unconditionally (`"runJob(...) is not wired until P2: no run<Job> handler exists yet"`), its two existing `JobName` values have no handler, and no e2e support file dials a functions export (`warm-callables.ts` only fetches the emulator hub). `@emulatorOnly` is a JSDoc tag on adapter exports (`console-otp-sender.adapter.ts:35`, `otp-crypto.adapter.ts:37,66`) whose every use preflight P7 requires behind `onEmulator()` (`main.ts:313`, `process.env['FUNCTIONS_EMULATOR'] === 'true'`); it is not a kind of Cloud Function export, and no exported function is emulator-only today. `main.spec.ts` pins `ENDPOINTS`, `EXPORTS` and `FLIPPED_EXPORTS` (`toHaveLength(54)`), so a new export changes a pinned surface. Playwright runs in Node and cannot call a functions export directly; the transport, how `now` reaches the server clock, how the endpoint refuses outside the emulator and how the pins treat it are all undecided. The name also breaks `run-job.ts`'s own convention that a `JobName` is "named by their `run<Job>` handler" (`'analyticsRecompute'` → `runAnalyticsRecompute`, not `runAnalyticsRecomputeNow`).
- **Rationale:** PR 4b's named gate stands on a helper that refuses every call; designing a new public surface on the functions app is an architectural decision, not an implementation detail.
- **Resolution:** decide and write down (a) the server side — either an `onCall`/`onRequest` export `runAnalyticsRecompute` registered only when `onEmulator()` (guard → `failed-precondition` otherwise; payload `{ nowUtcMs }`; the instant injected through a `ClockPorts` override for the run; how `EXPORTS`/`FLIPPED_EXPORTS` treat a conditional export and the new length), or an admin-SDK write of `backfillJobs/analyticsRecompute` from the e2e that fires `continueAnalyticsRecomputeOnJobWrite` (no new export at all); (b) the client side — implement `runJob`'s body (the emulator functions URL pattern of `warm-callables.ts`, project id and region), rewrite its doc comment, say whether the two stub names stay; (c) list `run-job.ts` as the file that changes from "throws" to "dials" and the `main.spec.ts` rows; (d) how the pin proves the export never ships in production.

### readiness-9b-2 — The stored-day writer's transaction boundary and read set are not decided — 🔴 Blocker

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** item 55 (lines 1286–1292), against "Stamp ordering" (lines 398–410) and the writer's ports (lines 500–502).
- **Discrepancy:** the feature text says every read happens "inside one `commit` per day", yet the port bundle lists `AnalyticsReadPorts`, `ShopDayReadPorts`, `PolicyReadPorts`, whose functions (`loadVisitsByBusyKeys`, `loadFollowUpsOf`, `loadSchedule`, `loadPolicy`) are non-transactional reads; a transactional read goes through `ReadTx.get` / `tx.query(QuerySpec)` (see `rebuild-busy.pipeline.ts:94–144`). "The follow-ups … one `in` chunk" contradicts `VISITS_PER_BARBER_DAY = 60` (Firestore `in` takes 30 values). Which reads define "this run's source-read instant" is therefore undefined.
- **Rationale:** stamp ordering is the idempotency guarantee of the whole write path (Law 7 T2); whether the visits, departure, roster and existing-document reads sit inside the transaction decides whether two racing writers can both pass the stamp check.
- **Resolution:** state explicitly — inside `commit`: a `QuerySpec` `visitsOnBusyDay(key)` (`busyKeys array-contains key`, no status filter, `limit: VISITS_PER_BARBER_DAY + 1`), `tx.get` of the existing day document, `tx.get` of `appointments/{sourceAppointmentId}`, the departure `tx.get(scheduleExceptions/{key})`; outside, before the commit, through the named bundles: roster, policy, locations and the follow-ups (`loadFollowUpsOf` in chunks of 30 via `BackfillPlanSystem.chunk` over up to 60 ids). Define `sourceReadUtcMs = ports.nowUtcMs()` taken before the first read of either kind. Remove "one `in` chunk".

### readiness-9b-3 — The recompute job is "on the policy-recompute model" but the differences are the whole design — 🔴 Blocker

- **Reviewer lens:** `egm-implementation-readiness`; also `egm-codebase-details` (its finding 11).
- **Affected scope:** items 52 and 56 (lines 1277–1278, 1293–1297); item 61(d); the entity at lines 444–451; Terms "Eligible" (lines 134–139).
- **Discrepancy:** `PolicyRecomputeJobSystem` is driven by a generation (`event.id`) and a `PreciseInstant`; the analytics job has neither, and its system (`extentOf`, `nextPage`, `finish`) names none of the policy system's members (`compareInstants`, `stepKeyOf`, `nextStep`, `sameStep`, `advance`, `isIdle`, `shouldRecordStall`, `stall`, `nudge`, `owesCatchUp`, `catchUp`, `judgePolicyPass`, `policy-recompute-job.system.ts:93–344`). Undecided: (a) what `jobStepKey` derives from; (b) the page size and the key ordering across barbers × dates that `jobCursor: BusyKey` resumes from (`BusyKey` sorts barber-first lexically); (c) how "reads the page's day documents by id" is served — `loadAnalyticsDays(barberIds, from, to)` is a range query, there is no by-id port; (d) what the 04:30 start does when a pass is unfinished or stalled — "a running pass is not started twice" conflicts with the Risk row "the pass resumes from its cursor; the window widens by itself", and the policy model's stall nudge lives in a third pipeline (`sweep-policy-recompute.pipeline.ts`) the plan has no analogue for; (e) `extentOf` when there is no job document or `jobFinishedAtUtcMs` is null, and which zone turns that stamp into "the last completed pass's date"; (f) whether `jobBarberIds` is compared as a sorted set.
- **Rationale:** this is the self-healing mechanism; each of (a)–(f) changes behaviour on an outage night.
- **Resolution:** write the `AnalyticsRecomputeJobSystem` contract the way the policy system's is written: `stepKeyOf(jobStartedAtUtcMs, jobCursor, jobFinishedAtUtcMs)`; `PAGE_SIZE = 100` keys; keys enumerated date-ascending then barber in `jobBarberIds` order, the cursor the last key written; either a `LoadAnalyticsDaysByKeys(keys)` port or `tx.get` per key inside the writer (which already reads the existing document — then the step hands every key to the writer and `jobChecked` is counted there); `startAnalyticsRecompute` rules: no job or finished → new pass with the computed extent; unfinished and `jobUpdatedAtUtcMs` older than `STALE_AFTER_MS` → nudge (rewrite `jobUpdatedAtUtcMs`, clear the stall, keep the cursor); unfinished and fresh → no write; `extentOf`: the full reach when no job, when `jobDefinitionVersion ≠ ANALYTICS_DEFINITION_VERSION`, or when the sorted barber lists differ, otherwise `localDateOf(jobFinishedAtUtcMs, defaultZone) − 1` to today. Name which policy members are reused (at least the `sameStep`/`stepKeyOf` compare-and-set and `shouldRecordStall`/`stall`).

---

## Majors

### codebase-9b-3 — Nobody in the plan turns the appointment write into the writer's `keys`, and the named precedent contradicts the busy pipeline's own rule — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** items 55, 60, 61(a) (lines 1286–1292, 1307–1315); design lines 381–383.
- **Discrepancy:** the writer's command is `{ keys; sourceAppointmentId; source }`; item 60 reuses "`decodeRebuildBusyEvent`'s command … adding `sourceAppointmentId` (a copy, no read)"; item 61(a) runs both pipelines "from the same decoded command". But `decodeRebuildBusyEvent` answers `RebuildBusyCommand = { before, after, salvagedKeys, salvagedLocationId, refusal }` (`apps/functions/src/wire/triggers.wire.ts:224–239`) — no `keys`. `BusySystem.affectedKeys(before, after, salvaged)` (`busy.system.ts:179`) is called inside `rebuild-busy.pipeline.ts:116`, whose header (lines 56–62) says "the one `affectedKeys` computation decides it, here, never the edge"; neither `main.ts` nor `triggers.wire.ts` calls it. The design's "composition root derives the keys" answer violates that recorded rule and Law 4 (a system call in the root).
- **Rationale:** the `before/after → keys` step belongs to nobody; an engineer must pick where it goes and whether to amend the busy pipeline's header.
- **Resolution:** recommended — make `writeAnalyticsDay`'s command a `source`-discriminated union whose `'APPOINTMENT'` variant carries the `RebuildBusyCommand` sides, and have the pipeline call `BusySystem.affectedKeys(before, after, salvagedKeys)` itself (mirroring `rebuildBusy`'s "refusal is the answer only when no day is left"). Alternative — a `decodeAnalyticsDayCommand(event)` in `triggers.wire.ts` that calls `affectedKeys` there, with the busy pipeline's header sentence amended. Item 60's `decodeAnalyticsDayEvent` for the departure trigger (one key or none) is fine as is.

### readiness-9b-9 — Joining the busy rebuild's and the day write's verdicts is undefined — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** item 61(a) (lines 1313–1315); "Failure semantics" (lines 390–396).
- **Discrepancy:** `rebuildBusyOnAppointmentChange` today calls `settleAttempt(fn, event, projectionReport(answer), root.edge)` over one `Result`. Two pipelines yield two answers; how they become one `AttemptReport`, and whether the day write still runs when `rebuildBusy` answers `Result.err`, is unspecified.
- **Rationale:** retry semantics (`retry: true`) depend on the combined verdict.
- **Resolution:** specify a `combinedReport(busy, day)` in `triggers.wire.ts` — `attemptFailure = TriggerAttemptSystem.decisiveFailure([...busyFailures, ...dayFailures])`, `survivedFailure: null` — and state that the writer runs regardless of the busy answer (its keys come from its own `affectedKeys` call, see codebase-9b-3), with a case in `triggers.wire.spec.ts`.

### readiness-9b-4 — PR 4a changes the answer's `DayRow` type without the system change that fills it — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** item 47 (lines 1244–1255) versus items 53 and 71.
- **Discrepancy:** item 47 replaces `AnalyticsReport.DayRow` with the `day*`-prefixed `DayRow` carrying `dayTakingsCents`, `dayTipsCents`, `currency`, `dayClosedDayMinutes`; today `StaffAnalyticsSystem.report`/`dayRowsFor` produce the unprefixed, money-less rows. Item 53 changes only `isPastDay` and the cap; per-day money and the renamed fields are first produced in item 71 (PR 4b).
- **Rationale:** PR 4a would not typecheck, breaking "each phase leaves the codebase buildable".
- **Resolution:** add to item 53: `report` builds `reportDayRows` as `DayFigures.rowOf(DayFiguresSystem.fold(...))` per live day (or a `dayRowOf(day, visits)` helper), and `seatRowsFor`/`dayRowsFor`/the `AnalyticsFigure.TIME` drill-downs read the renamed fields; list the `staff-analytics.system.spec.ts` cases for money per day.

### readiness-9b-5 — The definition version PR 4a's writer stamps versus the bump in PR 4b — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 27, 55, 69, 77 (lines 1173–1176, 1286–1292, 1357–1361, 1389–1392).
- **Discrepancy:** documents written after PR 4a's deploy carry `dayDefinitionVersion = 1`; PR 4b sets `ANALYTICS_DEFINITION_VERSION = 2`, making the entire reach "eligible" on 4b's deploy day and every past day live-computed until that night (the Risk row's cost case); the production flag flip is gated on "the first nightly recompute has logged `AnalyticsRecomputeDone`", which a version-1 pass already satisfies.
- **Resolution:** either stamp `dayDefinitionVersion` from a separate `DAY_DEFINITION_VERSION = 2` introduced in 4a (so 4a's documents are already current), or state that the production flip waits for the first `AnalyticsRecomputeDone` logged by the 4b build.

### readiness-9b-6 — Item 39 (PR 3) creates spec cases for types item 68 (PR 4b) adds later — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`; also `egm-style` (its M5).
- **Affected scope:** item 39 (lines 1214–1217) versus item 68 (lines 1354–1356); item 44.
- **Discrepancy:** item 39's `analytics-period.data.spec.ts` (Create) covers "`of` for DAY/YEAR/CUSTOM, `previous` per span, `isComparable`, `CUSTOM_MAX_DAYS`"; `Year`, `Custom`, `of(span, from, to)` and `CUSTOM_MAX_DAYS = 366` are added in item 68. Item 44 itself says DAY/YEAR/CUSTOM "arrive in PR 3/4b".
- **Resolution:** item 39 — "`of` and `previous` for DAY, `previous` for WEEK/MONTH, `isComparable`"; item 68 — "(Modify) the YEAR/CUSTOM cases and `CUSTOM_MAX_DAYS`".

### readiness-9b-7 — The chart kit's inputs are named but not typed — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 19–23 (lines 1140–1156) with the table at 606–611; item 31.
- **Discrepancy:** `uiOrientation` (which literals?), `uiValueText` (one string, a string per bar, a function?), `uiRows`/`uiColumns` (strings? `{ label }`?), `uiCells.row`/`column` (indexes or labels?), `uiAverage` (number, or `null`), `uiHighlightIndex` (`number | null`), `uiBars[].parts[].part` — the exact `[data-part]` vocabulary — are all unstated. Today `analytics-time-bar.css` uses `data-part='no-show'` while `AnalyticsBarPart.NoShow` is `'NO_SHOW'`; a `type:ui` library cannot import ecs-core, so the kit needs its own dictionary and the presenter a mapping. Item 23's spec parses these exact attribute values.
- **Resolution:** write the kit's public types in items 15/19–21 — e.g. `UiChartPart = { Worked: 'worked', NoShow: 'no-show', Unmarked: 'unmarked', Blocked: 'blocked', Unsold: 'unsold', Other: 'other', Online: 'online', Staff: 'staff', Unknown: 'unknown', Comparison: 'comparison' } as const`; `uiOrientation: 'vertical' | 'horizontal'`; `uiValueText: readonly string[]` aligned with `uiBars`; `uiRows`/`uiColumns: readonly string[]`; `uiCells[].row/column` as indexes; `uiAverage: number | null` — and in item 31 the presenter's `AnalyticsBarPart → UiChartPart` table in `analytics.vm.ts` (see codebase-9b-4 for the existing `BAR_PART_HOOKS`).

### codebase-9b-4 — `BAR_PART_HOOKS` has no colour entries and lives in `analytics.vm.ts`, not `analytics-time-bar/*` — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** item 33 (lines 1196–1199).
- **Discrepancy:** the plan deletes "the old colour rules in `analytics-time-bar.css` and `BAR_PART_HOOKS`'s colour entries". `BAR_PART_HOOKS` (`libs/features/staff/analytics/src/lib/analytics.vm.ts:67–74`) is the `AnalyticsBarPart → 'worked' | 'no-show' | 'unmarked' | 'blocked' | 'unsold' | 'other'` selector-hook table the template binds through `[attr.data-part]="segment.part"` (`analytics-time-bar.ts:28,40`); the colours are only in `analytics-time-bar.css:33–49`.
- **Rationale:** deleting the "entries" removes the `data-part` values the kit's `[data-part]` mapping (item 22) must match; the template would bind nothing.
- **Resolution:** item 33 → delete the six `[data-part=…]` background rules in `analytics-time-bar.css`; keep `BAR_PART_HOOKS` (list `analytics.vm.ts` only if its values are renamed to the kit's vocabulary) and state that `charts.css`'s `[data-part]` values are exactly these strings.

### readiness-9b-8 — DAY's tall bar: feature component or kit element? — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 32–33, 44 (lines 1190–1199, 1231–1236) versus lines 638–639 and the table row at 627.
- **Discrepancy:** the plan keeps `lib-analytics-time-bar` in the feature (restyled by the kit's CSS) and draws DAY with it; the feature text says it is "promoted into the kit" and DAY is "one tall segmented bar" of `ui-bar-chart`. "Stays in the tree for PR 3" leaves open whether PR 2's WEEK/MONTH page still renders it (dead code versus a duplicate bar).
- **Resolution:** pick one. If `ui-bar-chart` with `uiStacking: 'stacked'`, `uiOrientation: 'vertical'`, one bar: delete `analytics-time-bar/*` in PR 3 and say PR 2 removes it from the W/M template. If the feature component stays: amend lines 638–639 and the table, and say PR 2 does not render it.

### readiness-9b-10 — `toLocalDate` semantics on non-CUSTOM spans — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 69, 73, 74 (lines 1357–1361, 1373–1379); the contract at 562–566.
- **Discrepancy:** the call carries `toLocalDate: LocalDate | null` on every span; the plan does not say whether a non-null `to` on WEEK/MONTH/DAY/YEAR is refused, ignored or must equal the span's last day; nor whether the store sends `null` or the computed last day; `sameCall` and the cache key must compare it.
- **Resolution:** rule: `toLocalDate` is `null` unless `analyticsSpan === 'CUSTOM'`; a non-null `to` on another span, or null on CUSTOM, is `invalidInput('toLocalDate')`; `sameCall` and the cache key compare it.

### readiness-9b-11 — The range sheet's bounds have no implementation path — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`; also `egm-codebase-details` (its finding 16, the item-75 half).
- **Affected scope:** item 75 (lines 1380–1383).
- **Discrepancy:** `ui-date-field` (`libs/ui/controls/src/lib/date-field/date-field.ts`) has `value: model<UiDateFieldParts | null>`, `error`, `disabled` and no min/max; "bounded by the reach and today" and "from > to swaps; over 366 days disables" need a validator and words for out-of-reach, future and the swap — only `range.tooLong` is given. As worded, the sheet compares dates itself, a decision Law 10.2 reserves for a system/companion.
- **Resolution:** the sheet calls `AnalyticsPeriod.of(Custom, from, to)` + `isWithinRange` inside the store's `computed` and reads the `Result` (a named companion for the swap); name the `UiDateFieldParts → LocalDate` conversion (a presenter helper) and the keys `staffAnalytics.range.beforeReach`, `range.afterToday`; «Приложи» disabled on any refusal.

### readiness-9b-12 — Property P1's assertion set is not enumerated — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`; also `egm-style` (its N19).
- **Affected scope:** items 51, 67 (lines 1272–1276, 1347–1350); Verification Plan line 1519; feature line 469.
- **Discrepancy:** "`sum(days.map(fold))` equals `StaffAnalyticsSystem.report`'s figures" — the report has rates, the hero, bar segments and drill-down rows; `DayFigures` has none of those and has `dayServices` without `takingsPerHourCents`. The plan also drops the live term the feature range states (`sum(days.map(fold)) + live === report(visits)`).
- **Resolution:** list the pairs: each `day*Minutes` sum ↔ `report*Minutes`; `dayTakingsCents/TipsCents` ↔ `reportTakingsCents/TipsCents`; `dayExcludedVisitCount` ↔ `reportExcludedVisitCount`; `dayRebookedBase/Count`; `dayNoShowCount/Base`; `dayLateCancellationCount`; the three origin counts ↔ `reportOrigins`; `dayServices` merged by `serviceId` ↔ `reportServices` minus the derived ratio; `dayHourWorked/Rostered` ↔ `reportHourGrid`; and the fixture's `now` (28th 09:00) so only days ≤ 26th are folded. Use the feature range's formula in both places.

### readiness-9b-13 — The radar system's signature contradicts its rule — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 82–83 (lines 1410–1417); lines 480–485, 584–590.
- **Discrepancy:** `axes(figures: BarberFigures, best: BarberFigures)` — "best" is the per-axis maximum among barbers meeting each axis's floor, so a different barber per axis; one `BarberFigures` cannot carry it. Fill's base ("7 rostered days") has no source: `BarberFigures` has minutes, not a rostered-day count.
- **Resolution:** `RadarBest = { takingsPerHour: number | null; fill; rebooking; tipsRate }` returned by `bestOf`; `BarberFigures` gains `rosteredDayCount` in item 83 beside `serviceMinutes` and `workedSeatCount`.

### readiness-9b-14 — Goals: the edge refusal table, the audit variant's fields and who is refused — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 89, 91 (lines 1443–1446, 1452–1456).
- **Discrepancy:** `apps/functions/src/edge.ts` `ANALYTICS_WIRE` (lines 429–435) maps every `AnalyticsErrorCode` to an HTTPS code and is spec-pinned; PR 6 adds two codes and lists no `edge.ts` change. The `AuditContext` variant fields for `AnalyticsGoalSet` are unnamed, yet `firestore.indexes.json`'s `auditLog.goal*` overrides need their exact names. Whether a blocked/unlinked/receptionist caller gets `ANALYTICS_GOAL_FORBIDDEN` or v1's `ANALYTICS_FORBIDDEN`/`ANALYTICS_BARBER_NOT_LINKED` (i.e. whether the pipeline reuses `callerOf`/`scopeOf`) is open.
- **Resolution:** add `edge.ts` (+ spec) to item 89 (`GoalForbidden → permission-denied`, `GoalInvalidRange → invalid-argument` with `field`); name the variant fields `goalKey`, `goalScopeBarberId`, `goalMonth`, `goalLowCents`, `goalHighCents`; rule: the caller is judged by `callerOf` + `scopeOf` first (v1 codes), then `GoalForbidden` only for a barber naming another scope.

### codebase-9b-8 — `setAnalyticsGoal`'s dictionary is misnamed and its App Check token class undecided — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** item 90 (lines 1447–1451).
- **Discrepancy:** the plan adds "`SetAnalyticsGoal: 'setAnalyticsGoal'` in `CallableWire`". The name dictionary is `Callables` (`libs/ecs-core/src/ports/callables.ts:41–69`); `CallableWire` (line 79) is the type keyed by it. `CALLABLE_APP_CHECK_TOKEN` (lines 288–318) is total over `CallableName` and takes `AppCheckTokenUse.Standard | LimitedUse` — the plan does not say which (`setRoles`, the erasure and the export are `LimitedUse`; every other write is `Standard`); the `OPERATION_ID_FIELD` value is unstated.
- **Resolution:** name `Callables.SetAnalyticsGoal` plus the `CallableWire` entry; state the token class (recommend `Standard` — a goal is the caller's own month figure, not a destructive act) and `OPERATION_ID_FIELD: 'operationId'`.

### readiness-9b-15 — The shop CSV's "services per barber" has no data source — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 99, 101 (lines 1485–1494); the contract (575, 579); "Export (PR 7)" (724–730).
- **Discrepancy:** the shop report carries one shop-wide `reportServices`; `DayRow` excludes `dayServices`; `BarberFigures` has no service rows. "One row per service row per barber" cannot be built on the device for the shop scope.
- **Resolution:** either add `reportBarberServices: readonly { barberId; serviceId; workedSeatCount; takingsCents; serviceMinutes }[]` (shop scope, from the day documents' `dayServices` and the live days) in PR 4b/5 and size it inside the ≤ 100 kB budget, or define block 2 for the shop as shop-wide rows with `бръснар = Всички` and amend item 101's row-count formula.

### readiness-9b-16 — `periodInSpan` and `stepsOf` for the new spans are undefined — 🟡 Major

- **Reviewer lens:** `egm-implementation-readiness`.
- **Affected scope:** items 41, 76 (lines 1222–1225, 1384–1388).
- **Discrepancy:** switching MONTH → DAY needs a rule for which day (today if inside the period, else the period's first day?); WEEK/MONTH → YEAR (the year holding `from`?); → CUSTOM (opens the sheet, no period change?); `stepsOf` on CUSTOM (shift by the range's length, or disabled?).
- **Resolution:** state the rules in item 41 (DAY) and item 76 (YEAR/CUSTOM).

### codebase-9b-1 — `RecomputeJobName` is not in `ids.primitive.ts` — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`; also `egm-style` (its M6) and `egm-implementation-readiness` (its N8).
- **Affected scope:** item 48 (lines 1256–1258); item 49.
- **Discrepancy:** the plan adds `RecomputeJobName.AnalyticsDays: 'ANALYTICS_DAYS'` in `libs/ecs-core/src/primitives/ids.primitive.ts`. The dictionary lives at `libs/ecs-core/src/entities/policy-recompute-job.entity.ts:17–21` (`RecomputeJobName = { ClientStatsPolicy: 'CLIENT_STATS_POLICY' }`), entities tier; `ids.primitive.ts` holds only id brands/companions.
- **Rationale:** following the item redeclares the dictionary in a second tier — two homes for one name, which `verify-tools:layering` refuses.
- **Resolution:** either (a) extend the dictionary where it is, have `analytics-recompute-job.entity.ts` import it as a sibling (`./policy-recompute-job.entity`) and list the policy entity file as Modify (move the clause to item 49); or (b) move it to a primitives `recompute-job-name.data.ts` (base tag dictionaries are allowed there) and list the entity file and the `@core/entities` barrel change. Say which.

### codebase-9b-2 — The `CapacityMonthId → MonthKey` rename list is wrong in both directions — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** item 87 (lines 1431–1437).
- **Discrepancy:** the plan lists `tools/seed-dev-catalog.mjs`, which has no `CapacityMonthId`/`monthKey` reference (and `.mjs` is not compiler-checked, so the false entry would not be caught), and "the capacity adapters under `apps/functions/src/adapters` and `libs/infrastructure`" — the adapters do not name the brand; only their specs do. Files that DO name it and are missing: `libs/features/client/booking/src/lib/schedule-step/availability-month.ts`, `booking-day.store.ts`, `booking-schedule-step.spec.ts`; `libs/ecs-core/src/testing/port-doubles.spec.ts`; `libs/ecs-core/src/pipelines/{shop-day,sample-lead-time,rebuild-capacity}.pipeline.spec.ts`; `libs/ecs-core/src/systems/capacity.system.spec.ts`; `libs/infrastructure/firestore/src/lib/scheduling.adapter.spec.ts` and `.integration.spec.ts`; `apps/functions/src/adapters/firestore-capacity.adapter.spec.ts`; `apps/functions/src/integration/rebuild-capacity.integration.spec.ts`. (Correctly listed: `ids.primitive.ts`, `ids.type-spec.ts`, `local-date.primitive.ts` (`monthKey(d): CapacityMonthId` at line 257), `capacity-month.entity.ts`, `scheduling.port.ts`, `shop-day.pipeline.ts`, `rebuild-capacity.pipeline.ts`, `capacity.system.ts`, `lead-time.system.ts`.)
- **Resolution:** replace the list with the files above, drop the seed, and note that the client booking feature is touched (its lib's lint/test run becomes part of PR 6's gate).

### codebase-9b-5 — A refused cached report does not read as `null`, and the adapter has no version constant of its own — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** items 27 and 74 (lines 1173–1176, 1377–1379).
- **Discrepancy:** the plan says a cached answer the decoder refuses "reads as no cache (`readCachedReport` → `null`)" and "the version constant 2 drops v1 entries". `localStorageAnalyticsCachePorts.readCachedReport` (`libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts:56–81`) deletes the entry and answers `Result.err(RepositoryError.malformed(storageKey, …))`; `Result.ok(null)` is only an absent entry; the store's `paint` treats `!cached.ok` as nothing to paint (`staff-analytics.store.ts:257`). `VERSION_PREFIX` is built from `ANALYTICS_DEFINITION_VERSION` imported from `@core/components` (lines 2, 14), so item 69's bump is what drops v1 entries.
- **Resolution:** word both spec pins as `Result.err` with `REPOSITORY_MALFORMED` and the entry removed; drop "the version constant 2" from item 74 (the key change — `to` and the comparison — stands).

### codebase-9b-6 — The glyph vocabulary is `icon-vocabulary.ts`, not `icon-manifest.ts` — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** item 5 (lines 1074–1076).
- **Discrepancy:** the plan adds `analytics.chart` (Material `bar_chart`) in `libs/ui/icons/src/lib/manifest/icon-manifest.ts`. That file is "pure data — the shape, its tag dictionaries, the shorthand normalizer and the merge — with no import at all" (lines 12–15); the semantic keys (`'appointment.book': 'calendar_month'`, …) are in `libs/ui/icons/src/lib/manifest/icon-vocabulary.ts:43–84`. `bar_chart` is not yet in `material-glyphs.generated.ts`, so `pnpm icons:glyphs` is indeed required, as the plan says.
- **Resolution:** item 5 → `icon-vocabulary.ts` (Modify); keep `icon-vocabulary.spec.ts` and `pnpm icons:glyphs`.

### codebase-9b-7 — `libs/infrastructure/web-storage/README.md` does not exist — 🟡 Major

- **Reviewer lens:** `egm-codebase-details`.
- **Affected scope:** item 98 (lines 1478–1481).
- **Discrepancy:** the plan marks it Modify; the lib has `project.json`, `src/index.ts`, `src/lib/*` and no README.
- **Resolution:** mark Create.

### style-9b-1 — Wrong element selector for the prefetched page — 🟡 Major

- **Reviewer lens:** `egm-style`; also `egm-codebase-details` (its finding 13) and `egm-implementation-readiness` (its N3).
- **Affected scope:** item 1 (lines 1058–1063).
- **Discrepancy:** "`@defer (when false; prefetch on idle) { <lib-staff-analytics-page /> }`". The page's selector is `lib-staff-analytics` (`libs/features/staff/analytics/src/lib/staff-analytics-page/staff-analytics.page.ts:79`). The boundary claim is correct (`type:feature` → `type:feature` allowed, root `eslint.config.mjs:222–229`), and `libs/features/staff/analytics/src/index.ts:10` already exports `StaffAnalyticsPage`.
- **Rationale:** a template with the wrong tag fails `pnpm nx build web` (typecheck does not see templates).
- **Resolution:** "`@defer (when false; prefetch on idle) { <lib-staff-analytics /> }`".

### style-9b-2 — The route-binding name and `pickedTo` do not match the feature range — 🟡 Major

- **Reviewer lens:** `egm-style`.
- **Affected scope:** item 7 (lines 1087–1090); items 6, 44, 76; feature line 687.
- **Discrepancy:** the plan says "`bindAnalyticsRouteInputs(page, store)`, the schedule's `bindRouteInputs` pattern copied on purpose" and gives the store `applyRoute*` entry points; the feature range says "`StaffAnalyticsStore` gains `pickedTo` and a `bindRouteInputs` reader of `?span&from&to&barber`". `pickedTo` appears nowhere in the plan (item 76, CUSTOM, is where it must land).
- **Resolution:** item 7 — "`bindAnalyticsRouteInputs(page, store)` (the name line 687 calls `bindRouteInputs`), following the schedule's `route-inputs.ts`: untracked store calls; …", and fix line 687 or the plan so one name is used; item 76 — add "`pickedTo` beside `pickedFrom`" to the store's deliverables; drop "copied on purpose".

### style-9b-3 — Who produces the freshness string is ambiguous, and `relativeTime` has no «току-що» branch — 🟡 Major

- **Reviewer lens:** `egm-style`; also `egm-implementation-readiness` (its N2) and `egm-codebase-details` (its finding 14).
- **Affected scope:** items 9 and 10 (lines 1094–1103).
- **Discrepancy:** item 9: "`statusOf` words the freshness through `relativeTime(report.reportComputedAtUtcMs, now, lang)`: under one minute … → «току-що»; …"; item 10 lists `status.justNow`, `status.updatedAgo`, `status.info`. `relativeTime(target, now, lang, style = 'long')` (`libs/infrastructure/i18n/src/lib/relative-time.ts:39`) returns Intl phrasing ("преди 5 минути"; `'short'` → "преди 5 мин"), formats 0 minutes as the locale's "now" word and has no same-day/other-day branches. If it returns the finished phrase, `status.justNow`/`status.updatedAgo` duplicate it; if the presenter branches, four wordings need keys and only two are listed. The item also restates the four branches of "Freshness" (679–682) verbatim.
- **Resolution:** state the split once in item 9: the presenter branches on `UtcEpochMs.elapsedMs`; `status.justNow` for under one minute (and negative); `relativeTime(…, 'short')` wrapped as `status.updatedAgo` («Обновено {age}») for 1–59 minutes; `formatInstant` time for the same shop day (date parts compared) and date + time otherwise; list in item 10 exactly the keys that result; replace the verbatim branches with "the four branches of Freshness".

### style-9b-5 — Two names for the recompute job document constant — 🟡 Major

- **Reviewer lens:** `egm-style`.
- **Affected scope:** item 49 (line 1264) versus item 61(c) (line 1317).
- **Discrepancy:** item 49: "`ANALYTICS_RECOMPUTE_DOC = AnalyticsRecomputeJobId.FIXED`"; item 61(c): "`onDocumentWritten({ document: ANALYTICS_RECOMPUTE_JOB_DOC, retry: true }, …)`". `collections.ts` holds document ids (`POLICY_RECOMPUTE_DOC = PolicyRecomputeJobId.FIXED`, `libs/ecs-core/src/entities/collections.ts:136`) while `main.ts` builds trigger paths locally (`POLICY_RECOMPUTE_JOB_DOC`, `main.ts:595`; `EXCEPTION_DOC`, line 591). If `ANALYTICS_RECOMPUTE_JOB_DOC` is such a path constant the plan never declares it; if it is item 49's constant the names differ.
- **Resolution:** in item 61(c): "`document: ANALYTICS_RECOMPUTE_JOB_DOC` — a `main.ts`-local path `` `${Collections.BackfillJobs}/${ANALYTICS_RECOMPUTE_DOC}` ``, on the `POLICY_RECOMPUTE_JOB_DOC` model".

### style-9b-6 — Item 88 renders as a broken list — 🟡 Major

- **Reviewer lens:** `egm-style`.
- **Affected scope:** item 88 (lines 1438–1442).
- **Discrepancy:** "`libs/ecs-core/src/components/analytics-goal-call.data.ts`" is followed on the next line by "- `.spec.ts` (Create) — …": the "+ `.spec.ts`" wrapped and the formatter reads "+"/"-" as a list marker, producing a nested bullet. Rendered, the data file appears to have no spec and the entity and `collections.ts` deliverables hang under a stray sub-item.
- **Resolution:** keep the file and its spec on one line: "`libs/ecs-core/src/components/analytics-goal-call.data.ts` and its `.spec.ts` (Create) — `SetAnalyticsGoalCall`, its answer and `decodeSet`; `entities/analytics-goal.entity.ts` + type-spec (Create); `collections.ts` (Modify) — `AnalyticsGoals`."

### style-9b-7 — Wrong Nx project for the rules integration spec — 🟡 Major

- **Reviewer lens:** `egm-style`.
- **Affected scope:** Verification Plan (lines 1529–1530); items 63, 93.
- **Discrepancy:** "`pnpm nx run functions:test-integration` (the two new integration specs of item 66 and the rules denials)". `firestore.rules.integration.spec.ts` lives in `libs/infrastructure/firestore`, whose project is `firestore` with its own `test-integration` target (`libs/infrastructure/firestore/project.json`); `functions:test-integration` does not run it.
- **Resolution:** "`pnpm nx run functions:test-integration` (the two specs of item 66); `pnpm nx run firestore:test-integration` (the `analyticsDays` and `analyticsGoals` denials of items 63 and 93)".

### style-9b-8 — "Per the Chart kit table" cites dimensions the table does not hold — 🟡 Major

- **Reviewer lens:** `egm-style`.
- **Affected scope:** item 19 (lines 1141–1142); the table at 606–611.
- **Discrepancy:** "`ui-bar-chart` per the Chart kit table (4 px rounded data ends, 2 px surface gaps, a legend content slot `[uiChartLegend]`)". The table lists inputs and what each element draws; it says nothing about radii or gaps. The plan is the only place these numbers appear while the sentence says they come from the table.
- **Resolution:** "`ui-bar-chart` with the Chart kit table's inputs; marks: 4 px rounded data ends, 2 px gaps in the surface colour, a legend content slot `[uiChartLegend]`" — or add the two values to the table.

---

## Nits

### Readiness nits (decisions small enough to state in one sentence)

- **readiness-9b-17** 🟢 — items 6(c)/7 (lines 1083–1090): "never a navigation inside the first activation" versus "its first write-back writes the period's first day" — name the trigger of that first write (the deferred write after the first non-null `request`).
- **readiness-9b-18** 🟢 — item 6(a): what PR 1's store does with an unknown `span` value (ignore → current month) — state it.
- **readiness-9b-19** 🟢 — item 17 (lines 1135–1137): `elementWidth()`'s signature and its value when `ResizeObserver` is absent (`0` or `null`).
- **readiness-9b-20** 🟢 — items 25–26 (lines 1165–1172): the `seats`/`stretches` slice types `bucketsOf` takes and the name of the stretches field added to `AnalyticsDay`.
- **readiness-9b-21** 🟢 — item 55: the command field `source: 'APPOINTMENT' | 'DEPARTURE' | 'RECOMPUTE'` has no `as const` dictionary and no domain prefix (Laws 1/6); name it, e.g. `analyticsDaySource` with `AnalyticsDaySource`.
- **readiness-9b-22** 🟢 — item 71 (lines 1368–1370): the `localDate` of a partial first/last ISO week in the weekly grain (the week's Monday or the period's first day).
- **readiness-9b-23** 🟢 — item 90 (lines 1447–1451): the `OPERATION_ID_FIELD` and `CALLABLE_APP_CHECK_TOKEN` values for `SetAnalyticsGoal` (see codebase-9b-8).
- **readiness-9b-24** 🟢 — item 42 (lines 1226–1228): say DAY reads no follow-ups and no previous-period visits beyond the counterpart day.
- **readiness-9b-25** 🟢 — items 62/77/79: say explicitly that the e2e's `--project demo-creativo-test` reads the `development` map (per `write-functions-env.mjs`), so 4b's e2e depends on item 77's development `true` and 4a's integration specs run flag-off.
- **readiness-9b-26** 🟢 — item 14 (lines 1118–1123): the `RouteReuseStrategy`'s store/retrieve keying (one detached handle for `staff/schedule`) — one sentence.

### Codebase nits

- **codebase-9b-9** 🟢 — item 59 (lines 1301–1306; design 549–550): the policy-job read `loadPolicyRecomputeJob` is `PolicyRecomputeJobPorts` (`scheduling.port.ts:513–518`, inside `AdminBatchPorts`) and lives in `apps/functions/src/adapters/firestore-client-stats.adapter.ts:56`, not `firestore-jobs.adapter.ts`. Placing `loadAnalyticsRecomputeJob` in `firestore-jobs.adapter.ts` is legitimate — say so, and name the factory's new return type (`BackfillJobPorts & CallerRolesPorts & AnalyticsRecomputeJobPorts`) beside the `FirestorePorts` intersection change in `firestore-ports.ts` (its extension rule, lines 79–83).
- **codebase-9b-10** 🟢 — item 47 (line 1254): `analytics-rows-page/*` does not use `DayRow`; only `analytics.presenter.ts`, `analytics.vm.ts` and `analytics-call.data.ts`'s `dayRowOf` reference it. Drop it from item 47 or say why it changes.
- **codebase-9b-11** 🟢 — items 50, 64, 65 (lines 1265–1271, 1334–1340): more "seven" sites to update with the eighth TTL group — `retention.system.ts:5`, `firestore-ttl.adapter.ts:19`, `retention-group.data.ts:4–7` (the collection list), `docs/architecture/firestore-runbook.md §2.1`, `.claude/rules/firestore-layout.md:115–117`. Only `tools/verify/ops/retention.spec.mjs` and `production-deploy.md` are listed.
- **codebase-9b-12** 🟢 — item 31 (lines 1186–1189): "bucketing by grain" reads as a presenter grouping rule (Law 10.2); the grain is the system's (`reportSeries`/`reportTimeSeries` per span) — word it as a 1:1 mapping with span-dependent labels.
- **codebase-9b-13** 🟢 — item 15 (lines 1127–1132): the new library's Nx project name is unstated (`nx g @nx/angular:library charts --directory=libs/ui/charts …`); siblings are `tokens`, `layout`, `patterns`, `controls` — say `charts`, since `nx run charts:test` and the per-tier lint config depend on it. The generator's flag set was not verified (CLAUDE.md §6: `nx-generate` skill first).

### Style nits

- **style-9b-4** 🟢 — item 27 (line 1176): "pinned in the adapter spec of item 72" — item 72 is `analytics.error.ts`; the cache adapter and its spec are item 74. (Also readiness N1.)
- **style-9b-9** 🟢 — lines 1053–1054: the "Pay and sealing are their own design…" paragraph repeats Non-Goals (194–196) and D8. Delete or reduce to "Pay and sealing: Non-Goals, D8."
- **style-9b-10** 🟢 — items 3–4 (lines 1069–1073): item 4 is "(Modify, conditional)" while item 3's `view-transition-name` clause carries the same condition but is "(Modify)". Mark item 3 "(Modify; the `view-transition-name` line conditional on item 14)" and state the order once: item 14 runs first.
- **style-9b-11** 🟢 — item 6(a) (line 1078): "`applyRouteSpan/From/To/Barber`" is not greppable; write `applyRouteSpan`, `applyRouteFrom`, `applyRouteTo`, `applyRouteBarber`.
- **style-9b-12** 🟢 — item 13(a) (line 1113): "as navigated" is unclear → "the URL is `/staff/analytics?span=WEEK&from=<day>&barber=<id>` on arrival, before the store's first write-back".
- **style-9b-13** 🟢 — item 14 (line 1122): "`apps/web/src/app/schedule-reuse.strategy.ts` (Create) and `app.config.ts` (Modify)" — write `apps/web/src/app/app.config.ts`, as every other item does.
- **style-9b-14** 🟢 — item 15 (line 1132): "the a11y contract" — the feature range says "Accessibility" (618); write "the accessibility contract".
- **style-9b-15** 🟢 — item 18 (lines 1138–1139): "(Create) + a spec each (Create)" → "`linear-scale.ts`, `line-path.ts`, `stack-offsets.ts` + a spec each (Create)".
- **style-9b-16** 🟢 — item 17 (line 1137): "`libs/ui/layout/src/index.ts` (Modify)." says nothing about the change; add "— export it".
- **style-9b-17** 🟢 — item 37 (line 1208): "the time bars' legend sums equal the figure" — name it: "equal the period's rostered minutes (the time bar's total)".
- **style-9b-18** 🟢 — lines 1155, 1245–1247, 1252, 1258, 1455, 1492: continuation lines inside numbered items start at column 0; where a code span spans the break the backtick pairing is hard to follow. Indent to the item's text column.
- **style-9b-19** 🟢 — item 60 (lines 1309–1311): garbled clause → "the appointment trigger reuses `decodeRebuildBusyEvent`'s command; the writer's command adds `sourceAppointmentId = after.bookedFromAppointmentId ?? before.bookedFromAppointmentId`, copied from the event (no read)" — then reconcile with codebase-9b-3.
- **style-9b-20** 🟢 — items 61(e), 65, 69 (lines 1321, 1338, 1359): imperative voice ("raise the number…", "change "7 of 7" to "8 of 8"", "document the grain…") amid noun-phrase items. Pick one voice; for 65 give the explicit numbers: "§P2 "7 of 7" → "8 of 8"; §P3 24 → 25 composites" (matching NFR line 983).
- **style-9b-21** 🟢 — item 62 (line 1329): "the manifest spec pins every key is a `FlagName`" → "pins that every key is a `FlagName`".
- **style-9b-22** 🟢 — item 66 (line 1342): "run by `nx run functions:test-integration`" — CLAUDE.md §6 requires the `pnpm nx …` prefix.
- **style-9b-23** 🟢 — item 49 (line 1260): "`BarberAnalyticsDayMeta = { id: BarberAnalyticsDayId }` `& DayFigures`" reads as two types → "`BarberAnalyticsDayMeta = { id: BarberAnalyticsDayId }`; `BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures`".
- **style-9b-24** 🟢 — items 75 and 95 (lines 1382, 1467): "the dock" collides with the Term (153: the page's bottom `ui-page-action-bar`); `ui-modal-sheet` has no "dock". Write "the sheet's action row" or name the actual slot.
- **style-9b-25** 🟢 — item 74 (line 1378): "the version constant 2 drops v1 entries" → see codebase-9b-5; if kept, name `ANALYTICS_DEFINITION_VERSION` in `VERSION_PREFIX` (`local-storage-analytics-cache.adapter.ts:14`).
- **style-9b-26** 🟢 — items 63 (line 1333) and 93 (line 1462): non-parallel denial cases ("a client read and write of `analyticsDays` are denied" versus "a client read by a colleague is denied"). Rules deny all; make 93 parallel.
- **style-9b-27** 🟢 — item 96 (line 1471): "`ui-gauge` `circularCapacity`" → "`ui-gauge` with `uiGaugeStyle="circularCapacity"`" (`gauge.ts:127`).
- **style-9b-28** 🟢 — item 103 (lines 1502–1504): "a banner on each of …, each marked superseded by v2" → "a "superseded by v2" banner on "Reads and cost", Alternative C's rejection reason, the Non-Goals' pay line and Future Improvements".
- **style-9b-29** 🟢 — item 106 (line 1508): "the v2 deploy order as one checklist item set" → "one checklist block with the v2 deploy order (indexes + TTL → rules → functions → web; the flag flip)".
- **style-9b-30** 🟢 — Verification Plan (line 1528): "the new systems at 100 % branch coverage (they are pure)" — drop the justification.
- **style-9b-31** 🟢 — item 47 (lines 1244–1255): one 12-line sentence over seven files; split into (a) `day-figures.data.ts` + spec, (b) `analytics-report.data.ts`/`analytics-call.data.ts`, (c) the feature's renamed-field consumers, (d) fixtures — the pattern items 6 and 61 already use.
- **style-9b-32** 🟢 — item 72 (PR 4b) says "`invalidInput` names `toLocalDate`/`analyticsComparison`" but item 40 (PR 3) already decodes `analyticsComparison` and refuses `SAME_LAST_YEAR`. Move the `analyticsComparison` half to item 40, or state there that the `field` value is a plain string until item 72.
- **style-9b-33** 🟢 — item 6(d) (line 1086): "cleared in `DestroyRef`" — the hook is `DestroyRef.onDestroy`.
- **style-9b-34** 🟢 — item 9 (lines 1096–1098): the four freshness branches duplicate "Freshness" (679–682); keep only what is new there (folded into style-9b-3's resolution).

---

## Standard-required elements (readiness lens)

Present: PR ordering and dependencies (the table), a gate per PR, a deploy order per PR, flag and rollout steps (items 62, 65, 77; NFR), rollback (NFR). Data migration is not applicable and the plan says so (greenfield; the first nightly pass fills the reach). Verification commands are named and exist.

**Items judged implementable as written** (readiness lens): 2, 3, 4, 5 (once codebase-9b-6 is applied), 8, 10, 11, 12, 13, 15, 16, 18, 22, 23, 24, 28, 29, 30, 34, 35, 36, 37, 38, 40, 43, 45, 46, 49, 50, 54, 57, 58, 59, 60, 61(b)–(f), 63, 64, 65, 66 (once readiness-9b-2/3 are settled), 68, 70, 72, 74, 80, 81, 84, 85, 86, 87 (with codebase-9b-2's list), 88, 92, 93, 94, 95, 96, 97, 98, 100, 102–106.

---

## Code claims verified correct

Every claim below was checked read-only against the repository by `egm-codebase-details` and matched the plan.

**PR 1**

- `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.html` exists; the trailing cluster is view (`staff-view-segments`/`staff-view-trigger`, 101–142) · search (`staff-search-open`, 180–183) · scope (`staff-scope-trigger`, 210–215); `@defer (when …; prefetch on idle)` precedents at 324, 1190, 1202, 1205, 1291, 1400, 1465.
- `staff-dashboard.ts`, `staff-dashboard.chrome.css`, `staff-dashboard.spec.ts` exist; `store.dayKey()`, `store.todayKey()`, `store.scope()` are real `StaffDayStore` members (`staff-day.store.ts:686–698, 1061–1062`).
- `apps/web/src/styles.css` has `::view-transition-group(staff-search-field)` (218) and the reduced-motion `::view-transition-*` rules (227–229).
- `apps/web/src/app/app.config.ts`: `withComponentInputBinding()` (255) and `withViewTransitions(…)` (256) on; no `RouteReuseStrategy` yet (new, item 14). `app.routes.ts`: `staff/schedule` (136), `staff/analytics` lazy via `@creativo/features/staff/analytics` (147–153).
- `pnpm icons:glyphs` → `node tools/icons/build-material-glyphs.mjs` (`package.json:21`); `icon-vocabulary.spec.ts` exists; `bar_chart` is not yet in `material-glyphs.generated.ts`.
- `staff-analytics.store.ts`: `pickedPeriod`, `openedAtUtcMs` from `CLOCK_PORTS`, `pickSpan`/`step`/`pickScope`/`retry`; no route inputs yet. The schedule's pattern exists: `StaffDayStore.published` (727–732), `applyRouteDay/View/Barber/Free`, the deferred `replaceUrl: true` write (956–969).
- `libs/features/staff/dashboard/src/lib/staff-dashboard/route-inputs.ts` `bindRouteInputs(page, store)` does exactly what item 7 describes (untracked store calls, `undefined → null`, `?free=` never navigates in the first activation).
- `staff-analytics.page.ts` (`lib-staff-analytics`, `providers: [StaffAnalyticsStore]`); `analytics.presenter.ts` `statusOf` (148) using `formatInstant` from `@creativo/ui/wall-clock` (287); `relativeTime` exported from `@creativo/infrastructure/i18n` (`index.ts:2`).
- `analytics.words.ts` reads `staffAnalytics.status.{asOf,refreshing,failed,failedNoCache,retry,scopeGone}`; `bg.json` has `staffAnalytics.status` (2648–2655) and a `staff.day` family (1027, 1058); `en.json` exists.
- Specs exist: `analytics.presenter.spec.ts`, `staff-analytics.store.spec.ts`, `staff-analytics-page/staff-analytics.page.spec.ts`, `staff-dashboard.spec.ts`.
- `apps/web/e2e/staff-analytics.spec.ts` exists with the menu case (`nav-menu-trigger` → `menu-staff-analytics`, 128–129) and the `?free=1` open-hours case (204).

**PR 2**

- No `libs/ui/charts`, no `libs/ui/layout/src/lib/resize/`, no `libs/ui/tokens/src/lib/chart-palette.spec.ts`, no `apps/showcase/src/app/pages/controls/charts/` — all genuinely new.
- `tsconfig.base.json`: `@creativo/ui/{tokens,modifiers,controls,layout,patterns,wall-clock,theme}` (25–31), `@creativo/ui/icons` (119), the seven `@core/*` + `@core/testing` aliases (122–129).
- `libs/ui/patterns/eslint.config.mjs` extends `#eslint-config` with the `ui` selector-prefix rules (the file to copy); `libs/ui/layout/src/index.ts` is the barrel to extend.
- `libs/ui/tokens/src/lib/contrast.ts` exports `composite(top, alpha, under)`, `contrastRatio`, `parseHex`, `WCAG_AA_LARGE_TEXT = 3`; `accent-rule.spec.ts`, `accent-spec-support.ts` (reads CSS with `readFileSync`) exist; the tokens `test` target inputs already cover `{workspaceRoot}/libs/ui/**/*.css` (`project.json:34`).
- `apps/showcase/src/app/app.routes.ts` lazy `loadComponent` routes; `pages/controls/controls.page.ts` index entries `{ slug, name }` (100–101); `apps/showcase/e2e/design-system.spec.ts` `CONTROL_ROUTES` of `'controls/<slug>'` strings (11–22).
- `libs/ecs-core/src/systems/staff-analytics.system.ts`: `daysOf(input: AnalyticsDaysInput)` (626), `AnalyticsDay = ChairDay & {…}` (92; `ChairDay` is `chair-time.system.ts:51`), `report(input)` (738), `RATE_BASE = 20` (212, exported 472), `scopeOf` (711), `scopeChoicesOf` (967), `stepsOf` (1003), `periodInSpan` (1026), `mergeVisits` (546), `followUpOf` (604), `nowByLocation: readonly ShopNowAt[]` (150). No `isPastDay`, `comparisonOf` or `VISITS_PER_BARBER_DAY` yet (new, item 53). Spec exists.
- `components/analytics-report.data.ts`: `ANALYTICS_DEFINITION_VERSION = 1` (17), `AnalyticsReport.{ServiceRow,WeekdayFill,OriginShare,BarberFigures,DayRow,SeatRow}`; `BarberFigures` lacks `serviceMinutes`/`workedSeatCount` (new, item 83). `analytics-call.data.ts`: `AnalyticsCall = { scopeBarberId; fromLocalDate; analyticsSpan }` (no `toLocalDate`/`analyticsComparison` yet), `AnalyticsCall.decodeReport` (240), `dayRowOf` (180). `analytics-call.data.spec.ts`, `analytics-dictionaries.type-spec.ts`, `testing/analytics-report.fixtures.ts`, `systems/index.ts`, `components/index.ts` exist.
- `apps/functions/src/main.spec.ts`: `ENDPOINTS` (290), `EXPORTS` (372), `FLIPPED_EXPORTS` (1189, pinned `toHaveLength(54)` at 1295), `daily('every day 03:00' | '03:30' | '04:00')` rows.
- `analytics.vm.ts`: `AnalyticsShareGroupVm` (188), `AnalyticsBarSegmentVm`, `AnalyticsStatusVm`; page template test ids `analytics-title`, `analytics-span`, `analytics-scopes`, `analytics-hero`, `analytics-takings`, `analytics-open`, `data-load`, `<lib-analytics-time-bar>`, `<lib-analytics-rows-page>` all present.
- `analytics-time-bar/analytics-time-bar.{ts,css}` exist; colour rules at `.css:33–49` (`[data-part=…]`, accent + `color-mix` 72/50/32/18/9 %).
- `tools/verify/bundle/budgets.json`: `"libs/features/staff/analytics/src/index.ts": 1680000` (12); `pnpm run verify:bundle` (`package.json:16`).
- `libs/features/staff/dashboard/src/lib/staff-analytics.agreement.spec.ts` exists.

**PR 3**

- `components/analytics-period.data.ts`: `AnalyticsSpan = { Week, Month }`, `AnalyticsPeriod.{weekOf, monthOf, of(span, from), previous, isWithinRange, days, length}`, module-private `REACH_MONTHS = 12`; no `analytics-period.data.spec.ts` exists (Create is right). No `Day`, `dayOf`, `isComparable`, `CUSTOM_MAX_DAYS` yet.
- `pipelines/staff-analytics.pipeline.ts` (`StaffAnalyticsPorts` 84, `staffAnalytics` 118, `LogEvent.AnalyticsReported` with `durationMs` 276–283) + spec; `apps/functions/src/wire/analytics.wire.ts` (`decodeStaffAnalytics` 29) + spec.

**PR 4a**

- `MinuteCount`, `BusyKey` (`busy-key.primitive.ts`), `BarberBusyDayId` (`ids.primitive.ts:186–187`), `idCompanion` (89), `PolicyRecomputeJobId.FIXED = 'clientStatsPolicy'` (396–400), `CapacityMonthId` (202–203); `ids.primitive.spec.ts`, `ids.type-spec.ts` exist.
- `entities/policy-recompute-job.entity.ts` (`PolicyRecomputeJob`), `entities/collections.ts` (`Collections.BackfillJobs = 'backfillJobs'`, `POLICY_RECOMPUTE_DOC = PolicyRecomputeJobId.FIXED` at 136).
- `components/retention-group.data.ts` (`RetentionGroup`, `RetentionAnchor`, seven variants) + spec + type-spec; `systems/retention.system.ts` (`purgeAtUtcMs` 93, `*_KEEP_DAYS` 31–47, `LEAD_TIME_KEEP_DAYS = 400`, the doc-comment table 12–20) + spec; `apps/functions/src/adapters/firestore-ttl.adapter.ts` `anchorOf` switch on the last collection segment (96–127) + spec.
- `systems/policy-recompute-job.system.ts` + spec; `pipelines/{start,continue,sweep}-policy-recompute.pipeline.ts` + specs.
- `ports/analytics.port.ts` (`AnalyticsReadPorts` 99, `AnalyticsCallPorts`, `AnalyticsCachePorts`, `AnalyticsCacheKey = AnalyticsCall & { userId }`), `ports/index.ts`; `testing/analytics-doubles.ts` `memoryAnalyticsReadPorts(state) → { ports, log }`; `testing/index.ts` re-exports `analytics-doubles`, `analytics-report.fixtures`, `analytics.fixtures`.
- `RepositoryError.readFailed(path, reason)` (`errors/repository.error.ts:47`); `ReadTx.get/getAll/query` and `CommitPlan` (`ports/tx.port.ts:89–134`); `WriteOp.set(path, body)` (`components/write-op.data.ts:40`); `CommitPorts`, `ClockPorts` (`tx.port.ts:165, 188`); `LogPorts` (`telemetry.port.ts:77`); `ShopDayReadPorts`, `PolicyReadPorts` (`scheduling.port.ts:473, 468`); `LocationLoadPorts`, `DefaultLocationPorts` (`catalog.port.ts:104, 113`); `FlagsPorts` (`flags.port.ts:12`).
- `pipelines/index.ts`; `primitives/log-event.data.ts` (`LogEvent.AnalyticsReported = 'analytics.reported'` at 19) + spec.
- `apps/functions/src/adapters/firestore-analytics.adapter.ts`: module-private `VISITS_PER_BARBER_DAY = 60` (54), `overBound` from `./store-answer` (14, 89), `firestoreAnalyticsPorts(db, guardOf, log)` (66) + spec; `firestore-jobs.adapter.ts` `firestoreJobPorts(db, guardOf, log): BackfillJobPorts & CallerRolesPorts` + spec; `firestore-ports.ts` `FirestorePorts` intersection with `AnalyticsReadPorts` (127) and the spread (152).
- `apps/functions/src/wire/triggers.wire.ts`: `decodeRebuildBusyEvent` (224), `decodePolicyStepEvent` (324), `POLICY_STEP_TIMEOUT_SECONDS = 540` (111) + spec; `TriggerAttemptSystem.decisiveFailure`.
- `apps/functions/src/main.ts`: `rebuildBusyOnAppointmentChange = onDocumentWritten({ document: APPOINTMENT_DOC, retry: true }, …)` (940), `EXCEPTION_DOC` (591), `POLICY_RECOMPUTE_JOB_DOC` (595), `continueClientStatsPolicyRecompute` with `timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS, memory: LARGE_MEMORY` (1126–1134), schedules `every day 03:00 / 03:30 / 04:00` with `timeZone: CRON_TIME_ZONE, retryCount: 3` (1030–1037, 1147) — `04:30` is free; `staffAnalytics = onCall({ …LOG_DIGEST_SECRETS, memory: LARGE_MEMORY }, …)` (874); `serverPorts = once(…)` (338), `streakPorts = once(() => { …server, …paramFlagsPorts() })` (416–420); `paramFlagsPorts(): FlagsPorts` (`adapters/flags.adapter.ts:10`); `onEmulator()` (313).
- `apps/functions/src/lib/cron-zone.ts`: `CRON_TIME_ZONE = 'Europe/Sofia'`, comment "main.ts' three `onSchedule` options" — three is the current count, so "raise by one" is right.
- `components/feature-flags.data.ts`: `FlagName`, module-private `ALL_OFF`, `FeatureFlags.flagOn` + spec; `apps/functions/src/lib/flags.ts` `FLAG_PARAMS: Readonly<Record<FlagName, BooleanParam>>` (62) and `flagOn(key)` + spec; `config/feature-flags.json` with `development`/`staging`/`production`, 13 keys each, no `analytics.storedDays` yet.
- `firestore.rules`: default deny (197–198), the `restricted/link` deny-all match with comment (568–581), otps deny-all (823); `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts` exists.
- `firestore.indexes.json`: 24 composites (incl. `scheduleExceptions (barberId, localDate)` 198–206 and `barberBusy (barberId, localDate)` 152–160 — the shape to copy); `fieldOverrides` with `"indexes": []` precedents (366–433) and `auditLog` overrides (491+); `tools/verify/ops/retention.spec.mjs` `TTL_GROUPS` (7) checks `ttl === true` overrides.
- `docs/production-deploy.md`: P3 "all 24 declared composite indexes are `READY`" (52, 851), P2 "7 of 7 TTL policies `ACTIVE`" (859), §3.1 "Indexes and TTL" (843).
- `apps/functions/src/integration/*.integration.spec.ts` and the `functions:test-integration` target (`apps/functions/project.json:83`).
- `testing/analytics.fixtures.ts`: `ANALYTICS_FIXTURE_MONTH` (122), `analyticsFixturePorts(): StaffAnalyticsPorts` (603); `pipelines/staff-analytics.agreement.spec.ts` exists.
- `BackfillPlanSystem.chunk`, `once()`, `LARGE_MEMORY`, the ResizeObserver guard (`scroll-row.ts:116`), `uiVisuallyHidden` (`libs/ui/modifiers`), `ui-gauge` `circularCapacity` (`gauge.ts:28, 191, 281`) — the reuse the plan names exists.

**PR 4b**

- `errors/analytics.error.ts`: `AnalyticsErrorCode.{…, PeriodOutOfRange, InvalidInput}`, `AnalyticsError.invalidInput(field: string)`, `periodOutOfRange(fromLocalDate)`; no `GoalForbidden`/`GoalInvalidRange` yet.
- `libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts` + spec; key `creativo.analytics/<version>/<uid>/<scope>/<span>-<from>` (29–35) — `to`/comparison not yet encoded.
- `ui-modal-sheet`, `ui-date-field`, `ui-amount-field`, `ui-segmented-control` in `libs/ui/controls`; `ui-page-action-bar`, `ui-gauge`, `ui-metric` in `libs/ui/patterns`.
- `apps/web/e2e/support/run-job.ts` exists with `JobName` (but see readiness-9b-1).

**PR 5–8**

- `AnalyticsReport.BarberFigures` exists (item 83); `components/audit-context.data.ts` `AuditAction` (57) and `AuditContext` (169/202) + spec; `ports/callables.ts` `Callables`, `CallableWire`, `OPERATION_ID_FIELD`, `CALLABLE_APP_CHECK_TOKEN`, `CALLABLE_ANSWER_DECODERS` (all total over `CallableName`, `StaffAnalytics` present); `libs/infrastructure/firebase-app/src/lib/analytics-call.adapter.ts` `analyticsCallPorts(gateway): AnalyticsCallPorts` and `ports.tokens.ts` (`ANALYTICS_CALL_PORTS`, `ANALYTICS_CACHE_PORTS` injected by the store).
- `local-date.primitive.ts` `monthKey(d): CapacityMonthId` (257–258); `capacity-month.entity.ts`, `scheduling.port.ts`, `shop-day.pipeline.ts`, `rebuild-capacity.pipeline.ts`, `capacity.system.ts`, `lead-time.system.ts` name `CapacityMonthId`.
- `libs/features/staff/client-card/src/lib/client-card/client-card.ts` inline JSON download (353–359) and `libs/features/client/appointments/src/lib/client-appointments/client-appointments.ts` inline `.ics` download (885–889) — the two call sites item 98 replaces; `formatCents` at `@creativo/ui/wall-clock:302`.
- `docs/architecture/decisions/2026-11-08-staff-analytics.md`, `docs/designs/staff-analytics.md`, `docs/design-research/staff-analytics/review/implementation_checklist.md`, `libs/features/staff/analytics/README.md` exist; `review-v2/` has no `implementation_checklist.md` yet (Create is right); no `perf/` directory yet.

**Verification plan**

- Lint rules exist with specs beside them: `tools/lint-rules/presenter-purity.mjs`, `no-sliced-ports.mjs`, `query-needs-limit.mjs`.
- Nx targets exist: `verify-tools:layering`, `verify-tools:runbook-gates` (`tools/verify/project.json:12, 20`), `functions:test-integration`; scripts `e2e:web`, `verify:bundle`, `icons:glyphs`, `seed:dev` in `package.json`.
- CI: the `coverage` job runs `nx test ecs-core --coverage` (`.github/workflows/ci.yml:118–124`); `@screenshot`-tagged tests are excluded from CI (173–175, `tools/verify/ci/e2e-screenshot-tag.spec.mjs`).
- `apps/web/e2e/staff-client-roles.spec.ts` exists; `fast-check` is a dependency.

**Law 8/9/10 review of the proposed artefacts** (codebase lens): every new file sits in its right tier (`day-figures.data.ts` in components importing primitives only; the two entities; the four systems with `./` sibling imports; the port bundles in `ports/analytics.port.ts`; the four pipelines in `pipelines/`); `DayFigures.rowOf<T extends DayRow>(x: T): DayRow` follows the ecs-components projection rule; `MonthKey`/`AnalyticsGoalKey`/`BarberAnalyticsDayId`/`AnalyticsRecomputeJobId` belong in primitives; every pipeline port set is an intersection of existing named bundles with no `Pick`/`Omit`; Law 10.2 holds except the two wordings in codebase-9b-12 and readiness-9b-11.

**Not verified** (outside the repository or not checkable read-only): the `nx g @nx/angular:library` flag set of item 15; Material `bar_chart`'s availability in the glyph source `tools/icons/build-material-glyphs.mjs` reads from.
