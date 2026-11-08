# Comprehension review — `docs/designs/staff-analytics-v2.md`

Target: `docs/designs/staff-analytics-v2.md` (FeatureRange 1–702, DetailedRange 703–1089). Mode: REVIEW. Reader stance: a new team member who knows software but not this project.

## What this proposes

v2 keeps v1's model — one read-only `staffAnalytics` callable, the report cached on the device and painted before the call, the visibility table and the agreement specs — and adds a write path: every barber-day that is at least two days old becomes one small `analyticsDays/{barberId}__{localDate}` document, written by the existing appointment trigger, the departure trigger and a nightly 04:30 sweep, each inside a transaction that refuses to overwrite a newer computation. The callable then assembles any span — DAY, WEEK, MONTH, YEAR or a CUSTOM range of up to 366 days, compared with the previous period or the same period last year, up to 24 months back — from those documents plus today and yesterday read live from visits, cutting a barber-month from ~1,000 to ~210 reads and making a year affordable. A hand-built SVG chart kit (`ui-bar-chart`, `ui-line-chart`, `ui-heatmap`, later `ui-radar`) in `@creativo/ui/charts` redraws the screen as seven charts, each with one sentence, coloured by meaning from tokens that already exist; a toolbar button on the schedule opens analytics on the schedule's day and barber through the router; a monthly takings-range goal per barber or for the shop is stored in `analyticsGoals` via a new `setAnalyticsGoal` callable; a CSV export is built on the client and shared through Web Share. Pay and sealing move to a separate `staff-pay.md` design, with only their storage locations fixed here. Eight PRs ship it in dependency order, with the stored-days read path behind an `analytics.storedDays` flag.

## How the existing system works, per this document

v1 shipped on 2026-11-08 as one screen, «Анализи», reached only from the shell menu, showing a week or a month for the caller's own barber record or, for the admin, any barber or the whole shop. One callable re-reads every visit of the period on every open (~400 visits per barber-month, ~1,000 reads including the comparison period and the next seven days; ~11,500 for the shop), computes a report against a versioned metric catalogue (definition version 1) and writes nothing; the device caches the last report per scope and period, paints it first, and «Към 11:40» is the server's compute time, not a live clock. Figures are drawn as rows and thin bars in one grey because the design system's accent rule reserves its single orange for chrome. On every appointment write the trigger `rebuildBusyOnAppointmentChange` already recomputes the `barberBusy` projection for every busy key named by the before/after documents. Reach is 12 months, "closed day" means a day with a `CLOSED` departure, and drill-down rows ride inside the report.

---

## Findings

No 🔴 blockers: every section could be paraphrased. Twelve 🟡 majors, where the document's own parts do not meet or a load-bearing step is unstated, then 🟢 nits.

### 🟡 1. "Live day" and "past day" do not partition the period when a barber works at locations in different zones

- **Scope**: Terms, L88–93; Non-Goals L146; Shape L259–260, L271; `staffAnalytics` L361–363; cost table L498–503.
- **Discrepancy**: "Live day — today and yesterday on the shop's clock" assumes one clock. "Past day" is defined per location ("`d + 1 < today` at every location where the barber has a stretch on `d`"), and the linked v1 design says the shop needs no single time zone. A day that is yesterday at one location and two days back at another is not past, yet it is not one of "the two live days" either. Every later sentence ("the two live days", "today + yesterday (live)", "~30 live visits") inherits the gap.
- **Resolution**: Define live day as "every day of the period that is not past — normally today and yesterday", say which location's `ShopNow` the screen's "today" means for a multi-location barber, and note that the live set may be three days at a zone boundary.

### 🟡 2. A day with no stretch: is a document written, and does the callable count it as missing?

- **Scope**: Terms L92–93, L98–99; L284–287; `writeAnalyticsDay` L348–351; `staffAnalytics` L361–365; Goal 1 L112–114.
- **Discrepancy**: The sweep "writes every day that is past at every location where the barber has a stretch and whose document is missing". For a day with no stretch at any location (a day off, a Sunday) the condition is vacuously true or false depending on how the reader takes "every" — so it is unclear whether an all-zero document is written. If none is written, the callable's rule "a past day with no document … is computed live … and counted in `missingDays`" makes every rostered-off day a missing day on every open, contradicting Goal 1's "`missingDays` is 0 in steady state". A worked-outside-hours seat on an unrostered day (`dayOutsideHoursMinutes` exists) also needs a home.
- **Resolution**: State the rule in Terms: either "a document is written for every past calendar day of a barber record, zeros included" or "no document for a day with no stretch and no seat; the callable treats such a day as empty, not missing, because it reads the roster/… to know". Say which.

