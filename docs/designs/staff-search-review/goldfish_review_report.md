# Goldfish Annotated Review Report

**Status:** resolved on "auto accept" (2026-11-03). Applied: F-1 to F-36, except the parts listed under "Not applied". Skipped by rule: D-1 to D-7 (ESCALATE), C-1 and C-2 (CONTEST), X-1 to X-3 (DECLINE).

**Decisions D-1 to D-7 (decided 2026-11-03, my recommendations taken, as delegated):**

- D-1 split: part 1 stays in `docs/designs/staff-search.md` (highlighter, phone reading, window); part 2 is the new `docs/designs/staff-search-spotlight.md` (filters, recents, Spotlight sheet, event-card results).
- D-2 refresh on open (15-minute age plus invalidation on save), no listener; the listener is Alternative J in part 1.
- D-3 "search older" cut; older visits are reached on the client card (Alternative K in part 1).
- D-4 `barber:` hint parser cut (Alternative A in part 2).
- D-5 trimmed: no facet counts, no index `patch`, no `SearchRecentsSystem` (a plain function beside the store). `SearchWindowSystem` stays in part 1, reduced to `rangeOf` and `isStale`, because the staleness check is a decision with an elapsed-time rule (Law 3, Law 7).
- D-6 result cards: `visitRowOf` plus one marked `StaffEventLine` per matched field; results mounted in `lib-visit-list`.
- D-7 date presets only (Today, Tomorrow, This week = today through the next 6 days).
- The conditional fixes (F-19, F-20, F-21, F-24, F-31, F-32, F-36) were rewritten to match: the `StaffSearchStore`, `AppointmentRangePorts` and live adapter are gone, and the rebuild-versus-`patch` contradiction no longer exists.

**Not applied (still open):**

- F-35: numbering or lettering the unnumbered H3s; moving the "open the client card for older" option into Alternatives (it depends on D-3).
- F-6: moving the `.agenda-card` caveat into the Problem section. It stays in section 4 and Alternative H.
- F-21: the `SearchIndex` column element types are described, not fully typed.
- F-32: only the line-number references, pixel values and size estimates that the reviewers named were removed.
  **Target:** `docs/designs/staff-search.md` (full file, lines 1-793)
  **Findings from:** `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`, `intermediate_zoom_out_report.md`, `implementation_readiness_report.md`. Item ids below (`F-`, `D-`, `C-`, `X-`) are new; each lists the report items it covers.

## How I classified

I wrote this design, so I treated a wish to contest as no evidence. Almost every finding is valid.

- **ESCALATE (D-1 to D-7):** the finding is valid, but it has more than one lawful fix and the choice is yours (scope, or a product decision). I did not fix these. The skill's wording of ESCALATE is narrower (a critique that is inaccurate because of evidence the reviewer could not read). I used it for choices only you can make, since each of these shapes many other fixes.
- **PROPOSE FIX (F-1 to F-36):** the critique is valid and I have a concrete edit. Items marked _conditional_ change or disappear depending on a D-item.
- **CONTEST (C-1, C-2):** part of a finding is inaccurate, with evidence a reviewer could read.
- **DECLINE (X-1 to X-3):** nits I will not fix.

Severity is the highest any reviewer gave, unchanged.

## ESCALATE: decisions only you can make

### D-1. [`zoom-out`, `implementation-readiness`] Severity: Major. Split into two designs?

- **Covers:** zoom-out 1 #8, #9; Stage 8 B5, B6; Stage 9 (Stage 3 ships an 8x window before Stage 4's index).
- **Affected Scope:** lines 20-28, 626-793.
- **Discrepancy:** five features plus a cross-cutting rewrite in one design. Stages 1 and 2 are small root-cause fixes; Stages 3 to 5 are the Spotlight feature, and the request never says which of filters, recents and grouped cards are required. The 168-line implementation half also carries line-number tables that go stale.
- _**AI Suggestion:**_ ESCALATE
- _**Justification:**_ This is the biggest scope decision and it changes how many other items matter.
- _**Options:**_
  - **(a) Split.** Design A: highlighter, phone reading, and a minimal fix for the missed visit and stale window (range query, refresh-on-open). Design B: Spotlight sheet, filters, chips, recents, grouped cards. This file becomes Design B (or A) and the other is a new file; the Detailed Implementation half moves to per-stage PR plans. My recommendation.
  - **(b) Keep one design** and apply every fix inside it. Larger document; the D-2 to D-5 cuts still apply.

### D-2. [`design`, `zoom-out`, `comprehension`, `implementation-readiness`] Severity: Blocker. Freshness: long-lived listener, or refresh on open?

