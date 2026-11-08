# Intermediate zoom-out review — Staff Analytics v2, revised (Stage 8)

- **Mode:** REVIEW against `zoom-out-standard.md`
- **Target:** `docs/designs/staff-analytics-v2.md`, lines 1–1396 (read in full)
- **Also read in full:** the persona, the standard, the Stage 5 report (`review-v2/zoom_out_report.md`), both resolution records (`review-v2/goldfish_review_report.md`, `review-v2/goldfish_review_report_round2.md`), `CLAUDE.md`, `.claude/rules/firestore-layout.md`, `ecs-pipelines.md`, `ecs-ports.md`, `concepts_brief_v2.md`, `brainstorm_review_report_v2.md`, `chart-library-survey.md`, `mobbin-inspiration-v2.md`, the v1 ADR `2026-11-08-staff-analytics.md`, and the v1 design's Shape, Reads and cost, Risks and Alternatives A–C sections.
- **Code verified:** `libs/ecs-core/src/entities/policy-recompute-job.entity.ts` (the job-document model the recompute copies: `cursor`, `stepKey` compare-and-set, `failed` count), `apps/functions/src/main.ts` (the policy start/continue/sweep exports, the 03:00/03:30/04:00 slots, `rebuildBusyOnAppointmentChange` under `retryingTrigger`), `libs/ecs-core/src/systems/trigger-attempt.system.ts` (`decisiveFailure`: a `Malformed` repository error or an unknown code is permanent), `BusySystem.affectedKeys` (`busy.system.ts:179`), `AnalyticsReport.DayRow` (`analytics-report.data.ts:193–208`), `reportExcludedVisitCount` (`:115`), the two inline downloads (`client-card.ts:356–359`, `client-appointments.ts:886–889`), `CapacityMonthId` / `LocalDate.monthKey()` (`ids.primitive.ts:202`, `local-date.primitive.ts:257`), `flags.ts` (`flagOn`, default false), `RetentionAnchor` (seven formulas today), `firestore-analytics.adapter.ts` (`VISITS_PER_BARBER_DAY = 60`, `overBound`), the module-boundary rule that `type:feature` may import `type:infrastructure`, and that no `count()` / `AggregateField` aggregation exists anywhere in `apps/functions/src` today.

## 0. Context sufficiency — PASS

The Overview (13–46) names the six asks verbatim, maps each to a numbered change, and answers ask 6 in one paragraph. The Problem (48–86) and Goals (160–187) hold the altitude. A fresh reader can say what is being built and why without opening the brief.

## 1. Root problem and alignment — PASS

The stored projection is now justified on Law 5's read-fan-out clause in the design's own words (69–71), the ADR's upgrade trigger is named as fired (68–69), and the four large cuts (pay, findings, PDF/share card, six hues) survive both rounds unchanged. Nothing added in Stage 7 re-opens a decided question.

## Findings on what was added or changed

### 🟡 M-A — The retry list on the job document is a speculative repair path with a second writer on a compare-and-set document

**Scope:** Terms "Eligible" (133–139); Shape "Failure semantics" (386–391); `startAnalyticsRecompute` (476–487: "the retry list … clears the retry list"); Risks rows at 886 and 891; plan items 54 (1190–1194) and 59 (1205–1207, "a decisive one appending to the retry list").
**Rationale:** The list exists for one case: a trigger's day write fails with a _permanent_ code. By `TriggerAttemptSystem.decisiveFailure` that is a `Malformed` document or an unknown code. If the malformed input is a visit or a departure, the fix to that document fires the same trigger and rewrites the day — the list adds nothing. The only non-redundant case is a malformed roster or location, since Alternative D (752–761) says roster edits never rewrite history. For that rare case the design puts a second writer (every appointment trigger) on `backfillJobs/analyticsRecompute`, the document whose step protocol in the precedent (`policy-recompute-job.entity.ts:33–38`) relies on a `stepKey` compare-and-set over generation, cursor and finish; the design does not say how an append from a trigger and a step's write share that document without one clobbering or stalling the other, and the precedent itself does not do this (it counts `failed` and leaves repair to another job). The round-2 record (Decision 2) added the list as "one small write"; the coupling is not small. The design already accepts a residual of exactly this shape for clock skew — "the day is rewritten on its next edit" (Risks 887).
**Resolution (preferred):** Delete the retry list. "Eligible" becomes "missing or version-stale" — one sentence. A decisive failure logs `AnalyticsDayWriteFailed` with the key and is the accepted residual, same row as clock skew: "rewritten on the day's next edit; a stuck day is visible in the log; a version bump is the lever that rewrites the reach". The trigger then writes only day documents, the recompute writes only the job document, and plan items 54/59 shrink. **If kept instead:** state the write protocol in "Failure semantics" (a field-only transaction on the job document that never touches `stepKey`/`cursor`, or a separate `analyticsRetry` document) and add the `indexes: []` override for the array.

