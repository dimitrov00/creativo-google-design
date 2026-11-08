# Goldfish Review Report — Stage 7 critic review, round 2

**Target:** `docs/designs/staff-analytics-v2.md` (lines 1–917, the feature range before `## Detailed Implementation Plan` at line 918)
**Mode:** REVIEW. **Standard:** `feature-spec-standard.md` (egm-design, egm-structural); the technical-writing standard of the style persona (egm-style).
**Reviewer status:** egm-design — completed · egm-structural — completed · egm-style — completed. Each reviewer read the document fresh, without the round-1 reports.

**Severity count:** 🔴 1 blocker · 🟡 16 majors · 🟢 30 nits (after deduplication; 59 raw findings across the three reports).

## Reviewer Status

| Reviewer         | Status    | Raw findings                                                                 |
| ---------------- | --------- | ---------------------------------------------------------------------------- |
| `egm-design`     | completed | 6 major, 9 nit; 30+ code claims verified (listed at the end)                 |
| `egm-structural` | completed | 1 blocker, 6 major, 17 nit; all required sections present, all links resolve |
| `egm-style`      | completed | 9 major, 19 nit                                                              |

Finding ids are stable: `<reviewer>-2-<n>`. Where two reviewers reported the same defect, the finding is listed once under the reviewer that stated it most completely and the other lenses are named.

---

## Standard compliance (both structural and design lenses)

Every section the feature-spec standard requires is present and in a sensible order: Problem (48–86), Goals (146–170) and Non-Goals (172–205), Decisions (207–229), Open Questions (231–241), nine CUJs in Given/When/Then (243–328), Technical Plan (330–670), sixteen Alternatives A–P each with Pros, Cons and a Reason for Rejection (672–831), seventeen Risks with Effect and Mitigation (833–853), NFRs with security, performance, rollout and rollback (855–880). Heading hierarchy is H1 → H2 → H3 with no skipped levels. Every relative link in the range resolves (v1 `#terms`, the v1 ADR, the brief, the hypothesis, the implementation checklist, the firestore and production runbooks at the cited sections). The defects below are consistency and correctness defects inside an otherwise complete specification.

---

## Prioritized Findings (Blockers → Majors → Nits)

### 🔴 Blockers

#### egm-structural-2-1 — The sweep is defined three different ways, and the clock-skew mitigation relies on a criterion the sweep does not have

- **Reviewer lens:** `egm-structural` (blocker); also `egm-design` (major, finding 1) and `egm-style` (major, finding 1)
- **Affected scope:** lines 124–127 (Terms, "Sweep"), 363–369 (Shape), 376–377, 385–387 (Shape, "Stamp ordering"), 457–466 (Pipelines), 838 and 844 (Risks)
- **Discrepancy:** Terms and Pipelines define the sweep as writing every past day "whose document is missing or carries an older definition version" — two criteria, satisfied by reading the day documents in `in` chunks of 30. Shape (386–387) says "the sweep rewrites any day whose stamp is older than its source anyway", and the Clock-skew risk's mitigation (838) is "the sweep rewrites a day whose stamp is older than its newest visit's write". That third criterion appears nowhere in the sweep's definition, would require the sweep to read every day's visits (contradicting the nightly cost at line 652), and has no data to compare against: an `Appointment` carries no generic last-written instant, only `writeOperationId`, `revision` and per-variant lifecycle stamps (`.claude/rules/firestore-layout.md:22-52`). Separately, lines 363–364 and 844 say a policy write "starts the sweep's recompute over the reach", yet under the missing-or-version-stale criterion a policy change rewrites nothing. The words "sweep", "recompute" and "pass" are used interchangeably for the cron schedule, the pipeline pair and a single walk.
- **Rationale:** An engineer building from Terms and Pipelines builds a sweep that cannot deliver the Risks table's mitigation, so the clock-skew risk is unmitigated while the document claims it is mitigated, and the policy trigger does nothing. The standard requires Risks to state how each failure mode is mitigated; three sections contradict each other on the mechanism's definition.
- **Resolution:** Pick one eligibility rule and state it once. In Terms define two words: "**Recompute** — `startAnalyticsRecompute` / `continueAnalyticsRecompute`, a budgeted pass over the reach that hands eligible days to `writeAnalyticsDay`. **Sweep** — the 04:30 `CRON_TIME_ZONE` schedule that starts a recompute; the policy trigger starts one too." Then list eligibility once: a day is eligible when its document is missing, carries an older `dayDefinitionVersion`, or (if the policy trigger is kept) has `dayComputedAtUtcMs` earlier than the policy's change stamp. Either (a) drop "older than its source" from 386–387 and reword the Clock-skew mitigation to what exists — redelivery of the trigger plus repair on the next edit of that day or the next version bump — or (b) make it real cheaply: the nightly recompute rewrites the last 7 days unconditionally (≈ 70 writes a night at 10 barbers), which covers the realistic race window, and say so in Terms, Pipelines and the cost table. Replace every other phrasing (367–368, 376–377, 386–387, 462, 838) with "eligible (Terms)".

### 🟡 Majors

