# Goldfish Review Report — Stage 9 Implementation Readiness Test, round 1

**Target:** `docs/designs/staff-analytics-v2.md` (lines 975–1396, "## Detailed Implementation Plan" to the end; boundary re-checked — the header is at 975, `_Drafted with EGM_` at 1396)
**Mode:** REVIEW
**Standard:** `implementation-readiness-standard.md` (readiness, codebase); the style persona's writing standard (style)

## Reviewer Status

| Reviewer                       | Status    | Scope                                                                                                                                                                 |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `egm-implementation-readiness` | completed | decidability of every PR item; 7 blockers, 14 majors, 7 nits reported                                                                                                 |
| `egm-codebase-details`         | completed | every path, symbol, port, collection, index, rule, flag, cron slot, lint rule and command verified read-only against the repo; 2 blockers, 14 majors, 9 nits reported |
| `egm-style`                    | completed | prose clarity of the range; 0 blockers, 17 majors, 17 nits reported                                                                                                   |

After deduplication: **9 Blockers, 27 Majors, 24 Nits.** Where two reviewers found the same gap the finding carries the id of the reviewer whose evidence is primary and names the other in "Also found by".

**Verdict: NOT READY as written.** PRs 1, 2, 3, 7 (bar the CSV schema) and 8 are close. PR 4a is the weakest — the recompute job's entity, ports and continue trigger, the flag's plumbing, the follow-up read's placement and the `DayRow` split are all left to the engineer. PR 6 has an undefined callable wire. One Nx target and one "Modify" file do not exist.

Finding ids are stable: `readiness-9-<n>`, `codebase-9-<n>`, `style-9-<n>`. Item numbers are the plan's own ordered-list numbers (1–101); line numbers are in the target file.

---

## 🔴 Blockers

### readiness-9-1 — `DayRow` loses its identity and two parts; plan and design disagree on what it keeps

- **Scope:** PR 4a item 47 (lines 1158–1165); PR 4b item 69 (1252–1254); PR 7 item 94 (1340–1342)
- **Also found by:** `codebase` (A18, the `dayRowOf` clash — recorded separately as codebase-9-17)
- **Discrepancy:** Item 47 defines `DayRow` as "v1's `AnalyticsReport.DayRow` with the `day` prefix plus `dayTakingsCents`, `dayTipsCents`, `currency`". v1's `DayRow` (`libs/ecs-core/src/components/analytics-report.data.ts:193–208`) carries `barberId`, `localDate`, `bookedAheadMinutes`, `openMinutes` and the parts. The design's slice table (lines 415–426) puts `barberId`/`localDate` on `BarberAnalyticsDayMeta` and says `bookedAhead`/`open` "are not stored". Law 6 forbids two slices sharing a field, so `DayRow` and `BarberAnalyticsDayMeta` cannot both hold the identity — and the plan never says which does.
- **Rationale:** `reportDayRows` is the drill-down's row list, PR 7's "days per barber" CSV source and, beyond 93 days, 4b's "day rows per month". Without `localDate`/`barberId` the rows cannot be labelled, filtered or keyed; without `dayBookedAheadMinutes`/`dayOpenMinutes` the live days lose parts v1 shows. The engineer must choose the slice split — an owner decision.
- **Resolution:** Write the exact `DayRow` type in item 47. Recommended: `DayRow = { barberId; localDate; dayRosteredMinutes; dayWorkedMinutes; dayNoShowMinutes; dayUnmarkedMinutes; dayBookedAheadMinutes; dayHeldMinutes; dayBlockedMinutes; dayBreakMinutes; dayShortGapMinutes; dayUnsoldMinutes; dayOpenMinutes; dayClosedDayMinutes; dayTakingsCents; dayTipsCents; currency }`; `BarberAnalyticsDayMeta = { id }` only; a stored past day carries `dayBookedAheadMinutes: 0` and `dayOpenMinutes: 0` (one hidden class). Correct the design table (lines 417–418) to match and state for item 69 that a per-month row carries `localDate` = the month's first day.

### readiness-9-2 — The recompute's job entity, id, collection constant, ports, continue trigger and wire decoder are all missing

