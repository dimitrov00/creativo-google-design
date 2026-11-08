# Goldfish Annotated Review Report — Stage 7, round 2

Status: resolved — 44 fixes applied 2026-11-08; 0 contested, 3 declined, 0 escalated.

**Target:** `docs/designs/staff-analytics-v2.md` (FeatureRange, lines 1–917; two plan items the range forces)
**Round:** Stage 7, round 2, over `critic_report_round2.md` (1 blocker, 16 majors, 30 nits).

**Totals:** PROPOSE FIX 44, CONTEST 0, ESCALATE 0, DECLINE 3. No severity changed. **Settled list from round 1:** none of the round-1 findings recurred at its scope; the round-2 findings are at the scope of round-1 fixes but are not churn — reverting a fix would not resolve any of them (the 7-day sweep would still dead-end on a version bump; two per-day structs would still not bound the answer).

## Decisions the fixes rest on

1. **Two words, one eligibility rule.** _Recompute_ = `startAnalyticsRecompute` / `continueAnalyticsRecompute`, a budgeted pass that hands eligible days to `writeAnalyticsDay`. _Sweep_ = the 04:30 schedule that starts one. A day is **eligible** when its document is missing, carries an older `dayDefinitionVersion`, or is on the job document's **retry list**. The nightly pass checks the last 7 days (≈ 70 document reads) plus the retry list and a `count()` over `analyticsDays` (≈ 4 reads); it walks the full reach only when the version recorded on the job document differs from `ANALYTICS_DEFINITION_VERSION` or the count falls short of barbers × days in reach. Steady state ≈ 80 reads a night. "Older than its source" is deleted everywhere.
2. **A decisive write failure appends the key to the retry list** (one small write on the job document); the nightly pass rewrites listed keys. The clock-skew residual is accepted and said so: NTP assumed sub-second; a day that lost a race is rewritten on its next edit.
3. **No policy trigger.** `ClientStatsPolicy.isLateCancellation` judges by the window stamped on the seat; the current policy is a fallback for unstamped cancellations only, of which a greenfield deploy has none. So a cancellation-policy edit changes no stored count; the Non-Goal is widened back to "a roster, location-hours or policy edit does not rewrite history", and the round-1 policy-recompute path, the risk row and the trigger export are removed.
4. **The writer's transactional read set gains the follow-ups** (`bookedFromAppointmentId in [the day's visit ids]`, one `in` chunk, the adapter's existing cap) and the locations for the booking-day conversion; per-booking cost +~35 reads.
5. **One per-day family, composed by intersection.** `DayRow` stays v1's row plus `dayTakingsCents` and `dayTipsCents` (the `day` prefix); `DayFigures = DayRow & DayCounts & DayServices & DayHours` is the stored body; `reportDayRows: readonly DayRow[]`, produced by a declared projection `dayRowOf<T extends DayRow>(x: T): DayRow`, never a field-copying mapper. The answer stays near v1's size. `takingsPerHourCents` is not stored; `sum` and the report derive it.
6. **One "past" rule**: judged at every location where the barber has a stretch (the stricter rule); the day's chair-time partition keeps v1's first-stretch clock.
7. **Flag off = spans over 93 days are refused** with a new `ANALYTICS_SPAN_UNAVAILABLE`, which the screen words; the read path's rollback is the flag plus that refusal, and a redeploy of the previous functions restores everything else. Step 3's over-cap fallback is reworded to its three cases.
8. **PR 1 sends `span=WEEK`** (the week of the schedule's day); PR 3 switches the button to `DAY`; "Entry from the schedule" says so.
9. **D11 — `CapacityMonthId` becomes `MonthKey`** (one brand for `YYYY-MM`; a second brand would need a cast wherever a month crosses from capacity to goals).
10. The live days' follow-ups are not read (they are never in the rebooking base); the hour bucket is the minutes of overlap with `[h:00, h+1:00)`; the Goal 2 measure is ≤ 300 reads with the fixed reads named.

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-structural` structural-2-1 · `egm-design` design-2-1 · design-2-8 · `egm-style` 2-1 (sweep part)] — Severity: High (blocker)

- **Affected Scope:** Terms "Sweep" (L124–127), Shape (L363–369, 376–377, 385–387), Pipelines (L457–466), Risks (L838, 844), cost table (L652), NFR (L869–870)
- **Discrepancy:** Three definitions of the sweep; a clock-skew mitigation on a criterion that does not exist; a policy trigger that rewrites nothing; a nightly cost that contradicts the NFR.
- **_AI Suggestion:_** PROPOSE FIX — Decisions 1, 2 and 3: Terms define Recompute, Sweep, eligible and the retry list; Shape, Pipelines, Risks, the cost table and the NFR all say the same thing; the policy trigger, its risk row and `startAnalyticsRecomputeOnSettingsChange` are removed; Alternative D's parenthesis is corrected.