#### egm-design-2-1 — The nightly sweep's cost contradicts the Reads table and the "≤ 100 reads a night" NFR

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 124–127, 365–369, 457–466 versus 652 and 869–870
- **Discrepancy:** The sweep "continues until the reach is covered, normally that night" and "reads their documents in `in` chunks of 30" — a nightly walk of every barber-day in the 12-month reach (≈ 3,650 reads at 10 barbers, 7,300 at 20). The Reads table says "~10 barbers × 7 keys read + the days written; a full-reach pass ≈ 3,650 reads once", and the NFR says "the sweep ≤ 100 reads a night in steady state". Knowing a document is missing costs a read of its slot, so these cannot all hold.
- **Rationale:** The NFR is a stated gate; the cost model contradicts itself in the two places a reader will quote.
- **Resolution:** Make the three agree. Cheapest honest version: nightly the sweep walks the last 7 days (≈ 70 reads) and runs the full-reach pass only when (a) `ANALYTICS_DEFINITION_VERSION` differs from the version recorded on the job document, (b) the policy trigger started it, or (c) a `count()` aggregation over `analyticsDays` (≈ 1 read per 1,000 index entries, ≈ 4 reads for the reach) falls short of barbers × days in reach. Then "≤ 100 reads a night" holds and a silently missing old day still heals. Fix line 652 and the NFR to match whichever rule is chosen, together with egm-structural-2-1.

#### egm-structural-2-2 — "Seven questions, seven charts" over an eight-row table

