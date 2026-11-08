# Goldfish brainstorm review — staff analytics v2 hypothesis

- **Target:** `docs/design-research/staff-analytics/hypothesis-v2.md` (whole file; line numbers below refer to it unless another path is named)
- **Mode:** BRAINSTORM
- **Date:** 2026-11-08
- **Reviewers (all completed):** `egm-design` (architecture, cost, failure modes), `egm-codebase-details` (accuracy against the code, reuse), `egm-zoom-out` (scope, YAGNI), `egm-comprehension` (naive reader), `egm-implementation-readiness` (what a design must pin before PR 1/2), `egm-structural` (document skeleton and its place among the ADR and v1 design)
- **Inputs every reviewer read:** CLAUDE.md, `docs/designs/staff-analytics.md`, the ADR `2026-11-08-staff-analytics.md`, `chart-library-survey.md`, `mobbin-inspiration-v2.md`, the analytics pipeline / report data / chair-time system / store, `view-transition.ts`, the token files, `budgets.json`, `firestore.rules`, `firestore.indexes.json`, `apps/functions/src/main.ts`, plus whatever each stress-test point needed (`cron-zone.ts`, `app.config.ts`, `app.routes.ts`, `analytics-period.data.ts`, `analytics.port.ts`, `callables.ts`, `busy-key.primitive.ts`, the retention/TTL adapter, `run-backfill.pipeline.ts`, the agreement specs, `accent-rule.spec.ts`, the showcase e2e).

Severity: 🔴 blocker (the design that follows cannot be written, or an engineer would build the wrong thing) · 🟡 major · 🟢 nit. Each finding names the lens or lenses that raised it; a finding raised independently by three or more lenses is marked **(converged)**.

**Tally after deduplication:** 15 blockers, 31 majors, 22 nits.

---

## Verified as stated (no action)

- The device cache, paint-then-request, no listeners, «Към 11:40» = `reportComputedAtUtcMs` (`staff-analytics.store.ts:69-79, 253-296`; `analytics-report.data.ts:82`).
- The route `staff/analytics` with `activeGuard` + `rolesGuard` (`app.routes.ts:143-156`); `?free=1` and `?day&view&barber` on the schedule (`route-inputs.ts:4-9, 65-70`).
- `--sys-identity-0..4` exist in both themes and are documented as "WHOSE chair, never what state" — per-barber series is their lawful use (`theme-light.css:100-134`).
- `--sys-color-success` / `--sys-color-destructive` exist under those names; `HeroChange` already decides up/down/flat (`analytics-report.data.ts:61-70`).
- `accent-rule.spec.ts` does not police new tokens or `fill`/`stroke`; six `--sys-chart-*` tokens on marks would not fail it. A chart that sets `color: var(--sys-color-accent)` on a label or axis WOULD fail §5 (`accent-rule.spec.ts:441-473`).
- The survey's rubric figures (4.70 / 4.65 / 3.15 / 2.60; Chart.js 64 kB gzip, no heatmap) match `chart-library-survey.md` §4.
- The read arithmetic: 1,000 / 11,500 reads per open and "~3M reads, about $2" are consistent with the v1 table; 200 / 1,700 for a month from day documents hold if rebooking is inside the day document (see D1-1) and the next-7-days visits stay live. The analytics route has ~81 kB raw headroom under its 1,680,000 ceiling (`budgets.json:12`).
- `Currency` primitive exists; `payCurrency` beside `payFixedCents` is lawful Law 6/7 shape. The `{barberId}__{localDate}` id already exists as `BusyKey`.
- Route over sheet (D5's reasons), day documents over month projections once the year view is asked for (the ADR's own upgrade path), today never stored, counters banned, SVG-in-templates over canvas for the components that are needed, CSV through the browser, print before jsPDF, goals as a range — all six lenses accepted these.

---

## D1 — Stored closed days

### 🔴 D1-1 Rebooking and late-cancellation figures are not final when the day closes **(converged: design, codebase, comprehension, readiness, zoom-out)**

Lines 53-54 store "client counts (rebooked base and count, no-shows, late cancellations)". The catalogue (`docs/designs/staff-analytics.md:359, 361`; ADR D3) counts visit A as rebooked only once A's shop date + 1 day is before today and only if the follow-up F is "not CANCELLED at report time"; a late cancellation is judged by "the seat's stored window, else the current policy's". So a day document written at 04:00 on D+1 holds a rebooked count whose window is still open all of D+1, a follow-up cancelled weeks later changes day D with no write on any visit of day D (the trigger "when a visit of a closed day changes", line 57, never fires — F is a visit of a later day and carries only `bookedFromAppointmentId`), and a cancellation-policy edit re-judges every stored day (the capacity projection already has `recomputeClientStatsOnPolicyChange` for exactly this, `main.ts:1110-1123`). The proposed G5 case "month from day documents equals month from visits" fails on precisely these edits.
**Resolution (preferred, design + zoom-out):** store only source-final, clock-free facts in the day document — the minute partition, takings, tips, service rows, no-show counts, hour buckets — and keep rebooking and late cancellations computed live from v1's follow-up/policy reads (≤15 `in` queries, ~40 docs for a barber-month; one range query for the shop). **Alternative:** close day D at 04:00 of D+2, add a trigger path that rebuilds the source visit's day when an appointment with `bookedFromAppointmentId` is written or cancelled, and add the settings trigger to the list. The design must state which, and the G5 case for it.

### 🔴 D1-2 The callable has no write step, and three writers have no ordering rule **(converged: codebase, design, readiness, comprehension)**

Line 59-60: "A missing day is computed and written by the callable on first read (the pipeline's write step)". `staff-analytics.pipeline.ts:44-47, 84-90` is read-only — `StaffAnalyticsPorts` has no commit bundle; `analytics.port.ts:42-99` declares only `Load*`/`List*`; the callable is registered as a read with no operation id (`callables.ts:271-273`; `main.ts:874-883`). Turning it into a writer changes its idempotency class and "no partial report" guarantee. Job, trigger and callable each recompute and overwrite with no winner rule: the callable can read visits before an edit commits and write after the trigger's rebuild, leaving a stale figure with no later event to fix it. A literal reading of "missing day" also includes today (comprehension), contradicting lines 41 and 64.
**Resolution:** the callable never writes; a missing past day is computed live. Every writer stamps `dayDefinitionVersion` + `dayComputedAtUtcMs` and runs inside a transaction that re-reads the day's visits and refuses to overwrite a document computed after its own source read (stamp ordering, Law 7 T2). The nightly job also sweeps the last N days for missing or version-stale documents, as `sweepCapacityDaily` repairs capacity (`main.ts:1029-1033`). _The zoom-out lens argues the opposite cut — keep lazy write-on-read, drop the job and backfill, and have the existing triggers delete (invalidate) the touched day rather than rebuild it. Both agree on the version stamp and that the document is a cache; the design must pick one writer model and say why._

### 🔴 D1-3 The day document has no schema, and the multi-location question is open (readiness, codebase)

