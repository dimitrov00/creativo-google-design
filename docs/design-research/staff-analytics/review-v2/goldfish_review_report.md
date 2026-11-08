# Goldfish Annotated Review Report

Status: resolved — 70 fixes applied 2026-11-08 (Stage 7 round 1); 1 contested, 5 declined, 0 escalated.

**Target:** `docs/designs/staff-analytics-v2.md` (FeatureRange, lines 1–702; a few fixes reach into the plan where a feature-range change forces one)
**Round:** Stage 7, round 1 — resolving the findings of Stage 5 (`zoom_out_report.md`), Stage 6 (`comprehension_report.md`) and Stage 7 (`critic_report.md`) together. Findings that three stages raised at the same scope are merged under one issue and list every id.

**Totals:** 4 blockers (merged from 5 raw), 27 majors (merged from 36 raw), 45 nits. Suggestions: PROPOSE FIX 70, CONTEST 1, ESCALATE 0, DECLINE 5. No severity was changed.

## Decisions the fixes rest on

The fixes below are one consistent set. The decisions behind them, so the edits read as one design and not as patches:

1. **One repair mechanism.** The nightly sweep covers the full reach in budgeted steps that continue until done (the `sweep-policy-recompute` → `continue-policy-recompute` model that already exists), the last 7 days first. No backfill job, no seed writer. A definition-version bump, a cancellation-policy edit and the first rollout all take the same path: every stale day is "missing", the callable computes it live meanwhile, the sweep rewrites it that night. The flag `analytics.storedDays = off` means "`loadAnalyticsDays` is not called; every past day is missing" — one read path.
2. **Every past calendar day gets a document, zeros included**, rostered or not; "past" for a day with no stretch is judged on the default location's clock. So `missingDays` can reach 0.
3. **The heatmap stores both arrays**: `dayHourWorked` and `dayHourRostered` (24 each, wall-clock buckets `startMinutes ÷ 60`).
4. **`PREVIOUS` only in v2.** `SAME_LAST_YEAR` is decoded and refused until a year of stored days exists; reach stays 12 months; TTL 13 months (`localDate` + 400 days). A comparison period that starts before the reach is not read: the comparison fields are `null` and the chip says so.
5. **One per-day slice.** `AnalyticsReport.DayRow` is renamed `DayFigures` (the `day` prefix) and gains the money, count and hour fields; the stored document and the drill-down rows are the same struct. Day rows are per day for spans ≤ 93 days and per month beyond.
6. **Trigger failures join the busy trigger's verdict**: a transient failure redelivers the event; a decisive one logs `AnalyticsDayWriteFailed` and the sweep repairs the day (its reach is the full reach now).
7. **Export is one CSV** (days and services per barber), shared through a shared browser helper `shareOrDownloadFile` in `libs/infrastructure/web-storage` (no port, no token, no log); the two existing inline downloads move onto it.
8. **`CapacityMonthId` is renamed `MonthKey`** repo-wide in PR 6.
9. **Goal 8 is deleted**; the pay paths stay only as a suggestion inside Alternative L.
10. **Alternative O (one document per barber-month, the `capacity` precedent) is added and rejected**, with the shop-year measurement in PR 4b as the recorded trigger to revisit it.

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-zoom-out` S5-B1 · `egm-comprehension` S6-3 · `egm-design` design-1-2 · `egm-structural` structural-1-4 · `egm-design` design-1-11] — Severity: High (blocker)

- **Affected Scope:** Terms "Sweep" / "Definition version" (L98–101), Pipelines `sweepAnalyticsDays` (L356–360), `staffAnalytics` (L361–367), Rollout (L667–672), plan items 55, 65, 66, 77
- **Discrepancy Description:** Three repair mechanisms (7-day sweep, backfill job, seed writer), none rewrites the reach after a version bump or at first rollout; the flag and the backfill have no home in the feature range; the trigger's failure semantics are unstated.
- **Rationale:** Goal 1's `missingDays = 0` fails by construction; after a bump every open older than a week costs more than v1 forever.
- **_AI Suggestion:_** PROPOSE FIX
- **_Justification:_** Valid, and the brief's own sentence ("the sweep rewrites the reach") was lost in drafting. Decision 1 and 6 above.
- **_Proposed Edit:_**
  - Terms "Sweep": "the nightly job that writes, in budgeted steps that continue until done, every past day of every barber record in the reach whose document is missing or carries an older definition version — the last 7 days first".
  - Terms "Definition version": add "a bump makes the whole reach missing; the sweep rewrites it; the callable computes a missing day live meanwhile". Add Terms "Flag" (`analytics.storedDays`: off = every past day is missing; one read path).
  - Pipelines: `sweepAnalyticsDays` starts a budgeted recompute (`startAnalyticsRecompute` / `continueAnalyticsRecompute`, the policy-recompute model); `writeAnalyticsDay` failures join the trigger verdict (transient → redeliver; decisive → `AnalyticsDayWriteFailed`, the sweep repairs). `staffAnalytics`: add the flag's effect and the bound rule (a live fallback past the adapter's caps answers the existing `resource-exhausted` refusal; the screen shows «Опитай по-късно»; possible only before the sweep's first pass).
  - Rollout: "deploy with the flag off → turn it on → the sweep fills the reach that night → `missingDays` trends to 0 and is the gate". Delete plan items 65 and 66; reword 55, 77.

### [Issue 2] [`egm-design` design-1-1 · `egm-comprehension` S6-4] — Severity: High (blocker)

- **Affected Scope:** day-document table (L312), `AnalyticsHourSystem` (L333–336), `reportHourGrid` (L401)
- **Discrepancy Description:** The heatmap needs rostered minutes per hour; a past day stores only worked minutes per hour.
- **Rationale:** "Emptiest hour" is undefined for every past day.
- **_AI Suggestion:_** PROPOSE FIX
- **_Justification:_** Valid. Decision 3.
- **_Proposed Edit:_** add `dayHourRostered: readonly MinuteCount[]` (24) to the table and to `fold`; one more `fieldOverrides` entry; define the bucket on the wall clock; `peak` over hours with any rostered minutes in the period.

### [Issue 3] [`egm-structural` structural-1-1 · `egm-design` design-1-8] — Severity: High (blocker)

- **Affected Scope:** between Alternatives Considered and Non-Functional Requirements
- **Discrepancy Description:** No Risks & Mitigations section.
- **_AI Suggestion:_** PROPOSE FIX
- **_Proposed Edit:_** add `## Risks & Mitigations` (Risk | Effect | Mitigation) with the brief's seven rows, v1's rows that still apply, and the v2 items the reviewers listed (clock skew on the stamp, the version bump, the sweep failing for several nights, a trigger race on a past day, the shop-year read against 4 s, a 366-day CUSTOM for the shop, the view transition and Back re-mount, the localStorage quota, the hue gate, the Chart.js fallback).

