# Goldfish Review Report — Stage 7 critic review, round 1

**Target:** `docs/designs/staff-analytics-v2.md` (FeatureRange, lines 1–702 — everything before `## Detailed Implementation Plan` at line 703)
**Mode:** REVIEW. **Standard:** `feature-spec-standard.md` (egm-design, egm-structural); the persona writing standard (egm-style).
**Reviewer status:** egm-design `completed` · egm-structural `completed` · egm-style `completed`. All three read the goldfish context (CLAUDE.md, the three `.claude/rules` files, the survey, the Mobbin notes, the brainstorm review, the brief, the v1 design, the ADR) and verified claims against the repository's code.

## Reviewer Status

| Reviewer         | Status    | Raw findings                  |
| ---------------- | --------- | ----------------------------- |
| `egm-design`     | completed | 2 blockers, 9 majors, 6 nits  |
| `egm-structural` | completed | 1 blocker, 6 majors, 8 nits   |
| `egm-style`      | completed | 0 blockers, 7 majors, 18 nits |

After deduplication: **3 blockers, 19 majors, 29 nits**. Finding ids are stable: `<reviewer>-1-<n>` keeps each reviewer's own numbering (style majors M1–M7 are `style-1-1`…`style-1-7`, style nits N1–N18 are `style-1-8`…`style-1-25`). Where two reviewers raised the same point, the finding carries the primary id and names the merged ids so nothing is lost.

What every reviewer verified as stated and did not flag: `rebuildBusyOnAppointmentChange` is `retry: true` with the `TriggerAttemptSystem.decisiveFailure` verdict; cron slots 03:00/03:30/04:00 are taken, 04:30 is free; the cited port bundles (`CommitPorts`, `ShopDayReadPorts`, `AnalyticsReadPorts`, `PolicyReadPorts`, `LocationLoadPorts`, `DefaultLocationPorts`, `ClockPorts`, `LogPorts`) exist; `ReadTx.query` allows a query inside the transaction; the `(barberId, localDate)` composite on `scheduleExceptions` and the seven `ttl: true` overrides exist; `RetentionAnchor.barberBusy(localDate)` is the precedent; `MinuteCount`, `BusyKey`, `CapacityMonthId`, `ClientStatsSystem.inEuroCents`, `AnalyticsDay`, the six `AnalyticsBarPart`s, `REACH_MONTHS = 12`, `AnalyticsSpan = WEEK | MONTH`, `AnalyticsCacheKey = AnalyticsCall & { userId }`, the 1,680,000 route ceiling, `withViewTransitions` + `withComponentInputBinding`, `--sys-identity-0..4` and the semantic colour tokens all exist as described; the front-matter "Supersedes" targets resolve; the read-cost arithmetic (≈ 210 / 1,950 / 870 / 8,700) is consistent with the Goals' ceilings and the brief.

---

## Prioritized Findings (Blockers → Majors → Nits)

### 🔴 Blockers

#### design-1-1 — The heatmap's `rosteredMinutes` per cell has no source for a past day

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 312, 333–336, 401 (day-document table; `AnalyticsHourSystem`; `reportHourGrid`)
- **Discrepancy:** The day document stores `dayHourWorked` (24 worked-minute buckets) and nothing per hour for rostered time, yet `reportHourGrid` carries `{ weekday; hour; workedMinutes; rosteredMinutes }` and `AnalyticsHourSystem.peak` picks the busiest/emptiest hour "within rostered hours". For a past day the read path reads day documents, not rosters and departures (the cost table at 496–503 lists none for the period), and the Non-Goal at 154–156 freezes a past day's rostered minutes as of the write, so re-reading the live roster would contradict it.
- **Rationale:** "Emptiest hour" is the question the heatmap exists to answer, and it is undefined for every past day.
- **Resolution:** Either add `dayHourRostered: readonly MinuteCount[]` (24 entries, one more `fieldOverrides` entry) to the day document and to `DayFiguresSystem.fold`, or change `reportHourGrid` to carry worked minutes only and define "emptiest" over hours with any worked minutes in the period. State which, and define the hour bucket on the wall clock (`startMinutes ÷ 60`) so a DST day is 24 buckets too.

#### design-1-2 — Nothing writes a day document older than 7 days: no backfill at rollout, no repair after a definition-version bump; the flag and the backfill job have no home in the Technical Plan