- **Scope:** PR 4a items 52, 54, 57, 58, 59 (lines 1183–1211)
- **Also found by:** `codebase` (A8, A9); `style` (22, item 59 is one 90-word sentence)
- **Discrepancy:** Item 54 creates the start/continue recompute pipelines "on the policy-recompute model" and item 59 says "the continue step rides the policy recompute's nudge mechanism". The policy model in the repo is: `PolicyRecomputeJob` (`libs/ecs-core/src/entities/policy-recompute-job.entity.ts`) with `RecomputeJobName`; `PolicyRecomputeJobId.FIXED = 'clientStatsPolicy'` (`ids.primitive.ts:396–400`); `POLICY_RECOMPUTE_DOC` (`entities/collections.ts:136`); the `BackfillJobPorts` bundle (`governance.port.ts:105–109`) and `PolicyRecomputeJobPorts` (`scheduling.port.ts:513`) served by `firestore-jobs.adapter.ts`; and a separate export `continueClientStatsPolicyRecompute = onDocumentWritten` on `backfillJobs/clientStatsPolicy` (`apps/functions/src/main.ts:595–596, 1126–1144`) with `decodePolicyStepEvent`. The "nudge" is the daily sweep's write to that document, not the continuation. None of the analytics equivalents is listed: no entity + type-spec, no id companion, no `ANALYTICS_RECOMPUTE_DOC`, no load/write port bundle, no `CountAnalyticsDays` port for item 57's `count()` aggregation (item 52 declares only `LoadAnalyticsDays`/`AnalyticsDayReadPorts`), no `firestore-jobs.adapter.ts` change, no `continueAnalyticsRecompute` export (a job at `backfillJobs/analyticsRecompute` fires no existing trigger), no `decodeAnalyticsStepEvent`, no `EXPORTS`/`FLIPPED_EXPORTS` (currently 54, `main.spec.ts:1295`) and `ENDPOINTS` (line 290) pins.
- **Rationale:** The engineer would design the job entity's fields, the compare-and-set rule, two port bundles and the trigger wiring — exactly the API decisions the standard forbids leaving open. The "nudge mechanism" sentence is also misleading.
- **Resolution:** Add to PR 4a, as separate bullets: (a) `libs/ecs-core/src/entities/analytics-recompute-job.entity.ts` + `.type-spec.ts` (Create) — `AnalyticsRecomputeJob = { id: AnalyticsRecomputeJobId; recomputeJobName: 'ANALYTICS_DAYS'; definitionVersion; cursor: BusyKey | null; retryKeys: readonly BusyKey[]; fullReach: boolean; startedAtUtcMs; updatedAtUtcMs; finishedAtUtcMs: UtcEpochMs | null; stepKey; stalledAtUtcMs: UtcEpochMs | null; lastFailureCode; checked; written; failed; steps }`; `AnalyticsRecomputeJobId` via `idCompanion` with `FIXED: 'analyticsRecompute'` in `ids.primitive.ts`; `RecomputeJobName.AnalyticsDays`; `ANALYTICS_RECOMPUTE_DOC` in `collections.ts`; (b) in `ports/analytics.port.ts`: `CountAnalyticsDays = (from: LocalDate, to: LocalDate) => Promise<Result<number, RepositoryError>>` inside `AnalyticsDayReadPorts`, and `AnalyticsRecomputeJobPorts = { loadAnalyticsRecomputeJob; writeAnalyticsRecomputeJob }` (or a documented reuse of `BackfillJobPorts` with the job's shape); (c) `apps/functions/src/adapters/firestore-jobs.adapter.ts` + `.spec.ts` (Modify); (d) `main.ts` exports `continueAnalyticsRecomputeOnJobWrite = onDocumentWritten({ document: ANALYTICS_RECOMPUTE_JOB_DOC, retry: true }, …)` with its timeout/memory and `decodeAnalyticsStepEvent` in `triggers.wire.ts`, and `sweepAnalyticsDaysDaily` calling `startAnalyticsRecompute`; (e) `main.spec.ts`: the `EXPORTS` pin, the `FLIPPED_EXPORTS` length, the `ENDPOINTS` row and the `every day 04:30` slot. Replace "rides the policy recompute's nudge mechanism" with "(d)" above and rewrite item 59 as bullets (a)–(e).

### readiness-9-3 — The follow-up's source-visit read is placed in a pure wire decoder, and the writer's command cannot carry it

- **Scope:** PR 4a item 58 (lines 1202–1204), item 53 (1185–1189)
- **Also found by:** `codebase` (A19)
- **Discrepancy:** Item 58 puts "the follow-up rule (`after.bookedFromAppointmentId` → the source's keys, one read)" in `triggers.wire.ts`. Every decoder there is pure (`decodeRebuildBusyEvent` etc., lines 224–397; none reads Firestore), the rules say validation sits at the edge and reads go through ports in a pipeline (Law 4). The writer's command is `{ keys: readonly BusyKey[]; source }` (design line 470) with no field for a source id, and no port in the writer's bundle loads an appointment by id.
- **Rationale:** Three legal-looking placements (wire, main, pipeline) and an unstated port — a layering decision left open.
- **Resolution:** State: the command becomes `{ keys: readonly BusyKey[]; sourceAppointmentId: AppointmentId | null; source }`; `writeAnalyticsDay` adds the existing appointment load bundle (name it from `ports/*.port.ts`) to its intersection, reads the source visit once and unions its past busy keys into `keys`; the decoder only copies `after.bookedFromAppointmentId ?? before.bookedFromAppointmentId` into the command. Add the spec case "a cancelled follow-up rewrites the source day" to item 53.

### readiness-9-4 — The flag `analytics.storedDays` has no delivery path into the pipeline, two of its homes are unlisted, and its mechanism is misdescribed

- **Scope:** PR 4a item 60 (lines 1212–1214); PR 4b items 68 (1247–1251) and 74 (1269–1270); design NFR line 929
- **Also found by:** `codebase` (A6, A7); `style` (24, item 74's production clause is garbled)
- **Discrepancy:** (i) Item 68 has `staffAnalytics` honour the flag, but pipelines read flags only through `FlagsPorts` (`libs/ecs-core/src/ports/flags.port.ts:10–14`), served in functions by `paramFlagsPorts()` (`main.ts:420, 482`); `staffAnalytics` is wired on `root.ports = serverPorts()` (`main.ts:338–342, 874–883`), which does not include it, and `StaffAnalyticsPorts` (`staff-analytics.pipeline.ts:84–90`) has no `FlagsPorts`. No item adds either. (ii) A flag's one source is `FlagName` in `libs/ecs-core/src/components/feature-flags.data.ts:12–27` with `ALL_OFF` (38–52) and `feature-flags.data.spec.ts`; `FLAG_PARAMS` in `flags.ts` is `Readonly<Record<FlagName, BooleanParam>>` and will not compile without the entry; `tools/flags/feature-flags.manifest.spec.mjs` asserts every manifest key is a `FlagName`. Item 60 lists only `flags.ts` and `config/feature-flags.json`. (iii) Values come from the manifest per environment through `tools/flags/write-functions-env.mjs` after the build — so "the operator turns the flag on" (design 929) and "production on at deploy after P2/P3 and the first-night pass" (item 74) each mean a manifest edit plus a functions redeploy, not a runtime toggle.
- **Rationale:** The engineer must design the port path and discover the build-time nature from code; the rollout text promises an operator action the mechanism cannot provide.
- **Resolution:** Item 68 adds `FlagsPorts` to `StaffAnalyticsPorts`; a PR 4b `main.ts` item adds `analyticsPorts = once(() => ({ ...serverPorts(), ...paramFlagsPorts() }))` (the `streakPorts`/`privacyPorts` precedent), rewires `staffAnalytics` onto it and pins it in `main.spec.ts`; `flagOn(FlagName.AnalyticsStoredDays)` is read inside the handler, never at module load. Item 60 lists `feature-flags.data.ts` + `.spec.ts` (`FlagName.AnalyticsStoredDays: 'analytics.storedDays'`, `ALL_OFF`), the `ANALYTICS_STORED_DAYS` param in `flags.ts`, `config/feature-flags.json` (all three environments `false`) and `flags.spec.ts`. Rewrite item 74: "`analytics.storedDays` is on in development and staging in this PR; in production it is switched on by a second functions deploy of PR 4b's build with the manifest key `true`, after production-deploy §P2/§P3 have run and the first nightly recompute has logged `AnalyticsRecomputeDone`." Fix the design's line 929 the same way.

### readiness-9-5 — PR 4a's agreement gate depends on PR 4b's read path and cannot be written in 4a

- **Scope:** PR 4a item 65 (lines 1233–1237); summary table row 4a gate (987); PR 4b item 76 (1273–1274)
- **Also found by:** `readiness` N7 (merged here)
- **Discrepancy:** Item 65 asserts "a month from day documents plus the live days equals the month from visits (the flag's two settings asserted equal)" in `staff-analytics.agreement.spec.ts` — but nothing reads day documents until PR 4b item 68, so in 4a the two settings are identical by construction. Item 76 then puts "the agreement property over stored days" in the dashboard's `StaffDayStore` spec, which has no stored days.
- **Rationale:** A gate that passes vacuously is not a gate; the 4a row's "agreement day case" cannot be checked.
- **Resolution:** In 4a, item 65 keeps the fixture change and asserts the system-level identity only: `DayFiguresSystem.sum(pastDays.map(fold)) + live` equals `StaffAnalyticsSystem.report(visits)` over `ANALYTICS_FIXTURE_MONTH` (item 50's property run on the fixture); make the 4a gate "fold/sum agreement on the fixture month". Move "the flag's two settings asserted equal through `staffAnalytics(ports)`" to a new PR 4b item beside 76, in the ecs-core pipeline agreement spec. Item 76 becomes "`staff-analytics.agreement.spec.ts` (dashboard) unchanged" or is struck.

### readiness-9-6 — The `setAnalyticsGoal` callable has no request shape, no answer shape, no call component and no port entry

- **Scope:** PR 6 item 86 (lines 1309–1311), item 88 (1316–1318), item 90 (1322)
- **Also found by:** `codebase` (A14)
- **Discrepancy:** Item 86 adds `SetAnalyticsGoal: 'setAnalyticsGoal'` "and its wire types"; neither the plan nor the design (505–510, 665–672) states the call (scope, month, low, high, currency?) or the answer. `callables.ts` has four tables over `CallableName` — `CallableWire`, `OPERATION_ID_FIELD`, `CALLABLE_APP_CHECK_TOKEN`, `CALLABLE_ANSWER_DECODERS` (lines 79, 241, 288, 351) — and the answer decoder must be a call component's companion (`AnalyticsCall.decodeReport` precedent). No item creates that component; `AnalyticsCallPorts` (`analytics.port.ts:157–159`) is never modified although item 90 says the web bundle "grows".
- **Rationale:** The wire is the contract between PR 6's four layers; without it each is a guess.
- **Resolution:** Add `libs/ecs-core/src/components/analytics-goal-call.data.ts` (Create, or extend `analytics-call.data.ts`) with `SetAnalyticsGoalCall = { scopeBarberId: BarberId | null; goalMonth: MonthKey; goalLowCents: PriceCents; goalHighCents: PriceCents }` (currency fixed to `'EUR'` by the pipeline — or carried; pick one), answer `{ goalKey: AnalyticsGoalKey; goalSetAtUtcMs: UtcEpochMs }`, `decodeSet`, and the four table entries; errors `GoalForbidden | GoalInvalidRange | InvalidInput | RepositoryError`; `decodeSetAnalyticsGoal` reads each field through its primitive guard. Item 90: `AnalyticsCallPorts` gains `setAnalyticsGoal` in `analytics.port.ts` (Modify).

### readiness-9-7 — The CSV has no schema, so PR 7's gate cannot be checked

- **Scope:** PR 7 item 94 (lines 1340–1342), item 96 (1346–1347)
- **Discrepancy:** Item 94 says "the CSV rows and text (UTF-8 BOM, `;` separator, quoted fields); days per barber, services per barber"; item 96's e2e checks "the expected header and row count". No column list, header language, number format, date format, per-barber label (id or name), how the two tables share one file, or row order is given.
- **Rationale:** Every one of those is a decision the owner will have an opinion on, and the e2e's expected header cannot be typed.
- **Resolution:** Add the schema to item 94: one file, two blocks separated by a blank line; block 1 header `вид;бръснар;дата;работено мин;неявяване мин;немаркирано мин;блокирано мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш` with `вид=ДЕН`; block 2 header `вид;бръснар;услуга;посещения;оборот;минути услуга` with `вид=УСЛУГА`; barber = the catalogue name in the report's barber order; money via `formatCents` without the sign; dates `YYYY-MM-DD`; rows in report order. State item 96's expected header string and the row-count formula (days × barbers + services × barbers + 2 headers).

### codebase-9-1 — `pnpm nx run verify-tools:bundle` does not exist

- **Scope:** Verification Plan, line 1367
- **Discrepancy:** `tools/verify/project.json` declares three targets — `runbook-gates`, `layering`, `test` (lines 11–67). The bundle guard is the root script `pnpm run verify:bundle` (`package.json:16`: `pnpm nx build web -- --stats-json && node tools/verify/bundle/check-initial-bundle.mjs`). Confirmed by the synthesizer; the readiness reviewer's note that the target exists was wrong.
- **Rationale:** The PR 2 gate (bundle ceiling, item 36) runs a command that fails before it checks anything.
- **Resolution:** Replace with `pnpm run verify:bundle` (and note it runs the web build with `--stats-json`).

### codebase-9-2 — `analytics-period.data.spec.ts` is marked Modify but does not exist

- **Scope:** PR 3 item 39 (lines 1130–1132); PR 4b item 66 (1243)
- **Discrepancy:** `libs/ecs-core/src/components/` holds `analytics-period.data.ts` only; `AnalyticsPeriod` is covered indirectly through system and pipeline specs.
- **Rationale:** An engineer told to modify a file that is not there must invent its structure and cases.
- **Resolution:** Mark `libs/ecs-core/src/components/analytics-period.data.spec.ts` (Create) in PR 3 and state its cases: `of` for DAY/YEAR/CUSTOM, `previous` per span, `isComparable`, `CUSTOM_MAX_DAYS`; PR 4b item 66 then reads (Modify).

---

## 🟡 Majors

### codebase-9-3 — `staff-analytics.agreement.spec.ts` is listed one directory too deep

- **Scope:** PR 2 item 38 (line 1124); PR 4b item 76 (1273)
- **Discrepancy:** The plan says `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-analytics.agreement.spec.ts`; the file is `libs/features/staff/dashboard/src/lib/staff-analytics.agreement.spec.ts` (describe at line 70, the G5 case through `StaffDayStore`).
- **Resolution:** Correct the path in both items.

### codebase-9-4 — `store.day()` does not exist on `StaffDayStore`

- **Scope:** PR 1 item 2 (line 1003)
- **Discrepancy:** The shown day is `readonly dayKey = computed<LocalDate | null>(…)` (`staff-day.store.ts:697`; `todayKey` at 686), the selected chair is `readonly scope` (1062), the URL echo record is `published()` with `{ day, view, barber }` (727–732). `staff-dashboard.ts` itself reads `this.store.dayKey()` (617).
- **Resolution:** Name `store.dayKey()` (nullable — state the fallback, e.g. `todayKey()`) and `store.scope()` for the barber.

### readiness-9-8 — The entry rule's three cases are implied, and the URL echo vs. the e2e's `from=<day>` assertion is undecided

- **Scope:** PR 1 items 2 (1002–1005), 6 (1014–1019), 12 (1037–1038), 13 (1039–1042)
- **Also found by:** `style` (5, 6, 13)
- **Discrepancy:** Item 2 navigates with any `from` day; item 6 has the store accept "any `from` (the week or month that holds it)" and write the URL back with `replaceUrl` after each pick; item 13's e2e asserts `?span=WEEK&from=<day>&barber=<id>`. Whether the first write-back normalises `from` to the period's Monday/1st is unstated — if it does, the e2e is wrong or flaky. Item 12 tests "the three cases" without naming them; item 6 packs four instructions into one 60-word sentence.
- **Resolution:** Item 2: "`openAnalytics()` builds `{ span: 'WEEK', from: store.dayKey(), barber }` where `barber` is (a) `store.scope()` when an admin views one chair, (b) absent when an admin views every chair, (c) absent for a barber; then `router.navigate`." Item 6 as sub-bullets (a) the four `applyRoute*` inputs, (b) the `published()` echo guard, (c) a deferred `replaceUrl` write after each pick, (d) "the store never rewrites a URL it did not pick; the first write-back happens on the user's first pick and writes the period's first day". Item 12: "cases (a)–(c) of item 2". Item 13 as bullets (a)–(d) and assert the URL as navigated, then pick a period and assert the normalised form.

### readiness-9-9 — The analytics chunk "prefetch on idle" block is not a no-op and its mechanism is unspecified

- **Scope:** PR 1 item 1 (lines 998–1001)
- **Also found by:** `codebase` (A21)
- **Discrepancy:** A `@defer` block with only `prefetch on idle` also renders on idle (Angular's default trigger). A `@defer` prefetches the components it contains, not a route; the route is `loadComponent: () => import('@creativo/features/staff/analytics')` (`app.routes.ts:152`). The dashboard's blocks are all `@defer (when <signal>; prefetch on idle)` (`staff-dashboard.html:324, 1190–1465`).
- **Resolution:** Spell the block: `@defer (when false; prefetch on idle) { <lib-staff-analytics-page /> }` with `StaffAnalyticsPage` in the dashboard's imports (type:feature → type:feature is allowed, `eslint.config.mjs:222–229`), noting esbuild emits one chunk for the same dynamic module so the route's lazy load hits the prefetched chunk; or a `PreloadingStrategy` with `data: { preloadOnIdle: true }` in `app.config.ts` (then list that file). Pick one.

### codebase-9-5 — `staffAnalytics.freshness.*` would be a second home for the status words

- **Scope:** PR 1 item 10 (line 1032)
- **Discrepancy:** The words table's freshness group reads `staffAnalytics.status.*` (`asOf`, `refreshing`, `failed`, `failedNoCache`, `retry`, `scopeGone` — `analytics.words.ts:167–174`; `bg.json:2648–2655`).
- **Resolution:** Extend `staffAnalytics.status.*` (`status.justNow`, `status.updatedAgo`, `status.info`) or rename the whole family in one move. `staff.day.analyticsLabel` is fine (`staff.day` exists, `bg.json:1058`).

### codebase-9-6 — The freshness presenter hand-rolls relative time that `relativeTime` already provides

- **Scope:** PR 1 item 9 (lines 1026–1029)
- **Discrepancy:** `relativeTime(target, now, lang, style)` over a cached `Intl.RelativeTimeFormat` exists in `libs/infrastructure/i18n/src/lib/relative-time.ts:39–47` and `.claude/rules/angular-ui.md` names it as the helper presenters use. Reuse, never copy.
- **Resolution:** `statusOf` calls `relativeTime(report.reportComputedAtUtcMs, now, lang)`; the presenter keeps only the «току-що» clamp and the fallback to `formatInstant` (already used at `analytics.presenter.ts:184`).

### readiness-9-10 — The freshness rule's branches are underspecified and have no ticking clock

- **Scope:** PR 1 items 6 and 9 (1014–1019, 1026–1029); design 637–641
- **Also found by:** `style` (8); `readiness` N6 (merged)
- **Discrepancy:** "«току-що» under a minute or for a negative age, minutes under an hour, else «в HH:MM» / «на dd.MM в HH:MM»" gives two outputs for the "else" branch with no condition between them, and "same day" needs the location's zone (v1's `statusOf` already formats with it). The store holds `openedAtUtcMs = signal(this.clock.nowUtcMs())` once (`staff-analytics.store.ts:97`) and the presenter takes `now`, so «преди 2 мин» would freeze at the value on open.
- **Resolution:** Item 9: "under one minute or a negative age → «току-що»; under one hour → «преди N мин»; same shop day (judged on the default location's zone via `formatInstant`'s date part) → «в HH:MM»; otherwise → «на dd.MM в HH:MM»; plus the i18n key for the ⓘ text." Item 6: either "a `nowUtcMs` signal re-read every 60 s while attached (`effect` + `setInterval`, cleared in `DestroyRef`)" or "freshness is relative to open and does not tick" — one of the two.

### codebase-9-7 — `elementWidth()` cannot be "extracted from `scroll-row.ts`"

- **Scope:** PR 2 item 17 (lines 1058–1061)
- **Discrepancy:** `libs/ui/layout/src/lib/scroll-row/scroll-row.ts` has no width signal. Its `ResizeObserver` (115–143) observes the host and every child and only calls `syncStop()`, which compares `scrollWidth - clientWidth` and queries focusables (157–191), paired with a `MutationObserver`; a `clientWidth` signal would not serve it. The survey (§5) cites scroll-row only for the `typeof ResizeObserver === 'undefined'` guard.
- **Resolution:** Make `element-width.ts` a new helper (Create, no "extraction"), drop the `scroll-row.ts (Modify)` item, keep `libs/ui/layout/src/index.ts (Modify)`; home it in a subfolder like its siblings (`src/lib/resize/element-width.ts`).

### readiness-9-11 — `chart-palette.spec.ts`'s thresholds are not measurable as stated

- **Scope:** PR 2 item 23 (lines 1077–1080); design 633–635
- **Discrepancy:** "contrast ≥ 3:1 against both surfaces in both themes" does not name the two surface tokens; the marks are `color-mix(in srgb, var(--sys-color-foreground) 50|32|18 %, transparent)` so the spec must composite the mix over each surface (readers exist: `composite`, `parseHex`, `themeTokens` in `libs/ui/tokens/src/lib/accent-spec-support.ts`, `contrast.ts`); "OKLab ΔE ≥ 8" has no scale (L is 0–1, a/b about ±0.4, so 8 is unreachable unless × 100); the hatched warning mark has no measurement; the adjacency list is implied; the spec reads `libs/ui/charts/src/lib/charts.css` by path from another library.
- **Resolution:** Item 23 states: surfaces `--sys-color-background` and `--sys-color-surface` (confirm from `theme-light.css`); marks resolved by parsing `[data-part]` rules in `charts.css` for `color-mix(... N%, transparent)` and compositing with `composite`; the hatch measured on its solid fill; ΔE = Euclidean distance in OKLab × 100 ≥ 8; adjacent pairs = consecutive entries of `[worked, noShow, unmarked, blocked, unsold, other]` and `[online, staff, unknown]`, plus (comparison grey, accent).

### readiness-9-12 — The hour buckets are needed in PR 2 but built in PR 4a; `grid`'s past input names a type that does not yet exist

- **Scope:** PR 2 item 25 (lines 1087–1089); PR 4a item 50 (1177–1179)
- **Also found by:** `codebase` (A12); `style` (12, "the overlap bucket" has no referent)
- **Discrepancy:** `AnalyticsHourSystem.grid(pastDays, liveDays)` is built in PR 2 ("passes live days only") but `hourBuckets(seats, stretches)` is created in 4a under `DayFiguresSystem`, and `pastDays: DayFigures[]` is a 4a type. v1's `AnalyticsDay = ChairDay & { closedDayMinutes }` (`staff-analytics.system.ts:91–94`; `ChairDay` at `chair-time.system.ts:51`) carries minute totals, not intervals, and `daysOf` keeps the offered windows internal — PR 2 has nothing to bucket from.
- **Resolution:** Item 25 defines the PR 2 signature: `HourDay = { localDate; worked: readonly MinuteCount[]; rostered: readonly MinuteCount[] }` (24 each); `bucketsOf(seats: readonly Seat[], stretches: readonly MinuteSpan[]) → HourDay` in `analytics-hour.system.ts` (the two-bucket overlap rule lives here, with a spec case for a stretch crossing an hour boundary); `grid(days: readonly HourDay[]) → readonly HourCell[]`; `peak(cells)`. Item 26: `StaffAnalyticsSystem.daysOf` returns the day's offered stretches on `AnalyticsDay` (`stretches: readonly MinuteSpan[]`). In 4a, `DayHours` satisfies `HourDay` structurally and `DayFiguresSystem.hourBuckets` delegates to `bucketsOf` — say so.

### codebase-9-8 — `fold`'s input `AnalyticsDay` holds no seats or visits, so `fold` cannot compute takings, counts, services or origins

- **Scope:** PR 4a item 50 (lines 1177–1179), relying on design line 439 (outside the range, the only definition)
- **Discrepancy:** The design says "`AnalyticsDay` is v1's existing per-day system input (`ChairDay` plus the day's seats…)". It is `ChairDay & { closedDayMinutes }` with no seats; seats are on `ChairVisit`/`AnalyticsVisit`.
- **Resolution:** Item 50 gives `fold` its real input: `{ day: AnalyticsDay; visits: readonly AnalyticsVisit[]; followUps; policy; nowByLocation }` (or a named slice) and says which system derives the stretches for `hourBuckets`; correct design line 439.

### readiness-9-13 — The device cache's behaviour while the report grows under version 1 is unstated

- **Scope:** PR 2 item 27 (1094–1096); PR 3 item 40; PR 4b item 67
- **Discrepancy:** `ANALYTICS_DEFINITION_VERSION` stays 1 through PRs 2 and 3 while `decodeReport` gains required fields; a cached v1 answer without them is refused by the decoder. Whether the adapter then answers `null` (placeholder) or an error, and whether to bump earlier, is not said.
- **Resolution:** Item 27: "the version stays 1 until 4b; `decodeReport` refusing an older cached answer is treated as no cache (`readCachedReport` → `null`), pinned in the adapter spec."

### readiness-9-14 — The trigger integration suite is misnamed and whether to extend or create is undecided

- **Scope:** PR 4a item 64 (lines 1228–1232)
- **Also found by:** `codebase` (A10)
- **Discrepancy:** `apps/functions/src/*.integration.spec.ts` matches nothing; integration specs live in `apps/functions/src/integration/*.integration.spec.ts` (and `adapters/*.integration.spec.ts`). No spec exercises `rebuildBusyOnAppointmentChange` today; there is no "trigger/schedule integration suite" to modify.
- **Resolution:** `apps/functions/src/integration/write-analytics-day.integration.spec.ts` and `analytics-recompute.integration.spec.ts` (Create) for the trigger/recompute cases, run by `nx run functions:test-integration` (`apps/functions/project.json:83`); `staff-analytics.integration.spec.ts` (Modify) for the rules denials and 4b's read path.

### readiness-9-15 — The analytics port doubles and the report fixture are never listed, though every new field or port breaks them

- **Scope:** PR 2 item 27; PR 3 item 40; PR 4a items 52/57; PR 4b item 68; PR 5 item 79; PR 6 items 86/87
- **Discrepancy:** `libs/ecs-core/src/testing/analytics-doubles.ts` (`memoryAnalyticsReadPorts`) and `analytics-report.fixtures.ts` type against `AnalyticsReadPorts`/`AnalyticsReport`. The 4a/4b pipeline specs need in-memory `loadAnalyticsDays`/`countAnalyticsDays`/`loadAnalyticsRecomputeJob` doubles that do not exist.
- **Resolution:** Add `analytics-report.fixtures.ts (Modify)` to items 27, 40, 67, 79, 87; add `analytics-doubles.ts (Modify)` to item 52 ("`memoryAnalyticsDayPorts(state: { days?; job? })` with a query log") and to item 86.

### codebase-9-9 — `role.rules-parity.spec.ts` does not enumerate `match` blocks

- **Scope:** PR 4a item 61 (lines 1218–1219); PR 6 item 89 (1320)
- **Discrepancy:** That spec holds the role groupings of `roles.data.ts` equal to the rules helpers (`isStaff`, `worksTheBook`, … — header lines 14–33, `functionBody`/`helperRoles`/`listRoles`). The other rules-text spec, `libs/infrastructure/firestore/src/lib/rules-key-parity.rules-text.spec.ts`, pins key lists of the three browser-written collections only. A deny-all match is pinned nowhere except by behaviour.
- **Resolution:** Drop the parity-spec items; keep `firestore.rules.integration.spec.ts` (client read and write denied — it already has an analytics block at line 2480) as the one gate, or name a new rules-text case explicitly.

### codebase-9-10 — `overBound` is an adapter answer a pipeline cannot import

- **Scope:** PR 4a item 53 (line 1187)
- **Discrepancy:** `overBound` lives in `apps/functions/src/adapters/store-answer.ts` (imported by `firestore-analytics.adapter.ts:14`); Law 8 forbids a pipeline importing an adapter, and `tx.query` (`tx.port.ts:82`) returns rows.
- **Resolution:** "the pipeline answers `RepositoryError.readFailed(path, 'resource-exhausted')` (name the exact factory) when the `limit: 61` query returns 61 rows."

### codebase-9-11 — `VISITS_PER_BARBER_DAY = 60` already exists in the adapter

- **Scope:** PR 4a item 53 (line 1187)
- **Discrepancy:** The same constant, value and rationale sit as a module-private const in `apps/functions/src/adapters/firestore-analytics.adapter.ts:54`. A second copy in `@core/pipelines` is a duplicate the adapter cannot import.
- **Resolution:** Home it once in ecs-core (`StaffAnalyticsSystem.VISITS_PER_BARBER_DAY` beside `RATE_BASE`/`AHEAD_DAYS`, `staff-analytics.system.ts:472–473`, or a `*.data.ts` constant) and import it in both.

### readiness-9-16 — How day documents exist in the emulator for the YEAR/CUSTOM e2e and the perf run is not stated

- **Scope:** PR 4b items 75, 77 (lines 1271–1272, 1275–1277); Terms line 138
- **Discrepancy:** With the flag on in development and no recompute run, every past day is missing and YEAR falls back live for ~365 days per barber. The seed writes appointments directly, so the trigger writes documents only for days with visits; zero-visit days stay missing. The e2e has no way to run a 04:30 schedule.
- **Resolution:** Item 75: "the e2e relies on the appointment trigger writing the seed's past days during `seed:dev`; zero-visit days fall back live and are asserted to stay under the adapter caps (365 keys = 13 chunks, 0 results); `missingDays` is not asserted in e2e". If documents for every day are wanted, add a test-only step that invokes `startAnalyticsRecompute` (`firebase functions:shell` or an `@emulatorOnly` export) before the YEAR case, and list it.

### readiness-9-17 — The custom-range picker control is undecided

- **Scope:** PR 4b item 73 (lines 1263–1268)
- **Discrepancy:** "the «…» custom-range pill and its chip, … the CUSTOM screen" names no control for `from`/`to`. `ui-date-field` (`libs/ui/controls/src/lib/date-field`) and `ui-modal-sheet` exist; validation words for `from > to` or > 366 days (client-side or wait for `ANALYTICS_PERIOD_OUT_OF_RANGE`?) are unstated.
- **Resolution:** Add a sub-item: `staff-analytics-page/analytics-range-sheet.{ts,html,css,spec.ts}` (Create) — a `ui-modal-sheet` with two `ui-date-field`s (`from`, `to`), bounds = the reach and today, the dock's «Приложи»; `from > to` swaps; > 366 days disables «Приложи» with key `staffAnalytics.range.tooLong`.

### readiness-9-18 — `BarberFigures` lacks what the radar's axes need; the `reportRadars` row shape is elided

- **Scope:** PR 5 items 78–79 (lines 1281–1286); design 549–553
- **Discrepancy:** `axes(figures, best)` must compute € per hour of service (`takingsCents ÷ serviceMinutes`, base 20 worked seats) and the tips rate (same base). v1's `BarberFigures` (`analytics-report.data.ts:172–190`) has no `serviceMinutes` and no `workedSeatCount`; item 79 does not extend it. The row is written `{ barberId; axes… }`.
- **Resolution:** Item 79 adds `serviceMinutes: MinuteCount` and `workedSeatCount: number` to `BarberFigures` and either `reportComparisonBarbers: readonly BarberFigures[]` or a statement that comparison axes come from the comparison period's `DayFigures`. Write the row flat: `RadarRow = { barberId; takingsPerHour: number | null; fill; rebooking; tipsRate; reliability; comparisonTakingsPerHour: number | null; comparisonFill; comparisonRebooking; comparisonTipsRate; comparisonReliability }`.

### readiness-9-19 — `reportRadarBaseWord` has no tag values

- **Scope:** PR 5 item 79 (lines 1284–1286); design 545
- **Discrepancy:** "a tag the presenter words" — no dictionary, so neither spec can pin anything.
- **Resolution:** `RadarBase = { BestOfShop: 'BEST_OF_SHOP', TooFewBarbers: 'TOO_FEW_BARBERS' }` in `analytics-report.data.ts`, field `reportRadarBase`, two sentences in `analytics.words.ts`.

### readiness-9-20 — Which span reads and shows the goal is unstated; item 91 mixes a new component with seven edits

- **Scope:** PR 6 item 87 (lines 1312–1315), item 91 (1323–1328); design 620
- **Also found by:** `style` (26)
- **Discrepancy:** Goals are per month; the pipeline "reads the scope's goal (+1 read)" and the ring is section 8 for every span. For WEEK/DAY/YEAR/CUSTOM the month to read and the ring's visibility are undefined; `daysRosteredInMonth` needs the whole month's roster even for a week. Item 91 lists the sheet (Create) then "the store's `setGoal`; the goal ring section … with the pace sentence;" then eight files (Modify) without saying which holds what.
- **Resolution:** Item 87: "the goal is read only when `analyticsSpan === MONTH`; otherwise `reportGoalLowCents/HighCents = null`, `reportGoalPaceTag = NONE` and the section is hidden; «Задай цел» is offered only on the current or next month." Split item 91 into 91a (the sheet files, Create — a `ui-modal-sheet` with two `ui-amount-field`s and «Запази» in the dock) and 91b (the eight modified files, each with its change).

### readiness-9-21 — The shared download helper's contract is incomplete

- **Scope:** PR 7 item 93 (lines 1334–1339)
- **Discrepancy:** `shareOrDownloadFile(name, blob)` has no return type and no behaviour for `navigator.share` rejecting (`AbortError` on cancel; `NotAllowedError` without a gesture). The two call sites being moved (`client-card.ts:356–359` JSON, `client-appointments.ts:886–889` `.ics`) are real; their MIME types must reach the `File` for `canShare`.
- **Resolution:** `shareOrDownloadFile(name: string, blob: Blob): Promise<'SHARED' | 'DOWNLOADED' | 'CANCELLED'>`; `AbortError` → `CANCELLED`, nothing else; any other share failure → `<a download>`; `new File([blob], name, { type: blob.type })`.

### style-9-1 — Dedented continuation lines break list items and code spans in the rendered document

- **Scope:** items 3, 15, 47, 61, 66, 86, 87 and Verification "Unit Tests" — lines 1007–1008, 1051–1052, 1161–1162, 1215–1216, 1242–1243, 1310–1311, 1314–1315, 1371–1372
- **Discrepancy:** A backtick span is wrapped across two source lines and the second line starts at column 0 (e.g. 1008 `staff-analytics-head` on the button…`; 1052 `--tags=scope:shared,type:ui`): …`). The ordered list terminates or the continuation becomes a paragraph; the reader sees item 3 end mid-sentence.
- **Resolution:** Keep each code span on one source line and indent every continuation to the item's text column.

### style-9-2 — Files promised but not listed

- **Scope:** item 47 (1164–1165), item 80 (1288), item 89 (1320)
- **Discrepancy:** The preamble (977) promises "Every file is listed under the PR that touches it", yet item 47 ends "the presenter and the rows page (Modify)", item 80 "the showcase page (Modify)", item 89 "the rules integration spec and the parity spec (Modify)" — no paths.
- **Resolution:** Item 47: `libs/features/staff/analytics/src/lib/analytics.presenter.ts` and the drill-down sheet (`analytics-rows-page/*`) (Modify); item 80: `apps/showcase/src/app/pages/controls/charts/charts.page.*` (Modify); item 89: the spec paths from item 61 (and see codebase-9-9).

### style-9-3 — "the three specs", "+ specs", "the seven sections", "per the plan's table" shift or lose their referents

- **Scope:** items 44 (1150), 73 (1265), 81, 91, 95 ("the three specs"/"+ specs"); item 32 (1109, "the seven sections"); item 19 (1065, "per the plan's table")
- **Discrepancy:** Only item 11 names the three specs (presenter, store, page); items 81/91/95 say "+ specs" — a fourth form. The design has "the seven questions" (589) and a nine-entry "Sections in order" (606); "the seven sections" matches neither. Inside the plan "the plan's table" reads as the summary table at 982, which has no element inputs; the referent is the Chart kit table.
- **Resolution:** "the three specs of item 11 (presenter, store, page) (Modify)" everywhere; "the seven questions' sections drawn with the kit's elements"; "`ui-bar-chart` per the Chart kit table (§The screen, Chart kit)".

### style-9-4 — Unglossed shorthands: "P2"/"P3", "dark", "stored days"

- **Scope:** summary row 4a (987); PR 4a heading (1156); items 63 (1225), 74 (1270), 76 (1274)
- **Discrepancy:** "indexes + TTL (P2/P3)" and "P2 '7 of 7' → '8 of 8'" never say P2/P3 are sections of `docs/production-deploy.md`. "the flag — dark" is unexplained (and the em dash elsewhere separates a file from its description). Terms (127) rule "Day document in prose throughout", yet the heading says "Stored days (dark)".
- **Resolution:** "indexes + TTL (production-deploy §P2/§P3)" at first use; item 63 opens "`docs/production-deploy.md` (Modify) — in §P2 change '7 of 7' to '8 of 8'; in §P3 raise the composite count by one"; table cell "the flag (off; documents written, not read)"; heading "### PR 4a — Day documents, written but not read"; item 76 "over day documents".

### style-9-5 — Item 32 leaves the legend promotion's PR ambiguous

- **Scope:** item 32 (1111–1112)
- **Discrepancy:** "`lib-analytics-time-bar` kept for DAY (PR 3) and its legend promoted into the bar chart's legend slot" — "(PR 3)" may scope either clause; "`analytics-takings` digits structure" lacks a noun.
- **Resolution:** "the v1 test ids kept (`analytics-takings` and its digit elements, `analytics-open`, `analytics-hero`, `analytics-scopes`, `data-load`); `lib-analytics-time-bar` stays in the tree for PR 3's DAY screen; in this PR its legend moves into the bar chart's `[uiChartLegend]` slot."

### style-9-6 — The `fieldOverrides` grouping is ambiguous

- **Scope:** item 62 (1221–1223)
- **Discrepancy:** "`analyticsDays.purgeAt` `ttl: true`, `analyticsDays.dayServices`, `analyticsDays.dayHourWorked`, `analyticsDays.dayHourRostered` `indexes: []`" — whether `indexes: []` applies to the last field or the last three must be inferred.
- **Resolution:** "`fieldOverrides`: `analyticsDays.purgeAt` with `ttl: true`; `analyticsDays.dayServices`, `.dayHourWorked` and `.dayHourRostered` each with `indexes: []`".

---

## 🟢 Nits

### readiness-9-22 — Toolbar order

- **Scope:** PR 1 item 1 (998–1001). The cluster runs view · find · who (`staff-dashboard.html:168–172`; search appears from 600 px). "Between the view menu and the scope avatar" leaves view · chart · find · who vs. view · find · chart · who open. State the order.

### readiness-9-23 — The morph gate is subjective and "the morph" is unglossed

- **Scope:** PR 1 items 3–4, 14 (1006–1010, 1045). Also `style` (10). "only if the morph is kept after the PR's measurement" / "if the owner accepts the morph". Give the Back decision's criterion: kept only if no frame > 16.7 ms during the transition at 4× throttle; gloss at first use "(the shared `view-transition-name` between the button and the analytics headline)".

### readiness-9-24 — `affectedKeys` "once" implies an unlisted `RebuildBusyCommand` change

- **Scope:** PR 4a item 59 (1205–1207). Also `codebase` (C note). `rebuildBusy` already calls `BusySystem.affectedKeys` internally (`rebuild-busy.pipeline.ts:116`). Say "main derives the writer's keys from the same decoded command; the busy rebuild keeps its own call", or list the pipeline refactor.

### readiness-9-25 — DAY's `reportSeries` is unstated

- **Scope:** PR 3 item 41 (1136–1139). "one `reportTimeSeries` entry" is given; `reportSeries` for DAY (empty, or one point?) is not. State "`reportSeries` has one entry for DAY; the presenter draws no line".

### readiness-9-26 — The `MonthKey` rename's file list

- **Scope:** PR 6 item 83 (1299–1302). "every use updated" is compiler-checked, but list them: `ids.primitive.ts`, `ids.type-spec.ts`, `local-date.primitive.ts`, `capacity-month.entity.ts`, `scheduling.port.ts`, `shop-day.pipeline.ts`, `rebuild-capacity.pipeline.ts`, `capacity.system.ts`, `lead-time.system.ts`, the capacity adapters under `apps/functions/src/adapters` and `libs/infrastructure`, `tools/seed-dev-catalog.mjs`.

### codebase-9-12 — `BarberAnalyticsDayMeta` id should be an id companion, not the `BusyKey` brand

- **Scope:** PR 4a item 48 (1167). Entity ids are companions (`BarberBusyDay.id: BarberBusyDayId`, `ScheduleException.id: ScheduleExceptionId`, both `idCompanion(...)` in `ids.primitive.ts:186, 206`); `BusyKey.of` builds the text. Declare `BarberAnalyticsDayId` via `idCompanion` and add it to item 48.

### codebase-9-13 — Two `dayRowOf` functions with opposite meanings

- **Scope:** PR 4a item 47 (1161–1164). `analytics-call.data.ts:180–199` already has a module-local decoder `dayRowOf(raw: unknown): DayRow | null`; the plan adds a projection `dayRowOf<T extends DayRow>(x: T): DayRow` next door. Name the projection `DayFigures.rowOf` or rename the decoder.

### codebase-9-14 — The `@nx/angular:library` command omits what every `libs/ui/*` lib carries

- **Scope:** PR 2 item 15 (1051–1055). `project.json` `"prefix": "ui"` and the `ui` selector-prefix lint rules (`libs/ui/patterns/project.json:5`; `libs/ui/patterns/eslint.config.mjs:8–35`), `--unitTestRunner=vitest` for `vite.config.mts`/`test-setup.ts`. Add `--prefix=ui --unitTestRunner=vitest --style=css` and "copy the selector rules from `libs/ui/patterns/eslint.config.mjs`".

### codebase-9-15 — `libs/ui/tokens/project.json (Modify)` is redundant

- **Scope:** PR 2 item 23 (1079–1080). The `test` target's inputs already include `{workspaceRoot}/libs/ui/**/*.css|html|ts` (lines 34–36). Drop it, or name the `test-ci--src/lib/chart-palette.spec.ts` entry (49–116 precedent).

### codebase-9-16 — The audit row's variant fields need their `fieldOverrides`

- **Scope:** PR 6 item 85 (1307), item 89. `AuditAction.AnalyticsGoalSet` is correctly homed (`audit-context.data.ts:57`), but the precedent is an `indexes: []` override per `auditLog` variant field (`firestore.indexes.json:490–784`) and an `AuditContext` variant. Add the `auditLog.goal*` overrides to a PR 6 indexes touch.

### codebase-9-17 — `bindAnalyticsRouteInputs` copies non-trivial guard logic

- **Scope:** PR 1 item 7 (1020–1022). `libs/features/staff/dashboard/src/lib/staff-dashboard/route-inputs.ts` `bindRouteInputs` is the exact pattern. Accept and say so, or generalise one `bindRouteInputs(params: Record<name, {input, published, apply}>)` in `@creativo/shared/view-state` (`tsconfig.base.json:24`) and have both call it.

### codebase-9-18 — Say that `analytics-time-bar.css`'s colour rules are deleted

- **Scope:** PR 2 items 22, 33 (1114). The `[data-part]` → token mapping exists for six parts in `analytics-time-bar.css:31–49` and `BAR_PART_HOOKS` (`analytics.vm.ts:67–74`). Item 33 moves the swatches onto the kit; make explicit the old rules go, not stay beside.

### style-9-7 — "absent = `undefined` → `null`" is a symbol chain

- **Scope:** item 7 (1021–1022). Write "an absent query parameter arrives as `undefined` and is passed to the store as `null`".

### style-9-8 — Items 13 and 14 nest three levels of parentheses

- **Scope:** items 13 (1039–1042), 14 (1043–1047). Rewrite as lettered bullets; in 14 say whether "reads issued" is a third measurement and move the `RouteReuseStrategy` branch (its two files and spec) to its own sentence.

### style-9-9 — "the bundle served" and "the comment's count" are not instructions

- **Scope:** items 57 (1201), 59 (1210). "`firestore-ports.ts` (Modify) — the served bundle gains `loadAnalyticsDays`"; "`cron-zone.ts` (Modify) — raise the number of schedules named in the file's comment by one" (currently "three `onSchedule` options", `cron-zone.ts:9`).

### style-9-10 — Noun-phrase items that need a verb

- **Scope:** items 3 (1007), 33 (1114), 67 (1246), 90 (1322), 93 (1339), 99 (1359). "position the button in the cluster"; "the worked part keeps the accent colour"; "document the grain of `reportSeries` and `reportDayRows` per span in the type's JSDoc"; "the web's `ANALYTICS_CALL_PORTS` bundle gains `setAnalyticsGoal`"; "their inline download code is replaced by a call to it"; "how each was closed".

### style-9-11 — A figure without a unit

- **Scope:** item 36 (1121). "over 1,680,000" → "over 1,680,000 bytes" (`tools/verify/bundle/budgets.json:12`).

### style-9-12 — "switcher", "rows page", "the eighth formula/TTL group"

- **Scope:** items 44 (1146), 47 (1165), 49 (1173–1174), 62 (1224). The design says "the period control (`analytics-span`)" and "the drill-down sheet"; "eighth" assumes a count the reader lacks — "an eighth retention formula (`ANALYTICS_DAYS_KEEP_DAYS = 400`)", "an eighth TTL group".

### style-9-13 — Three spellings of the first recompute

- **Scope:** items 63 (1227), 74 (1270), Verification (1392). "the first nightly recompute" throughout.

### style-9-14 — A rules case filed under an e2e item

- **Scope:** item 92 (1330). Move "a colleague's direct read is denied (rules spec)" to item 89 as "a client read by a colleague is denied".

### style-9-15 — Stray marker and missing marker

- **Scope:** item 84 (1305) "`entities/analytics-goal.entity.ts` - type-spec (Create)" → "+ type-spec (Create)"; item 98 (1354) has no (Modify) and its banner sentence (1355–1357) separates "marking … as superseded" by a four-item list — "a banner on each of: 'Reads and cost', Alternative C's rejection reason, the Non-Goals' pay line, Future Improvements — each marked superseded by v2."

### style-9-16 — Summary table and pay line

- **Scope:** lines 985–989, 994. The Gate column mixes "+" and "and"; "the v1 e2e kept" is a status, not a gate ("passes"). "Pay and sealing: … after the reconciliation gate." has no verb and "the reconciliation gate" is defined nowhere in the document.

### style-9-17 — The fast-check property is phrased three ways; two fragments in the verification plan

- **Scope:** items 50 (1178–1179), 65 (1235–1237), Verification (1371–1372, 1379–1380, 1388). Name the two properties separately (item 50's `sum(fold(days))` vs the report; item 65's day documents + live days vs the month from visits — see readiness-9-5 for which PR owns the second). "Never run the full e2e suite and `run-many -t test` at the same time." "100 % branch coverage".

---

## Items judged ready as written (readiness lens)

PR 1: items 5, 8, 10 (bar the key family, codebase-9-5), 11, 12, 14 (the `RouteReuseStrategy` branch is gated by a numeric criterion in Open Questions). PR 2: items 16, 18, 19, 20, 21, 22, 24, 26, 28, 29, 30, 31, 34, 35, 36, 37, 38 (bar the path, codebase-9-3). PR 3: items 42, 43, 45, 46. PR 4a: items 49, 51, 55, 56, 62, 63. PR 4b: items 70, 71, 72, 77. PR 5: items 80 (bar the path, style-9-2), 81, 82. PR 6: items 84, 85, 88, 92. PR 7: items 95, 96 (once the header exists). PR 8: items 97–101. Verification Plan: every named target and script exists except `verify-tools:bundle` (codebase-9-1); the one unmeasurable gate is the palette ΔE (readiness-9-11).

## Code claims verified correct

**Paths (Modify targets exist):** `libs/features/staff/dashboard/src/lib/staff-dashboard/{staff-dashboard.html,.ts,.chrome.css,.spec.ts}` and `route-inputs.ts`; `apps/web/src/styles.css` (`::view-transition-group(staff-search-field)` at 218; `view-transition-name: staff-search-field` at `staff-dashboard.chrome.css:356` — the "beside the search's" precedent is real); `libs/ui/icons/src/lib/manifest/{icon-manifest.ts,icon-vocabulary.spec.ts}` and `pnpm icons:glyphs` (`package.json:21`; no `analytics.*` glyph exists, so `analytics.chart` is new); `libs/features/staff/analytics/src/lib/{staff-analytics.store.ts,analytics.presenter.ts,analytics.vm.ts,analytics.words.ts,analytics.presenter.spec.ts,staff-analytics.store.spec.ts,staff-analytics-page/staff-analytics.page.{ts,html,css,spec.ts},analytics-time-bar/*,analytics-rows-page/*}`, `README.md`, `index.ts` (exports only `StaffAnalyticsPage`); `libs/infrastructure/i18n/src/assets/i18n/{bg,en}.json`; `apps/web/e2e/staff-analytics.spec.ts` and `staff-client-roles.spec.ts`; `tsconfig.base.json` (`@creativo/ui/*` aliases 25–31, no `@creativo/ui/charts` yet); `libs/ui/layout/src/index.ts`; `libs/ui/tokens/src/lib/contrast.ts` (`parseHex`, `composite`, `relativeLuminance`, `contrastRatio`, `WCAG_AA_LARGE_TEXT = 3`) and `accent-spec-support.ts` (`themeTokens`); `apps/showcase/src/app/{app.routes.ts,pages/controls/controls.page.ts}` and the `pages/controls/<name>/<name>.page.*` layout; `apps/showcase/e2e/design-system.spec.ts` (`CONTROL_ROUTES` 11–24, both themes); `libs/ecs-core/src/systems/{staff-analytics.system.ts,+spec,retention.system.ts,+spec,index.ts}`; `libs/ecs-core/src/components/{analytics-report.data.ts,analytics-call.data.ts,+spec,analytics-dictionaries.type-spec.ts,analytics-period.data.ts,retention-group.data.ts,+spec,+type-spec,audit-context.data.ts,feature-flags.data.ts,index.ts}`; `libs/ecs-core/src/entities/collections.ts`; `libs/ecs-core/src/ports/{analytics.port.ts,callables.ts,flags.port.ts,index.ts}`; `libs/ecs-core/src/pipelines/{staff-analytics.pipeline.ts,+spec,staff-analytics.agreement.spec.ts,index.ts}`; `libs/ecs-core/src/primitives/{log-event.data.ts,+spec,ids.primitive.ts,+spec,local-date.primitive.ts}`; `libs/ecs-core/src/errors/analytics.error.ts`; `libs/ecs-core/src/testing/{analytics.fixtures.ts (ANALYTICS_FIXTURE_MONTH, analyticsFixturePorts, analyticsFixtureBusyDays),analytics-doubles.ts,analytics-report.fixtures.ts}`; `apps/functions/src/{main.ts,main.spec.ts,wire/analytics.wire.ts,+spec,wire/triggers.wire.ts,+spec,adapters/firestore-analytics.adapter.ts,+spec,adapters/firestore-ports.ts,adapters/firestore-ttl.adapter.ts,+spec,adapters/firestore-jobs.adapter.ts,lib/flags.ts,lib/cron-zone.ts}`; `config/feature-flags.json` (development/staging/production); `firestore.rules`; `firestore.indexes.json` (exactly 24 composites, so 24 → 25 is right); `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts` (analytics block at 2480); `tools/verify/ops/retention.spec.mjs` (pins "exactly the seven" TTL groups, 4–41 — the eighth-group edit is right); `tools/verify/bundle/budgets.json` (analytics ceiling 1,680,000, line 12); `docs/production-deploy.md` (P2 "7 of 7" at 859, "all 7" at 51/377; P3 "24 declared composite indexes" at 52); `libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts` (+spec, index.ts; reads `ANALYTICS_DEFINITION_VERSION` so a bump drops v1 entries as item 72 says); `libs/infrastructure/firebase-app/src/lib/{analytics-call.adapter.ts,ports.tokens.ts}` (`ANALYTICS_CALL_PORTS` 238, `ANALYTICS_CACHE_PORTS` 247); `client-card.ts:356–359` and `client-appointments.ts:886–889` (item 93's two inline `<a download>` sites); `apps/web/src/app/app.config.ts` (`withComponentInputBinding()` 255, `withViewTransitions(…)` 256); `apps/web/src/app/app.routes.ts` (`staff/analytics` 147, `loadComponent` 152); `docs/designs/staff-analytics.md` and `docs/architecture/decisions/2026-11-08-staff-analytics.md`. Every file marked Create was confirmed absent.

**Symbols:** `AnalyticsSpan.{Week,Month}`; `AnalyticsPeriod.{weekOf,monthOf,of,previous,isWithinRange,days,length}`; `REACH_MONTHS = 12`; `ANALYTICS_DEFINITION_VERSION = 1` in `analytics-report.data.ts` (item 67's home); `AnalyticsReport.DayRow` (item 47's removal target); `StaffAnalyticsSystem.{report,periodInSpan,stepsOf,scopeChoicesOf,computedOn,barSegmentsOf,screenOf,busyKeysOf,mergeVisits,daysOf}` with `RATE_BASE`/`AHEAD_DAYS`; `AnalyticsReadPorts`, `loadVisitsByBusyKeys` and its caps (`IN_CHUNK`, `overBound`); `StaffAnalyticsPorts = AnalyticsReadPorts & ProfileLoadPorts & ShopDayReadPorts & PolicyReadPorts & DefaultLocationPorts & ClockPorts & LogPorts`; `LogEvent.AnalyticsReported` with `durationMs` (pipeline line 283 — the p95 measurement is real); `decodeStaffAnalytics`; `decodeRebuildBusyEvent` (triggers.wire.ts 224); `BusySystem.affectedKeys(before, after, salvaged)` (busy.system.ts 179); `TriggerAttemptSystem.decisiveFailure` (193); `WriteOp.set` (write-op.data.ts 40); `QuerySpec`/`TxQuery`/`ReadTx.query` (tx.port.ts 57/82) and `QueryOp.{ArrayContains,In}`; `liveOnBusyDay` excludes non-live statuses (rebuild-busy 94–109) so a new `visitsOnBusyDay` "cancelled included" is justified, not a duplicate; `CommitPorts`, `ShopDayReadPorts`, `PolicyReadPorts`, `LocationLoadPorts`, `DefaultLocationPorts`, `ClockPorts`, `LogPorts`, `BackfillJobPorts`, `FlagsPorts` all exist as named bundles (item 53's Law 9 intersections are valid); `ClientStatsSystem.inEuroCents` (677/905); `RetentionGroup`/`RetentionAnchor` (7 groups) and `RetentionSystem.*_KEEP_DAYS` (LEAD_TIME 400 precedent — item 49's shape is right); `firestore-ttl.adapter.ts` `anchorOf` switches on the last collection segment ("the `analyticsDays` segment reads `localDate`" fits); `CRON_TIME_ZONE = 'Europe/Sofia'` with the comment "three `onSchedule` options" (item 59's "comment's count" is right); cron slots 03:00/03:30/04:00 taken (main.ts 1030–1041, 1147) so 04:30 is free; `main.spec.ts` `EXPORTS` (372), `daily('every day …')` slots (326–344), length pin 54 (1295); `Callables.StaffAnalytics`, `CALLABLE_APP_CHECK_TOKEN`, `OPERATION_ID_FIELD`; `CapacityMonthId` (ids 202–203) and `LocalDate.monthKey(): CapacityMonthId` (local-date 257) — item 83's rename targets exist; `AuditAction` dictionary (audit-context.data.ts 57); `AnalyticsErrorCode` six codes and `AnalyticsError.{invalidInput,periodOutOfRange}` (item 70's additions fit); `Roles.ANALYTICS_SELF/ANALYTICS_SHOP`; `AnalyticsCacheKey = AnalyticsCall & { userId }` and `analyticsCacheStorageKey` (item 72's key change is real, lines 29–35); `relativeTime` in `libs/infrastructure/i18n`.

**UI elements and test ids:** `ui-segmented-control`, `ui-amount-field` (controls/amount-field.ts 93), `ui-modal-sheet` (modal-sheet.ts 30), `ui-page-action-bar` (page-action-bar.ts 93), `ui-gauge` with `circularCapacity` (gauge.ts 27–28, 191–204), `ui-metric`, `ui-date-field`, `uiVisuallyHidden`; `analytics-takings` (`.ui-metric__value .ui-metric__digits`), `analytics-open`, `analytics-hero`, `analytics-scopes`, `analytics-span`, `analytics-rows`, `data-load` on `staff-analytics`; dashboard cluster ids `staff-view-trigger` (142) and `staff-scope-trigger` (215) — "between the view menu and the scope avatar" is real; `menu-staff-analytics` (site-menu.component.html 295); `bindRouteInputs` in the dashboard.

**Commands and gates:** `pnpm nx run-many -t typecheck|test|lint`, `pnpm nx build web|functions`, `pnpm nx run verify-tools:layering`, `pnpm nx run verify-tools:runbook-gates`, `pnpm nx run functions:test-integration` (project.json 83, `vitest.integration.config.mts`), `pnpm run e2e:web` (package.json 14; `e2e` inferred by `@nx/playwright/plugin`, nx.json 38–40), the CI `coverage` job (`.github/workflows/ci.yml:118–124`, `nx test ecs-core --coverage`), `pnpm run verify:bundle` (the correct name for the bundle guard). Lint rules `tools/lint-rules/{presenter-purity,no-sliced-ports,query-needs-limit}.mjs` exist.

**Tiers (Law 8):** every new file is homed correctly — `day-figures.data.ts`/`analytics-goal.data.ts` → components; `barber-analytics-day.entity.ts`/`analytics-goal.entity.ts`/`collections.ts` → entities; `*.system.ts` → systems; `analytics.port.ts`/`callables.ts` → ports; the four pipelines → pipelines; `log-event.data.ts`/`ids.primitive.ts` → primitives; `analytics.error.ts` → errors; adapters/wire/main in `apps/functions`; presenters/vm/words/store in `libs/features/staff/analytics`; the chart kit `scope:shared,type:ui` matching `libs/ui/patterns/project.json`; `shareOrDownloadFile` in `libs/infrastructure/web-storage` (`type:infrastructure`, importable by `type:feature`).

## What reads well (style lens)

One PR per section in dependency order, every item opening with a path and a Create/Modify marker, a summary table with gate and deploy order per PR, code identifiers rather than paraphrases, and a verification section that maps each command to what it proves. Items 16, 21, 28, 39, 45, 55, 60, 72 and 96 are the model. The defects are local: dedented wrapped lines, a handful of unglossed shorthands, and six overlong items (6, 13, 14, 47, 59, 91) that each become clear as three or four sub-bullets.