### [Issue 2] [`egm-design` design-2-2] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Decision 4 (the follow-up query and the locations inside the `commit`; the port bundle names `AnalyticsReadPorts` already, which holds `loadFollowUpsOf`'s `QuerySpec` shape; the cost lines updated).

### [Issue 3] [`egm-design` design-2-3 · `egm-style` 2-3 · 2-4 · 2-17 (table part)] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Decision 5; the day-document table split into the four slices with `ChairDay` attributed only to the eight parts and the sum, `dayClosedDayMinutes` noted as v1's per-day report figure; "day document" in prose, `BarberAnalyticsDay` for the entity, `AnalyticsDay` glossed as v1's per-day system input and `nets` dropped from the gloss.

### [Issue 4] [`egm-design` design-2-4] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Decision 6, in Terms and in "The day document".

### [Issue 5] [`egm-structural` structural-2-4 · `egm-design` finding 6] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Decision 7; the Risks row's Effect names the day after a version bump; the NFR rollout reworded (the writers and the recompute run from the functions deploy, so the operator does not wait after the flag).

### [Issue 6] [`egm-structural` structural-2-2 · `egm-style` 2-8] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — caption "The seven questions, and the admin's radar (PR 5)", the radar row under a rule; the origins row's element is a single horizontal stacked `ui-bar-chart`.

### [Issue 7] [`egm-structural` structural-2-3 · `egm-style` 2-2 (figures) · `egm-design` nit 7 · design-2-11] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — CUJ 4 "about 5,000 reads (≈ 8,700 once a comparison year exists; v1 would re-read ~50,000 visits)"; Overview "about 260 and 2,100"; both year rows headline the no-comparison state; the v1 column of the day rows "— (v1 read the month: ~1,000)"; Goal 2 "≤ 300 reads, the fixed reads (barber records, locations, roster, policy) included".

### [Issue 8] [`egm-structural` structural-2-5] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Decision 9: D11 in Decisions.

### [Issue 9] [`egm-structural` structural-2-6] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — "the survey's five-row rubric plus the row the brief added (engineering days to the first shipped screen, 20 %, the five rows re-weighted to 80 %), on which the two draw level".

### [Issue 10] [`egm-structural` structural-2-7] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — Decision 8, in "Entry from the schedule", CUJ 1 ("after PR 3") and plan items 2, 6 and 13.

### [Issue 11] [`egm-style` 2-1 (radar) · 2-2 (callable names) · 2-5 · 2-6] — Severity: Medium

- **_AI Suggestion:_** PROPOSE FIX — reliability `(1 − noShowRate) × 100`, absolute, "four axes normalised … reliability absolute" in CUJ 5; "the callable" / `staffAnalytics` throughout; the error sentence as key → value; the counterpart-day entry reworded.

### [Issue 12] [`egm-design` design-2-5 · 2-6 · 2-7 · 2-9 · 2-10 · 2-12] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX — Decision 10 (no live follow-ups read; the ratio derived; the overlap formula and the `reportHourGrid` row); a "why" clause for the dropped log and seat CSV (the log would bend the client-issue channel's meaning for a usage count the server cannot verify; seat rows need a read path a shop span does not have); the deploy order and the runbook count edits named in the NFR; the TTL re-stamp noted in Future Improvements.

### [Issue 13] [`egm-structural` structural-2-8 … 2-23] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX for 2-8 (Status "Proposed"), 2-9 (Goal 1 retitled), 2-10 (the deciding con in I, J, L), 2-11 (Shape's count merged), 2-12 and 2-13 (the screen's bold run-ins promoted to H4; D6's pointer), 2-14 (the visibility link), 2-15 (the third override), 2-17 ("(to be written)"), 2-18 ("accent"), 2-19 (CUJ 2's When widened), 2-20 (links), 2-21 (D10 names the record), 2-22 (the pay suggestion moved to Future Improvements), 2-23 (plan items 44 and 71). DECLINE 2-16 beyond a light pass: the deferred items are listed once each in Future Improvements and named by pointer elsewhere; full deduplication would strip the Non-Goals of their reasons.

### [Issue 14] [`egm-style` 2-7 … 2-20] — Severity: Low

- **_AI Suggestion:_** PROPOSE FIX for 2-7, 2-8, 2-9, 2-10, 2-11, 2-13, 2-14, 2-15 (define drill-down here), 2-16, 2-18 ("open-hours card", v1's name), 2-19, 2-20. DECLINE 2-12 beyond "assumed sub-second; the residual is accepted (Risks)" — no documentation citation is added for a platform property the design does not depend on. DECLINE 2-17's prose split of the Form cells: the table is the one place the seven forms are read together; the cells are shortened instead.