### 🟡 3. A definition-version bump and pre-deploy history: the sweep's 7-day reach, the backfill and `missingDays` do not meet

- **Scope**: Terms L98–101 (sweep "repairs any day document that … was computed under an older definition"); `sweepAnalyticsDays` L356–360 (`SWEEP_REACH_DAYS = 7`); Goal 1 L112–114; Rollout L667–669; PR 4a item 65 L922–926; Verification L1084–1085 ("`missingDays` at 0 after the first sweep").
- **Discrepancy**: Terms promise the sweep repairs stale documents; the pipeline walks only the last 7 days. So after a version bump, every day older than a week is "missing" (computed live on every open) with no stated mechanism to repair it. The backfill job `BackfillJobName.AnalyticsDays` appears only in the implementation plan (item 65) — never in Shape, the Terms, Rollout or Observability — and the plan does not say when it runs (before the flag is turned on? after?). The history before the deploy has the same gap: the first sweep repairs 7 days, so "`missingDays` at 0 after the first sweep" cannot hold for a MONTH or YEAR open.
- **Resolution**: In the Feature range, add the backfill as the fourth writer with its trigger ("run once after PR 4a deploys and after every `ANALYTICS_DEFINITION_VERSION` bump, before the flag is turned on"), and reword Terms "Sweep" to its 7-day reach. State what the screen shows during the gap.

### 🟡 4. The heatmap's per-hour rostered minutes cannot be built from the day document as specified

- **Scope**: day document L312 (`dayHourWorked`, 24 entries, no rostered counterpart); `AnalyticsHourSystem` L333–336 ("within rostered hours"); `reportHourGrid` L401 (`{ weekday; hour; workedMinutes; rosteredMinutes }`, "`null` under 7 rostered days"); item 27 L800–802.
- **Discrepancy**: The grid needs rostered minutes per weekday × hour, and `peak` is bounded by rostered hours, but a past day stores only `dayHourWorked[24]` and a total `dayRosteredMinutes`. The document never says where the per-hour rostered figure for past days comes from (a `dayHourRostered` array? the roster pattern read live and bucketed by weekday? the heatmap limited to live computation?). A reader cannot say how the YEAR heatmap is drawn.
- **Resolution**: Either add `dayHourRostered: readonly MinuteCount[]` (24) to the day document table (and the `fieldOverrides` entry), or state that rostered-by-hour is derived from the roster read live and accept the approximation, and define "rostered hours" for `peak`.

### 🟡 5. "G1" and "G5" collide between v1's goals and v2's own numbered Goals

- **Scope**: Alternative B L545 ("v1's G1"); item 40 L839 ("the G1 case (unsold + open = the schedule's free minutes)"); item 79 L973 ("the G5 property over stored days"); v2 Goals 1–8 at L108–133.
- **Discrepancy**: In the linked v1 design, G1 is "The barber's own figures on the phone"; the agreement "unsold + open equals the schedule's free minutes" is v1's **G5**. v2 has its own Goals 1–8 (its G5 is "One tap from the schedule"), so "G1"/"G5" without a prefix is ambiguous and, as written, wrong at L545 and L839.
- **Resolution**: Write "v1 G5" explicitly, or name the spec (`staff-analytics.agreement.spec.ts`, the free-minutes case) instead of a goal number.

### 🟡 6. The goal's "pace" is a system decision with no stated rule

- **Scope**: Goal 6 L128–129; CUJ 6 L224–225 («12 от 22 работни дни · на път»); report table L405 (`reportGoalPaceTag`: `ON_TRACK`, `BEHIND`, `AHEAD`, `NONE`); Goals (PR 6) L484–485; item 89 L1007–1008 (`goalPaceOf(takings, goal, daysWorked, daysRostered)`).
- **Discrepancy**: L393 promises "each a catalogue row with formula", but the pace row gives only the tag names. A reader cannot say what "on track" means (takings so far against the range scaled by worked ÷ rostered days? against calendar days? which bound?), nor what `NONE` covers (no goal, or no rostered days).
- **Resolution**: Add the formula and thresholds to the catalogue table, with the `daysWorked`/`daysRostered` inputs defined.

### 🟡 7. The per-chart scope × span matrix and the staging dependency table live only in the predecessor brief