- **Reviewer lens:** `egm-structural`; also `egm-style` (finding 8)
- **Affected scope:** lines 35 (Overview), 156 (Goal 3), 219 (D4), 558–569 (the table), 581–582 ("Sections in order" items 6 and 7)
- **Discrepancy:** The table captioned "**The seven questions.**" has eight rows; the eighth, "How each barber does (PR 5)", is also listed as a separate screen section (item 7, "the admin's radars"), so the radar is simultaneously inside and outside the seven. The "Where bookings come from" row names no `ui-*` element ("thin segmented bar") while every other row does.
- **Rationale:** The count is load-bearing: Goal 3's measure, D4's one-liner and the Overview all say seven. A fresh reader cannot tell whether the radar is the seventh question or an eighth.
- **Resolution:** Caption → "**The seven questions, and the admin's radar (PR 5).**"; separate the radar row with a rule or a second small table; keep Goal 3 and D4 at seven. Name the element for the origins row (the kit's stacked horizontal `ui-bar-chart`, or `lib-analytics-time-bar` reused).

#### egm-structural-2-3 — Read-count figures disagree between the Overview, Goal 2, CUJ 4 and the cost table

- **Reviewer lens:** `egm-structural`; also `egm-style` (finding 2) and `egm-design` (nit 7)
- **Affected scope:** lines 46, 154, 280–284, 645–650
- **Discrepancy:** CUJ 4's Then says the admin's year "costs about 8,700 reads" while in the same sentence the comparison chip reads «няма данни за сравнение» because the previous year is before the reach; the cost table (650) prices that very state at ≈ 5,000 "(~8,700 once a comparison year exists)". The two year rows use opposite headline conditions (barber-year 870 includes the comparison, "≈ 500 without"; shop-year 5,000 excludes it). The Overview (46) says "about 230 and 2,000" where the table (649) says ≈ 2,100 and Goal 2 (154) says ≤ 2,500. Rows 645–646 put "~1,000" under v1 for "Barber: one day", but v1 had only `WEEK`/`MONTH` (line 99).
- **Rationale:** A CUJ's Then must agree with the Technical Plan it illustrates; the Overview and the cost table are the two places a reader quotes.
- **Resolution:** CUJ 4 → "costs about 5,000 reads (≈ 8,700 once a comparison year exists; v1 would re-read ~50,000 visits)". Line 46 → "about 230 and 2,100". Give both year rows the same headline condition. Rows 645–646 v1 column → "— (v1 read the month: ~1,000)".

#### egm-structural-2-4 — The over-cap live fallback is "possible only before the sweep's first pass", but the document describes two more cases

- **Reviewer lens:** `egm-structural`; also `egm-design` (finding 6)
- **Affected scope:** lines 471–474 (Pipelines, `staffAnalytics` step 3) versus 128–133 (Terms "Definition version", the flag), 839 (Risks, version bump) and 873–877 (NFR, rollout and rollback)
- **Discrepancy:** Step 3 says a live fallback exceeding the adapter's caps answers `resource-exhausted` / «Опитай по-късно», "possible only before the sweep's first pass". By the document's own rules this also happens (a) on the day after a definition-version bump, when the whole reach is missing and the callable computes live until that night's recompute, and (b) after a rollback by the `analytics.storedDays` flag once PR 4b has shipped `YEAR`/`CUSTOM`: the web cannot see the server flag, so the admin's «Година» segment answers «Опитай по-късно» indefinitely.
- **Rationale:** A user-visible failure mode is understated in Pipelines and the rollback story in the NFRs is not a working rollback for the read path.
- **Resolution:** Reword step 3: "possible before the sweep's first pass, on the day after a definition-version bump until that night's recompute finishes, and whenever `analytics.storedDays` is off". Add the first to the Risks row's Effect column. For the flag-off state, either have the callable refuse spans over 93 days with a dedicated code the screen words (or hides the segment on), or state that the read path's rollback is "redeploy the previous functions" and keep the flag as the dark-launch gate only.

#### egm-design-2-2 — The writer's read set omits the follow-ups that `dayRebookedBase`/`dayRebookedCount` need

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 379–383 (writer reads), 419–422 (`fold(day, nets, followUps, policy)`), 651 (per-booking cost)
- **Discrepancy:** `DayFiguresSystem.fold` takes `followUps`, and the stored rebooking figures need them (v1 catalogue: F with `bookedFromAppointmentId = A.id`, F's booking shop date ≤ A + 1, F not CANCELLED). The writer's read list is "the day's visits — live and cancelled —, the barber's roster, the day's departure and the existing day document": no follow-up query (`bookedFromAppointmentId in [the day's visit ids]`, one `in` chunk, ≤ `FOLLOW_UPS_PER_VISIT` rows per visit — `apps/functions/src/adapters/firestore-analytics.adapter.ts:57`) and no location zones for `ZonedTimeSystem.toLocal(bookedAtUtcMs)` inside the `commit`. The per-booking cost "+~20 reads" omits them too.
- **Rationale:** The day document would store a rebooking count computed from no follow-ups; the agreement property at line 426 (stored figures equal v1's live figures) fails.
- **Resolution:** Add the follow-up `QuerySpec` and its cap to the writer's transactional read set and its port bundle; add ~5–15 reads to the per-booking and sweep cost lines; state that the `in` query runs inside the same `commit` (`tx.query` with `QueryOp.In` exists — `libs/ecs-core/src/ports/tx.port.ts:57-82`).

#### egm-design-2-3 — `reportDayRows: readonly DayFigures[]` breaks the "answer ≤ ~100 kB" NFR on shop spans

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 392–394, 405–406, 517, 871–872
- **Discrepancy:** `DayFigures` is v1's `AnalyticsReport.DayRow` (13 fields, `libs/ecs-core/src/components/analytics-report.data.ts:193-208`) "renamed and widened" to carry `dayServices[]`, `dayHourWorked[24]` and `dayHourRostered[24]`, and it is also the per-day row of the answer for spans ≤ 93 days. A shop-month answer is ≈ 310 rows × (48 integers + service rows + ~25 counts) ≈ 150–200 kB; a 93-day shop `CUSTOM` ≈ 930 rows ≈ 500 kB. `reportHourGrid` is already computed server-side, so the per-day hour buckets serve nothing on the device.
- **Rationale:** The NFR "the answer ≤ ~100 kB on any span" and the 6-entry localStorage cache (`ANALYTICS_CACHE_CAPACITY = 6`, `libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts:18`) are both at risk.
- **Resolution:** Keep the stored `DayFigures` as specified, but let `reportDayRows` carry a named narrower slice (v1's `DayRow` fields plus takings and tips if the rows page needs them), declared structurally — `<T extends DayFigures>(x: T): DayRow` — not as a mapper; or state the measured size per span and raise the NFR honestly.

#### egm-design-2-4 — Two different rules for when a two-location barber's day is "past"

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 109–113 (Terms) versus 409–412 ("The day document")
- **Discrepancy:** Terms define a past day as `d + 1 < today` "at every location where the barber has a stretch on `d`"; the day-document section says a barber at two locations has one document "whose day boundary and 'past' are judged on the clock of the location of their first stretch". The code today uses the first stretch's clock for the day's `ShopNow` (`libs/ecs-core/src/systems/staff-analytics.system.ts:451-464`).
- **Rationale:** "Past" decides what is written and never recomputed from the clock; with two rules the writer and `isPastDay` disagree for a barber at two zones.
- **Resolution:** One sentence, one rule, in both places: "past" is judged at every stretch location (the stricter rule), while the day's chair-time partition keeps v1's first-stretch clock.

#### egm-structural-2-5 — A repo-wide primitive rename is decided inside the Technical Plan with no Decision entry

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 627–628 versus 222–223 (D6)
- **Discrepancy:** "`CapacityMonthId` is renamed `MonthKey` (`YYYY-MM`) repo-wide — one brand for one format" sits under "Goals (PR 6)". D6 names the goals collection and the fold of findings only. The rename touches the capacity pipelines, adapters and seed (plan item 82), and the brief's alternative ("becomes or joins" — add `MonthKey` beside `CapacityMonthId`) is not recorded.
- **Rationale:** The Decisions section claims to list each decision with a pointer; a cross-cutting rename is buried in the technical plan.
- **Resolution:** Add to D6 (or a new D11): "`CapacityMonthId` becomes `MonthKey`, repo-wide (one brand for `YYYY-MM`) → Technical Plan, 'Goals (PR 6)'", with one line on why not a second brand.

#### egm-structural-2-6 — Alternative E cites a survey rubric row the survey does not contain

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 723–725 versus `docs/design-research/staff-analytics/chart-library-survey.md` §4 (lines 236–245)
- **Discrepancy:** "the survey's rubric (bundle 25 / CSP 15 / design-system fit 25 / phone performance 20 / maintenance 15; delivery time added at 20 %) draws level on delivery". The survey's rubric has exactly those five rows summing to 100 % and no delivery-time row; the 20 % row was proposed by the brainstorm review (D2-2) and adopted in the brief (`concepts_brief_v2.md` 192–195). As written the weights sum to 120 % and the cited source lacks the attributed figure.
- **Rationale:** The Alternatives rule requires documented rejection reasons; this one points at a document that does not say what it is cited for.
- **Resolution:** "the survey's rubric … plus the brief's added row, engineering days to the first shipped screen at 20 % (the five survey rows re-weighted to 80 %), on which the two draw level" — or amend the survey and keep the citation.

#### egm-structural-2-7 — PR 1 in the plan navigates to a span the screen refuses, contradicting "Entry from the schedule" and CUJ 1

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 616–618 and 248–255 (range) versus 945–948, 957–962, 982–984 (plan)
- **Discrepancy:** The range fixes the entry's query as `span=DAY&from=<the schedule's day>` and CUJ 1's Then as "opens on `DAY` for today". Plan item 2 has PR 1's button send `{ span: 'DAY', … }` while item 6 has PR 1's store refuse DAY "and fall back to the month" until PR 3; item 13's e2e asserts `?span=…` with the value elided.
- **Rationale:** The plan must not contradict the range; a PR that ships a known mismatch needs the range to say so.
- **Resolution:** Either PR 1 sends `span=WEEK` (or no span) and PR 3 switches the button to DAY, with item 13 asserting the concrete value; or add under "Entry from the schedule": "until PR 3 the store maps `span=DAY` to the containing week".

#### egm-style-2-1 — The radar's units and normalisation are stated four different ways

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 290–291, 438, 520, 524–528
- **Discrepancy:** CUJ 5: "values 0–100 against the best barber meeting the sample floor"; 438 and 520: "five values 0–100 or `null`"; 526: "reliability (`1 − noShowRate`, base 20, **absolute**, not normalised)" — a 0–1 quantity — and 527: "the four normalised axes".
- **Rationale:** A reader of CUJ 5 believes all five axes are normalised; a reader of the contract sees four, with one axis on a different scale.
- **Resolution:** Line 526 → "reliability (`(1 − noShowRate) × 100`, base 20, absolute — never divided by the best)"; CUJ 5 → "four axes normalised 0–100 against the best barber meeting the sample floor, reliability absolute, a subtitle saying so in words".

#### egm-style-2-2 — The one callable has five names

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 14, 27, 123, 168, 498 (versus "callable" at 334, 370 and elsewhere)
- **Discrepancy:** "one server call" (14, 27), "the screen's call" (123), "the analytics call" (168), "the call" (498).
- **Rationale:** v1's Terms, which line 90 says hold, define "callable"; the house vocabulary is callable/pipeline. "Server call" and "the screen's call" read as different mechanisms.
- **Resolution:** Use "the callable" (or `staffAnalytics`) throughout: line 14 "computed by one callable", 123 "never by the callable", 168 "readable only through the callable".

#### egm-style-2-3 — The stored day has four names, one of which collides with an existing, different type

- **Reviewer lens:** `egm-style` (findings 5 and 19)
- **Affected scope:** lines 97, 121, 391–392, 420–423, 450, 490, 666
- **Discrepancy:** "`analyticsDays` document" (97), "**Day document** — `analyticsDays/{busyKey}` … (`DayFigures`)" (121), "Entity `BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures`" (391), "analytics day" inside `writeAnalyticsDay`, `AnalyticsDayWritten`, `AnalyticsDayReadPorts`; and line 420 `fold(day: AnalyticsDay, …)` where `AnalyticsDay` is v1's existing per-day _input_ type (`ChairDay & { closedDayMinutes }`, `staff-analytics.system.ts:92-94`) — not the document. Terms also implies the document _is_ `DayFigures` while the entity section says it is Meta & DayFigures. The gloss at 420–423 says `AnalyticsDay` is "`ChairDay` plus the day's seats and their nets" while `nets` is also a separate parameter.
- **Rationale:** One name per concept; `AnalyticsDay` beside `BarberAnalyticsDay` and `analyticsDays` will be read as the same thing, and an implementer will look for the wrong type.
- **Resolution:** Terms 121 → "**Day document** — `analyticsDays/{busyKey}`, entity `BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures`; 'day document' in prose throughout." Line 420 → "`fold(input: AnalyticsDay, …)` — `AnalyticsDay` is v1's existing per-day system input (`ChairDay` plus the day's seats), unrelated to the day document"; drop `nets` from either the gloss or the parameter list.

#### egm-style-2-4 — The field table misattributes names to `ChairDay`

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 399
- **Discrepancy:** "`dayRosteredMinutes`, … `dayClosedDayMinutes` | `MinuteCount` | `ChairDay`'s parts". `ChairDay` (`libs/ecs-core/src/systems/chair-time.system.ts:51-72`) has ten parts plus `rosteredMinutes`; it has no closed-day field — closed-day minutes is a report figure (`reportClosedDayMinutes`, `analytics-report.data.ts:100`). `dayRosteredMinutes` is the sum, not a part.
- **Rationale:** Identifier precision; an implementer will look for `ChairDay.closedDayMinutes`.
- **Resolution:** Split into two rows: "`dayRosteredMinutes` + the eight stored parts (`dayWorkedMinutes`, `dayNoShowMinutes`, `dayUnmarkedMinutes`, `dayHeldMinutes`, `dayBlockedMinutes`, `dayBreakMinutes`, `dayShortGapMinutes`, `dayUnsoldMinutes`) | `MinuteCount` | `ChairDay`'s sum and parts; `bookedAhead` and `open` are 0 on a past day and are not stored" and "`dayClosedDayMinutes` | `MinuteCount` | v1's `reportClosedDayMinutes` per day; not a `ChairDay` part".

#### egm-style-2-5 — Error identifiers appear in three casings

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 484–485, 660–661
- **Discrepancy:** 484–485 "`ANALYTICS_GOAL_FORBIDDEN`, `ANALYTICS_GOAL_INVALID_RANGE`" (values); 660 "`AnalyticsErrorCode` gains `GoalForbidden`, `GoalInvalidRange`; `invalidInput` names the new fields …; `periodOutOfRange` covers …" — `invalidInput`/`periodOutOfRange` are the factory functions (`analytics.error.ts:51,57`), while the dictionary keys are `InvalidInput`/`PeriodOutOfRange`.
- **Rationale:** Law 7.5 names errors as dictionary key → value; mixing factory names with keys in one sentence reads as three different things.
- **Resolution:** Line 660 → "`AnalyticsErrorCode` gains `GoalForbidden` → `'ANALYTICS_GOAL_FORBIDDEN'` and `GoalInvalidRange` → `'ANALYTICS_GOAL_INVALID_RANGE'`; the `InvalidInput` struct's `field` names the new fields and the refused `SAME_LAST_YEAR`; `PeriodOutOfRange` covers `CUSTOM_MAX_DAYS`."

#### egm-style-2-6 — Garden-path definition of "Counterpart day"

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 105–107
- **Discrepancy:** "**Counterpart day** — the day today is compared with inside the comparison period: the same position (for `DAY`, the same weekday a week earlier); its seats count up to the current minute, as v1's hero rule says."
- **Rationale:** "the day today is compared with" parses first as "the day today", then stalls; this is a Terms entry other sections rely on.
- **Resolution:** "**Counterpart day** — the day in the comparison period that today is compared with: the same position in that period (for `DAY`, the same weekday a week earlier). Its seats count up to the current minute (v1's hero rule)."

### 🟢 Nits

#### egm-design-2-5 — Follow-ups read for the live days feed no figure

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 477–478, 647
- **Discrepancy:** "follow-ups for the live days only (~10 reads)": by the rule at 109–111 and v1's base rule (`addDays(visit.localDate, 1) < today`, `staff-analytics.system.ts:306`), today's and yesterday's visits are never in the rebooking base.
- **Resolution:** Drop the read and the ~10 from the cost line, or say what it feeds.

#### egm-design-2-6 — `takingsPerHourCents` stored per day is a derived ratio

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 405, 425
- **Discrepancy:** `dayServices` stores `takingsPerHourCents`, yet `sum` must recompute it from merged `takingsCents`/`serviceMinutes`.
- **Resolution:** Store the two sums only and derive the ratio in `sum` or the report (Law 3 lazy evaluation; smaller document).

#### egm-design-2-7 — Hour-bucket formula is ambiguous and `reportHourGrid` has no formula row

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 134–136, 509–511, 518
- **Discrepancy:** "worked and rostered minutes per wall-clock hour (`startMinutes ÷ 60`)": a 10:30–11:15 seat either lands wholly in bucket 10 or splits 30/15; the two give different heatmaps. Lines 509–511 promise a formula per new figure; the contract table has none for `reportHourGrid`.
- **Resolution:** Pin "minutes of overlap with [h:00, h+1:00)" and add the row.

#### egm-design-2-8 — The policy trigger's recompute is mostly dead weight

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 363–364, 713–714, 844
- **Discrepancy:** `ClientStatsPolicy.isLateCancellation` (`libs/ecs-core/src/components/client-stats-policy.data.ts:92-116`) judges by the window stamped on the seat and falls back to the current policy only for unstamped cancellations (pre-2026-09-25; none in a greenfield deploy).
- **Resolution:** Say the recompute exists for unstamped seats only, or drop the policy trigger and keep the precedent note. (Interacts with egm-structural-2-1.)

#### egm-design-2-9 — The brief's `AnalyticsExported` log event and seat-level CSV were dropped without a recorded reason

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 632–639 versus `concepts_brief_v2.md` D7
- **Resolution:** One clause in Alternative K or in Export saying why ("No port, no token, no log" is the what, not the why).

#### egm-design-2-10 — Deploy order waits a night it does not need, and the runbook count edits are not named in the range

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 873–877
- **Discrepancy:** "functions with the flag off; then the flag on; the sweep fills the reach that night" — the flag gates only `loadAnalyticsDays` (131–133), so writers and sweep run from the functions deploy and the reach fills the first night regardless. The brief's runbook edits (P2 "7 of 7" → 8, P3's 24 composites → 25, `production-deploy.md` §3.1) are literal counts at `docs/production-deploy.md:51-52` and are not named in the range.
- **Resolution:** Reword the order so the operator does not wait after flipping; list the runbook count edits under NFRs or Additional Resources.

#### egm-design-2-11 — The ≤ 250-read barber-month measure omits the fixed reads every open pays

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 153–154, 645–647
- **Discrepancy:** `listBarberRecordIds` (10 barber documents), `listLocations` (≤ 3), the roster and the policy (`staff-analytics.pipeline.ts:136-196`) are not counted; ≈ 245 against a 250 gate fails on a 12-barber shop.
- **Resolution:** Say "≤ 300" or exclude the fixed reads explicitly.

#### egm-design-2-12 — Raising the TTL later re-stamps every document

- **Reviewer lens:** `egm-design`
- **Affected scope:** lines 903–904
- **Discrepancy:** `purgeAt` is anchored on `localDate`, so a formula change to 25 months does not propagate by itself.
- **Resolution:** Note the re-stamp as the migration cost of that Future Improvement.

#### egm-structural-2-8 — Status line carries review-process state

- **Reviewer lens:** `egm-structural`; also `egm-style` (finding 22)
- **Affected scope:** line 4
- **Discrepancy:** "Proposed — in `/egm:egm-review` (Stage 7 round 1 fixes applied)". A fresh reader does not know what Stage 7 is.
- **Resolution:** Keep "Proposed"; move the process note to the PR or drop it.

#### egm-structural-2-9 — Goal 1 and Goal 2 titles overlap

- **Reviewer lens:** `egm-structural`; also `egm-style` (finding 11)
- **Affected scope:** lines 148, 153
- **Discrepancy:** Both say past days are "read as documents"; Goal 1's body is about when a past day is recomputed.
- **Resolution:** Retitle Goal 1 "Past days are stored on event and recomputed only on cause".

#### egm-structural-2-10 — Tautological rejection reasons on Alternatives I, J, L

- **Reviewer lens:** `egm-structural`; also `egm-style` (finding 17)
- **Affected scope:** lines 763, 771, 789
- **Discrepancy:** "**Reason for Rejection**: rejected on the cons above; chosen instead: …" — filler in a field whose heading already says rejection; A–H and M–P state the deciding con.
- **Resolution:** State the deciding con, e.g. 763 → "readable by colleagues and bound to the account; `analyticsGoals/{key}`, callable-only and keyed by month, has neither flaw."

#### egm-structural-2-11 — Shape's pipeline count disagrees with Pipelines

- **Reviewer lens:** `egm-structural`; also `egm-style` (finding 14)
- **Affected scope:** lines 336–339
- **Discrepancy:** Shape lists "a **write path** that keeps one document per past barber-day" and "one writer pipeline fed by the existing triggers and the sweep" as two additions when they are one, and Pipelines adds three new pipelines (`writeAnalyticsDay`, `startAnalyticsRecompute`, `continueAnalyticsRecompute`) beside `setAnalyticsGoal`.
- **Resolution:** Merge: "a **write path** (`writeAnalyticsDay`, fed by the existing triggers and the recompute) that keeps one document per past barber-day" and state the count.

#### egm-structural-2-12 — D6's pointer "→ 'Goals'" is ambiguous; PR numbers appear in only two H3 titles

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 223, 622, 632
- **Resolution:** Point to "Technical Plan, 'Goals (PR 6)'"; either drop the PR numbers from the two H3s or add them everywhere.

#### egm-structural-2-13 — D3 and D4 point to bold run-ins, not headings

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 218–219, 539–606
- **Discrepancy:** "Chart kit", "The seven questions.", "Sections in order", "Colour.", "Freshness.", "State and URL." are bold paragraphs, not anchors.
- **Resolution:** Promote them to H4 so the pointers resolve, or say "paragraph".

#### egm-structural-2-14 — Visibility cites "v1's table" without a link

- **Reviewer lens:** `egm-structural`
- **Affected scope:** line 533
- **Resolution:** Link `./staff-analytics.md#visibility`.

#### egm-structural-2-15 — `dayServices` has no `fieldOverrides` entry in the range

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 405–406 versus plan item 61 (1156–1159)
- **Discrepancy:** The range names "two `fieldOverrides` entries" for the hour arrays only; the plan adds three including `dayServices`. `firestore-layout.md` requires the override for never-queried arrays.
- **Resolution:** Carry the third override in the range.

#### egm-structural-2-16 — Duplication across Non-Goals, Open Questions and Future Improvements

- **Reviewer lens:** `egm-structural`
- **Affected scope:** 184–186 and 903–904 (same period last year); 181–183 and 905–906 (barber's own radar); 193–194, 233–237, 744–745, 847, 907 (hue per part); 195–196 and 910–911 (PDF, share card, seat CSV); 174–177 and 912 (pay)
- **Resolution:** Keep each once in the owning section and cross-reference by name elsewhere.

#### egm-structural-2-17 — Future Improvements omits "(to be written)" for `staff-pay.md`

- **Reviewer lens:** `egm-structural`
- **Affected scope:** line 912 (versus 174, 790)
- **Resolution:** Add "(to be written)"; the file does not exist.

#### egm-structural-2-18 — Token vocabulary drift in CUJs

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 263, 271
- **Discrepancy:** "orange worked time", "the emptiest in orange" versus "accent" in Goal 4 and the Technical Plan.
- **Resolution:** Use "accent".

#### egm-structural-2-19 — CUJ 2's Then reaches beyond its When

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 260–266
- **Discrepancy:** When = "they look at the takings line and the time bars"; one Then bullet is about the heatmap's sentence.
- **Resolution:** Widen the When or move the bullet.

#### egm-structural-2-20 — Link-style inconsistency

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 674, 683
- **Discrepancy:** `concepts_brief_v2.md` and `docs/design-research/availability-and-statistics-design.md` appear as code spans in the body while Additional Resources links the first and v1 links the second.
- **Resolution:** Make them links.

#### egm-structural-2-21 — D10 does not name the record it creates

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 228–229
- **Resolution:** Name `2026-11-09-staff-analytics-v2.md` in D10 as the plan (1284) and the brief do.

#### egm-structural-2-22 — Alternative L carries design for another document

- **Reviewer lens:** `egm-structural`
- **Affected scope:** lines 790–792
- **Discrepancy:** The `restricted/pay` match and the seal snapshot are suggestions for the pay design, not a rejection.
- **Resolution:** Move them to Future Improvements or the pay design's brief.

#### egm-structural-2-23 — Plan items outside the range that contradict it (for the plan's author)

- **Reviewer lens:** `egm-structural`
- **Affected scope:** plan lines 1090 and 1194 (outside the range; recorded because the range is their source)
- **Discrepancy:** Item 44 says PR 3 adds "the fourth segment" — v1 has two, PR 3's DAY is the third, PR 4b's «Година» the fourth (range line 576 "four segments"). Item 71 names `libs/infrastructure/firebase-app/src/lib/analytics-cache.adapter.ts`, which does not exist; the v1 cache adapter is `libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts`, and the range's Ports section (497–498) is the cache-key change it implements.
- **Resolution:** Fix the ordinal and the path.

#### egm-style-2-7 — Duplicate colour clause in The Problem

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 52–53, 60
- **Resolution:** Delete the second "nothing on the screen is distinguishable by colour"; end line 60 at "for chrome."

#### egm-style-2-8 — Unpunctuated list of colour pairs

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 160–161
- **Resolution:** "accent = earned, red = lost, hatched amber = needs a mark, grey = nothing happened, identity tone = whose chair".

#### egm-style-2-9 — Dangling modifier in the Overview

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 13–15
- **Discrepancy:** The screen is "computed by one server call … drawn as rows".
- **Resolution:** "one screen, «Анализи», that a barber or the admin opens for a week or a month; one callable computes its report by re-reading every visit of the period, and the screen draws the figures as rows in one grey."

#### egm-style-2-10 — Garden path in Export

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 637–639
- **Resolution:** "…; the client card's JSON download and the client appointments' `.ics` download move onto the same helper."

#### egm-style-2-11 — Redundant phrase in Alternative P

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 828–829
- **Resolution:** "~13 `in` chunks per barber for one barber" → "~13 `in` chunks for one barber".

#### egm-style-2-12 — NTP claim without a source

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 385–386, 838
- **Resolution:** Cite the Cloud Functions documentation or write "assumed sub-second; the recompute's rewrite covers the residual".

#### egm-style-2-13 — Code-span hygiene

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 427–428, 433–435, 516
- **Discrepancy:** Inline code spans broken across lines inside list items (`pastDays: readonly` / `DayFigures[]`, `grid(pastDays, liveDays)` / `→ weekday × hour`); line 516 puts prose inside a code span (`readonly { localDate; the six bar parts }[]`).
- **Resolution:** One line per code span; 516 → "`readonly { localDate; workedMinutes; noShowMinutes; unmarkedMinutes; blockedMinutes; unsoldMinutes; otherMinutes }[]` (the six bar parts)".

#### egm-style-2-14 — "Zone boundary" is ambiguous

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 116–117, 187
- **Resolution:** "three when the barber's locations lie in different time zones".

#### egm-style-2-15 — "drill-down" is not a v1 term

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 90–91
- **Discrepancy:** v1's Terms (staff-analytics.md:75–116) define no "drill-down" entry.
- **Resolution:** Drop it from the list or define it here.

#### egm-style-2-16 — `analytics.chart` icon does not exist yet

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 610
- **Resolution:** Say "(a new icon)" so the reader does not search `libs/ui/icons`.

#### egm-style-2-17 — Table hygiene

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 396–407, 560–569
- **Discrepancy:** The Field cell at 399 is ~200 characters of ten identifiers; Form cells at 562–563 are ~140 characters.
- **Resolution:** Split the Field cell (see egm-style-2-4) and move per-row mechanics ("the v1 time bar, promoted", "DAY shows the hero and the delta only") into prose under the table.

#### egm-style-2-18 — "free-time card" versus v1's "open-hours card"

- **Reviewer lens:** `egm-style`
- **Affected scope:** lines 271, 565
- **Resolution:** Pick one name and use it in CUJ 3 and the table.

#### egm-style-2-19 — "CSP-clean (no inline styles)" misstates the survey

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 718
- **Discrepancy:** The survey (`chart-library-survey.md:173`) says Chart.js injects no CSS but does set `canvas.style` via CSSOM.
- **Resolution:** "no `eval`, no CSS injection".

#### egm-style-2-20 — "and them" is unclear

- **Reviewer lens:** `egm-style`
- **Affected scope:** line 252
- **Resolution:** "opens on `DAY` for today and for that barber".

---

## Claims verified against the code (egm-design; correct as stated)

Recorded so the next revision need not re-prove them.

- `rebuildBusyOnAppointmentChange` derives both sides' keys via `BusySystem.affectedKeys(before, after, salvaged)` (`apps/functions/src/main.ts:940-957`, `libs/ecs-core/src/systems/busy.system.ts:179-194`); the rebuild commits one transaction per key and judges failures with `TriggerAttemptSystem.decisiveFailure` (`libs/ecs-core/src/pipelines/rebuild-busy.pipeline.ts:111-168`).
- `recomputeClientStatsOnPolicyChange`, `continueClientStatsPolicyRecompute` (cursor on `backfillJobs/clientStatsPolicy`) and `sweepClientStatsPolicyDaily` exist (`main.ts:1089-1159`; `start-/continue-/sweep-policy-recompute.pipeline.ts`).
- `CRON_TIME_ZONE = 'Europe/Sofia'`; schedules at 03:00, 03:30 and 04:00 exist, so 04:30 is free (`apps/functions/src/lib/cron-zone.ts:11`; `main.ts:1030-1037, 1147-1148`).
- `VISITS_PER_BARBER_DAY = 60`, `IN_CHUNK = 30`, `overBound` → `resource-exhausted`, `BOOKED_IN_RANGE = 20,000` (`firestore-analytics.adapter.ts:54-64, 76-102`; `store-answer.ts:24,36`).
- `QuerySpec` with `limit` exists in the tx port; `CommitPorts`, `ClockPorts`, `LogPorts`, `PolicyReadPorts`, `ShopDayReadPorts`, `LocationLoadPorts`, `DefaultLocationPorts` are real bundles (`tx.port.ts:57-82, 165-188`; `scheduling.port.ts:468-480`; `catalog.port.ts:104-113`; `telemetry.port.ts:77`).
- `staffAnalytics` is read-only over `AnalyticsReadPorts & ProfileLoadPorts & ShopDayReadPorts & PolicyReadPorts & DefaultLocationPorts & ClockPorts & LogPorts`, derives `nowByLocation` once, reads the previous period for the hero (`staff-analytics.pipeline.ts:84-90, 156-196`); `AnalyticsCacheKey = AnalyticsCall & { userId }` (`analytics.port.ts:126-128`).
- `AnalyticsSpan` is `WEEK | MONTH`, `REACH_MONTHS = 12`, `AnalyticsPeriod.of` refuses a non-boundary `from`; `ANALYTICS_DEFINITION_VERSION = 1`; `AnalyticsBarPart` has six parts; `DayRow`/`ServiceRow`/`BarberFigures` exist; `AnalyticsDay = ChairDay & { closedDayMinutes }`; `ChairDay` holds ten parts plus `outsideHoursMinutes`/`outsideHoursSeatCount`; the day's clock is the first stretch's location; the hero counterpart is cut at the current minute.
- `MinuteCount` exists; `CapacityMonthId` exists and `LocalDate.monthKey()` returns it; `inEuroCents` is a fixed `BGN_PER_EUR` conversion.
- `RetentionGroup`/`RetentionAnchor` have seven groups and `RetentionSystem.purgeAtUtcMs` seven formulas; `LEAD_TIME_SAMPLES` uses the same "+400 d from `localDate`" shape; the TTL adapter switches on `Collections.*`; seven `ttl: true` fieldOverrides exist (`firestore.indexes.json:945-986`).
- `appointments.busyKeys` keeps its default single-field index and a composite with `bookingStatus`; `bookedFromAppointmentId` and `bookedAtUtcMs` keep default indexes.
- Rules: `barbers/{id}` public read, `restricted/link` deny-all (`firestore.rules:564-582`); `users/{uid}` `allow get: if isOwner(uid) || worksTheBook()` (:209) — Alternative I's reason holds.
- Functions flags come from `config/feature-flags.json` through `FlagName`-exhaustive params; `Collections.BackfillJobs` exists.
- `withViewTransitions` skips only same-path navigations and reduced motion; `withComponentInputBinding` is on (`apps/web/src/app/app.config.ts:253-282`).
- Tokens `--sys-color-accent #f26b22`, `--sys-color-warning`, `--sys-color-destructive` exist in both themes; `accent-rule.spec.ts`, `contrast.ts`, `ui-page-action-bar`, `ui-gauge` `circularCapacity`, the `ResizeObserver` guard in `scroll-row.ts`, and the `@creativo/ui/layout` and `@creativo/infrastructure/web-storage` aliases all exist; the `.ics` download uses an inline `<a download>` today.
- The analytics route ceiling is 1,680,000 bytes (`tools/verify/bundle/budgets.json:12`); the production runbook's P2/P3 gates exist (`docs/production-deploy.md:51-52`); the firestore runbook has §2.1 "The seven policies".
- The v1 ADR D1 names the per-day set as the upgrade path; v1 Future Improvements list v1.1/v1.2/v2 as the design restates them; the Overview's 1,000 / 11,500 reads match v1's table.

**Law compliance audited with no finding** (egm-design): Law 5 (stored day justified by read fan-out, rebuilt by triggers, expired by TTL, flat root fields, arrays only for 1-to-N, composite declared, deny-all rules), Law 7 (stamp ordering, TTL and freshness are on the T2 list; "past" judged on `ShopNow.localDate`), Law 8 (`type:ui` kit takes plain display structs), Law 9 (new ports are named bundles), Law 10 (series grain, peak hour, goal pace and radar axes are system decisions worded by the presenter).