The hypothesis lists categories, no fields, primitives or 1-to-N shapes. Most of it exists as types: `ChairDay` (`chair-time.system.ts:51-72`, ten parts summing to `rosteredMinutes`), `AnalyticsReport.DayRow` (`analytics-report.data.ts:193-208`), `ServiceRow`, `OriginShare`/`BookingOrigin`, the `report*` counts (`:112-134`). Only the 24 hour buckets are new. v1 computes days per location via `nowByLocation` (`staff-analytics.pipeline.ts:156-159, 256-261`).
**Resolution:** `libs/ecs-core/src/components/analytics-day.data.ts` — a flat `AnalyticsDay` slice with a `day` prefix reusing `ChairDay`'s field names (`bookedAhead` and `open` are 0 on a past day by construction), `dayTakingsCents` (euro cents after `inEuroCents`) + `currency`, `dayTipsCents`, `dayServices: readonly {…}[]`, three flat origin counts, `dayNoShowCount`, `dayWorkedSeatCount`, `dayDefinitionVersion`, `dayComputedAtUtcMs`; `entities/analytics-day.entity.ts` with id `BusyKey`; `Collections.AnalyticsDays`; a type-spec. Decide: one document per barber-day across locations (v1's approximation: the first stretch's location clock) or per (barber, location, day), and whether `locationId` is on the document.

### 🔴 D1-4 "Closed day" is undefined, collides with a v1 term, and "04:00 shop time" is not what `onSchedule` offers **(converged: comprehension, design, codebase, readiness)**

In v1 a "closed day" is a `CLOSED` departure (`reportClosedDayMinutes`, `analytics-report.data.ts:100`); a v1 reader takes D1 as "store only days off". "The shop's clock" is not one thing: a barber may work several locations in different zones (v1 Terms). `CRON_TIME_ZONE = 'Europe/Sofia'` is a deploy-time literal (`cron-zone.ts:11`: "never a shop's clock"), and 04:00 is already `sampleBarberLeadTimeDaily`'s slot (`main.ts:1146`). For a location hours west of Sofia, "yesterday in Sofia" is still today there — a stored day with clock-dependent minutes, the ADR D1 failure.
**Resolution:** rename to "past day"; define once: "a barber-day `d` is past when `d < ShopNow.localDate` at every location where the barber has a stretch on `d`". The job fires on `CRON_TIME_ZONE` at a free slot (e.g. 04:30; update the cron-zone comment count), derives `ShopNow` per location inside the pipeline (as the callable does), writes each missing or version-stale past day over a catch-up window of N days (pin N — this is what makes a failed run self-heal), and skips any day not yet past at every location.

### 🔴 D1-5 TTL, composite index, rules and `fieldOverrides` for `analyticsDays` are not pinned, and the repo's TTL mechanics are not acknowledged **(converged: readiness, codebase, design, comprehension)**

"TTL 25 months" (line 60) is not operational. The repo's convention is the adapter-stamped `purgeAt` Timestamp outside the entity type (`firestore-ttl.adapter.ts:7-34, 96-127`; `RetentionAnchor` + `RetentionSystem.purgeAtUtcMs`, "the seven formulas"), seven `fieldOverrides` with `ttl: true` (`firestore.indexes.json:945-986`), and a deploy gate P2 that counts "7 of 7 TTL policies ACTIVE" (`production-deploy.md:51, 377, 859-882`). v1 Non-Goals (`staff-analytics.md:164-166`) say stored derived money goes behind `restricted/`; the day document carries takings at the root of a new collection with no stated rule.
**Resolution:** a `RetentionAnchor.analyticsDays(localDate)` variant and an eighth formula (anchor + reach + 1 month, from `localDate` never from the write time so a rebuild does not extend it); a `case Collections.AnalyticsDays` in the adapter; the eighth `fieldOverrides` entry and the runbook's count 7 → 8; `fieldOverrides` with `indexes: []` on the service-row and hour-bucket arrays; composite `(barberId ASC, localDate ASC)` like `scheduleExceptions` (`firestore.indexes.json:197-210`) and a decision on the shop-wide read (one `localDate` range or `barberId in [≤30]` chunks) with its `limit`; `match /analyticsDays/{dayId} { allow read, write: if false; }` with the convention comment. Deploy order for the PR: indexes + TTL (wait P2/P3) → rules → functions. State that `REACH_MONTHS` (12, `analytics-period.data.ts:23`) becomes 24 so "same period last year" on a year 12 months back has its base — or the TTL is 13 months.

### 🟡 D1-6 The departure/roster triggers have no rule for which days, and no bound (design, comprehension, readiness)

Line 57-59 names "the appointment trigger" and "the departure/roster triggers"; none exists for analytics (`main.ts` exports `rebuildBusyOnAppointmentChange`, `rebuildCapacityOnExceptionChange`, `…OnRosterChange`, `…OnLocationChange`, `:940-1027`). The appointment trigger's shape is reusable: `decodeRebuildBusyEvent` already derives `before.busyKeys ∪ after.busyKeys` (`triggers.wire.ts:224-239`), i.e. exactly the days to rebuild, including a `localDate` change and a re-staff. A departure carries one `localDate` — fine. A roster version write carries only `barberId`; a backdated edit touches every day from its effective date to yesterday — up to ~730 rebuilds × ~20 reads from one write, inside a trigger timeout. Location hours and settings also move rostered minutes and the late line; capacity has five sources plus a sweep.
**Resolution:** either enumerate all five sources and run roster/location/settings rebuilds as a chunked, budgeted job bounded to the reach (the `continue-policy-recompute.pipeline.ts` model), or adopt the product rule "rostered minutes of a past day are the roster as it stood when the day closed" and rebuild only on departure and appointment edits. The second is cheaper and defensible for pay; state it. Name the new exports and add them to `main.spec.ts`'s `EXPORTS` pin (`:372, 1250`).

### 🟡 D1-7 The hero comparison cannot be reproduced from day documents (codebase, comprehension)

Design "Comparison" (`staff-analytics.md:371-378`): today compares with its counterpart day where a seat counts once it has ended by the current minute. A day document holds whole-day takings; the hypothesis buckets only worked minutes per hour, not money.
**Resolution:** read the one counterpart day's visits live (~15 reads), or store per-hour takings too, or change the rule to whole days and raise `ANALYTICS_DEFINITION_VERSION`. The G5 case fails until one is chosen.

### 🟡 D1-8 Drill-down seat rows for past days are unaccounted for; Alternative M's objection returns (design, comprehension)

The day document holds service rows, not seat rows (client names stay off stored projections, ADR D6). A closed-month drill-down to seats re-reads the month's visits (~400 — today's cost), and after a late edit those live rows disagree with the day-document hero until the trigger lands — the reason v1 rejected a rows callable (`staff-analytics.md:703-707`).
**Resolution:** say where seat rows come from in v2; carry `dayComputedAtUtcMs` so the rows page can say "rows as of now, figure as of <time>" when they differ; or scope G4's footer-equals-figure guarantee to live days and write that down.

### 🟡 D1-9 Partition names are mixed up (codebase, comprehension)