### 🟢 N-A — The `count()` shortfall is the one eligibility clause without a precedent, and the job document already holds what it detects

**Scope:** Terms "Eligible" (136–138); Pipelines (481–483); cost table (697); plan items 54, 57 ("the `count()` aggregation").
**Rationale:** Code search finds no aggregation query in `apps/functions/src`; this adds a port, an adapter path, an in-memory double and an emulator assumption for ~4 reads a night. What the count catches that the version check does not: (a) a new barber record (365 zero-days to write), (b) the recompute failing for more than 7 nights so days fell out of the 7-day window, (c) the first rollout (also caught by the absent job document). The precedent measures staleness from the job document's own `updatedAtUtcMs`, not from an external count.
**Resolution:** Replace the count with two facts the job document already carries: record the barber-id list on the job document at each start and walk the full reach when it differs; and define the nightly window as "from the last completed pass's date minus one, to today" instead of a fixed 7 days, so an outage widens the window by itself. Then "Eligible" reads: missing, version-stale, or inside the window since the last pass; the full reach only on a version change or a barber-list change. Zero new infrastructure. Keep `count()` only if the owner wants a defence against documents vanishing for reasons the design does not name.

### 🟢 N-B — `ANALYTICS_SPAN_UNAVAILABLE` is a dedicated refusal for a state meant to last hours

**Scope:** Terms "Flag" (143–145); Pipelines step 2 (490–492); Errors (705–707); Risks 894; plan items 68, 70, 73 (the notice, its i18n in two languages).
**Rationale:** The same paragraph already specifies what happens when a live fallback is too large: the existing `resource-exhausted` refusal and «Опитай по-късно» (493–498). The new code pre-empts that for one deterministic sub-case (flag off and span > 93 days) so the screen can word it precisely — during a rollback. A code, a notice, a spec and two translations for an operational state the NFR expects to end with a flag flip.
**Resolution:** Either accept the small cost (it is small) or let the flag-off long span fall through to the existing `overBound` refusal and «Опитай по-късно», deleting `SpanUnavailable` from Errors, the Risks row's wording and plan items 70/73's notice. Owner's call; the design is coherent both ways.

### 🟢 N-C — `pickedComparison` in the store for a field with one legal value

**Scope:** Ports (521–523, "the call now carries … `analyticsComparison`, so the storage key encodes them"); State and URL (645–648); Non-Goals (198–200).
**Rationale:** M2's resolution kept the wire field so nothing dead-ends — correct. But the store gains a `pickedComparison` signal and the cache key encodes a value that cannot change until November 2027; the chip (614–615) is informational, not a picker. State with one legal value is state nobody can test.
**Resolution:** The call sends the constant `PREVIOUS`; the store holds no `pickedComparison` until a second value is enabled; the cache key may encode the constant (harmless) or omit it. One line in "State and URL".

### 🟢 N-D — Alternative P's rejecting figure is the month's, not the year's