- **Scope**: L444–447 ("the seven questions of the brief's table"); L451 ("per the brief's D3"); L703–704 ("One PR per row of the brief's staging table"); CUJ 1 L183–184; item 46 L859–860.
- **Discrepancy**: The design never lists the seven questions as a table with scope and spans. From this document alone a reader cannot answer: do the client tiles or the origin bar appear on DAY? does "free time ahead" appear on YEAR? which charts are admin-only? (DAY is partially described at L860: "no line, no heatmap".) Likewise the PRs are "in dependency order" but no per-PR dependency, gate or deploy step is stated here (the brief had "Depends on | Gate | Deploy"). A design meant to supersede its brief should carry both.
- **Resolution**: Add a table under "The screen": Question | Scope (barber / admin-barber / admin-shop) | Spans (D W M Y C / next 7) | Element | Opens to; and a PR table with Depends on | Gate | Deploy at the head of the Detailed Implementation Plan.

### 🟡 8. v1's vocabulary is used throughout without a pointer, and "stretch" is defined nowhere

- **Scope**: Terms L79–106 define only v2's new words. Used undefined: _visit_, _seat_, _seat rows / day rows_, _follow-up_ (L280 glosses it by field name only), _departure_ (L96, L282, L291, L350, L498 — glossed only as "`scheduleExceptions`" at L282), _roster_, _stretch_ (L93, L285, L329, L350), _`ShopNow`_ (L285, L329), _hero_ (L183, L189, L330, L444), _busy key / `BusyKey`_ (L279, L298), _`barberBusy` / "the busy projection"_ (L279, L250, L543), _`ChairDay`_ (L305, L326), _drill-down_, _the visibility table_ (L26, L414), _the agreement specs_ (L27, L112, L326), _the fixture month_ (L327), _"book-working role"_ (L140, L609), _`capacity`_ (L160, L561).
- **Discrepancy**: A reader who has not read v1 cannot follow the write path (L278–294) or the day document table; "stretch" is load-bearing in the past-day rule and the sweep and is not in v1's Terms either.
- **Resolution**: One line at the head of Terms: "v1's Terms hold — visit, seat, follow-up, departure, roster, hole, `ShopNow`, hero, drill-down ([staff-analytics.md#terms])" — plus new entries for **stretch** (a barber's rostered working window at one location on one day?) and **busy key** (`{barberId}__{localDate}`, the id of `barberBusy` and now of `analyticsDays`).

### 🟡 9. "P2/P3" is an unstated workflow prerequisite in the rollout

- **Scope**: Rollout L667–669 ("deploys indexes + TTL (wait for P2/P3), then rules, then functions"); item 77 L968–969.
- **Discrepancy**: P2 and P3 are not defined or glossed; Additional Resources names `docs/production-deploy.md` §3.1 but not that P2/P3 are its gates nor what each waits for. The deploy order depends on it.
- **Resolution**: Gloss once: "P2/P3 — the production runbook's gates that the TTL policies and composite indexes are active (`docs/production-deploy.md`, §…)".

### 🟡 10. "The dataviz validator" / "the bundled `dataviz` skill" is an acceptance step with no location

- **Scope**: Goal 4 L121–124; Open Questions L168; Additional Resources L685–687.
- **Discrepancy**: The mark colours are "validated with the dataviz validator", and a later hue set would be too, but the document never says what the validator is, where it lives (the repo? an external tool? a Claude skill?), or how to run it. The brainstorm review (`brainstorm_review_report_v2.md` D3-1) already noted no such script exists under `tools/`.
- **Resolution**: Name the tool and its invocation, or drop the step and let `chart-palette.spec.ts` on `contrast.ts` be the whole gate (then Open Question 1's "validated" means that spec).

### 🟡 11. "Two small new callables" names one; the export's telemetry channel is named only as "-style"

- **Scope**: Shape L260–261 ("two small new callables (`setAnalyticsGoal`, and the export is client-side)"); Ports L381–383 ("the existing client telemetry callable"); item 97 L1037–1038 ("the existing `reportClientIssues`-style channel").
- **Discrepancy**: The count says two, the parenthesis names one callable and then says the export is not a callable. Goal 7's measure ("an `AnalyticsExported` log row is written") depends on a channel that is described as "-style" rather than named.
- **Resolution**: "one new callable, `setAnalyticsGoal`; the export is client-side and logs `AnalyticsExported` through `<the exact callable>`".

### 🟡 12. `AnalyticsDay` in `fold(day: AnalyticsDay, …)` is a third name beside `BarberAnalyticsDay` and `DayFigures`

- **Scope**: Systems L322–327; day document L298–300; items 48–49 L867–873.
- **Discrepancy**: The stored entity is `BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures`; `fold` takes an `AnalyticsDay`, which is never defined here (the predecessor brief used `AnalyticsDay` for the stored slice, so a reader coming from it reads `fold` as taking the output as input). It is presumably v1's per-day input struct, but the sentence that follows ("from the structs v1 already computes per day") does not name it.
- **Resolution**: Name the input type and its home ("`AnalyticsDay`, v1's per-day input in `staff-analytics.system.ts`: `ChairDay` + the day's seats + …") or rename to avoid the near-collision.

---

### 🟢 Nits

- **L333 vs L801** — `AnalyticsHourSystem.grid(days)` in the Feature range, `grid(seats, rosters)` in PR 2. Say the PR 2 signature is the live form and PR 4b adds the `days` input, or unify.
- **L232 vs L491–492** — CSV file name `creativo-analytics-2026-11.csv` (CUJ 7) vs `creativo-analytics-<from>-<to>.csv` (Export). Pick one.
- **L51, L124** — "the design system's accent law" / "the accent-rule spec" are not named or linked; cite `accent-rule.spec.ts` and the palette rule document in Additional Resources.
- **L231, L448, L1019, L1036** — "the dock" (the screen's bottom action bar?) — gloss once.
- **L331, L499, L852** — "counterpart day" — gloss once ("the day today compares with: same weekday a week earlier for DAY, the same day-of-period in the comparison period otherwise").
- **L378, L900** — "`overBound` past it" — say what happens (a refusal code? the report says so?).
- **L352–353** — "the attempt verdict follows `TriggerAttemptSystem.decisiveFailure`" — gloss ("whether the trigger reports failure so the platform retries").
- **L307** — "at the stored rate" — which exchange rate, stored where (the visit? settings?).
- **L315–316** — "v1's approximation of the first stretch's clock" — one clause saying what is approximated for a barber at two locations in one day.
- **L372** — "month within reach + 1" — say "up to and including next month".
- **L384–385** — "`AnalyticsCacheKey` becomes `AnalyticsCall & { userId }` as today" — "becomes … as today" contradicts itself; say "stays `AnalyticsCall & { userId }`; `AnalyticsCall` now carries `toLocalDate` and `analyticsComparison`, so the storage key grows with it".
- **L341–344, L943–945** — `AnalyticsPeriod.of(span, from, to)`: the boundary rule for YEAR (1 January?) is not stated; WEEK/MONTH rely on v1's Monday/1st.
- **L435–436** — "a value change transitions `height`/`d` via `@property`" beside "cross-fade on a series change" and the survey's "d is not animatable in Safari"; say which changes morph and which cross-fade.
- **L576** — "if the kit misses its PR 2 date" — no date is given anywhere.
- **L217, L403, L430** — the radar's grey comparison outline: normalised against the previous period's best or this period's? State it.
- **L534** — "the earlier statistics design (§4.3)" is not linked in v2 (v1 links `availability-and-statistics-design.md`).
- **L132–133 vs L637–638, L660** — Goal 8 says the pay record's "collection and rules are decided and documented here", but the body states only "a named `restricted/` match" (NFR) and the path in Alternative L; add the one-sentence rule (deny-all, callable-only, like `restricted/link`) to the Technical Plan.
- **L7 vs L137** — the header supersedes v1's "Earnings and pay" Non-Goal line while L137 keeps earnings and pay a non-goal; one clause ("v1 promised pay in v2; v2 does not deliver it") resolves the apparent contradiction.
- **L734, L753** — `published()` record, "the echo guard" — the schedule store's pattern; gloss or cite `staff-day.store.ts`.
- **L1071–1072** — "`runbook-gates` (the removed-key gate on the new fixture names)" — unclear what the gate checks; one clause.

---

### Review scope

Read in full: the target (L1–1089); the comprehension persona; `CLAUDE.md`; `docs/design-research/staff-analytics/chart-library-survey.md`, `mobbin-inspiration-v2.md`, `brainstorm_review_report_v2.md`, `concepts_brief_v2.md`; `.claude/rules/firestore-layout.md`, `ecs-pipelines.md`, `ecs-ports.md`; `docs/designs/staff-analytics.md` (v1, all 1127 lines); `docs/architecture/decisions/2026-11-08-staff-analytics.md`. No file failed to read; the review is complete. Terms general to software (Firestore `in`/`array-contains` limits, `ResizeObserver`, `RouteReuseStrategy`, `@defer`, Web Share, CSV BOM, TTL) were not flagged.