Line 53 "every part of `ChairTimeSystem`'s partition" (ten parts, no "other") versus D3's six "chair-time parts: worked, no-show, unmarked, blocked, unsold, other", which are the time BAR's `AnalyticsBarPart`s (`analytics-report.data.ts:48-57`; Other = held + short gaps; break excluded).
**Resolution:** D1 stores the ten `ChairDay` parts plus the outside-hours fields; D3 colours the six `AnalyticsBarPart`s and says so. Minutes are `MinuteCount`, not `DurationMinutes`.

### 🟡 D1-10 The day document and `definitionVersion` are not coupled (structural, comprehension, readiness)

v1's rule: a formula change raises `ANALYTICS_DEFINITION_VERSION` and invalidates cached reports (`analytics-report.data.ts:17`). The hypothesis says what the device cache does on a bump, not what 25 months of day documents do. Every future formula change otherwise becomes a backfill.
**Resolution:** the day document carries its `dayDefinitionVersion`; a mismatched day is treated as missing (recomputed live, rewritten by the sweep). State it as the maintenance rule. PR 3 raises the version to 2.

### 🟡 D1-11 Backfill, kill switch and rollback are absent (readiness, codebase)

`runBackfill` exists: sysadmin-only, `BackfillJobName` dictionary, progress in `backfillJobs/{job}`, budgeted and idempotent (`run-backfill.pipeline.ts:70-94`); it is not `@emulatorOnly`, so P7 does not apply. `appointments.barberIds` has indexes switched off (`firestore.indexes.json:445-449`), so there is no per-barber appointment query to walk.
**Resolution:** `BackfillJobName.AnalyticsDays` with a page walk over appointments grouped by `busyKeys`; a functions flag (`config/feature-flags.json` → `.env`) `analytics.storedDays` that makes the callable ignore day documents and read visits; run the backfill only after the schema is final, re-runnable per `dayDefinitionVersion`. _The zoom-out lens notes that at greenfield volume there is nothing to backfill; lazy fill is the backfill for any gap._

### 🟡 D1-12 No log events, drift signal or missing-day counter (codebase)

`LogEvent.AnalyticsReported` covers the callable only (`log-event.data.ts:19`).
**Resolution:** `AnalyticsDayWritten` (barberId, localDate, source, visitCount, durationMs — no money), a per-run sweep summary, `AnalyticsDayMissing` (a rising count is the only symptom of a broken job), and `AnalyticsDayDrift` from a sampled shadow recompute, so an oncall can answer "which day document is stale and why" from Cloud Logging.

### 🟡 D1-13 The year view and a 366-day custom range are unpriced (design)