### [Issue 4] [`egm-design` design-1-3 · `egm-comprehension` S6-2] — Severity: Medium

- **Affected Scope:** Terms (L92–93, L98–99), Goal 1, `writeAnalyticsDay`, sweep, `staffAnalytics`
- **Discrepancy Description:** Days without a stretch never get a document, so `missingDays` is never 0 and every open pays for them.
- **_AI Suggestion:_** PROPOSE FIX — Decision 2 (a zero-figure document for every past calendar day; a stretch-less day's "past" on the default location's clock; an outside-hours seat lands in its day's outside-hours fields through the visit's key).

### [Issue 5] [`egm-comprehension` S6-1] — Severity: Medium

- **Affected Scope:** Terms "Live day" / "Past day" (L88–94), Shape, cost table
- **Discrepancy Description:** Live and past days do not partition the period for a barber at locations in different zones.
- **_AI Suggestion:_** PROPOSE FIX — "Live day: every day of the period that is not past — normally today and yesterday, three days at a zone boundary; the screen's "today" is the default location's clock."

### [Issue 6] [`egm-design` design-1-4] — Severity: Medium

- **Affected Scope:** Non-Goals (L154–156), day document (L309), agreement property, CUJ 8
- **Discrepancy Description:** A late-cancellation count frozen at write time breaks the agreement property after a policy edit.
- **_AI Suggestion:_** PROPOSE FIX — option (b): a `settings` write that changes the cancellation window starts the same budgeted recompute over the reach (as `recomputeClientStatsOnPolicyChange` does for client stats); the Non-Goal is narrowed to roster and location-hours edits; CUJ 8 and the property hold "once the recompute completes"; the ⓘ says so.

### [Issue 7] [`egm-zoom-out` S5-M2 · `egm-design` design-1-9] — Severity: Medium