- **Reviewer lens:** `egm-design` (merged: `structural-1-4`)
- **Affected scope:** lines 98–101 (Terms), 356–367 (Sweep, `staffAnalytics` pipeline), 667–672 (Rollout & Rollback); plan lines 911, 923–926, 968 for contrast
- **Discrepancy:** Terms say the sweep "repairs any day document that is missing or was computed under an older definition"; the pipeline section bounds it to `SWEEP_REACH_DAYS = 7`. So (a) at rollout every day older than a week has no document, the callable computes them live at v1 cost and `missingDays` never reaches 0 — Goal 1's measure fails by construction; (b) when `ANALYTICS_DEFINITION_VERSION` bumps, up to 25 months of documents become "missing" and only the last 7 days are ever rewritten, so a shop-year re-reads ~50,000 visits per open, far past the 4 s budget. The brief said "the sweep rewrites the reach"; the design's sweep does not. `BackfillJobName.AnalyticsDays` appears only in the implementation plan (item at 923), and the Rollout steps never run it. Likewise `analytics.storedDays` is first mentioned at 668 inside NFR; the `staffAnalytics` pipeline entry (361–367) never says the callable consults a flag or what "off" does.
- **Rationale:** The plan builds two mechanisms (flag, backfill) the architecture section does not describe, and the one Goal 1 measure depends on them.
- **Resolution:** In the feature range name the repair path and its trigger: `BackfillJobName.AnalyticsDays` (page walk over appointments, re-runnable per `dayDefinitionVersion`, budgeted) run after the flag-off deploy and after every version bump — or a sweep whose reach widens to the oldest stale document under a per-run write budget. Add the step to Rollout. In `### Pipelines` add the flag's effect to `staffAnalytics` ("with `analytics.storedDays` off every day is read live, as v1") and a `runBackfill` bullet; add "Flag" and "Backfill" to Terms. State what the callable does when the live fallback for a span of missing days would exceed the adapter's bounds (refuse with a `periodOutOfRange`-style error, or answer with the comparison omitted).

#### structural-1-1 — No "Risks & Mitigations" section

- **Reviewer lens:** `egm-structural` (merged: `design-1-8`)
- **Affected scope:** whole feature range; the gap sits between `## Alternatives Considered` (524–651) and `## Non-Functional Requirements` (653)
- **Discrepancy:** The standard's "Risks & Limits" is a _must_ and its Requirements list names "Risks & Mitigations". The v1 design has a 13-row table (`staff-analytics.md:582–598`), the brief a 7-row one (`concepts_brief_v2.md:359–369`: a day document out of step with its visits, a version bump against 25 months of documents, the view transition on a phone, the kit's cost, the flat screen, client names in an export, yesterday/today vs a document). None of those rows is carried into the design; mitigations are scattered (stamp ordering at 289–294, the version rule at 100–101, the morph gate at 469–471, the Chart.js fallback at 576) with no index.
- **Rationale:** A mandatory section is absent, and the risks the body itself raises are never collected or mitigated: clock skew between two function instances making `dayComputedAtUtcMs` ordering unreliable; the definition-bump exposure (design-1-2); the TTL purging the comparison base near the reach edge (design-1-9); the localStorage quota on year reports (design-1-5); the view transition and the Chart.js fallback; the hue gate; trigger timeouts when one appointment write touches several past days.
- **Resolution:** Add `## Risks & Mitigations` after Alternatives Considered in v1's three-column form (Risk | Effect | Mitigation), carrying the brief's seven rows, the v1 rows that still apply (first open with no cache; cache from an older definition; `in`/`array-contains-any` 30-value chunking; money on a shared device; stale account link), and the v2 items above plus: a sweep that fails for several nights (`missingDays` rises), a trigger race on a past day, the shop-year at ~8,700 reads against the 4 s budget, a `CUSTOM` of 366 days × barbers, and the view-transition/Back re-mount measurement.

---

### 🟡 Majors

#### design-1-3 — Days without a stretch never get a document, so `missingDays` is never 0 and every open pays for them

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 92–93, 98–99, 112–114, 349–350, 356–359, 361–365
- **Discrepancy:** "Past" and the sweep's write set are both defined as "past at every location where the barber has a stretch on `d`". A day off (two of every seven, plus `CLOSED` departures) has no stretch, so no writer produces a document; the callable treats it as a missing past day — one `array-contains-any` chunk query per 30 keys (a zero-row query is still billed one read; a shop-year adds ~1,040 stretch-less keys ≈ 35 queries) — and `reportMissingDays` counts it. "Past" is also vacuous for a day with a visit but no stretch (worked on a day off — v1 counts these).
- **Rationale:** Goal 1's "0 in steady state" is unreachable and the oncall signal is permanently noisy.
- **Resolution:** Write a zero-figure document for every past day in the sweep's reach whether or not rostered (~30 integers); define "past" for a stretch-less day on the default location's clock; let the callable skip the live fallback for days it knows are unrostered, or accept the extra queries explicitly in the cost table.