Barber-year ≈ 732 day docs + ~110 ahead visits ≈ 850 reads; shop-year ≈ 7,300 + ~1,070 ≈ 8,400 — about today's shop-month, so the 4 s budget must be stated for it. The live "next 7 days" read is now 55–65 % of every open — the next lever, unaddressed.
**Resolution:** price YEAR and CUSTOM per scope in the design; say which span breaks which budget (the barber's budget is 1.5 s, not 4 s — comprehension).

### 🟢 D1-14 Smaller D1 points

- The jump from "~5,000 visits per barber a year" to "1,000 reads a barber-month" is unexplained; v1 has ~400 visits a barber-month plus previous period, follow-ups and next 7 days (comprehension).
- "There are no listeners and no per-write rebuilds" (line 26) describes v1; D1 adds a rebuild per edit of a past day — reword (design).
- Hour buckets: 24 root fields are a bounded map fixed at design time (allowed by `firestore-layout.md`) but cost 24 single-field indexes unless overridden; one 24-long `readonly MinuteCount[]` needs one override. Decide, and decide the measure first — worked minutes, occupied minutes or visit starts (codebase, design, comprehension).
- Takings in euro cents at the stored rate: a later rate change leaves past days at the old rate — state it as accepted (readiness).
- Gloss "the agreement specs (G5)" once: `staff-analytics.agreement.spec.ts` over the September 2026 fixture in `@core/testing` (comprehension). No visit crosses midnight (`endMinutes` ∈ (0, 1440]) — state it so the straddle question is closed (readiness).

---

## D2 — The hand-built chart kit

### 🔴 D2-1 `libs/ui/charts` cannot import ecs-core; every input must be a plain display struct, and the scaffold is unlisted (readiness)

`type:ui` may depend only on `type:ui` (`eslint.config.mjs:240-242`); ecs-core is `type:domain`. The geometry module is display geometry over raw numbers in `libs/ui/charts/src/lib/*.geometry.ts` (survey §5 says so), not an ecs-core system.
**Resolution:** the design lists each element's `input()` types (e.g. `readonly { label: string; value: number; previous: number | null }[]`) and states that the presenter in `libs/features/staff/analytics` does every bucketing and normalisation. Scaffold: `nx g @nx/angular:library` with tags `scope:shared, type:ui`, alias `@creativo/ui/charts` beside `tsconfig.base.json:25-31`, showcase routes (`apps/showcase/src/app/app.routes.ts:230-232` pattern), entries in `CONTROL_ROUTES` of `apps/showcase/e2e/design-system.spec.ts:11-24`. Note CI runs no `@screenshot` tests (`tools/verify/ci/e2e-screenshot-tag.spec.mjs:3-9`): "visual baseline" is an owner-machine gate, not a CI gate.

### 🟡 D2-2 The kit's honest cost is five to six weeks, the rubric omits delivery time, and three drawing components cover the screen (zoom-out, structural, design)

The survey itself prices the kit at "two to three weeks of design-system work before the first screen" (`chart-library-survey.md:252-258`). An itemised estimate of what D2 lists (geometry + specs, bar, line with right-edge labels and label collision at 320 px, readout that does not fight page scroll, heatmap, calendar heatmap, radar, sparkline, stacked bar + legend, ten showcase pages, both-theme baselines plus axe) is 24–30 engineering days before PR 4 draws a chart on real data. Chart.js 4 in `@defer` reaches the same screen in about a week (heatmap hand-built either way). Re-weighting the bundle row does not flip the rubric — "design-system fit" (25 %, scored 5 vs 2) carries it — but the rubric has no row for "engineering days to the first shipped screen"; add it at 20 % and the two draw. D4's eleven rows use four geometries: rectangles (every bar variant, incl. ranked horizontal, stacked, 100 % stacked, segmented origin), a polyline (hero line; the sparkline is the line without axes), a tinted cell grid (weekday × hour; the calendar is `ui-calendar-grid` with a `--ui-cell` tint), and rings (`ui-gauge`, built). The radar is the only new geometry. The hidden data table per chart is good practice, not a requirement: `role="img"` with the presenter's one-sentence label already passes `expectNoAxeViolations`.
**Resolution:** build three drawing components (`ui-bar-chart` with orientation/stack inputs promoted from `lib-analytics-time-bar` and the page's share bars, `ui-line-chart` with a grey comparison series and tap readout, `ui-heatmap` as a CSS grid) as the redrawn screen needs them; `ui-gauge` for rings; radar and calendar heatmap later, each when a screen needs it; one showcase page for the three; geometry limited to `linearScale`, `niceTicks`, `linePath`, `stackOffsets` (a straight polyline is what Revolut draws). Put the delivery-cost row in the survey rubric with a number. What is lost: a DS-complete kit on day one and the FIFA polygon in the first redraw.

### 🟡 D2-3 "Ten SVG elements" versus nine names, and two D4 forms have no element (structural, comprehension)

Lines 84-86 list nine new elements; "rings stay `ui-gauge`" is existing (`libs/ui/patterns`); `ui-chart-legend` is `uiListRow`s, not SVG. D4's "ranked horizontal bars" (row 5) and "split bars per metric" (row 8) have no element in D2 or the survey §5 table.
**Resolution:** "nine new elements, of which seven draw SVG and two are HTML; rings reuse `ui-gauge` unchanged (say why not `ui-progress-ring`, `libs/ui/controls`)"; add an Element column to the D4 table and reconcile.

### 🟢 D2-4 Smaller D2 points

- "d3-shape + d3-array 4.65": the survey's scored column is "d3 modules + templates" (shape, scale, array, interpolate) — match the name (comprehension).
- Gloss "showcase page and visual baseline": `apps/showcase` page; Playwright screenshots in both themes (comprehension).
- The kit imported statically by the analytics route counts toward its 1,680,000 ceiling (~81 kB headroom; the kit is 25–40 kB raw): pin a dated ceiling raise or `@defer` for the heavy charts (readiness, codebase).

---

## D3 — The data palette

### 🔴 D3-1 The six hues have no values and "the dataviz validator / the script" does not exist in the repo **(converged: readiness, comprehension, design)**

`--sys-chart-1..6` is the first thing PR 1 writes into `theme-light.css`/`theme-dark.css`, yet the hypothesis leaves the family as open question 1 and rests D3's acceptance criterion on a tool no grep finds under `tools/`, `libs/ui/tokens` or `apps/` ("dataviz" appears only in this file).
**Resolution:** list the twelve hex values (six per theme) with measured contrast against `--sys-color-surface`/`--sys-color-background` (≥ 3:1, SC 1.4.11) and a CVD check (simulated protanopia/deuteranopia/tritanopia pairwise distinguishability); name the external tool or add `libs/ui/tokens/src/lib/chart-palette.spec.ts` on the existing `contrast.ts` (`accent-rule.spec.ts:28-34`) that pins them; state that chart marks use `fill`/`stroke`, never `color`, so accent-rule §5 stays green, and that the chart stylesheets join the tokens test target's inputs (`accent-rule.spec.ts:181-183`). Note the identity block's exclusion — "None enters the accent's warm Lab sector (h 25–95) … No orange and no red-orange" (`theme-light.css:100-129`) — applies to any new hue; say so in open question 1.

### 🟡 D3-2 "Worked" moves from the accent to `--sys-chart-1`, contradicting the survey and the live time bar (codebase, comprehension, readiness)

Survey §5 Colour: "The accent is the one series that matters (this period, worked, the goal)"; the time bar grades the foreground with `color-mix` and reserves the accent for worked (`analytics-time-bar.css:31-49`). D3 reserves the accent for "selected / this period / best" and gives worked a categorical hue.
**Resolution:** one of the two documents changes; if D3 wins, say "worked is `--sys-chart-1`; the accent is never a time part; the time bar is repainted".

### 🟡 D3-3 Six fresh categorical hues contradict the repo's own research on ordered data (zoom-out, codebase)

The chair-time parts have a fixed order. `mobbin-inspiration-v2.md` "Patterns to avoid" §3: "use an ordered ramp for ordered data and at most six hues otherwise". The only true categorical sets on the screen are per-barber (identity tones exist) and booking origin (two or three values). Six new tokens plus a validator step serve one stacked bar the research says should be a ramp.
**Resolution:** accent + one ordered ramp of the foreground (the `color-mix` steps with the 32 % floor and hairline the survey §5 specifies for bars) + identity tones for barbers + success/destructive for change with an arrow. Zero new tokens. What is lost: hue-per-part "colour that explains"; a ramp explains by order and the legend-as-table carries the names. If six hues stay, D3-1 applies in full.

### 🟡 D3-4 D3's colour rules and D4's Colour column disagree in four rows, and token binding is unstated (structural)

Rows 3 and 11 use an "accent ramp" D3 never defines. Row 4 "Free time ahead: accent, emptiest bar outlined" inverts D3's "accent = selected / this period / best" and Mobbin pattern 6 (grey bars, one accent bar). Row 5 "one hue" is not a D3 category. Rows 9-10 use `--sys-chart-*` for booking origins, so the same hue means "worked" in one chart and "online" in the next on one screen.
**Resolution:** add to D3 "a one-hue ramp of the accent for ordered intensity (heatmap, calendar)"; change row 4 to "grey bars, emptiest in accent"; state whether chart tokens are bound to parts screen-wide (origins then use grey grades) or every chart owns its indices and no two adjacent charts share one.

### 🟢 D3-5 Smaller D3 points

- Words on a green/red delta chip are ink: `--sys-color-destructive-label` is the ink cut (`theme-light.css:48-57`); no success-label token exists — the chip's text stays ink, the arrow/glyph carries the colour (codebase).
- Name the grey token ("previous / average / context"): the survey says 18 % and 9 % greys fail 3:1 for bars; use the 32 % `color-mix` with the 1 px separator edge (comprehension).

---

## D4 — The screen, chart by chart

### 🔴 D4-1 The radar's base leaks the best barber's figure to a barber, and lines 130 and 136-137 contradict each other **(converged: design, comprehension, structural, zoom-out)**

Row 130: admin radar, "values 0–100 against the shop's best in the period". Lines 136-137: "A barber sees their own radar against the shop average … (v1.1's reference rule)" — and the v1.1 rule is "averaged over the OTHER barbers" (`staff-analytics.md:750`), not the shop average. If a barber's axis scale is the shop's best, a barber at 50 on € per hour knows the best colleague makes twice theirs; in a 3-barber shop that person is identifiable. v1 Non-Goals: "Ranking barbers on a barber's screen"; NFR: "a barber's report never contains another barber's figure" (`:166-168, 719`). Fairness: one outlier (three visits at a high rate) flattens everyone; rates are `null` below base 20 (G6), so a part-timer's radar has holes; the Mobbin round itself warns "a radar needs a floor or it shows nothing" (`mobbin-inspiration-v2.md:149-153`).
**Resolution:** split into two rows with a Scope column: "How I do (barber): normalised against the barber's own previous period, the average of the other barbers as the grey outline, shown from three contributors" and "How each barber does (admin): against <one stated base>". Compute all radar values server-side as a system decision (Law 10) so the max never travels; base = best among barbers whose figure meets its sample floor; a `null` axis is drawn as missing with a word, not 0; define "contribute" (rostered minutes > 0? a worked seat?). Add a row to the Goals/Non-Goals table saying the v1 non-goal holds.

### 🔴 D4-2 The radar's axes are undefined or double-defined, and the new figures have no catalogue entries (comprehension, readiness, structural)

"€ per hour" — per hour of service (v1 `takingsPerHourCents`) or per rostered hour? "fill" per barber — v1 defines fill per weekday only. "tips rate" — tips ÷ takings, or per worked seat? "returning clients" — not a v1 figure (v1.1's "first-visit return"), and "rebooking" is already an axis: two axes for one idea. "reliability (100 − no-show)" is already 0–100; dividing it by the shop's best makes 100 mean "as reliable as the best", not "no no-shows". The busiest/emptiest hour sentence and the findings' "largest change" are new figures too. v1's rule (G3): every figure has a catalogue entry and a `definitionVersion` bump.
**Resolution:** add "D9 — The callable v2 contract and catalogue version 2" (see X-3): one line per figure with formula, includes, excludes, base gate and whether it is normalised; `AnalyticsRadarSystem.normalise` (best = 0 → axis null; under base 20 → null; the ≥ 3 rule), `AnalyticsHourSystem.buckets/peak` (ties → earliest). Drop or define "returning clients".

### 🔴 D4-3 A reader cannot build the span × role matrix from the table (comprehension, structural)

Two rows say "(admin)", one "(shop)"; "Where bookings come from" is unmarked but admin-only in v1 (`staff-analytics.md:362`); "When the shop is busy" says shop but a barber presumably sees their own. Span is implied only in three rows; nothing says what Day shows for "Do clients come back" (a 12-period sparkline of 12 days?), whether "Free time ahead" appears in Year, or whether the heatmap appears in Day. The table rows are 230–290 characters wide.
**Resolution:** columns "Question | Scope (barber / admin-barber / admin-shop) | Spans (D W M Y C / next 7 days) | Element (ui-*) | Form | Colour | Opens to"; move per-row mechanics (right-edge labels, delta chip, tap targets) to the design's "The screen" section or mark the table "the design owns the detail".

### 🟡 D4-4 Several charts duplicate each other or exist already (zoom-out)

Row by row: hero + line (keep; the only chart needing the comparison base); where the time went (keep; the day's "tall segmented bar" is `lib-analytics-time-bar` as built); heatmap (keep; it alone answers the v1 problem statement's empty Thursday afternoon; its sentence is D6's "finding"); free time ahead (keep; the existing open-hours card with a bar per day); ranked services (keep; rows already have share bars); retention tiles with 12-period sparklines (demote: twelve periods means twelve reports or stored days, and under base 20 most periods are `null` — a verdict word and a delta answer the question); radar (see D4-1, schedule it after the screen when its figures exist); compare two barbers (cut: same six metrics, and CUJ 4's scope picker already does it); fill by weekday 100 % stacked (cut: the heatmap's column totals, and the existing weekday-fill share bars show it); booking origin (keep; zero new drawing); "the year" as a section (cut: row 1 already draws months for year; the calendar heatmap of daily takings answers "which days", which nobody rosters or prices by — decoration from the Mobbin round).
**Resolution:** seven sections, three new drawing components. If variety is the point, vary orientation, stacking and comparison of the three forms rather than add geometries. What is lost: pictures, not answers; the owner would notice fewer of them.

### 🟡 D4-5 "Fill by weekday" as a 100 % stack has undefined segments (comprehension)

v1's Fill is one ratio per weekday (`WeekdayFill`, `analytics-report.data.ts:155-163`). A 100 % stack needs named segments: filled vs unfilled (two greys), or the six bar parts (which is "where the time went per weekday", not fill).
**Resolution:** define the segments, or cut the row (D4-4).

### 🟢 D4-6 Smaller D4 points

- `?free=1` and the CUJ 2 link shape already exist (`route-inputs.ts:65-70`; `staff-day.store.ts:985-994`) — cite them rather than imply something new (codebase).
- "the base named in the subtitle" → "a subtitle stating the comparison base in words: «спрямо най-добрия в салона за октомври»" (comprehension).
- "v1.1's reference rule" is not built; say "lands in PR 3". "a 'waiting' state under the sample floor" → gloss "the G6 base of 20". Say whether takings per hour of service stays on the services row (comprehension).
- The freshness wording («Обновено преди 2 мин», lines 32-33) is a screen decision that lives only in the preamble and staging; move it into D4. It is a presenter formatting of `reportComputedAtUtcMs` with `now` as input (Law 7 T2 "staleness budgets"), display only — say so, so nobody reopens ADR D6's refusal of a reuse window; «Обновено 11:40» is the smaller fix (structural, comprehension, codebase, readiness, zoom-out).

---

## D5 — Entry from the schedule

### 🟡 D5-1 Wrapping the navigation in `document.startViewTransition` collides with the router's own transition **(converged: design, codebase, zoom-out, readiness)** — top major

`app.config.ts:253-282`: `provideRouter(…, withViewTransitions({ onViewTransitionCreated }))` starts a transition on every navigation and skips only same-path or reduced motion; `/staff/schedule → /staff/analytics` is a path change. `view-transition.ts:69-81` documents the hazard the hypothesis recreates: "The platform allows ONE view transition at a time: starting another skips the running one"; `settledViewTransition()` exists for it, and `staff-day.store.ts:954` awaits it before a URL write. The search morph works because it is an in-page state change (`_searching`, `staff-day.store.ts:1934-1941`; `@defer (when store.searching())`), not a navigation. `runViewTransition` is dashboard-internal and not importable by the analytics feature. A `router.navigate` inside it resolves after the guards and the lazy chunk, so the snapshot finishes before the new page exists. A 40 px icon stretching into a text headline is also a distorted snapshot; the search capsule morphs because both ends are a pill.
**Resolution:** do not call `runViewTransition`/`startViewTransition` around `router.navigate`. Use the router's transition; give the toolbar button and the analytics headline a shared `view-transition-name` (precedent `staff-search-field`, `staff-dashboard.chrome.css:356`; `::view-transition-group` rule in `styles.css:218`) only if the morph is shown to look right; otherwise the router's root cross-fade at the house timing is what every other screen gets. Prefetch the analytics chunk on idle (the sheets already do) — a cold chunk freezes the old snapshot for the chunk's load. The two can coexist only sequentially via `settledViewTransition()`. Prove in e2e that the dashboard's deferred URL write (`staff-day.store.ts:948-969`) cannot fire mid-navigation.

### 🟡 D5-2 The route is not query-driven today; `?span=DAY&from&barber` names things that do not exist (codebase, readiness, comprehension)

`AnalyticsSpan` is `WEEK | MONTH` (`analytics-period.data.ts:6-12`); `AnalyticsPeriod.of` refuses a first day that is not a Monday or 1st (`:57-68`); reach is 12 months; the store holds `pickedPeriod`/`pickedScope` as signals with no route inputs (`staff-analytics.store.ts:115-127`); the cache key is `AnalyticsCall & { userId }` (`analytics.port.ts:126-128`). CUSTOM needs `to`; the shop scope needs a grammar.
**Resolution (belongs in D9):** `span=DAY|WEEK|MONTH|YEAR|CUSTOM`, `from=YYYY-MM-DD` (any day for DAY/CUSTOM, a boundary otherwise), `to=` for CUSTOM only, `barber=<id>` or absent for the shop; a `bindRouteInputs`-style reader (`route-inputs.ts` is the model; `withComponentInputBinding` is on) with URL→store→URL sync as `staff-day.store.ts` does for `?day`; a barber's `?barber=` is ignored; the localStorage key encodes span + from + to + comparison.

### 🟡 D5-3 "Opening on the schedule's barber" sends a barber to a FORBIDDEN screen (comprehension — rated blocker by that lens)

Every book-working role sees every chair; a linked barber viewing a colleague's column taps the chart → `barber=<colleague>` → `ANALYTICS_FORBIDDEN` (visibility table, `staff-analytics.md:305`). Undefined when the schedule shows the whole shop.
**Resolution:** "barber = the schedule's selected barber when the caller is admin, else the caller's own `linkedBarberId`; when the schedule shows all chairs an admin opens the shop scope, a barber their own."

### 🟡 D5-4 "Between search and the scope avatar; it shows at every width" has no search button beside it on a phone (codebase)

`staff-dashboard.html:168-187`: the search button is in the top trailing cluster "from 600px of bar only"; a phone finds it in the bottom bar (`staff-search-entry`, `:999-1000`).
**Resolution:** decide where the analytics button lives under 600px (bottom bar beside search, or the top cluster alone) and say so.

### 🟡 D5-5 "Lag never" is asserted, not measured; the route re-mounts the schedule on Back (design)

No `RouteReuseStrategy` exists in `apps/web/src`. Navigating away destroys the dashboard: its listeners (busy day, exceptions, schedule, location, the day's appointments) are torn down and re-subscribed on Back with a cold first paint. The dashboard already keeps its DOM alive under seven `@defer` sheets including the search the owner likes. The route's real advantages (deep links, stacked sheets, a back stack) stand; the lag argument is not established.
**Resolution:** measure both on the 4× throttle production build (forward: tap → first frame; back: tap → schedule interactive, reads issued); if the route wins, state the Back re-mount cost and consider a detach/attach `RouteReuseStrategy` for the schedule only, which also keeps scroll position.

### 🟢 D5-6 Smaller D5 points

- D5 departs from the research's own recommended pattern 11 (`mobbin-inspiration-v2.md:501-503`: a modal page launched from the schedule's toolbar) without saying so; add one clause to the counter-argument (structural).
- The v1 e2e opens analytics from the menu (`apps/web/e2e/staff-analytics.spec.ts:128-129`); the new entry needs a case proving Back restores `?day&view&barber` and that the `?free=1` round trip still clears the parameter (design, readiness).

---

## D6 — Goals and written findings

### 🟡 D6-1 Goals on the user record are readable by colleagues, bound to the account, per-admin for the shop, and have one month of history **(converged: design, codebase, readiness, comprehension, structural)**

`firestore.rules:209`: `allow get: if isOwner(uid) || worksTheBook()` — any receptionist can read a barber's money goal directly, against the v1 Non-Goal on stored derived money. A goal on `users/{uid}` follows the account: a re-link through `setRoles` carries it to the wrong barber. "The admin for the shop, stored on the user record" gives each admin their own shop goal; the shop has no user record to hold one. `users/*` is written only by audited callables (`firestore.rules:214-235`). One `analyticsGoalMonth` pair means the year view's "goal pace" has nothing to draw. No `YYYY-MM` brand exists except `CapacityMonthId` (`ids.primitive.ts:201`).
**Resolution:** `barbers/{id}/restricted/goals` (callable-only; the analytics callable returns it with the report, +1 read) keyed by month, and the shop goal on the settings document; one `setAnalyticsGoal` callable (barber for self, admin for the shop) with an audit row; widen `CapacityMonthId` to a general `MonthKey` or add one (Law 7.4), reused by `analyticsSeals`.

### 🟡 D6-2 "Written findings" duplicates the chart captions (zoom-out)

The four findings (best day, emptiest hour, largest change, goal pace) are each already a figure on screen: the hero delta chip, the heatmap's sentence, the line's peak label, the goal ring. A separate system + presenter + half a PR restates what the reader just looked at.
**Resolution:** each chart carries its one sentence, worded by the existing `analytics.presenter.ts` from values the report already contains (Law 10 satisfied). Keep goals, last among the v1.2 items.

### 🟢 D6-3 Smaller D6 points

- A `ui-gauge` ring "with seven week dots" for a _month_ goal: the Strava pattern is seven weekday bars for a weekly goal; say what the dots mean (comprehension).
- D6 has no counter-argument though the H2 promises one (structural).
- Every writer that creates a user document (provisioning stub, complete-registration, dev seed) must write defaults if goals stay there — another reason for their own document (structural).

---

## D7 — Export

### 🟡 D7-1 A CSV of seat rows exports client names off the device with no audit (design, comprehension)

Seat rows are the rows "through `lib-visit-list`" with client names (`staff-analytics.md:514-517`); ADR D6 keeps them out of the device cache for that reason. A CSV via Web Share hands names + prices + dates to any app on the phone, by any barber. "Money never leaves a barber's own scope" addresses the wrong risk. Print-to-PDF prints the live DOM, so the same applies to printing a drill-down.
**Resolution:** default CSV = day rows and service rows (no names); seat-level CSV admin-only and without names (appointmentId, date, service, net, tip) unless a stated purpose requires them; an `AnalyticsExported` log event (uid, scope, period, row count — no money).

### 🟡 D7-2 Three export surfaces for one ask ("reports exportable") (zoom-out)

CSV through `Blob` + Web Share with a download fallback is 0 bytes and one PR. The print stylesheet is "nearly free" until page breaks, hidden chrome, SVG in print and iOS Safari's print path are handled. The share card needs `svgToPngBlob` with computed-style inlining of every `fill`/`stroke`/`font`, a background rect, `canvas.toBlob`, `canShare({files})` detection, plus card design — the most code for the surface nobody asked for.
**Resolution:** CSV only in the export PR; print stylesheet as a follow-up if the owner asks for "PDF" after seeing CSV; share card cut until a user asks. Pin `navigator.canShare({ files })` + `<a download>` fallback if it stays (readiness). D7 has no counter-argument (structural).

---

## D8 — Pay rule, earnings and sealing

### 🔴 D8-1 A pay rule "on the barber record" is public **(converged: design, codebase, readiness, comprehension, structural)**

`firestore.rules:564-566`: `match /barbers/{barberId} { allow read: if true; allow write: if false; }`. Root fields `payRateBasisPoints`, `payFixedCents`, `payCurrency` publish every barber's commission to anyone, signed out. "In a `restricted/` subdocument's spirit" is not a rule. `barbers/{id}/restricted/link` is a NAMED match, deny-all, callable-only (`firestore.rules:568-581`), with the comment that `restricted/` under a barber "holds nothing else" and that a second wildcard would break `role.rules-parity.spec.ts`; `barber-link.entity.ts:15` repeats it. "Readable by admins and the barber it names" is not expressible in rules without a `get()` on `users/{uid}`.
**Resolution:** `barbers/{id}/restricted/pay` as a second NAMED match, `allow read, write: if false`, callable-only; earnings reach the barber only through `staffAnalytics`, which already judges stored roles and `linkedBarberId`; a `setPayRule` callable (admin, audited like `setRoles`); update the entity comment and the parity spec; a rules integration case beside the link's. Answer ADR D4 ("revisited only if pay arrives (v2)") in one sentence either way.

### 🔴 D8-2 Sealing as specified is contradicted by three D1 rules and breaks G4 (design, zoom-out, comprehension)

(a) "A missing day is computed and written by the callable on first read" silently recomputes a sealed month's missing day from the current, edited visits. (b) "TTL 25 months" deletes the sealed basis of a pay figure on a timer. (c) The G5 case fails by design for any sealed month with a later edit. (d) A frozen day document with live drill-down rows means the rows no longer sum to the figure (G4, `staff-analytics.md:128-130`; the footer check `:579-580`). "Raises a notice" has no recipient, home or effect on the figures.
**Resolution:** a seal is its own snapshot document (`analyticsSeals/{barberId}__{YYYY-MM}` holding the sealed figures, the pay rule applied, `definitionVersion`, `sealedAtUtcMs`, `sealedByUserId`, an audit row, no TTL, callable-only; a `SealKey` primitive since `BusyKey.parse` refuses it). Day documents stay a rebuildable cache. The screen shows the sealed figure and, when it differs from the live one, says so («Разлика след запечатване»). Then no writer needs a seal check and the G5 case excludes nothing. Whether a later edit in a sealed month is allowed-and-flagged or refused is a booking-domain rule for the pay design, not an analytics projection freeze.

### 🔴 D8-3 "Net takings" is undefined, and it decides money (comprehension)

v1 "Takings" is already Σ seat nets after discount (`staff-analytics.md:356`); "net" could also mean takings − voucher draws (the reconciliation gate's formula, `:1119-1122`) or excluding tips.
**Resolution:** "Earnings = `payRateBasisPoints` × takings (v1 definition: Σ worked-seat nets, euro cents, vouchers counted in full) + the fixed amount; tips are never in the base."

### 🔴 D8-4 Pay needs its own design (zoom-out, design, structural)

The v1 success measure makes a reconciled month (takings + tips − voucher draws within 2 % of the till) a precondition of pay; v1 shipped 2026-11-08 to a greenfield with no users — that month has not happened, and the gate depends on a calendar, not code. Beyond D8-1 to D8-3 the hypothesis leaves open: an audit row per rule change; versioning (`payEffectiveFromLocalDate` on one record cannot express a rate that changes mid-month); currency (`payCurrency` vs takings in euro cents — a BGN rule over EUR takings is unconverted, with the 2026 changeover live); the fixed monthly amount on a Day/Week/Year/Custom span (prorated, Month-only, summed?); the label's legal weight («Възнаграждение» reads as wages — informational or a payslip basis?); payroll retention periods (long in Bulgaria — confirm with the shop's accountant; they apply to the seal snapshot, never to a TTL'd cache). D8's own counter-argument concedes "anything richer is a design of its own"; one percentage plus a fixed amount already carries all of the above.
**Resolution:** cut D8 to one sentence: "pay and sealing: `docs/designs/staff-pay.md`, its own review, after the reconciliation gate". The v1 non-goal "Earnings and pay" is then not lifted by v2 — record that in the Goals/Non-Goals table. If sealing ships with v2 at all, only under D8-2's snapshot model. `payRateBasisPoints` needs its own brand with a smart constructor (Law 7.4); the existing percentage convention is `discountPercent`.

---

## Staging

### 🟡 S-1 Seven PRs is the wrong cut: PR 1 ships a kit nobody uses, PRs 1–3 change nothing the owner sees, and dependencies are unwritten **(converged: zoom-out, design, structural, readiness)**

PR 2 writes production documents nobody reads until PR 3; the G5 day-document case needs the read path. The kit's component API is unvalidated until PR 4 uses it. The schedule entry (D5) depends on nothing and is the owner's item 4. PR 7 depends on a calendar. `REACH_MONTHS` 12 → 24, the `AnalyticsSpan` extension and the `definitionVersion` bump are PR 3 items not listed. The survey's own §5 order starts by promoting the live time bar to `ui-stacked-bar`/`ui-chart-legend` (zero new drawing, a consumer the same day). Staging swaps D1/D2's order without a reason. v1 carried a records PR (ADR, design amendment, i18n, e2e); v2 omits it.
**Resolution:** a table "PR | Deliverables | Depends on | Gate | Deploy step | Ships independently?". Proposed order: (1) schedule entry button + URL state + freshness wording against the v1 screen; (2) the redrawn Week/Month screen on live data with `ui-bar-chart` (promoted from the time bar), `ui-line-chart`, `ui-heatmap` built as needed, one showcase page; (3) DAY span (live visits, ~15 docs); (4) stored days (schema final, `dayDefinitionVersion`, sweep) together with the YEAR span, the comparison base and the G5 case; (5) the admin radar when its figures exist; (6) goals; (7) CSV; (8) the records; pay and seals in their own design. Deploy steps: the stored-days PR needs indexes + TTL (P2/P3) → rules → functions and a `production-deploy.md` note (new TTL group, composite, scheduled job, triggers); the callable PR deploys functions before web (a new web sending `DAY` to old functions is refused `ANALYTICS_INVALID_INPUT`); any rules PR deploys rules before functions. Showcase and per-component baselines land with the components, never as a gate ahead of them.

### 🟡 S-2 Testing the design must name (readiness)

Beyond geometry specs and the G5 case: `analytics-day.data` spec + type-spec; `AnalyticsDaySystem.fold(ChairDay, nets…) → AnalyticsDay` and `sum(days, today) === report(visits)` as a property over the fixture; hour-bucket and radar systems' purity + boundaries (DST day, zero best, base 20); the trigger wire spec (both sides → day keys, refused side salvaged); the job pipeline spec with pinned `nowUtcMs` across two zones and a missed day; the backfill page spec; `functions:test-integration` for the trigger and the job; a rules integration case that a client read/write of `analyticsDays` is denied; e2e for the schedule entry and the DAY/YEAR controls. The fixture (September 2026, now = 28th 09:00) already splits 27 past days from a live today and 2 future days.

---

## Cross-cutting and structural

### 🔴 X-1 No Goals vs Non-Goals for v2; the fate of each v1 non-goal is unstated (structural)

v1's Non-Goals (`staff-analytics.md:158-174`): "Earnings and pay" is lifted by D8 without saying so; "Ranking barbers on a barber's screen" is claimed kept (line 137) but strained by D4-1; "A security boundary on money" awaits the ADR D4 answer; "One free-time number", "Changing the roster permission", "Storing the private reason for a block", "Push notifications / client-facing analytics" are silent. v1.1 items v2 does not pick up (first-visit return, overdue regulars, the Monday card, the receptionist's forward open-time card, `:750-755`) are neither dropped nor deferred.
**Resolution:** add "## Goals and Non-Goals for v2" between "Hypothesis" and "Decisions": numbered goals, one per owner ask, each with a success measure (v1 had four, `:146-156`); a table "v1 non-goal | Holds / Lifted / Amended | By which D"; a table "v1 Future Improvements item | In v2 (D) / Deferred / Dropped".

### 🔴 X-2 The relationship to the ADR and the v1 design is unstated (structural)

ADR D1 says "No … Nothing is written" and names the per-day set as the upgrade path with two triggers (p95 > 4 s for a week, or the year view / same-period-last-year / custom ranges are built). v2 fires the second trigger — so it takes the ADR's own path — but reverses the ADR's text, goes beyond its path (a scheduled job, write-on-read, hour buckets, a backfill), and changes ADR D7's "Storage tiers" and "Sealing" rows. The design's "Reads and cost" (`:500-501`: "No projection, trigger or TTL is added; the signal is the time budget, not the read count") and Alternative C's rejection reason become false, and D1's counter-argument says the stored set is accepted partly "because the owner's cost worry is answered by it" — contradicting the design's stated signal. Repo convention: a superseded ruling gets a status banner in the OLD file naming the NEW one (`2026-11-06-blocks-move-and-break-series.md:3-6`); a second ADR on the same subject is a separate dated file (`2026-11-03-staff-search-sheet.md:3-6`). `2026-11-08-staff-analytics.md` exists, so a same-day v2 ADR needs a distinct name. CLAUDE.md §4: "do not reopen a decided question in code" — the reopening happens in a record first.
**Resolution:** front matter gains "Date", "Predecessor" and "Supersedes / amends" (ADR D1's "No"/"Nothing is written", ADR D7's two rows, design "Reads and cost", Alternative C's reason, Non-Goals, Future Improvements); one sentence in D1: "This fires the ADR's second trigger (year view built), not its first; written the day v1 shipped because the owner's first reading asked for the year"; a "## Records" item naming the new ADR file and deciding whether `docs/designs/staff-analytics.md` is amended in place or a `staff-analytics-v2.md` is written with v1 marked Predecessor.

### 🟡 X-3 "The callable v2" is a PR with no decision behind it; the contract and catalogue v2 have no home (structural, readiness, comprehension)

Staging item 3 lists spans, comparison base, hour buckets and radar figures as server work; D4 describes the normalisation in a screen row; nothing owns the contract.
**Resolution:** add "### D9 — The callable v2 contract and catalogue version 2": `AnalyticsSpan.Day/Year/Custom`; `toLocalDate: LocalDate | null` and `analyticsComparison: 'PREVIOUS' | 'SAME_LAST_YEAR'` on `AnalyticsCall` (both decoded in `analytics.wire.ts`); `AnalyticsPeriod.of` rules per span (DAY any day; YEAR Jan 1; CUSTOM `from ≤ to`, ≤ 366 days — open question 4 decided); `previous()` for CUSTOM (same length ending the day before) and SAME_LAST_YEAR (same dates vs ISO-week aligned — pin); reach 24 months; `ANALYTICS_DEFINITION_VERSION = 2`; every new `report*` field in `decodeReport`; each new figure's catalogue row; the DAY-scope comparison (same weekday last week? yesterday?); the wire-skew rule.

### 🟡 X-4 No traceability from the six asks to D1–D8, no success measures, no risks section (structural)

Mapping (the reviewer's, not the document's): ask 1 → D2, D3, D4; ask 2 → D1, D4 period control, staging 3, open question 2; ask 3 → D1, D6–D8; ask 4 → D5; ask 5 → D7; ask 6 → the preamble + D1. Every ask is answered and nothing answers no ask, but ask 2's DAY span is answered only by an open question, ask 5 duplicates part of ask 3, and the four-item "Hypothesis" list is unlabelled against eight decisions. v1 had a risks table (`:582-598`); v2 introduces new risks (a day document out of step with its visits, a sealed month edited, a definitionVersion bump against 25 months of documents, the view transition on a phone, hues failing the validator) and lists none. Item 6's answer: the owner's worry is answered by wording alone; D1 earns its complexity from the year view, not from $2 a month — say so (zoom-out).
**Resolution:** a table "Ask | Decisions | Success measure" after "Hypothesis"; "(D1)", "(D2–D4)", "(D5)", "(D6–D8)" appended to the four items; "## Risks and mitigations" in v1's three-column form carrying the four v1 risks that still apply.

### 🟢 X-5 Open questions: three of four are settled by rules already in the repo (zoom-out, comprehension, structural)

- Q1 (hue family): settled by the identity block ("WHOSE chair, never what state") — never the identity tones for parts; the warm-sector exclusion applies to any new hue; and per D3-3, possibly not six hues at all. Unanswerable until D3-1's validator exists. It has no hypothesised answer; give one.
- Q2 (a past day scope): settled by `AnalyticsPeriod.isWithinRange` (12 months back to today); the hypothesis's answer stands.
- Q3 (hour buckets): the reader cannot judge "double the size" without the field list, and "≤ 400 reads" is unstated as per-barber-week or shop-week. The zoom-out lens says do not store them now: read the last four weeks' visits live or bucket only the rostered span.
- Q4 (366-day cap): a real decision only when custom range ships; 366 is fine then; add the shop figure (366 × barbers reads).
  Prefix each with its D and place each at the foot of its D as well.

### 🟢 X-6 Smaller structural and wording points

- PR 2 "the component": in this repo a component is a `*.data.ts` slice; name it (`AnalyticsDay`) so it is not read as an Angular component (comprehension).
- "the visibility table", "the agreement specs", "G5", "v1.1's reference rule": one parenthetical each with the file or section name (comprehension).
- The D2 rubric line (90-91) is a sentence-table hybrid; make it a two-row table or a sentence (structural).
- State the ordering principle of D1–D8 (dependency order) in one sentence under the H2 (structural).
- The 24-month backfill is ~7,300 writes and ~150k reads at 10 barbers — fine, but only after the schema is final (design).
- Rings: say why `ui-gauge` and not `ui-progress-ring` (`libs/ui/controls`) (codebase).

---

## Where the lenses disagree (for the owner to decide)

1. **Who writes a missing day.** Design/codebase/readiness: the callable never writes; a nightly sweep repairs gaps (keeps the read callable's contract). Zoom-out: the callable writes lazily on read, the job and backfill go, and the existing triggers invalidate by deleting the touched day. Both agree on `dayDefinitionVersion` + `dayComputedAtUtcMs` and that the document is a cache. Pick one in D1.
2. **Six hues or a ramp.** Zoom-out and codebase lean to accent + ordered ramp + identity tones (zero new tokens); the hypothesis and the Mobbin round's "chrome monochrome, one series colour" reading support a small categorical set. If hues stay, D3-1 (values + validator) is the gate.
3. **The route's "lag never" claim.** D5's reasons for a route (deep links, stacked sheets, a back stack) are accepted by all lenses; the performance argument against the sheet is not established and the Back re-mount is a cost the sheet does not have. Measure before asserting.
