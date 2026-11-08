# Zoom-out review — Staff Analytics v2 (docs/designs/staff-analytics-v2.md)

- **Mode:** REVIEW against `zoom-out-standard.md`
- **Target:** `docs/designs/staff-analytics-v2.md`, lines 1–1089
- **Read in full:** persona, standard, target, CLAUDE.md, chart-library-survey.md, mobbin-inspiration-v2.md, brainstorm_review_report_v2.md, firestore-layout.md, ecs-pipelines.md, ecs-ports.md, staff-analytics.md (v1), 2026-11-08-staff-analytics.md (ADR), concepts_brief_v2.md
- **Code searched for reuse:** `libs/ecs-core/src/{systems,pipelines,primitives,components}`, `libs/ui/**`, `libs/features/staff/{analytics,dashboard}`, `libs/infrastructure/*`, `apps/functions/src/{main.ts,wire/triggers.wire.ts,lib/flags.ts}`

## 0. Context sufficiency — PASS

Overview (11–39), The Problem (41–77) and Goals (109–133) state what is built and why; the six owner asks are each traceable to a section. No request for context needed.

## 1. Root problem and project alignment — PASS with one nit

The design answers ask 6 honestly (35–39: nothing is live; stored days earn their complexity from the year view, not $2) and takes the ADR's own upgrade path. The large cuts (Non-Goals 135–162; Alternatives G, J, K, L) are the right ones. See nit N7 on citing Law 5.

## Findings

### 🔴 B1 — Three repair mechanisms, and none of them rewrites the reach after a version bump or at first rollout

**Scope:** Terms 98–101; Goal 1 (109–114); Pipelines `sweepAnalyticsDays` 356–360 (`SWEEP_REACH_DAYS = 7`); Alternative C 547–554 ("the sweep … self-heals"); Rollout 667–669; plan items 55 (891–892), 65 (922–926, `BackfillJobName.AnalyticsDays`), 66 (927–930, the seed writes day documents), 77 (968–969).
**Rationale:** The document defines "missing" as "no document or an older `dayDefinitionVersion`" (100–101) and promises `missingDays = 0` in steady state (113–114), yet the only automatic writer of old days is a sweep that looks back 7 days. Two situations the design itself creates are therefore never healed: (a) the day `ANALYTICS_DEFINITION_VERSION` goes to 3, every one of ~7,300 documents in the 24-month reach becomes "missing" and every open of a period older than a week recomputes it live from visits — v1's read cost plus the stale document read, i.e. worse than v1 — forever; (b) at first rollout (flag off → on, 667–669) every past day before the deploy has no document and nothing in the rollout steps runs the backfill first. The design then adds a second mechanism (the backfill job, item 65) and a third (the seed writer, item 66) without saying when either runs, while Alternative C's rejection rests on "the sweep self-heals". The brief's own sentence "the sweep rewrites the reach; nothing is backfilled by hand" (concepts_brief_v2.md 127–128, 364) did not survive into the design. This is the "Architectural Dead-End" the standard names: the versioning scheme dead-ends on its first use.
**Resolution:** One repair mechanism. Make the sweep's repair reach the full `REACH_MONTHS`, paged and budgeted the way `continue-policy-recompute.pipeline.ts` / `sweep-policy-recompute.pipeline.ts` already walk a long recompute (one page of barber-days per run, resume from a cursor; the 7-day fast path stays as the first page). Delete item 65 (the backfill job) and item 66 (the seed writer — the live fallback already makes a dev stack correct). Add to Rollout: "turn the flag on; the sweep fills the reach over N nights; `missingDays` trends to 0 and is the gate". Add to Terms "Definition version": "a bump makes the whole reach missing; the sweep rewrites it; the callable computes live meanwhile". If the backfill is kept instead, the design must say "a version bump runs `runBackfill(AnalyticsDays)` before deploy of the new version" and drop the sweep's repair clause.

### 🟡 M1 — The flag creates two read strategies in one callable

**Scope:** Pipelines `staffAnalytics` 361–367; Rollout 667–669 ("the callable reads visits as v1"); plan items 61 (910–911), 68 (935–939, "both paths asserted equal"), 71 (949–952, "the flag").
**Rationale:** The design already specifies the complete v1 behaviour as the fallback for one missing day: "a past day with no document or an older version is computed live from its visits" (363–365). Flag-off is exactly "every day is missing". Building a second branch that "reads visits as v1" keeps the whole v1 read path alive beside the new one, doubles the pipeline spec, and leaves a code path to delete later that no PR names. CLAUDE.md's stance is greenfield: no users to protect with a parallel implementation.
**Resolution:** Define `analytics.storedDays = off` as "`loadAnalyticsDays` is not called; every past day is treated as missing" — one read path, one spec, and the agreement case (item 68) becomes "the live fallback equals the document path", which it must prove anyway. Rollback stays the flag.