#### design-1-4 — A late-cancellation count frozen at write time breaks the pinned agreement property and the drill-down footer after any policy edit

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 110–114, 154–156, 309, 326–327, 361–365
- **Discrepancy:** Stored days judge a late cancellation "by the seat's stored window, else the policy at the time of the write"; the two live days, the live fallback and the drill-down rows use the current policy. After a cancellation-policy edit one report mixes two policies, `sum(days.map(fold)) + live === report(visits)` no longer holds in production (the spec passes only because the fixture never edits the policy), and CUJ 8's "the next open agrees" is false for this case. The capacity projection has `recomputeClientStatsOnPolicyChange` (`main.ts` ~1110) for exactly this.
- **Rationale:** The figure and its rows diverge permanently; the design's own G5 property is unprovable in production.
- **Resolution:** Pick one and write it down: (a) store `dayLateCancellationCount` only for seats with a stored window and compute the policy-judged remainder live from the day's cancelled seats; (b) treat a policy edit as a definition bump (needs design-1-2's repair path); or (c) accept the divergence, scope G5 and CUJ 8 to exclude late cancellations, and say so in the ⓘ text.

#### design-1-5 — The report's size and the device cache are unbounded for YEAR and shop spans

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 130–131, 384–385, 399–404, 494–503
- **Discrepancy:** v1's report carries `reportDayRows` for every barber-day (`analytics-report.data.ts:137`: "always"); the CSV at 130–131 and 489–492 needs "days per barber" from the open report. A shop-year is ~3,650 day rows plus 365 series points, 365 time-series entries and 168 grid cells, cached in `localStorage` with up to 6 entries ("a quota error is ignored" — the year view silently loses its first-frame paint). The design states read cost but not answer size, the day-row grain per span, or the cache rule for a year.
- **Rationale:** Payload and cache behaviour are non-functional requirements the standard asks for and the YEAR span changes them by an order of magnitude.
- **Resolution:** State the day-row grain per span (per day ≤ 93 days; none, or per month, beyond), the maximum answer size per scope/span, and whether YEAR reports are cached (or cached without day rows). Add it to Non-Functional Requirements.

#### design-1-6 — The admin's seat-row export has no data source

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 147–148, 228–234, 489–492
- **Discrepancy:** Non-Goals keep "seat rows behind a figure are still read live from the visits when tapped"; a shop report carries no seat rows (`reportSeatRows` is empty in a shop report, verified); past months are day documents without seats. "The admin may add seat rows without names" to the CSV of the open shop-scope report therefore needs a fresh read of the whole period's visits — ~4,000 for a shop-month, ~50,000 for a shop-year, the Alternative M objection the design itself keeps at 640–643 — and nothing in Ports or Reads provides it.
- **Rationale:** A promised capability with no read path.
- **Resolution:** Restrict the seat-row CSV to a single-barber scope on spans whose rows the report already holds (live days), or move it to Future Improvements; say which.

#### design-1-7 — The one-document-per-barber-month alternative was never weighed

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 524–651 (Alternatives Considered)
- **Discrepancy:** The design chooses one document per barber-day (barber-year = 730 reads with comparison, shop-year = 7,300) and rejects only v1's Alternative A (a month projection rebuilt whole on every write). The repo's own precedent, `capacity/{YYYY-MM}` with a sorted `entries[]` of flat `{ localDate, barberId, … }` structs rebuilt by dropping the scope's entries (`firestore-layout.md`, Collections), is a third option: one event rebuilds one day's entry (same ~20 reads) while a barber-year reads 12 documents and a shop-year ~120 — roughly 60× fewer reads, and the YEAR budget stops depending on a 3,661-document range query. Its costs (one hot document per barber-month under ~1 write/s per document, ~30 × 30 integers, the whole month rewritten per transaction) are real but small at this volume and were not considered.
- **Rationale:** The standard requires viable designs to be rejected for documented reasons.
- **Resolution:** Add an Alternative with the numbers and either reject it with a stated reason (contention under a shop-wide reschedule, document size, the `arrayUnion` ban) or adopt it.