- **Covers:** critic B1 (window never re-anchors), M7 (listener strawman, 20-minute detach), M8 cost row; Stage 8 B1, B2; zoom-out 1 #3; comprehension 6, 7, 9; Stage 9 B5 (part), M4, M5.
- **Affected Scope:** lines 117, 356-398, 503-505, 689-698, 782-784.
- **Discrepancy:** the listener fixes its range when it attaches, so a tablet left open for days never rolls forward (Blocker). The doc never weighs the cheaper option (keep the one-shot read, re-read when the pool is older than N minutes), the 20-minute detach adds cost in the 20 to 30 minute band, the 30-minute billing claim has no source, and the live adapter cannot reuse `observeQuery` as described.
- _**AI Suggestion:**_ ESCALATE
- _**Justification:**_ Both routes work; they differ in complexity by roughly a store, a port bundle, an adapter rewrite and a lifecycle. By the doc's own numbers the cost is US$0.003 a load (lines 373-383).
- _**Options:**_
  - **(a) Refresh on open.** Replace the count query with the date-range query, and re-read when the pool is older than N minutes. Drop the listener, re-anchoring, detach, `stale`, partial-load handling, `AppointmentRangePorts` and `StaffSearchStore`. Add one Alternatives entry with numbers. My recommendation.
  - **(b) Keep the listener** and take the fixes the critics asked for: re-attach when the shop date changes (once a day, about 4,800 reads), name the first-paint behaviour, verify the 30-minute billing claim before fixing 20 minutes, and write the adapter's merge helper.

### D-3. [`design`, `zoom-out`] Severity: Major. Keep or cut "search older"?

- **Covers:** critic M9; zoom-out 1 #5; Stage 9 M5 (part).
- **Affected Scope:** lines 77-79, 135-138, 177-183, 371, 689-693.
- **Discrepancy:** the step reads 60 days per tap (a visit 200 days back takes about 3), has no cap or end-of-data rule, merged rows are not live, and the client card already has a paged history.
- _**AI Suggestion:**_ ESCALATE
- _**Options:**_
  - **(a) Cut from v1.** Remove CUJ 5, the Goal 3 sentence, `readAppointmentRange`, `olderRange`, `olderReached`, and the Open Question; add a sentence that older visits are reached from the client card. My recommendation.
  - **(b) Open the client card** instead of widening the sheet (answers the Open Question; smaller than keeping the step).
  - **(c) Keep it** and specify taps, cap, end-of-data and where merged rows live.

### D-4. [`zoom-out`, `design`, `comprehension`] Severity: Major. Keep the typed `barber:` hint parser?

- **Covers:** critic M11; zoom-out 1 #7; comprehension 12 (D3's third entry has no home); Stage 9 M6 (part).
- **Affected Scope:** lines 21-22, 118, 168, 314-318, 578-583, 718, 743.
- **Discrepancy:** the doc calls it a hidden extra, yet a pure system cannot hold locale key tables (Law 8, Law 10), and making it work needs a `names` contract, a locale-aware key table, multi-word and ambiguity rules.
- _**AI Suggestion:**_ ESCALATE
- _**Options:**_
  - **(a) Cut.** Chips and suggestions cover the need. Remove the parser, the `barber:` half of CUJ 3, D3's second and third entries, the hint i18n keys and `queryHints`. My recommendation.
  - **(b) Keep** and define `names` (service, barber and status lists with locale labels passed in by the store), the key table location, and the hint grammar.

### D-5. [`zoom-out`, `design`] Severity: Major. Which extras stay in v1: facet counts, incremental `patch`, `SearchWindowSystem`, `SearchRecentsSystem`?

- **Covers:** zoom-out 1 #7; Stage 8 B4; critic N6 (patch contradiction, facets signature); Stage 9 M6.
- **Affected Scope:** lines 320-336, 344-354, 454-458, 719-721.
- **Discrepancy:** by the doc's own figure (line 531) one scan of about 4,800 visits is a few milliseconds, so `patch` is premature and contradicts "rebuilt only when the window changes". Facet counts are the hardest algorithm and exist for "(4)" beside a suggestion; the two small systems wrap a date subtraction and an eight-line dedupe.
- _**AI Suggestion:**_ ESCALATE
- _**Justification:**_ Goal 5 says suggestions "show how many visits each would keep", so dropping counts changes a stated goal. The other three are internal.
- _**Options:**_
  - **(a) Trim all four.** Drop `patch` (rebuild per window change), offer suggestions from the distinct values in the text-matched set with no counts, put the window constants beside the store and call `BookingPolicy.horizonEndFrom`, and make recents a small function. Remove "counts" from Goal 5. My recommendation.
  - **(b) Keep counts, trim the other three.** Fix the `facets` signature (the filters cannot be lifted from an already-filtered `kept`: pass `index, read, filters`).
  - **(c) Keep all four** and fix the contradictions only.

### D-6. [`implementation-readiness`, `codebase-details`] Severity: Blocker. What does a result card show?