- **Affected Scope:** Terms (L83–87), CUJ 4, `AnalyticsPeriod` (L341–344), TTL (L316–318), contract (L389–393), plan items 50, 69, 76, 78
- **Discrepancy Description:** `SAME_LAST_YEAR`, reach 24 and a 760-day TTL with nothing to compare until November 2027; comparison periods outside reach have no rule.
- **_AI Suggestion:_** PROPOSE FIX — Decision 4 (PREVIOUS only; `SAME_LAST_YEAR` decoded and refused; reach 12; TTL 400 days; a comparison before the reach is not read, the fields are `null`, the chip says so; CUJ 4 compares with the previous year's months only once they exist; a Future Improvements line).

### [Issue 8] [`egm-zoom-out` S5-M1] — Severity: Medium

- **Affected Scope:** `staffAnalytics` pipeline, Rollout, plan items 61, 68, 71
- **Discrepancy Description:** The flag creates two read strategies in one callable.
- **_AI Suggestion:_** PROPOSE FIX — Decision 1: flag off = every past day missing; one read path; item 68's case becomes "the live fallback equals the document path".

### [Issue 9] [`egm-zoom-out` S5-M3 · `egm-comprehension` S6-12 · `egm-style` style-1-22 · `egm-structural` structural-1-9] — Severity: Medium

- **Affected Scope:** the day document (L296–313), `DayFiguresSystem` (L322–327), plan items 48–49
- **Discrepancy Description:** `DayFigures` duplicates `AnalyticsReport.DayRow`; `AnalyticsDay` is a third unglossed name; meta fields sit in the slice table.
- **_AI Suggestion:_** PROPOSE FIX — Decision 5: `DayRow` → `DayFigures` (`day` prefix, the money/count/hour fields added; `reportDayRows: readonly DayFigures[]`); the table re-titled "the document body" with the meta row separate; `fold(day: AnalyticsDay, …)` glossed as v1's per-day input (`ChairDay` plus its seats).

### [Issue 10] [`egm-design` design-1-5] — Severity: Medium

- **Affected Scope:** contract (L399–404), Ports (L384–385), NFR
- **Discrepancy Description:** The report's size and the device cache are unbounded for YEAR and shop spans.
- **_AI Suggestion:_** PROPOSE FIX — day rows per day for ≤ 93 days, per month beyond (a month in YEAR opens the MONTH span); the series per day/week/month as stated; stated maximum answer ≈ 100 kB (shop-year); YEAR cached like any span (6 entries, a quota error ignored, as v1) — in NFR.

### [Issue 11] [`egm-design` design-1-6 · `egm-zoom-out` S5-N8 · `egm-zoom-out` S5-M4 · `egm-zoom-out` S5-M5 · `egm-design` design-1-13 · `egm-comprehension` S6-11 · `egm-structural` structural-1-5] — Severity: Medium

- **Affected Scope:** Goal 7, CUJ 7, Ports (L381–383), Export (L487–492), Observability (L520), plan items 95–98
- **Discrepancy Description:** The admin's seat-row CSV has no read path; a port, an adapter and a token for a browser download the codebase does inline twice; `AnalyticsExported` through the client-issue channel; two file-name patterns.
- **_AI Suggestion:_** PROPOSE FIX — Decision 7: one CSV (days + services per barber), `creativo-analytics-<from>-<to>.csv`; `shareOrDownloadFile(name, blob)` in `libs/infrastructure/web-storage` (the client card's JSON and the client appointments' `.ics` move onto it in PR 7); no port, no token, no log; Goal 7's log clause dropped; seat rows to Future Improvements.

### [Issue 12] [`egm-design` design-1-7] — Severity: Medium

- **Affected Scope:** Alternatives Considered
- **Discrepancy Description:** The one-document-per-barber-month alternative (the `capacity/{YYYY-MM}` precedent) was never weighed.
- **_AI Suggestion:_** PROPOSE FIX — Decision 10: Alternative O with the numbers (barber-year 12 reads, shop-year ~120, against 730 / 7,300) and the reasons it loses now: every booking rewrites a ~45 kB month document (write amplification ×30 on bytes), per-entry stamp ordering inside one document, a hot document per barber-month when a month of departures is edited in one batch, and the day as the unit every trigger already names; the shop-year read (~3,650 documents) is measured in PR 4b, and if it misses the 4 s budget the month document is the recorded next step.

### [Issue 13] [`egm-design` design-1-10] — Severity: Medium

- **Affected Scope:** Goal 4, Colour (L450–457), Open Question 1
- **Discrepancy Description:** Accent and warning are adjacent warm oranges in every stacked bar; the palette spec cannot catch it.
- **_AI Suggestion:_** PROPOSE FIX — unmarked gets a diagonal hatch over the warning fill plus the separator edge; `chart-palette.spec.ts` pins pairwise distinguishability of adjacent parts (ΔE in OKLab ≥ 8, computed in the spec) beside the surface contrast; the Colour paragraph says so.

### [Issue 14] [`egm-structural` structural-1-3 · `egm-comprehension` S6-7] — Severity: Medium

- **Affected Scope:** Goals, "The screen" (L444–451), Detailed Implementation Plan head
- **Discrepancy Description:** The seven questions, the D-numbering and the PR dependency table live only in the brief.
- **_AI Suggestion:_** PROPOSE FIX — a `## Decisions` H2 (D1–D10, one line each with the section that elaborates) between Non-Goals and Open Questions; the seven-question table (Question | Scope | Spans | Element | Form | Opens to) in "The screen"; the PR table (PR | Deliverables | Depends on | Gate | Deploy) at the head of the plan; the brief references replaced by anchors.

### [Issue 15] [`egm-structural` structural-1-2] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — promote Additional Resources and Future Improvements to H2 in v1's order.

### [Issue 16] [`egm-structural` structural-1-6 · `egm-style` style-1-4] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — "one new callable (`setAnalyticsGoal`), one writer pipeline fed by the existing triggers and the sweep, and a client-side export".

### [Issue 17] [`egm-structural` structural-1-7 · `egm-comprehension` S6-8] — Severity: Medium

- **Affected Scope:** Terms (L79–106), "The screen" (L440–449), CUJ 7
- **Discrepancy Description:** v1's vocabulary used without a pointer; "stretch" and "busy key" undefined; the dock, hero, `ui-metric`, `ui-gauge`, `ui-chart-readout` never introduced.
- **_AI Suggestion:_** PROPOSE FIX — a first line in Terms ("v1's Terms hold — visit, seat, follow-up, departure, roster, hole, `ShopNow`, hero, drill-down"), new entries for **stretch**, **busy key**, **dock**, **counterpart day**; "The screen" names `ui-metric` (hero, tiles), `ui-gauge` (ring), the dock (`ui-page-action-bar`) and adds it to the sections; the readout is deferred (Issue 25).

### [Issue 18] [`egm-comprehension` S6-5] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — "v1 G5" and "v1 G4" named explicitly, or the spec's case named, at every use.

### [Issue 19] [`egm-comprehension` S6-6] — Severity: Medium

- **Discrepancy Description:** The goal's pace rule is unstated.
- **_AI Suggestion:_** PROPOSE FIX — catalogue row: `expectedLow/High = goalLow/High × daysWorkedSoFar ÷ daysRosteredInMonth` (days with a stretch, up to and including today); takings ≥ expectedHigh → `AHEAD`; ≥ expectedLow → `ON_TRACK`; else `BEHIND`; `NONE` = no goal or no rostered day yet.

### [Issue 20] [`egm-comprehension` S6-9] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — gloss P2/P3 once: the production runbook's gates that every TTL policy and composite index is active (`docs/production-deploy.md` §3.1).

### [Issue 21] [`egm-comprehension` S6-10 · `egm-structural` structural-1-12 (dataviz part)] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — name the tool: the bundled dataviz skill's `scripts/validate_palette.js`, run once by hand on the six mark colours per theme (outside the repo); the repository gate is `chart-palette.spec.ts`. Open Question 1 says "validated by that script and pinned by the spec".

### [Issue 22] [`egm-style` style-1-2 · style-1-3] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Goal 1: "Past days are stored on event and read as documents; a past day is recomputed only when one of its visits or follow-ups is edited, the cancellation policy changes, or its definition version changes." Goal 2: "Past days of every span are read as day documents, not visits."

### [Issue 23] [`egm-style` style-1-1 · style-1-5 · style-1-6 · style-1-7] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — the four wording edits as proposed (delete "correct and dull"; "that either side of a write names"; the morph accepted "on the 4× throttle production build in PR 1", Back's re-mount "drops a frame over 16.7 ms"; the four numbered changes with the periods as the fourth).

### [Issue 24] [`egm-zoom-out` S5-N5] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — Alternative P: rebooking and late cancellation computed live, day documents store only clock-free facts (pros: fewer writers, no two-day lag; lost on the YEAR span's follow-up reads); line 93 → "unless a visit of that day, or a follow-up booked from it, is edited".

### [Issue 25] [`egm-zoom-out` S5-N1 · `egm-structural` structural-1-8 · `egm-style` style-1-10] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — `uiStacking: 'stacked' | 'single'`; no `niceTicks`; `ui-chart-readout` deferred ("if the line is unreadable without it"); one `elementWidth()` signal helper extracted into `libs/ui/layout` from `scroll-row.ts`; "three in PR 2, `ui-radar` in PR 5" in Overview and Terms.

### [Issue 26] [`egm-zoom-out` S5-N2] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — delete plan item 56; item 60: `main.ts` derives the keys once with `BusySystem.affectedKeys` and runs both pipelines.

### [Issue 27] [`egm-zoom-out` S5-N3 · `egm-design` design-1-16] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — Decision 8: `CapacityMonthId` → `MonthKey` repo-wide in PR 6.

### [Issue 28] [`egm-zoom-out` S5-N4] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — Decision 9: delete Goal 8; the paths stay inside Alternative L as "a suggestion for that design".

### [Issue 29] [`egm-zoom-out` S5-N6] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX (partial) — radii, `@property` and the prefetch mechanics move to the plan items; `replaceUrl` stays in the feature range because Issue 32 makes it a product rule; plan item 3 and the cap sentence of item 2 deleted.

### [Issue 30] [`egm-zoom-out` S5-N7] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — the Law 5 sentence at "Every open re-reads the period".

### [Issue 31] [`egm-design` design-1-14] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — the writer's query is a new `QuerySpec` (`busyKeys array-contains` alone, cancelled visits included, `VISITS_PER_BARBER_DAY = 60`).

### [Issue 32] [`egm-design` design-1-12] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — picks write the URL with `replaceUrl`; Back returns to the schedule; Goal 5 and CUJ 1 stand.

### [Issue 33] [`egm-design` design-1-15] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — the cost table adds the counterpart day's ~15 visits and the trigger's roster + departure reads; the shop-year row names PR 4b's measurement and Alternative O as the fallback.

### [Issue 34] [`egm-design` design-1-17] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — the presenter clamps a negative age to «току-що».

### [Issue 35] [`egm-structural` structural-1-10, -1-11, -1-12, -1-13, -1-14, -1-15] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — retention named by group, anchor and formula; continuation lines reflowed and signatures in code spans unbroken; links in Additional Resources and `staff-pay.md` marked "(to be written)"; "v1's CUJs 1, 4, 5 and 6 hold unchanged"; Pros/Cons rows for F and M; the `CLOSED` departure wording and "a data warehouse" added.

### [Issue 36] [`egm-style` style-1-8, -1-9, -1-11, -1-12, -1-13, -1-14, -1-16, -1-17, -1-18, -1-19, -1-20, -1-23, -1-24, -1-25 · `egm-comprehension` nits] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — the wording edits as proposed; the long sentences broken into lists; Open Question 3 moved into Terms; the YEAR boundary (1 January) and the radar outline's base (the comparison period's figures against this period's best) stated; which value changes morph (bar heights) and which cross-fade (a series change, the line's path).

### [Issue 37] [`egm-comprehension` nit "at the stored rate"] — Severity: Low

- **_AI Suggestion:_** CONTEST
- **_Justification:_** `ClientStatsSystem.inEuroCents` (v1 design, "the client card keeps its own rounding"; `libs/ecs-core/src/systems/client-stats.system.ts`) converts a seat's `priceCents` + `currency` at the fixed BGN→EUR changeover rate the system holds; "the stored rate" means that constant, and the design's parenthesis already says "at the stored rate". One gloss is added anyway ("the system's fixed changeover rate").

### [Issue 38] [`egm-comprehension` nits: "the attempt verdict", "`overBound`", "echo guard", "runbook-gates"] — Severity: Low

- **_AI Suggestion:_** DECLINE for "echo guard" and "runbook-gates" (plan-range glosses, Stage 9's scope); PROPOSE FIX for "attempt verdict" and "`overBound`" (one clause each).

### [Issue 39] [`egm-comprehension` nit L576 "PR 2 date"; `egm-style` style-1-24 "Rules of the house"] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — "if the kit is not ready when the redrawn screen is" / "Repository rules".

### [Issue 40] [`egm-comprehension` nit "v1's approximation of the first stretch's clock"] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — one clause: a barber at two locations in one day has one document, its day boundary and "past" judged on the clock of the location of their first stretch; the minutes of both stretches are in it.

### [Issue 41] [`egm-comprehension` nit "month within reach + 1"] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — "up to and including next month".

### [Issue 42] [`egm-structural` structural-1-12 link style] — Severity: Low

- **_AI Suggestion:_** DECLINE for the body's backtick paths (v1's link style is not a standard requirement); PROPOSE FIX for Additional Resources (markdown links).