### 🟡 M2 — "Same period last year", reach 24 months and a 760-day TTL, with nothing to compare until November 2027

**Scope:** Terms 83–87; Overview 38; CUJ 4 (203–209); `AnalyticsPeriod` 341–344 (`REACH_MONTHS = 24`); day document TTL 316–318 ("760 days (25 months)"); contract 389–393; plan items 50 (874–880, `ANALYTICS_DAYS_KEEP_DAYS = 760`), 69 (943–945), 76 (963–967, the chip), 78 (970–971, "SAME_LAST_YEAR with the seed's 2025 visits").
**Rationale:** The repository has no production data (CLAUDE.md §0). v1 shipped 2026-11-08, so the first period that has a "same period last year" arrives in November 2027. Until then the comparison chip, the second `previous()`/`sameLastYear()` code path, the doubled reach, a TTL that keeps every document a year longer than any screen can use, and a seed that must grow 2025 visits for an e2e, all exist for a value that is `null`. Reach 24 also widens the stored-money retention window for no reader. This is the standard's "built solely for speculative future requirements" — the requirement is real but a year early.
**Resolution:** Keep the wire shape so nothing dead-ends (`analyticsComparison` decoded; `'SAME_LAST_YEAR'` refused with `ANALYTICS_INVALID_INPUT` until enabled). Ship `PREVIOUS` only, `REACH_MONTHS = 12`, TTL 13 months (as the brainstorm review's D1-5 offered), no chip, no 2025 seed. Add a Future Improvements line: "SAME_LAST_YEAR, reach 24 and TTL 25 months in the PR that lands after a full year of stored days". Terms 86–87 and CUJ 4's "two years is not" then follow.

### 🟡 M3 — `DayFigures` duplicates the existing `AnalyticsReport.DayRow`

**Scope:** The day document 296–313 (`DayFigures`, prefix `day`); `DayFiguresSystem` 322–327; plan items 48–49 (867–873).
**Rationale:** Code search: `libs/ecs-core/src/components/analytics-report.data.ts:193–208` already declares `DayRow = { barberId, localDate, rosteredMinutes, workedMinutes, noShowMinutes, unmarkedMinutes, bookedAheadMinutes, heldMinutes, blockedMinutes, breakMinutes, shortGapMinutes, unsoldMinutes, openMinutes, closedDayMinutes }` — the same ten parts, the same two keys, already produced per barber-day by `StaffAnalyticsSystem.daysOf` (`staff-analytics.system.ts:626`) over `ChairDay` (`:92`). The design adds a second per-day struct with the same minutes under a `day` prefix plus money and counts, so the codebase will carry two shapes for one fact, two folds, and a mapping between them when the day rows are drawn from stored days (which v2 must do for YEAR).
**Resolution:** One per-day slice. Either make the stored slice the day row (rename `DayRow` → `DayFigures` with the `day` prefix Law 6 wants, add the money/count/hour fields; `reportDayRows` carries `DayFigures`), or state that `DayRow` is retired in PR 4a and the drill-down reads `DayFigures`. Greenfield: a rename, not a migration. State the choice in "The day document".

### 🟡 M4 — A port bundle, an infrastructure adapter and an InjectionToken for a Blob download the codebase already does inline twice

**Scope:** Ports 381–383 (`AnalyticsExportPorts`); Export 487–492; plan items 95 (1027–1030: `share-file.adapter.ts` in `libs/infrastructure/firebase-app`, token `ANALYTICS_EXPORT_PORTS`), 96–97 (1031–1039).
**Rationale:** Code search: `libs/features/staff/client-card/src/lib/client-card/client-card.ts:356–359` (`URL.createObjectURL(blob)`, `link.download = …json`) and `libs/features/client/appointments/src/lib/client-appointments/client-appointments.ts:886–889` (the `.ics` download) already implement the browser download in two components, with no port and no token. The design makes the third copy a `@core/ports` bundle (a domain tier for a browser API with no domain meaning), an adapter in `firebase-app` (nothing Firebase about it — wrong placement), a token in `ports.tokens.ts`, and a spec for each. Ecosystem reality: `navigator.share` + `<a download>` is ten lines.
**Resolution:** One shared browser helper `shareOrDownloadFile(name, blob)` (with `canShare({ files })` detection) in a `type:ui`/`type:util` browser lib the three features can import (e.g. beside `libs/infrastructure/web-storage`, or a small `libs/ui/modifiers` utility — not `firebase-app`), the two existing call sites moved onto it in PR 7. No port, no token. The export presenter stays pure and returns the CSV text; the page calls the helper. If the owner insists on a port for testability, name the bundle for what it is (`BrowserFilePorts`), not analytics.

### 🟡 M5 — `AnalyticsExported` sent through the client-issue channel

**Scope:** Goal 7 (130–131, "an `AnalyticsExported` log row is written"); Ports 382–383; Observability 520–521; plan item 97 (1037–1039, "through the existing `reportClientIssues`-style channel").
**Rationale:** Code search: `report-client-issues.pipeline.ts`, `client-issue.data.ts`, `client-issue.system.ts` form a channel for client-side _issues_ (defects, canonical JSON digests). Routing a usage event through it bends a channel's meaning for a success measure. The CSV is built entirely on the device; the server has nothing to log and the "audit" value is nil (a user can save the CSV any other way). The log exists only to make Goal 7 measurable.
**Resolution:** Drop the client log and the Goal 7 clause; if an export count is wanted later, add it to the next server-side analytics call as a field on `AnalyticsReported`, or make a proper `ClientUsageEvent` when a second usage event exists. Zero new channel today.

### 🟢 N1 — Chart-kit API surface no screen uses, and a fifth ResizeObserver

**Scope:** Chart kit table 425–430 (`uiStacking: 'stacked' | 'normalised' | 'single'`, `ui-chart-readout`); geometry 432–433 (`niceTicks`); plan items 18 (773–774), 21 (781–782), 23 (785–786, `chart-size.ts`).
**Rationale:** Non-Goals cut "fill by weekday as a 100 % stack" (157–159), so `'normalised'` has no consumer. The adopted frame (Mobbin pattern 1; CUJ 2) prints right-edge labels and values on the bars, "no left axis, no grid" — `niceTicks` draws ticks nobody asked for. The readout is the component the survey (§4) and the brainstorm review (D2-2) name as the edge-case sink ("a pointer readout that does not fight the page scroll"); bar taps already open rows (`(uiBarPicked)`) and the line's right-edge labels answer "what is this value". Code search: `ResizeObserver` is already wrapped in `scroll-row.ts`, `menu.ts`, `modal-sheet.ts`, `map.ts`, `scrollbar-width.ts` — `chart-size.ts` would be the fifth copy.
**Resolution:** Ship `uiStacking: 'stacked' | 'single'`; no `niceTicks`; defer `ui-chart-readout` to a later PR "if the line is unreadable without it"; extract one `elementWidth()` signal helper into `libs/ui/layout` (from `scroll-row.ts`) and use it from the kit.

### 🟢 N2 — Plan item 56 changes `rebuild-busy.pipeline.ts` for keys the trigger already has

**Scope:** "Who writes what" 277–281 ("the same decoded command now also feeds `writeAnalyticsDay`"); plan item 56 (893–895, "answers the affected keys so the trigger can hand them on"); item 60 (905–909).
**Rationale:** Code search: `triggers.wire.ts:224–235` `decodeRebuildBusyEvent` already yields the keys of both sides, and `rebuild-busy.pipeline.ts:116` derives them purely via `BusySystem.affectedKeys(cmd)`. The composition root can call `BusySystem.affectedKeys` on the decoded command and hand the result to both pipelines; no change to `rebuildBusy`'s answer, no coupling of the busy projection to analytics. The Technical Plan already says this; item 56 contradicts it.
**Resolution:** Delete item 56; in item 60 say "`main.ts` derives the keys once with `BusySystem.affectedKeys` and runs both pipelines".

### 🟢 N3 — `MonthKey` beside `CapacityMonthId`

**Scope:** Goals (PR 6) 480–484 ("`MonthKey` … is added; `CapacityMonthId` stays"); plan item 85 (994–995).
**Rationale:** Code search: `ids.primitive.ts:202–203` brands `CapacityMonthId` for `YYYY-MM` and `local-date.primitive.ts:257` already exposes `LocalDate.monthKey()` returning it. Two brands for one string format is a second primitive to maintain and a cast between them wherever a month moves from capacity to goals. Greenfield: rename, don't twin.
**Resolution:** Rename `CapacityMonthId` → `MonthKey` repo-wide in PR 6 (capacity's `capacity/{YYYY-MM}` id is a month key); `LocalDate.monthKey()` returns it; `AnalyticsGoalKey` composes it.

### 🟢 N4 — Goal 8 is a non-goal, and its homes are speculative

**Scope:** Goal 8 (132–133); Non-Goals 137–139; Alternative L 630–638 (`barbers/{id}/restricted/pay`, `analyticsSeals/{key}`); NFR 659–660.
**Rationale:** "Pay has a home but not a screen … nothing in v2 has to change when the pay design lands" is an unverifiable promise about a design that does not exist, and naming two collection paths for it is deciding ahead of the review that owns them. The one lawful sentence is already in Non-Goals.
**Resolution:** Delete Goal 8; keep Non-Goals 137–139 and Alternative L's "its own design"; drop the two path names (or mark them "a suggestion for that design").

### 🟢 N5 — The simpler cut for rebooking was not weighed

**Scope:** Terms "Live day"/"Past day" 88–94 (the two-day rule exists "because the rebooking window … closes only at the end of the next day"); "Who writes what" 280–282 (follow-up → source visit's day, one extra read); day document 309; Alternatives 524–651 (no entry).
**Rationale:** The brainstorm review's preferred D1-1 resolution — keep rebooking and late cancellation live from v1's follow-up reads (≤ 15 `in` queries for a barber-month) and store only clock-free, source-final facts — would remove the two-day "past" rule, the follow-up trigger path, the source-visit read, and the claim at line 93 that "a past day's figures are final unless a visit of that day is edited" (false under the chosen rule: a later follow-up's cancellation changes day D). The design chose the alternative without recording why the simpler one lost.
**Resolution:** Add "Alternative O: rebooking and late cancellation computed live, day documents store only clock-free facts" with pros (fewer writers, no two-day lag, line 93 true) and the reason it lost (the YEAR span's follow-up reads: ~365 `in` chunks). Then fix line 93 to "…unless a visit of that day, or a follow-up booked from it, is edited".

### 🟢 N6 — Altitude drops inside the Technical Plan

**Scope:** Chart kit table 425–430 ("4 px rounded ends, 2 px gaps", every input name); 432–438 (`@property`, `fill`/`stroke`, `ResizeObserver`); State and URL 459–462 (`replaceUrl` vs push); Entry 466–476 (`@defer (prefetch on idle)` on a no-op block); plan item 2 (716–721, "the file's `max-lines` cap (4338) stays or shrinks — the entry logic goes into … `analytics-entry.ts` if the cap is reached"), item 3 (722–724, a pure helper `analyticsEntryQueryOf` with its own spec for a three-branch query), item 19 (`[uiChartLegend]`).
**Rationale:** The standard asks high-level sections to carry interfaces and data flow, not pixel radii, replace-vs-push semantics and a lint cap's current value. The Detailed Implementation Plan is the right home for most of it; item 2's conditional file split is a decision for the PR, not the design.
**Resolution:** In "The screen", keep the element list, its inputs' _shapes_ and the colour mapping rule; move radii, `@property`, `replaceUrl` and the prefetch mechanics to the PR items. Delete item 3 and the cap sentence of item 2 (write `openAnalytics()` where it is; split when the cap says so).

### 🟢 N7 — Cite Law 5's clause so the stored projection is lawful on its face

**Scope:** "Every open re-reads the period" 54–62; Shape 257–261; Additional Resources 682.
**Rationale:** The ADR being superseded (D1) says "Law 5 allows a derived value only for a privacy boundary, a read fan-out or a conflict set. None applies." v2 reverses that on read fan-out (a year = 5,000–50,000 visits) with a projection that triggers rebuild and a TTL expires — exactly Law 5's permitted form — but never names the clause, so a reader of both records sees a contradiction rather than a trigger firing.
**Resolution:** One sentence at 60–62: "This is Law 5's read-fan-out case — a year reads 5,000 visits per barber — met in Law 5's prescribed form: a projection triggers rebuild and a TTL expires."

### 🟢 N8 — Seat-level CSV for the admin

**Scope:** Export 489–491; CUJ 7 (231, "two choices"); plan items 96–97 (1033, 1036).
**Rationale:** The owner asked for "exportable reports"; days and services per barber are the report. A second, seat-level file (appointmentId, net, tip) is scope nobody requested, with a menu to choose it and a privacy row in the NFR to defend it.
**Resolution:** One CSV in PR 7; add seat rows when someone asks and says what for.

## What the design gets right (no action)

Pay and sealing cut to their own design; findings folded into chart sentences; CSV before PDF; zero new hues behind a gate; three drawing components built as the screen needs them with `ui-gauge` for rings (selectors verified: `gauge.ts:160`, `progress-ring.ts:70`, `mark-scale.ts:89`, `calendar-grid.ts:46`, `metric.ts:78`); the callable never writes; stamp ordering instead of a delete protocol; measurement before `RouteReuseStrategy`; the router's own view transition; Chart.js recorded as the fallback; `analyticsGoals` keyed by barber record and month rather than the user record.

## Verdict

Not yet approved. Resolve B1 (one repair mechanism with full reach; the version-bump and first-rollout path written down), and decide M1–M5 in the text (M1 and M3 are text-only simplifications; M2 removes a year of unexercisable code; M4/M5 remove a port, an adapter, a token and a misused channel). The nits can land with the records PR.