- **Covers:** Stage 9 B4 (and cd-M7, cd-M8); critic M2 (card naming).
- **Affected Scope:** lines 24-25, 88-90, 430-439, 593-602, 732-737.
- **Discrepancy:** `visitRowOf` builds a services-led card: time, shop, party, barber and the booker's `quote`. It never emits the client name, phone, e-mail or note lines, which CUJ 1 needs marked. `StaffEventLine.parts` already exists, so `lineRuns` is redundant, and `lib-visit-list` already provides sections, headings and a paging foot.
- _**AI Suggestion:**_ ESCALATE
- _**Justification:**_ This is a product choice about what a search hit looks like, and it decides the Stage 5 file list.
- _**Options:**_
  - **(a) Extend the row.** A search row adds up to four lines (client name, phone, e-mail, note), shown only when the query matched them, as `StaffEventLine`s with `parts`; the title stays the services; add only `titleParts`. Mount the results in `lib-visit-list` sections. My recommendation.
  - **(b) Client name as the title** for search rows, with the services as a line.
  - **(c) Skip the card.** Keep a compact search row like today's, with marked fields, and drop the event-card goal.

### D-7. [`comprehension`, `design`, `implementation-readiness`] Severity: Major. Date filters

- **Covers:** comprehension 12; critic N1; Stage 9 M7.
- **Affected Scope:** lines 82-86, 407-415, 714, 718-722.
- **Discrepancy:** Goal 5 promises "a chosen day or range", but no picker or DS element exists, "this week" is undefined, and no system produces a `WHEN` filter from `ShopNow`.
- _**AI Suggestion:**_ ESCALATE
- _**Options:**_
  - **(a) Presets only.** Today, Tomorrow, This week, where "this week" = today plus the next 6 days. Delete "a chosen day or range" from Goal 5, and add a `SearchFilterSystem.whenOf(preset, shopNow)`. My recommendation.
  - **(b) Add a picker.** Needs a DS date element and a Stage 5 row.

## CONTEST

### C-1. [`design`, `critic B2`] Severity: Blocker (sub-part only). A kill-switch and per-device read thresholds

- **Affected Scope:** lines 503-505, whole document.
- **Discrepancy Description:** B2 asks for success criteria, "a threshold (for example, a maximum reads per device per day) and the means to turn the listener back into a one-shot read without a deploy".
- _**AI Suggestion:**_ CONTEST (this sub-part only; the rest of B2 is F-14)
- _**Justification:**_ `CLAUDE.md` §0 states no production users, and lines 373-383 put the whole shop's cost at US$0.45 to US$1.80 a month. The repo has no remote-config mechanism, and a revert PR does the same job. I keep the failure-mode and security statements. I do not change B2's severity.

### C-2. [`zoom-out`] Severity: Nit. "Parallel arrays" versus Law 3

- **Affected Scope:** lines 320-324.
- _**AI Suggestion:**_ CONTEST
- _**Justification:**_ Law 3 says "prefer linear `for` scans over flat struct arrays" and §0 says "flat arrays, no hidden-class churn". Parallel typed columns scanned linearly are the flat-array form of that rule, not a violation. I will add one clause saying so (F-36).

## PROPOSE FIX

### F-1. [`comprehension 1`, `critic M13`] Severity: Blocker. How text terms and the phone reading combine

- **Affected Scope:** lines 283-285, 326-330.
- **Description:** for `088 333` the terms are `088` and `333` plus a phone reading; ANDed, `088` matches nothing, so CUJ 1 fails. `Иван 088` is undefined.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ One rule resolves both.
- _**Proposed Edit:**_ In §2 after the phone table, add: "_Terms and number._ The typed text is split on spaces. A run of consecutive tokens that are phone-shaped (digits, `+`, `-`, `(`, `)`) and hold at least 3 digits in total forms the phone reading, and those tokens are not text terms. Every other token is a text term. A visit must match every text term and, when a phone reading exists, the phone reading. `088 333` is one phone reading and no terms; `Иван 088 333` is the term `Иван` and one phone reading." Add the same sentence to `SearchFilterSystem.keep` (line 328) and a mixed-query case to the Stage 4 spec.

### F-2. [`implementation-readiness B2`, `codebase-details B1`] Severity: Blocker. `0088 333` contradicts the plan's own rule

- **Affected Scope:** lines 75-76, 149-150, 295, 676, 751.
- **Description:** `00` → `+` makes `0088 333` read as international `88333`, which cannot start `35988333…`. The code behaves the same way. Only `00359 88 333` equals `088 333`.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Replace `0088…` with `00359 88 333` in Goal 2 (line 76), CUJ 1 (line 149), and the e2e (line 751). In the phone table (line 295) the example becomes `00359 88 333`, `0044…`. Add under the table: "`00` always means `+`. `0088 333` therefore reads as the number `+88 333` and finds a visit only if some stored number starts with `88333`." Give every Stage 2 spec row an expected output: `0088…` → international `88…`, `+0088…` → `NONE` (a `+` followed by `00` is not a number), and so on.

### F-3. [`implementation-readiness B2`, `codebase-details M3`, `critic N`, `comprehension 13`] Severity: Blocker. `PhoneReading` shape