#### design-1-9 — Comparison periods outside reach or past the TTL have no rule

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 85–87, 207–209, 316–318, 341–344, 365, 376–378
- **Discrepancy:** Reach is 24 months so "a year twelve months back still has its comparison", but a MONTH, WEEK or CUSTOM period 13–24 months back with `SAME_LAST_YEAR` has a comparison 25–36 months back: outside reach and past the 760-day TTL. The design does not say whether the callable refuses (`ANALYTICS_PERIOD_OUT_OF_RANGE`), answers `comparisonTakingsCents: null`, or falls back to live visits (appointments have no TTL, so the fallback silently reads at v1 cost and counts the days as missing).
- **Rationale:** An undefined edge on a path every comparison chip can reach.
- **Resolution:** One rule: a comparison period that starts before the reach is not read; the comparison fields are `null` and the chip says so. Pin it in the `AnalyticsPeriod.sameLastYear`/`previous` specs.

#### design-1-10 — Accent and warning are adjacent warm oranges in every stacked bar, and the palette spec cannot catch it

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 121–124, 166–169, 190–192, 450–457
- **Discrepancy:** `--sys-color-accent` is `#f26b22` (hue ≈ 21°) in both themes; `--sys-color-warning` is `#b26a00` light / `#d08a2c` dark (hue ≈ 36°) — inside the warm sector (h 25–95) the design's own Open Question excludes for any new hue. Worked (accent) and unmarked (warning) are neighbouring segments in every time bar, and `chart-palette.spec.ts` pins contrast against the surface only, never between adjacent marks.
- **Rationale:** At a few pixels wide or under deuteranopia the two read as one part, defeating "colour explains" for the one state (unmarked) that asks for action.
- **Resolution:** Pin pairwise distinguishability of adjacent parts (ΔE or a CVD simulation) in the spec, give unmarked the 1 px separator edge the greys already get or a hatch, and say so in the Colour paragraph.