**Scope:** Alternative P (873–881: "a `YEAR` span needs the follow-ups of ~365 days — ~13 `in` chunks for one barber").
**Rationale:** v1's "≤ 15 `in` queries" is a barber-_month_ (~400 visits ÷ 30). A barber-year at ~5,000 visits is ~165 chunks. The rejection stands and is stronger with the right number; a reader who checks the arithmetic will distrust the rest of the table.
**Resolution:** "~165 `in` chunks for one barber (5,000 visits ÷ 30), one `bookedAtUtcMs` range of ~24,000 rows for the shop".

### 🟢 N-E — Residual weeds in the Technical Plan after the N6 pass

**Scope:** "Stamp ordering" (393–403: `limit VISITS_PER_BARBER_DAY + 1 = 61`, `overBound`), recompute (483–484: `RECOMPUTE_PAGE = 300`, "`in` chunks of 30"), Chart kit (581–582: `fill`/`stroke`, `[data-part]`).
**Rationale:** The round-1 fix moved radii, `@property` and the prefetch block to plan items — good. The constants and the "`in` chunks of 30" for reading documents by id remain in the architecture section; the latter is also the heavier mechanism (the Admin SDK's `getAll` over refs has no 30-cap and is one call). These numbers already live in plan items 53/54/57.
**Resolution:** In the Technical Plan say "bounded by a per-day visit cap", "one page of keys per step", "reads the page's documents by id"; leave the values where they are in the plan. Drop "in chunks of 30" or let the adapter choose.

### 🟢 N-F — Placement of `shareOrDownloadFile`

**Scope:** Export (678–681); plan item 93 (`libs/infrastructure/web-storage/src/lib/share-or-download-file.ts`).
**Rationale:** Lawful (`type:feature` may import `type:infrastructure`; verified in `eslint.config.mjs:222–229`) and exactly what M4 asked for. The lib's two existing exports are storage adapters (`session-storage-booking-draft`, `local-storage-analytics-cache`); a share/download helper is a browser-file concern, not storage. Fine for now; if a third browser-API helper appears, a `browser-file` or `web-platform` lib is the home.
**Resolution:** None required; one clause in the README of `web-storage` that it also holds browser file helpers, or rename the lib when a third helper lands.

## Judged proportionate (no action)

- **Recompute / sweep / eligibility as one mechanism** (129–139, 383–384, 476–487, 924–930): the policy-recompute model is reused as-is (start, budgeted continue, nudge, sweep), the backfill job and the seed writer are gone, a version bump and first rollout take the same path, and the callable stays read-only. This is the simplification Stage 5 asked for; the two eligibility clauses flagged above (retry list, count) are the only parts that exceed it.
- **"Every past calendar day gets a document, zeros included"** (124–127, 1188–1189): the alternative — judging "nothing happened" from a roster that may since have changed — needs the roster as it stood, which is not recoverable. Zeros cost ~1,100 small documents per barber-year at most and make `missingDays = 0` a true signal. Right call.
- **`DayRow & DayCounts & DayServices & DayHours`** (407–426): M3 asked for one per-day slice; round 2 produced one family by intersection with one fold (`DayFiguresSystem.fold`) and one declared projection (`dayRowOf<T extends DayRow>`), which is the repo's sanctioned shape for cutting a wire-sized row from a stored body (ecs-components checklist). It does not reintroduce two folds or a mapper. The reason for the split (the answer bounded at ~100 kB on YEAR) is real.
- **PREVIOUS only, reach 12, TTL 13 months, `SAME_LAST_YEAR` decoded and refused** (104–105, 198–200, 461–465, 531, 956–958): M2 resolved exactly as proposed, with the Future Improvements line.
- **The hatch and the pairwise ΔE pin** (627–635, items 22–23): one CSS pattern and one computed check in a spec that already exists for contrast; it answers a real adjacency (hue 21° beside 36°) with zero new tokens, keeping the hue gate closed.
- **Decisions D1–D11** (220–247): one line each with a pointer, mirroring v1's section; no decision is new to the body.
- **Alternatives O and P** (858–881): both were requested; O carries its own re-entry gate (PR 4b's shop-year measurement), which is the correct way to defer a storage change rather than build it.
- **Risks table** (882–903): eighteen rows, each with an effect and a mitigation that names a thing in the design; the "as v1" rows are short.
- **Trigger composition** (374–384, item 59): `BusySystem.affectedKeys` derived once in the composition root, both pipelines run, no change to `rebuildBusy`'s answer.

## Six asks at altitude

Still answered, each traceable from the Overview: 1 → D2–D4 and "The screen"; 2 → D9 and `AnalyticsPeriod`; 3 → D1, D6, D7, D8 and Non-Goals; 4 → D5; 5 → D7; 6 → Overview 42–46 and Freshness. Nothing in the document answers no ask.

## Stage 5 findings: resolved / open

| Id                                                                     | Status          | Where                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 — one repair mechanism, version bump and first rollout written down | **Resolved**    | Terms 129–145; Shape 383–391; Pipelines 476–487; Alternative C 748–750; Risks 888–889; Rollout 924–930; items 65/66 repurposed, no backfill job, no seed writer                                                      |
| M1 — flag creates two read strategies                                  | **Resolved**    | 143–145, 490–492, item 60: flag off = `loadAnalyticsDays` not called, every past day missing; agreement spec asserts both settings equal (1235–1237). The added `ANALYTICS_SPAN_UNAVAILABLE` is N-B above (optional) |
| M2 — SAME_LAST_YEAR, reach 24, 760-day TTL                             | **Resolved**    | 104–105, 198–200, 431–434, 461–465, 531, 956–958                                                                                                                                                                     |
| M3 — `DayFigures` duplicates `DayRow`                                  | **Resolved**    | 407–413, item 47: one family by intersection, `AnalyticsReport.DayRow` removed, one fold, one declared projection                                                                                                    |
| M4 — port, adapter and token for a download                            | **Resolved**    | 678–683, item 93: `shareOrDownloadFile` in `web-storage`, no port, no token, both call sites moved (placement note N-F)                                                                                              |
| M5 — `AnalyticsExported` through the client-issue channel              | **Resolved**    | 682–683: no log, with the reason                                                                                                                                                                                     |
| N1 — kit surface, fifth ResizeObserver                                 | Resolved        | 573 (`'stacked' \| 'single'`), 578–580 (no `niceTicks`, `elementWidth()` extracted), 584–585 (readout deferred)                                                                                                      |
| N2 — item 56 changes `rebuildBusy`                                     | Resolved        | item 59; no item touches `rebuild-busy.pipeline.ts`                                                                                                                                                                  |
| N3 — `MonthKey` beside `CapacityMonthId`                               | Resolved        | D11, item 83                                                                                                                                                                                                         |
| N4 — Goal 8                                                            | Resolved        | seven goals; pay paths as "a suggestion" in Future Improvements 967–969                                                                                                                                              |
| N5 — the simpler rebooking cut not weighed                             | Resolved        | Alternative P; Terms 114–116 corrected (figure N-D)                                                                                                                                                                  |
| N6 — altitude drops                                                    | Mostly resolved | radii/`@property`/prefetch moved; `replaceUrl` kept as a product rule (accepted); residue in N-E                                                                                                                     |
| N7 — cite Law 5                                                        | Resolved        | 69–71                                                                                                                                                                                                                |
| N8 — seat-level CSV                                                    | Resolved        | 157–158, 207–208, 965–966                                                                                                                                                                                            |

## Verdict

The Stage 5 blocker and all five majors are resolved in the text, and the mitigations added in two rounds are, with one exception, the minimal form of what was asked: one recompute reused from the policy model, one per-day family, one comparison, one CSV through one helper. The exception is the **retry list (M-A)**: a repair path for a failure class the design cannot name beyond "a malformed visit" (which the trigger on that visit already repairs), bought with a second writer on the recompute's compare-and-set job document. Decide it in the text — preferably by folding it into the residual the design already accepts for clock skew — and the design passes the zoom-out standard. The `count()` clause (N-A) is the only other place where the eligibility rule exceeds what the job document already knows; the remaining nits are wording and can land with the records PR.