- **Affected Scope:** lines 292-305, 675-683.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - Add the row `3 bare digits | a bare run | the code + the run, else the run anywhere`, and change line 299 to "under 3 digits: none". State that this lowers the bare-run threshold from the doc's "4+" to the existing `MIN_PHONE_DIGITS` (3).
  - Replace the `PhoneReading` description (line 675) with: `PhoneReading` is a flat component in `@core/components` (`phone-reading.data.ts`): `{ phoneReadingKind: PhoneReadingKind; phoneReadingCandidates: readonly string[] }`, `PhoneReadingKind` an `as const` dictionary (`INTERNATIONAL`, `BARE`, `NONE`). `BARE` carries two candidates, `[code + run, run]`; `INTERNATIONAL` carries one. This matches `phoneInternationalDigits` today.
  - Add to the `phone.system.ts` row and its spec row: `PhoneSystem.readingMatches(reading, storedDigits): boolean` is true when the stored digits start with any candidate (INTERNATIONAL) or the first candidate starts, or the second appears anywhere in, the stored digits (BARE). `NONE` never matches.
  - State that `searchDigitsOf` takes the calling code, so the reading needs no extra field.
  - Decide the `+` marking: `phoneSegments` marks from the first digit, so `+359 88 333` marks `359 88 333` (the `+` stays unmarked, as in `client-query.system.spec.ts`). Change Stage 2's expected mark at line 681 to match.
  - Name `staff-visit-editor.ts:3981` in the Stage 2 file list, and say what `phoneAsTyped` receives (`parsed.phoneTyped` plus the reading's first candidate).

### F-4. [`zoom-out 1 #2`, `Stage 8 B3`] Severity: Major. Build on `ParsedClientQuery`, drop the `PHONE` filter variant

- **Affected Scope:** lines 274, 283-285, 301-305, 714, 718.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ `ParsedClientQuery` and `phoneInternationalDigits` already exist (`client-query.system.ts`); a third parse shape duplicates them.
- _**Proposed Edit:**_ State that `SearchQuerySystem.read` builds on `ClientQuerySystem.parse` (`ParsedClientQuery`) and returns the terms plus `PhoneReading`, with no second parser. Delete the `PHONE` variant from `SearchFilter` (line 274) and from the Stage 4 dictionary (714): the phone reading is part of the query, not a filter. Rename `ClientQuerySystem.phoneInternationalDigits` as the single delegating caller of `PhoneSystem.searchDigitsOf` (also fixes the naming drift in D6).

### F-5. [`critic M1`] Severity: Major. CUJ 1 describes the rejected in-field rewrite

- **Affected Scope:** lines 147-150.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Replace "The field reads `+359 88 333` as the user types, and the result list shows" with "A top suggestion row reads `Телефон +359 88 333…`, and the result list shows".

### F-6. [`critic M2`, `zoom-out 1 #10`] Severity: Major. Which card the results use

- **Affected Scope:** lines 24-25, 61-64, 88-90, 430-439.
- _**AI Suggestion:**_ PROPOSE FIX (the card's contents are D-6)
- _**Proposed Edit:**_ Overview 4: "Results are event cards (`lib-visit-row`, the same family as the agenda's event head), grouped under date headings." Goal 7: replace "the agenda's event card (`lib-staff-event-head`, regular size)" with "`lib-visit-row` event cards in its staff layout". Line 431-432: replace "looks exactly like the same visit in" with "uses the same event-head family as". Move the `.agenda-card` caveat from line 435-439 into the Problem section and Alternative H, and delete "I have not planned that".

### F-7. [`critic M3`] Severity: Major. Cross-references

- **Affected Scope:** lines 100, 111, 131, 312, 489, 752.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ line 100: "see Alternative A"; line 111: "The reasoning is in Technical Plan sections 2 to 5"; lines 131 and 489: "the table in Technical Plan section 6"; line 312: "(Alternative E)"; line 752: "D1 to D6".

### F-8. [`critic M4`, `comprehension 16`, `Stage 9 M18`] Severity: Major. Conversation-dependent wording and process notes

- **Affected Scope:** lines 4, 30-34, 53, 58-60, 109-111, 120, 125-128, 138, 439, 519-521, 574, 580-581, 587, 756.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Delete the "How this draft was made" paragraph (30-34) and the `design_draft.md` row (756). Change line 4 to `Status: Proposed`. Retitle the H2 "Decisions"; change "These are the choices you left to me" to "Choices without an explicit owner ruling; each can be reversed". Replace "You asked for…", "you ruled out", "which you ruled out" and "because you asked for one highlighter" with "Owner requirement (2026-11-03): …". Delete the revision-history parenthesis at lines 58-60. Reword lines 519-521 to "Each option below lost for the reason given; the reopen condition says what would change that." Open Questions may keep addressing the owner. Add one line to The Problem saying how often search misses (or that it is unmeasured).

### F-9. [`critic M5`] Severity: Major. Horizon, cap and "every future visit"

- **Affected Scope:** lines 77-79, 125-128, 349-354, 365.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Goal 3: "finds every visit from now to the booking horizon, up to the cap, and the past 60 days". Delete the 120-day Open Question (the policy has `horizonMonths`, default 2). In §3 add: "A longer horizon costs proportionally more reads and memory (12 months ≈ 14,600 visits at 40 a day, past the cap); the cap then truncates to the nearest ~75 days and the footnote says so." Fix the cost table: 60 back + 60 ahead ≈ 4,800 at the default; say it once. Use one name for the flag (`capped`), one for the horizon ("booking horizon").

### F-10. [`critic M6`, `Stage 9 B3`, `style-1`] Severity: Major. Word-start versus anywhere marking

- **Affected Scope:** lines 70-72, 185-191, 337-342, 652, 778-781.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ The code already settles it: `nameSegments` marks word beginnings, `TextMatchSystem.segments` marks anywhere.
- _**Proposed Edit:**_ `TextMatchSystem.segmentsAny(text, terms, matchMode)` takes a `MatchMode` dictionary (`ANYWHERE` or `WORD_START`). `nameSegments` calls it with `WORD_START`; the service list and the schedule search use `ANYWHERE`. Goal 1: "one match-marking system" replaces "the three older copies are deleted". CUJ 6: "same look" (same wash, padding, corner, selected-row behaviour), not "same behaviour". Replace the Stage 1 `client-query.system.ts` row hedge and the first Risks bullet with this one statement.

### F-11. [`Stage 9 B3`, `codebase-details M4`] Severity: Blocker. Other marking copies

- **Affected Scope:** lines 337-342, 650-652.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Add: "`ClientQuerySystem.phoneSegments` and `emailSegments` (called at `visit-client-row.presenter.ts:68, 76`) are replaced by `TextMatchSystem.phoneSegments` and `segmentsAny`, keeping their candidate-priority behaviour (a spec pins today's output first). Their callers move in Stage 1." Move `TextSegment` to a neutral file in `@core/components` to avoid the type-only import cycle between `text-match.system.ts` and `client-query.system.ts`.

### F-12. [`critic M8`, `Stage 9 B5`] Severity: Major. The add-client page shares the window

- **Affected Scope:** lines 54-60, 361-371, 481-489, 701.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Line 54-56: "The only callers of `reloadSearchPool` are `openSearch` and `ensureWindow`, the second used by the add-client page («Скорошни»)". Add a read-table row: "Add-client page first opened → same window load, shared." Add a row to §6: «Скорошни» keeps "nearest to now" semantics, now over the range, and says so.

### F-13. [`critic M10`] Severity: Major. Location-scope claim

- **Affected Scope:** lines 107, 395-398.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ `firestore.rules:297` lets every `worksTheBook()` role read every appointment, and a `locationId` filter would need a composite index (contradicts line 257).
- _**Proposed Edit:**_ Replace "Nothing outside the shop's own location scope is read" with "The queries read every appointment in the date range that the signed-in role may read (`firestore.rules`: barbers, receptionists and admins read all appointments). A barber therefore searches all barbers' clients' names, phones and e-mails." Do not add a location filter.

### F-14. [`critic B2`] Severity: Blocker. Risks and Mitigations

- **Affected Scope:** lines 491-513, 776-793.
- _**AI Suggestion:**_ PROPOSE FIX (C-1 excluded)
- _**Proposed Edit:**_ Add one H2 "Risks and Mitigations" before Alternatives, merging Cross-cutting (491-513) and "Risks the implementer should watch" (776-793) into one table: failure modes (listener or range-read error, partial first paint, `localStorage` unavailable), security (what a staff device holds, the F-13 statement, behaviour if the rules deny the range query: the sheet shows the "may be out of date" or empty state, no crash), scalability (the cap and the horizon, F-9), mitigations beside each. Keep it to a few lines each. Failure rows for listener behaviour apply only if D-2(b).

### F-15. [`zoom-out 1 #1`] Severity: Blocker (resolved by the merge in code). Name the prerequisite

- **Affected Scope:** line 337, 45-49.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Line 337: "`TextMatchSystem` (merged in PR #20, commit `0926913d`, which this work builds on) gains…". In The Problem, "the service list now has" → "the service list has". Stage 1 `Depends on:` → "PR #20".

### F-16. [`Stage 9 M1`, `codebase-details M1`] Severity: Major. Stage 1 leaves existing specs failing

- **Affected Scope:** lines 628, 646-670.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Add to the Stage 1 table: `staff-dashboard.spec.ts` (replace `.staff-search__mark` at ~4120 and update the `staff-search-hit`, `-headline`, `-sheet` cases at ~4103-4143 and ~5439-5474 so they pass until Stage 5), `staff-visit-editor.spec.ts` (`.staff-event-head__hit` at ~3974, 3995, 4021 → `ui-marked-text`), and a check of `stylesheets.spec.ts` for `.staff-visit__mark`. Add these ranges to the Stage 3 and Stage 5 spec rows too.

### F-17. [`critic N3`, `Stage 9 M2`, `codebase-details M13`] Severity: Major. The mark token and the wash guard

- **Affected Scope:** lines 120, 467-476, 585-591, 658-659.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Replace the line 659 row with `libs/ui/tokens/src/lib/accent-rule.spec.ts`: add the mark to `WASHES` (line ~184) and its stylesheet to the target's inputs in `project.json`; state the revised contrast floors (re-measure the worst ink contrast at 28% light and 40% dark; if it falls below 14.5 and 9.7, lower the mark to a single `--sys-alpha-segment-selected` rung, which needs no new floor). Put `--sys-color-mark` in `theme-light.css` and `theme-dark.css` beside `--sys-alpha-segment-selected`, not `tokens.css`. Add to D5: "This deviates from `styling-conventions.md` ('a tone wash is the tone at `--sys-alpha-tint`'); the exception is recorded in `docs/design-research/decisions.md`." Say "alpha rung" once, with a definition.

### F-18. [`Stage 9 M3`, `codebase-details M5`] Severity: Major. `VisitGrain.Day` and the grouping

- **Affected Scope:** lines 440-446, 722, 743.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ `sections()` files every upcoming visit under one key, so future days cannot get their own headings from `sectionKeyOf(Day)`; `VisitGrain` has about 84 usages.
- _**Proposed Edit:**_ Do not extend `VisitGrain`. Add a `DayBucket` dictionary (`TODAY`, `TOMORROW`, `LATER`, `PAST`) in `visit-list.data.ts` and `VisitListSystem.dayGroups(visits, today)` returning keyed day groups (a key per future local date, a single `PAST` key for earlier days). The headings are «Днес», «Утре», weekday and date for later days, and one «По-рано» for the past (change Goal 7 to match). List the files: `visit-list.system.ts`, a new `day-bucket.data.ts`, and the i18n heading keys.

### F-19. [`Stage 9 B5`, `codebase-details M9`] Severity: Blocker. Stage 3 store continuity

- **Affected Scope:** lines 685-703.
- _**AI Suggestion:**_ PROPOSE FIX (_conditional_: if D-2(a), this becomes a much smaller edit to `staff-day.store.ts`)
- _**Proposed Edit:**_ If the store is kept: keep `searching`, `term`, `setTerm`, `closeSearch` on `StaffDayStore` until Stage 5, and in Stage 3 add only the window. List the missed bindings (`staff-dashboard.html:309, 349`; `staff-dashboard.ts:1031-1032, 1059, 1062`), the store's inputs (policy via `SCHEDULING_READ_PORTS.observePolicy`, `today`, zone, clock, log port), its provider scope, and say that «Скорошни» awaits `ensureWindow()` through the same store. Use `open()` consistently.

### F-20. [`Stage 9 M4`, `codebase-details M10`] Severity: Major. Live-range adapter

- **Affected Scope:** lines 691-697.
- _**AI Suggestion:**_ PROPOSE FIX (_conditional_ on D-2(b); moot under D-2(a))
- _**Proposed Edit:**_ Add: a new `observeRawQuery` helper in `observe.ts` returns raw snapshots; the adapter combines the two with `combineLatest`, runs `keepAdmitted` over the pair, and reuses `subscribeWithRetry`. `capped` = either raw side returned its cap. Register both as `LazyMethod.Observable` and `LazyMethod.Promise`. Extend `scheduling.port.contract.ts`.

### F-21. [`Stage 9 M6`, `M10`, `M11`] Severity: Major. System and VM shapes

- **Affected Scope:** lines 718-720, 732-733.
- _**AI Suggestion:**_ PROPOSE FIX (_conditional_ on D-4, D-5)
- _**Proposed Edit:**_ Add a "Shapes" block: `ReadQuery { queryTerms: readonly string[]; queryPhone: PhoneReading }` (hints gone under D-4(a)); `SearchIndex` as columns `{ foldedClient: readonly string[]; foldedService: …; phoneDigits: …; … }`; `names` as `readonly { id: string; label: string }[]` per kind; `facets` result as `{ barbers; services; statuses; dayBuckets }` of `{ id; count }[]`; the companion-name and unnamed-client inputs to `build` (passed in as plain strings by the presenter's caller); a `fold` function exported by `TextMatchSystem`. `SearchSheetVm` gets `searchSheetState` (dictionary `IDLE`, `RESULTS`, `EMPTY`), typed `chips`, `recents`, `phoneReading`, `footnote`; `SearchGroupVm.rows` is `AppointmentRowVm`. `SearchInput` gains `callingCode`.

### F-22. [`critic N2`, `Stage 9 M8`, `Stage 8`] Severity: Major. Recents persistence

- **Affected Scope:** lines 119, 454-458, 506-508, 739.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Reuse the `agenda-fields.ts` `localStorage` pattern. Add `SearchQuery.parse(raw): Result<SearchQuery, SearchQueryError>` (Law 7) as the guard when reading; a corrupt entry is dropped. Drop "cleared when the staff member signs out"; say "per device, cleared by «Изчисти»".

### F-23. [`zoom-out 1 #6`, `codebase-details M6`] Severity: Major. Use `uiChip`, not a new `ui-search-token`

- **Affected Scope:** lines 447-449, 729-731, 743.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ `libs/ui/controls/src/lib/chip/chip.ts` is documented as a removable token (trailing ✕); `styling-conventions.md` says extend, never copy beside.
- _**Proposed Edit:**_ `ui-search-field` takes chips through `uiTokens` rendered as `button[uiChip]`. Delete the `ui-search-token` rows (730-731) and use `uiChip` for the idle suggestions. Rename the input to `uiTokens` consistently and use "chip" throughout (one term).

### F-24. [`codebase-details M7`] Severity: Major. Reuse `lib-visit-list`

- **Affected Scope:** lines 732-738.
- _**AI Suggestion:**_ PROPOSE FIX (_conditional_ on D-6)
- _**Proposed Edit:**_ Mount results in `lib-visit-list`, mapping day groups to `VisitSectionVm` (state its `detail` and `testId`). «Търси по-назад» disappears under D-3(a); under D-3(c) it is the existing `loadMore` foot. Delete `SearchGroupVm`.

### F-25. [`Stage 9 M12`, `codebase-details M2`] Severity: Major. Directory lookup (Stage 2 row 683)

- **Affected Scope:** lines 488, 677, 683.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Delete row 683 and change §6's directory row to "unchanged: `lookupKeys` / `phoneLookupVariants` already produce `0…` and `359…` forms". Add `phoneLookupVariants` (`client-query.system.ts:376`) to Stage 2's list as a further delegating caller of `searchDigitsOf`, and name it where line 677 says "the second copy of the rule goes".

### F-26. [`Stage 9 M13`, `M11`] Severity: Major. Stage ordering

- **Affected Scope:** lines 633-640.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Stage 2 depends on 1; Stage 3 on 1 and 2 (shared files `staff-search.presenter.ts`, `staff-dashboard.html`, `staff-dashboard.ts`); Stage 4's summary drops "window" (delivered in 3).

### F-27. [`Stage 9 M14`, `codebase-details M16`] Severity: Major. `admin-rhythm-sheet`

- **Affected Scope:** lines 129-131, 744.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Remove the Open Question. State: `admin-rhythm-sheet.html:23-35` is a services search filtering by `servicesSearch`; it adopts `TextMatchSystem.segmentsAny` and `ui-marked-text` in Stage 5 (files: that html, its ts, its spec).

### F-28. [`codebase-details M14`, `M15`] Severity: Major. Showcase wiring and phantom edits

- **Affected Scope:** lines 668, 731, 742, 754.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Add `apps/showcase/src/app/app.routes.ts` and `controls.page.ts`'s `links` to the Stage 1 row. Replace "the field's existing showcase page" with "a new `search-field` showcase page". Delete the `staff-day.presenter.ts` / `staff-day.vm.ts` row (no search words or types there). Fix the docs row to the files that actually name `searchHits`, `splitOnTerm` or `staff-search.presenter.ts`: `docs/architecture/flips/f-08-dashboard-wording.md`, `docs/architecture/review/f08-dashboard-inventory.md`, `docs/architecture/flips/pass-d-brands-shapes.md`, `docs/design-research/staff-visit-editor-design.md`.

### F-29. [`Stage 9 M9`] Severity: Major. Stage 5 tests

- **Affected Scope:** lines 729-731, 738-739.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ List cases for `search-field` (chip render, Backspace removes last chip and announces it, focus order), `staff-search-sheet` (debounce, chip add/remove, recent save, `openHit`), and a `staff-search.store.spec.ts` row (query, recents round trip, corrupt storage). Define `uiTokenActivate` as "opens the chip's edit list"; if undefined, delete it. Name the `ui-marked-text` input `uiRuns`.

### F-30. [`Stage 9 M18`, `style`] Severity: Major. Unmeasurable or self-contradicting plan text

- **Affected Scope:** lines 652, 743, 744, 753, 785-793.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Line 785: "If a shop's real daily volume exceeds 50 visits (3,000 per side over 60 days), the cap shortens the window". Replace the "Rename churn" bullet with "**Specs replaced, not adapted.** `SearchHitVm` and `searchHits` have specs of their own; the rewrite replaces them and carries the old expectations over case by case." Replace `(if present)` with the real spec path `libs/infrastructure/i18n/src/lib/catalogue-parity.spec.ts`. Reword the hedged instructions at 652 and 753 as decisions (652 is F-10; 753: "Add one line pointing at the ADR"). Add `visit-row.css` to the Stage 5 table or reword the visit-row bullet.

### F-31. [`critic N6`, `Stage 8`] Severity: Nit. Spec/Detailed contradictions

- **Affected Scope:** lines 326-336, 440-449, 493-495, 719-722, 729.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ After D-5, state one `facets` signature (`index, read, filters`), one rebuild rule, `DayBucket` (F-18) in §4 in place of `byLocalDate`/`dayOffset`, `uiTokenActivate` in §4 if kept, and `capped` throughout.

### F-32. [`zoom-out 1 #9`, `Stage 8 B6`, `critic`] Severity: Major (altitude). Stale line references and pixel values in the implementation half

- **Affected Scope:** lines 626-793, 363-383.
- _**AI Suggestion:**_ PROPOSE FIX (_conditional_ on D-1(b); under D-1(a) the whole half moves out)
- _**Proposed Edit:**_ Replace "about line", "near" and range line references with symbol names; drop pixel values (3px, 1px, 36px) in favour of the token names; remove "about 90 lines"/"about 150 lines" estimates; correct line 699 to about 60 lines; line 700 to "remove the double at line 189" only; and keep the `eslint.config.mjs` ratchet in Stage 6 with a one-line definition ("`max-lines` cap lowered to the file's new length").

### F-33. [`critic M14`] Severity: Major. Unmeasured performance claims

- **Affected Scope:** lines 493-497, 530-533.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ "a few milliseconds" → "expected to take a few milliseconds; the spec asserts a bounded number of comparisons per keystroke". Delete "A few megabytes" or give 4,800 × ~8 folded fields × ~40 bytes ≈ 1.5 MB. Delete "The greenfield stance of the repo favours fewer moving parts" (CLAUDE.md §0 does not say it). Remove the "10,000 synthetic visits … operation counts" spec (a pure function exposes none) and use a sized fixture with a timing smoke check outside the unit suite.

### F-34. [`critic N4`, `N5`, `N13`, `N14`] Severity: Nit. Wording and sentence fixes

- **Affected Scope:** lines 12, 22-23, 44, 62-66, 199, 287-290, 376-383, 388, 511, 556-557, 532.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Line 511: "components → entities → systems; ports → pipelines → store (no upward import)" (Law 8). Line 287-290: replace the ITU E.164 citation with "as libphonenumber and the add-client page already treat it". Replace the subjective phrases ("small and plain", "look like a different app", "The trade is plain", "The obvious fix", "a count is not a promise", "nobody has to know it", "the service's ranking power buys nothing", "joining pieces", "reads a typed number correctly") with the measurable fact. Line 255-256: "Only the store calls the ports; it alone touches `localStorage`."

### F-35. [`critic N7-N11`, `comprehension 14`, `18-20`] Severity: Nit. Structure and terminology

- **Affected Scope:** lines 135-138, 158-168, 197, 210, 212-247, 266-275, 281-342, 402-428, 459, 491, 519-523.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Rename §2 "Reading and matching what was typed"; add a one-line systems list in "Shape of the solution"; number or letter the unnumbered H3s; move the rejected "re-read after every write" and "open the client card" options into Alternatives; add "Reopen if" to C, D, F, G, I, K (or soften the intro); tag the two untagged code fences (`ts`, `text`); add `SearchRecentsSystem` to the diagram if it stays; remove the `Win2 --> FS` arrow; make the sheet "two regions (idle, results) plus an empty-result state"; use «Бръснар» in CUJ 3 and give CUJ 2 a Service group; merge table rows 367-368; link `CLAUDE.md` once instead of defining internal symbols.

### F-36. [`Stage 9 nits`, `style`] Severity: Nit. Detailed Implementation nits

- **Affected Scope:** lines 631-640, 654-655, 663, 678, 699-700, 722-723, 743, 750-751, 755, 767-774, 782-784.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ One consistent file-path style (repo-relative paths, not bare names); list `search.fixtures.ts` once; correct "D1 to D7" (done in F-7); note seed rows that already exist (cancellations, no-shows, notes, «Николай Иванов») and add only a visit about 24 days ahead; use `signInAs(page, uid, roles)` in the e2e; state the `waitUntil: 'commit'` constraint and why; name the emulator request-log method or use the document-read counter; replace "Browser pane" with "the in-app browser"; "hidden 19 minutes keeps it, 21 detaches" → "stays attached after 19 hidden minutes; detaches after 21" (D-2(b) only); add the clock and phone icons to the Stage 5 icon-registry step; add that `ui-marked-text` uses `ViewEncapsulation.None` with CSS in `@layer sys-components`; and add the C-2 clause ("parallel columns scanned linearly are the flat-array form of Law 3").

## DECLINE

- **X-1.** [`comprehension 18`] A glossary of internal symbols and Bulgarian strings. A human reader of this repo knows them; F-35 links `CLAUDE.md` once instead.
- **X-2.** [`critic N15`] The "40 visits a day" source. It is a code comment's estimate and the doc already says so (line 365).
- **X-3.** [`Stage 9 cd`] Update `HANDOFF.md` only "if the file lists live decisions" (line 753): resolved inside F-30 as a plain one-line pointer; no further change.

## Counts

- 7 ESCALATE (D-1 to D-7), 36 PROPOSE FIX (F-1 to F-36), 2 CONTEST (C-1 to C-2), 3 DECLINE (X-1 to X-3).
- Dependencies: D-1 scopes the whole file; D-2 drives F-19, F-20, F-36; D-3 drives F-24; D-4 and D-5 drive F-21 and F-31; D-6 drives F-6 and F-24; D-7 drives Goal 5.