#### design-1-11 — The trigger's failure semantics for the day write are unstated

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 278–287, 348–353
- **Discrepancy:** "The attempt verdict follows `TriggerAttemptSystem.decisiveFailure`, as the busy rebuild does" leaves the key choice open: are the day write's failures merged into the busy trigger's verdict (a transient Firestore error redelivers the whole event and re-runs the busy rebuild; a decisive one leaves the day stale until the sweep — which reaches only 7 days back, so an edit to a visit three weeks ago whose write fails decisively is wrong forever), or logged and left to the sweep as capacity's R-1 does (same 7-day hole)?
- **Rationale:** Either way the design must say, because design-1-2 decides whether the hole closes.
- **Resolution:** State the rule (recommended: analytics failures join the verdict so transient ones redeliver; a decisive failure logs `AnalyticsDayWriteFailed` and the sweep's reach, or the backfill, repairs it) and add the case to the trigger wire and pipeline specs.

#### structural-1-2 — `Additional Resources` and `Future Improvements` are H3 under `Non-Functional Requirements`

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 674, 689 (under the H2 at 653)
- **Discrepancy:** Both headings are `###`, so they read as sub-sections of NFR; one is a bibliography, the other a roadmap. v1 has both as H2 (`staff-analytics.md:730`, `748`), and `## Detailed Implementation Plan` at 703 returns to H2, so the hierarchy is inconsistent within the document.
- **Rationale:** Heading hierarchy must reflect content hierarchy.
- **Resolution:** Promote both to `##`, in v1's order (Non-Functional Requirements → Additional Resources → Future Improvements → Detailed Implementation Plan).

#### structural-1-3 — The seven questions and the decision numbering live only in the brief

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 118–120 (Goal 3), 444 ("the seven questions of the brief's table"), 451 ("per the brief's D3"), 705 ("the brief's staging table"); no `## Decisions` section anywhere
- **Discrepancy:** The central promise ("Seven questions, seven charts, each with one sentence") is never tabulated in the design; the only enumeration is a parenthetical prose run at 444–448. The brief's D4 table (Question | Scope | Spans | Element | Form | Colour | Opens to) answers which span and which role sees which chart; the design does not. "D3", "D1" are the brief's numbering and are unresolvable inside this document (v1 carries its own `## Decisions` at 176).
- **Rationale:** The standard's core principle is that a reader unfamiliar with the codebase can understand the feature from the specification alone.
- **Resolution:** Add a `## Decisions` H2 (between Non-Goals and Open Questions, as in v1) with a one-line entry per brief decision D1–D10 and a pointer to the elaborating section; copy the brief's seven-question table into `### The screen` with the Element column; replace "the brief's D3" / "the brief's table" with intra-document anchors.

#### structural-1-5 — The CSV file name is given two ways

- **Reviewer lens:** `egm-structural`
- **Affected scope:** line 232 (`creativo-analytics-2026-11.csv`) vs line 492 (`creativo-analytics-<from>-<to>.csv`)
- **Discrepancy:** CUJ 7 and `### Export (PR 7)` disagree on the name pattern.
- **Rationale:** Two specifications of one artefact.
- **Resolution:** Pick the `<from>-<to>` form (it covers CUSTOM) and make CUJ 7's example an instance of it (`creativo-analytics-2026-11-01-2026-11-30.csv`).

#### structural-1-6 — "Two small new callables" names one

- **Reviewer lens:** `egm-structural` (merged: `style-1-4`, part of `design-1-17`)
- **Affected scope:** lines 260–261 (`### Shape`)
- **Discrepancy:** "two small new callables (`setAnalyticsGoal`, and the export is client-side)" — the parenthesis lists one callable and then a non-callable. The diagram (263–276) and `### Pipelines` (346–372) show one new callable, one trigger-fed writer and one scheduled sweep. "Small" is an unmeasured qualifier.
- **Rationale:** A count the sentence itself contradicts, in the paragraph that states the shape.
- **Resolution:** "…one new callable (`setAnalyticsGoal`), one writer pipeline fed by the existing triggers and the sweep, and a client-side export."

#### structural-1-7 — Screen elements used but never introduced (dock, hero, goal ring element, `ui-metric`, `ui-chart-readout`)

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 231, 448 (the "dock"); 183, 444, 446 ("hero"); 448 ("the goal ring"); 425–430 (kit table)
- **Discrepancy:** The analytics page has no dock today (`staff-analytics.page.html` has no `dock` match) and "Sections in order" (440–449) does not add one, yet CUJ 7 taps «Експорт» "in the dock". The brief's D2/D4 name `ui-metric` for the hero and tiles and `ui-gauge` `circularCapacity` for the goal ring; the feature range names neither (the plan does, at 1019). "Hero" is a v1 term that v2's Terms drop while still using it. `ui-chart-readout` (428) appears nowhere else.
- **Rationale:** A reader of the feature range cannot tell which elements draw the screen.
- **Resolution:** Add the dock to the sections list; state in `### The screen` which DS elements draw the hero (`ui-metric`), the tiles and the ring (`ui-gauge`); either carry v1's Terms with one sentence ("v1's Terms hold; these are added") or re-define "hero".

#### style-1-1 — "correct and dull" is a subjective quality judgment

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 45–46 (`### The screen does not explain`)
- **Discrepancy:** "v1's screen is correct and dull." "Dull" is an opinion; "correct" is asserted, not sourced.
- **Rationale:** The paragraph already carries the factual content ("a flat bar in greys and a list of minutes", "nothing on the screen is distinguishable by colour").
- **Resolution:** "v1's screen prints every figure as text or a grey bar; nothing on it is distinguishable by colour." Delete "correct and dull".

#### style-1-2 — Goal 1's "never computed twice" is an absolute the document contradicts

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 109–114 (Goal 1); contradicted by 92–93, 98–99, 245–251, 361–365
- **Discrepancy:** "Past days are stored on event and never computed twice." Terms say a past day is recomputed when a visit of it is edited; the sweep recomputes a version-stale day; the callable computes a missing day live and the sweep computes it again that night.
- **Rationale:** An unprovable absolute in a goal; the measure beneath it (`missingDays` is 0 in steady state) is the verifiable version.
- **Resolution:** "Past days are stored on event and read as documents; a past day is recomputed only when one of its visits is edited or its definition version changes."

#### style-1-3 — Goal 2's "Every span reads days, not visits" is contradicted by the read path

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 115–117 (Goal 2); contradicted by 88–91, 146, 271–273, 361–367
- **Discrepancy:** The two live days, the next 7 days, the follow-ups and the counterpart day are read from visits on every open, in every span.
- **Rationale:** The heading overstates; the measure (≤ 250 / ≤ 2,500 reads, p95 budgets) is already exact.
- **Resolution:** "Past days of every span are read as day documents, not visits." Keep the measure unchanged.

#### style-1-5 — Garbled clause in the trigger description

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 278–279 (**Who writes what, in order.**)
- **Discrepancy:** "already recomputes `barberBusy` for every busy key either side of a write names." A relative pronoun is missing.
- **Rationale:** This sentence defines which days the trigger rebuilds — a load-bearing mechanism.
- **Resolution:** "already recomputes `barberBusy` for every busy key that either side of a write names (`before.busyKeys ∪ after.busyKeys`)."

#### style-1-6 — "judged right" and "is visible" are unverifiable acceptance criteria

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 469–471 (`### Entry from the schedule`); lines 170–172 (Open Question 2)
- **Discrepancy:** "share `view-transition-name: staff-analytics-head` only if the morph is judged right on a phone in PR 1" — no judge, no criterion. Open Question 2 gates a `RouteReuseStrategy` on whether a re-mount "is visible", also unmeasured, while the rest of the document uses a 16.7 ms frame measure.
- **Rationale:** Both are PR 1 decisions an engineer has to call.
- **Resolution:** "only if the owner accepts the morph on the 4× throttle production build in PR 1; otherwise the root cross-fade." Open Question 2: "if Back's re-mount drops a frame over 16.7 ms at 4× throttle on a production build, a detach/attach strategy …".

#### style-1-7 — "change four things" does not match the enumeration that follows

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 26–33 (**The proposed solution.**)
- **Discrepancy:** The sentence promises four changes, then lists stored day documents; three chart components plus a redrawn screen; a toolbar button; goals and CSV; and a separate pay design. The brief (`concepts_brief_v2.md:22–24`) enumerated a different four (source of past days, drawing, entry point, periods); the periods are missing here.
- **Rationale:** A count the text does not support, in the one paragraph a skimming reader relies on.
- **Resolution:** Number the changes — "(1) every past barber-day becomes one stored document …; (2) three chart components join the design system and the screen is redrawn around seven questions; (3) a toolbar button on the schedule opens the screen on the schedule's barber and day; (4) `DAY`, `YEAR` and `CUSTOM` spans with a comparison period. Goals and a CSV export follow; pay and sealing get a design of their own." — or drop the number.

---

### 🟢 Nits

#### design-1-12 — URL pushes per pick contradict "Back returns to the schedule"

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 125–127, 184, 459–462
- **Discrepancy:** The store "writes the URL back after each pick so Back steps through periods"; Goal 5 and CUJ 1 promise Back restores the schedule. After five picks Back takes six taps.
- **Resolution:** Decide `replaceUrl` versus push and amend Goal 5 / CUJ 1 to match.

#### design-1-13 — `AnalyticsExported` through the client-issue channel

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 381–383, 520
- **Discrepancy:** The "existing client telemetry callable" is `reportClientIssues`, whose input is `ClientIssue[]` with `ClientIssueKind` a dictionary of failures (`client-issue.data.ts:8–40`). An export is not an issue.
- **Resolution:** Either add a kind and say the sink writes it as one line, or log the export server-side when the share is confirmed.

#### design-1-14 — The writer's visit query is new, not "the existing" one

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 289–291
- **Discrepancy:** `liveOnBusyDay` filters `bookingStatus in LIVE_STATUSES` and is `limit: null`; the day write needs cancelled visits too (late cancellations, held time), so it is a new `QuerySpec` on `busyKeys array-contains` alone (single-field index) with a declared cap (`VISITS_PER_BARBER_DAY = 60`) for `query-needs-limit`.
- **Resolution:** Say so.

#### design-1-15 — Cost table omissions

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 496–505
- **Discrepancy:** The barber-month row omits the counterpart day's ~15 live visits (330–332) and the roster/locations reads the trigger needs on every booking write to decide "past". The shop-year budget rests on "≈ 8,700 reads is today's shop-month", but v1's 4 s is a budget, not a measurement, and a 3,661-document range query has no stated fallback if it misses.
- **Resolution:** Add the two reads and name the fallback (monthly grain only, or a 2-page read) or the PR in which it is measured.

#### design-1-16 — Two brands for one `YYYY-MM` string

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 483–484
- **Discrepancy:** `MonthKey` is added while `CapacityMonthId` "stays"; Law 7 wants one primitive per concept and the brief said `CapacityMonthId` "becomes or joins".
- **Resolution:** Pick one brand.

#### design-1-17 — «Обновено преди 2 мин» under negative clock skew

- **Reviewer lens:** `egm-design` (the callables part of this finding is merged into `structural-1-6`)
- **Affected scope:** lines 36–39
- **Discrepancy:** The relative time is computed from the device clock against `reportComputedAtUtcMs`; a device behind the server produces a negative age.
- **Resolution:** Say the presenter clamps a negative skew to «току-що».

#### structural-1-8 — Chart kit count disagrees between Overview, Terms and the table

- **Reviewer lens:** `egm-structural` (merged: `style-1-10`)
- **Affected scope:** line 30 ("Three chart components"), 102–103 (three + "later `ui-radar`"), 425–430 (four rows + `ui-chart-readout`)
- **Resolution:** "Three in PR 2, a fourth (`ui-radar`) in PR 5, plus the `ui-chart-readout` helper" in both Overview and Terms.

#### structural-1-9 — Day-document table mixes meta fields into the `DayFigures` slice

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 299–304
- **Discrepancy:** 299 says `BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures`; 300 introduces the table as what "the slice `DayFigures` … holds"; row 304 lists `barberId`, `localDate` with the note "(meta)". The plan (871) puts them in the meta slice.
- **Resolution:** Re-title the table "the document body" or move the row above it as the meta slice's fields.

#### structural-1-10 — Retention named by group only

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 316–318
- **Discrepancy:** The repo's TTL shape is a `RetentionGroup` value, a `RetentionAnchor.<group>(…)` variant and `RetentionSystem.purgeAtUtcMs` (`retention-group.data.ts`, `retention.system.ts:93`); the plan (875) names `RetentionAnchor.analyticsDays(localDate)`. The feature range names only the group "with the formula".
- **Resolution:** "`RetentionGroup.AnalyticsDays`, anchor `RetentionAnchor.analyticsDays(localDate)`, formula in `RetentionSystem.purgeAtUtcMs`: UTC midnight of `localDate` + 760 days".

#### structural-1-11 — List continuation lines at column 0 and inline code spans broken across lines

- **Reviewer lens:** `egm-structural` (merged: `style-1-21`)
- **Affected scope:** lines 322–323, 324–325, 328–330, 333–334, 337–338, 342, 354–355, 389–391
- **Discrepancy:** Inside bullet items some continuation lines are indented two spaces and others start at column 0, with backticked signatures wrapped across the break (`` `fold(day: AnalyticsDay,`` / ``nets, …` ``), which Markdown renders as broken code spans.
- **Resolution:** Reflow so every continuation line is indented to the item's text column and no code span straddles a line break; or put each signature in a fenced block.

#### structural-1-12 — Link style and unresolvable targets

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 3–7 vs 137, 637, 676–687, 697
- **Discrepancy:** The front matter uses markdown links (all resolve); everything else uses bare backtick paths where v1 uses links with anchors throughout. `docs/designs/staff-pay.md` is cited three times (137, 637, 697) and does not exist — fine as a future document, but 137 reads as if it does. "the bundled `dataviz` skill" (685) is not a repository path and cannot be checked. Every other cited path resolves.
- **Resolution:** Use markdown links in Additional Resources; mark `staff-pay.md` "(to be written)" at first mention.

#### structural-1-13 — Fate of v1 CUJs 1, 4, 5, 6 unstated

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 176–251
- **Discrepancy:** CUJ 3 and CUJ 8 are marked "(v1's CUJ 2 / 3, kept)"; nothing says whether v1's CUJ 1 (month between clients), 4 (owner compares barbers and weekdays), 5 (new barber, first week) and 6 (not linked) still hold.
- **Resolution:** One sentence under the H2: "v1's CUJs 1, 4, 5 and 6 hold unchanged; 2 and 3 are restated below."

#### structural-1-14 — Alternatives F and M omit the Pros/Cons rows

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 578–585, 640–643
- **Discrepancy:** Twelve alternatives follow the three-row template (Pros / Cons / Reason for Rejection); F and M carry only "Reason for Rejection".
- **Resolution:** Add Pros/Cons rows (F: pros "coverage of every form / wrappers"; M: v1's pros/cons carried in one line).

#### structural-1-15 — Wording drift against v1's Terms and Non-Goals

- **Reviewer lens:** `egm-structural` (merged: `style-1-15`)
- **Affected scope:** line 94 (Terms, "Past day"); lines 160–162 (Non-Goals)
- **Discrepancy:** "(v1's "closed day" stays what it was: a day the shop is closed, a departure kind.)" — v1 defines a `CLOSED` departure as the barber's "no work that day, e.g. a day off", not the shop being closed. v1's non-goal list also names "a data warehouse", which is dropped from the "other non-goals hold" line.
- **Resolution:** "(v1's "closed day" keeps its meaning: a barber-day with a `CLOSED` departure — the barber's day off.)"; add "a data warehouse".

#### style-1-8 — The owner's six asks are phrased as unmeasurable qualities

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 18 (Overview, item 1): "varied and readable at a glance, with colour that explains"
- **Rationale:** Goals 3 and 4 already restate them measurably; the list is the owner's words, which is acceptable if said so.
- **Resolution:** Prefix the list with "in the owner's words:" or change item 1 to "charts instead of rows; colour that carries meaning (Goals 3, 4)".

#### style-1-9 — Rhetorical question in the Overview

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 24
- **Resolution:** "an answer on whether «Към 11:40» means the figures are rebuilt live on every open."

#### style-1-11 — "(Revolut above all)" and "the standard the owner expects" are unsourced qualifiers

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 49, 67–69
- **Resolution:** "(Revolut among them)"; "The search on the schedule is the existing precedent: a tap on the toolbar, an animated hand-off, the same place on return."

#### style-1-12 — "Staff keep the schedule open" is an unsupported premise

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 66
- **Resolution:** "The schedule is the screen staff work from." — or cite the source.

#### style-1-13 — "That was right for a week or a month" is a value judgment

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 56–58
- **Resolution:** "That met the 1.5 s / 4 s budgets for a week or a month at greenfield volume."

#### style-1-14 — "a wish list without a design" editorialises

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 73
- **Resolution:** "The v1 design listed v1.1, v1.2 and v2 items without a design for any of them: …".

#### style-1-16 — An answered question sits under "Open Questions"

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 173–174 (Open Question 3)
- **Discrepancy:** "Hour buckets: worked or occupied minutes? Worked — …" is decided in the same line.
- **Resolution:** Move it to Terms ("`dayHourWorked`: worked, not occupied, minutes — a no-show hour is not busy") and delete it from Open Questions.

#### style-1-17 — "not 100,000" is an unsourced contrast

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 207–209 (CUJ 4)
- **Discrepancy:** "costs about 8,700 reads, not 100,000" — the 100,000 is never derived; v1 has no year span to compare with.
- **Resolution:** "costs about 8,700 reads (v1 would re-read ~50,000 visits plus the comparison year)" or drop the contrast.

#### style-1-18 — Garbled tense: "becomes … as today"

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 384–385 (`### Ports`)
- **Discrepancy:** "The web's `AnalyticsCacheKey` becomes `AnalyticsCall & { userId }` as today" — if it is already that, it does not become it.
- **Resolution:** "The web's `AnalyticsCacheKey` stays `AnalyticsCall & { userId }`; the call now carries `toLocalDate` and `analyticsComparison`, so the storage key encodes them."

#### style-1-19 — "Now" in proposed-tense design prose

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 280 ("now also feeds"), line 507 ("is now the largest share")
- **Resolution:** "The same decoded command also feeds …"; "After this change the live "next 7 days" read is the largest share …".

#### style-1-20 — Over-long sentences that should be lists

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 361–367 (`staffAnalytics` pipeline bullet, six semicolons); 440–449 (**Sections in order**, one ten-line sentence); 190–194 (CUJ 2 "Then", five outcomes); 661–666 (NFR Performance, seven semicolons)
- **Resolution:** Break each at the semicolons into a bulleted or numbered list.

#### style-1-22 — `AnalyticsDay` is used but never glossed, and is confusable with "Day document"

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 322, against 95–97 and 298–299
- **Discrepancy:** `AnalyticsDay` is v1's per-day input struct (`staff-analytics.system.ts:92`, `ChairDay & {…}`), but the document defines "Day document" and `BarberAnalyticsDay` and never says what `AnalyticsDay` is.
- **Resolution:** Gloss once at first use: "`fold(day: AnalyticsDay /* v1's per-day input: `ChairDay` plus its seats */, nets, followUps, policy) → DayFigures`".

#### style-1-23 — "Reason for Rejection" rows that state the chosen option, not a reason

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 612 (Alt I), 619–620 (Alt J), 637–638 (Alt L)
- **Resolution:** "Rejected on the Cons above; chosen instead: `analyticsGoals/{key}`, callable-only, keyed by month." (same pattern for J and L).

#### style-1-24 — Figurative phrasings that can be literal

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 60, 132, 404, 473–475, 508, 571, 682, 694–695
- **Resolution:** "named the way out" → "named the upgrade path"; "Pay has a home but not a screen" → "Pay's storage is decided; no pay screen ships."; "for want of a document" → "because no document exists"; "every chair shown → an admin opens the shop, a barber their own" → "when every chair is shown, an admin opens the shop scope and a barber their own"; "the next lever" → "the next cost to reduce"; "a bitmap is a wall to screen readers" → "a bitmap is unreadable to screen readers"; "Rules of the house" → "Repository rules".

#### style-1-25 — Unmeasured "cannot" in the problem statement

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 58–59
- **Discrepancy:** "It cannot give a year … inside the 1.5 s / 4 s budgets" — the year was never measured in v1; an estimate presented as fact.
- **Resolution:** "At ~5,000 visits per barber-year (50,000 for the shop) a year or a custom range is not expected to fit the 1.5 s / 4 s budgets, …".
