# Stage 8: Intermediate Zoom Out Review

Target: `docs/designs/staff-search.md` (lines 1-793, full file)
Reviewer: `egm-zoom-out` (Mode: REVIEW), second pass
Inputs: `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`, `CLAUDE.md`, `docs/styling-conventions.md`
Tree state: `origin/main` merged (commit `44318d0f`). The design doc has not been edited since the first zoom-out pass, so none of the Stage 6 or Stage 7 fixes are in it yet. The reviewer judged the fixes those reports ask for, not applied edits.

## Verdict

Still do not pass as one design. The objective and root problem are clear, so context sufficiency is met. The root-cause fixes are still small: the `088…` phone bug and the count-based, never-refreshed window.

Taken at face value, the fixes the Comprehension and Critic reports ask for would push the design further into the weeds. Both reports treat the design's own premises as fixed: the long-lived listener, "search older", the hint parser, the capped window, and the six-stage file tables. Many of their findings are consequences of those premises, so cutting a premise closes the findings that follow from it.

Code re-verified on the merged tree:

- `libs/ecs-core/src/systems/text-match.system.ts` exists. It exports only `matches` (line 22) and `segments` (line 32). `segmentsAny` and `phoneSegments` do not exist, so line 337's "gains" is accurate.
- `staff-day.store.ts`: `SEARCH_WINDOW_PER_SIDE = 300` is at 137. `reloadSearchPool` is called at 1785 (`openSearch`) and 1802 (`ensureWindow`). `ensureWindow` is called from `staff-dashboard.ts:3912`. The critic's "two callers" correction (M8/N16) is right and the doc's lines 54-60 are wrong.
- `booking-policy.data.ts:61` has `horizonMonths: 2`, so the Open Question about a 120-day fallback (lines 125-128) is moot.
- `libs/ui/controls/src/lib/chip/chip.ts:12` documents a trailing `ui-icon` as "a removable token's ✕". `uiChip` already covers `ui-search-token`.
- `firestore.rules:297` lets anyone who `worksTheBook()` read every appointment. The doc's "Nothing outside the shop's own location scope is read" (line 396) has no query or rule behind it.
- `localStorage` is already used in `staff-day.store.ts` and `agenda-fields.ts`, so recents have a precedent.

## A. Which requested mitigations are proportionate

### Keep (cheap, and they fix real contradictions)

| Item                                                                                                                                       | Why it is proportionate                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M13 / Comprehension 1: how text terms and the phone reading combine                                                                        | One sentence. Without it `088 333` fails CUJ 1, which is the live bug. Say that a phone-shaped query uses the phone reading instead of the text terms.                                             |
| M1, M2, M3, M4, N12, N13 (CUJ 1 vs Alternative E, card wording, cross-references, "you" and draft-process leaks, delegating function name) | Wording edits only. Line 756 and the "How this draft was made" paragraph (30-34) should be deleted, not rewritten.                                                                                 |
| M10: location-scope claim                                                                                                                  | Delete or correct line 396 to "reads all appointments the role may read (`firestore.rules:297`)". Do not add a `locationId` filter, because that needs a composite index and contradicts line 257. |
| M12: add the exactly-3-digits row to the phone table (lines 292-299)                                                                       | One row.                                                                                                                                                                                           |
| M5, reduced: weaken Goal 3 to "up to the cap" and delete the 120-day Open Question                                                         | One sentence plus a deletion.                                                                                                                                                                      |
| M6: settle word-start vs "anywhere"                                                                                                        | State that `nameSegments` keeps its word-start rule, or change it. Weaken Goal 1 ("the three older copies are deleted") and CUJ 6 to "same look", not "same behaviour".                            |
| N3: record the mark wash as a deviation from `--sys-alpha-tint`                                                                            | One line. `styling-conventions.md:89` ties a wash to `--sys-alpha-tint`, and the mark uses twice `--sys-alpha-segment-selected`. Name the `accent-rule.spec.ts` guard.                             |
| B2, reduced: a risk list                                                                                                                   | Merge "Risks the implementer should watch" (776-793) and Cross-cutting (491-513) into one short Risks block. A few lines, not a new H2 table.                                                      |
| M7, reduced: one alternative paragraph                                                                                                     | Add "keep the one-shot read, re-read on sheet open when older than N minutes". The doc's own number (about US$0.003 per load) is enough.                                                           |

### Cut

| Item                                                                                                                | Where                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: re-anchoring on date rollover, with its day-roll cost statement and re-attach logic                             | lines 356-362, 387-394, 697              | B1 exists only because of the page-lifetime listener (D2). Without that listener there is nothing to re-anchor. Do not add machinery to repair machinery that should go. If the listener survives the split, one sentence ("re-attach when the shop date changes") is the most it deserves.                                                                                                                           |
| Kill-switch, success criteria, per-device-per-day read thresholds (B2)                                              |                                          | Total cost is US$0.45 to US$1.80 a month by the doc's own figures (lines 373-383). `CLAUDE.md` §0 says there are no production users. A kill-switch needs remote config the repo does not have, and a revert PR does the same job. The attach and detach log lines (503-505) are also unnecessary if the listener goes.                                                                                               |
| First-paint and partial `fromCache` handling for two listeners (B2)                                                 |                                          | Listener-only complexity. A one-shot read has no such issue.                                                                                                                                                                                                                                                                                                                                                          |
| Verify the 30-minute billing claim in a real project (M7)                                                           |                                          | This is the 20-minute detach, `visibilitychange` timer and `stale` footnote again. Drop the detach and the question disappears. Lines 363-371 and 782-784 carry a billing theory that only the listener needs.                                                                                                                                                                                                        |
| M11: define `names`, key tables and locale resolution so a pure system can parse `barber:` / `status:отказан`       | lines 118, 168, 314-318, 718, 743        | The fix grows the weeds. The parser is a hidden extra ("nobody has to know it", line 21). The critic found that it cannot live in a system as written (Law 8 and Law 10), and the cure would add a names contract, a locale-aware key table and ambiguity rules. Cut the parser, D3's third entry point, the `barber:` half of CUJ 3 (line 168) and the hint i18n keys. Chips and suggestions already cover the need. |
| M9: bounding and specifying "search older" (detection rule, per-step cost, cap, re-attach behaviour of merged data) | CUJ 5, lines 177-183, 371, 689, 691, 693 | Specifying it more deeply is the wrong response. Cut it from v1. The Open Question (135-138) already names the cheaper route, which is to open the client card's paged history.                                                                                                                                                                                                                                       |
| N2: name a sign-out hook or key recents by uid                                                                      | lines 456-458, 506-508                   | Drop the sign-out claim. Say "per device, cleared by Изчисти".                                                                                                                                                                                                                                                                                                                                                        |
| M14: justify "a few ms / a few MB", add a budget, or add a measurement                                              | lines 493-497, 530-533                   | Drop the 10,000-visit "operation counts" spec (line 720). A pure function exposes no operation count. Soften the claims to "expected".                                                                                                                                                                                                                                                                                |
| Cost and memory rows for 6- and 12-month horizons (M5)                                                              |                                          | A sentence ("cost scales with the horizon") is enough.                                                                                                                                                                                                                                                                                                                                                                |
| N11 / Comprehension 18: glossary of internal symbols and Bulgarian strings                                          |                                          | Link `CLAUDE.md` once instead of defining `ReadGuard`, `ShopNow` and the rest.                                                                                                                                                                                                                                                                                                                                        |
| N1: date picker for "a chosen day or range"                                                                         | line 83, Goal 5                          | Delete it from Goal 5. Today, Tomorrow and This week are enough.                                                                                                                                                                                                                                                                                                                                                      |

## B. Findings

### 1. Major: the Comprehension and Critic fixes treat speculative premises as settled

**Scope:** B1, B2, M7, M9, M11, N2 of `critic_report.md`; Comprehension 6, 7, 15; lines 118, 361-398, 689-698.

Roughly a third of the combined findings (B1, M7, M8's cost row, Comprehension 6, 7 and 15, B2's first-paint and kill-switch parts) exist only because of the long-lived listener pair and "search older". Applying them in turn adds a re-anchor rule, a rollover cost, a detach-versus-billing study, a merged-data staleness rule and an older-reached detector. Remove the premises first. The first pass's candidate still stands: keep the existing one-shot read and re-read on open when the pool is older than N minutes. That changes `openSearch`'s early return at `staff-day.store.ts:~1784`, which is a few lines and avoids all of the above.

### 2. Major: Stage 3 builds a new store, ports and adapters where a small edit would do

**Scope:** lines 685-703, 361-398.

The critic confirms `ensureWindow` also feeds the add-client «Скорошни» (`staff-dashboard.ts:3912`). The design's answer is `StaffSearchStore`, a new `AppointmentRangePorts` bundle, adapter rewrites, port-double rewrites and an emulator spec. A date-range query replacing the 300-count query, and an age check in the existing `openSearch` / `ensureWindow`, deliver the stated goals (all future visits, a window that refreshes) without the extraction. The shape in lines 212-247 only needs the new store if a listener is kept. Keep the range query, since it is the real fix for the missed booking three weeks out. Drop the rest until the plain version proves insufficient.

### 3. Major: the hint parser and the `SearchQuery` / `SearchFilter` / `ReadQuery` stack still duplicate what exists

**Scope:** lines 260-336, 714-722 (first-pass findings 2 and 7, unchanged).

`ClientQuerySystem` already has `ParsedClientQuery`, `clientQueryShape` and `phoneInternationalDigits`. The design still adds `SearchQuerySystem.read` and `ReadQuery`, and a `PHONE` filter variant that duplicates the phone reading. Neither report asked for these to be removed. Comprehension 12 and the critic's N6 mention only the contradictions among them. Cut the hint parser and the `PHONE` variant. Build `SearchQuerySystem` on `ParsedClientQuery`, or put the phone reading into `ClientQuerySystem` and have the schedule search call it. The Comprehension 1 blocker (terms ANDed with the phone reading) is a symptom of that parallel parse shape.

### 4. Major: first-pass over-build items the critic reports downgraded to "contradictions" are still in the design

**Scope:** lines 320-336, 685-689, 719-722, 729-731.

The critic's N6 asks for the `facets` signature and the rebuild-versus-`patch` contradiction to be reconciled, not removed. Reconciling them locks in more code.

- **`SearchIndexSystem.patch`.** The design says one scan over about 4,800 visits takes a few milliseconds (line 531). Build the index once per window change and delete `patch`. This makes the contradiction go away (Comprehension 10, M14).
- **`facets` with "own filter lifted" counts.** This is the hardest algorithm in the design and exists for "(4)" next to a suggestion. Offer suggestions from the distinct values in the text-matched set. The `facets(index, kept)` signature problem (Comprehension 11) then disappears.
- **`SearchWindowSystem`.** It wraps `BookingPolicy.horizonEndFrom` (`booking-policy.data.ts:252`) and one subtraction. Put the constants next to the store and call `horizonEndFrom` directly.
- **`SearchRecentsSystem`.** It is an eight-line dedupe. Make it a small function beside the `localStorage` read and write.
- **`ui-search-token`.** The critic's reports never carried first-pass finding 6 forward as a change request. Comprehension 17 only asks the doc to "justify" it. `uiChip` already has the trailing-icon removable-token form (`chip.ts:12`). `styling-conventions.md:178` says to extend and never copy. Compose `uiChip` in `ui-search-field` via `uiTokens`. Delete `search-token.ts`, `.css`, `.spec.ts` and the showcase page (lines 730-731).

### 5. Major: the first pass's split recommendation still holds, and is stronger

**Scope:** lines 20-28, 633-640.

Stages 1 and 2 (shared highlighter, phone reading) are root-cause fixes. They share `staff-search.presenter.ts`, so mark them as ordered, not "Depends on: none" (critic's spec/Detailed contradictions, Comprehension 20). Stages 3 to 5 are the filters / Spotlight / chips / recents / grouped-cards feature. The owner's request never says which of those is required. Do not let the added fixes (Risks, success criteria, kill-switch, re-anchoring) grow Stages 3 to 5 further. Recommended split:

- **Design A:** highlighter plus phone reading, plus a minimal fix for the missed visit and the stale window (range query with refresh-on-open). It is a short document.
- **Design B:** Spotlight sheet, filters, chips, recents and grouped event-card results. It takes the cuts in sections 3 and 4 above.

Stage 3 as written also gives the old sheet an 8x larger window before Stage 4's index exists (Comprehension 9). The split removes that regression, because the old path ships with A at 4,800 visits, which is one scan.

### 6. Major (altitude): the design now also invites weed-level edits

**Scope:** lines 626-793 (first-pass finding 9, unaddressed), plus N5, N10, N11, N13, N14 and Comprehension 18-20.

The Detailed Implementation half (168 lines, 626-793) is still file-by-file tables with line references into other files ("about line 4023", "lines 8628 to 8638", "near 326 and 706 to 751"), pixel values (3px, 1px, 36px), a `localStorage` key, spec-case enumerations and the ESLint `max-lines` ratchet (755). These go stale on the next PR. Move them to the per-stage PR plans. Likewise, the reports' proposed edits to wording (E.164 citation, `ul` / `ol`, "Барбър" vs "Бръснар", redundant table rows 367/368) are worth doing only if the document stays, and they should be edits and not new content.

### 7. Nit: the speculative-timing mitigations (listener lifetime and 20-minute detach) should be removed from "Risks the implementer should watch" (lines 782-784)

If the listener stays, this risk text carries a billing assertion with no source (Comprehension 6, critic M7). If it goes, the bullet goes with it.

## C. Items from the first zoom-out report that remain unaddressed (doc unedited)

| First-pass #                                                                         | State                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Blocker (baseline)                                                                 | Mostly resolved by the merge. `text-match.system.ts` is in the tree and line 337 correctly says it "gains" two functions. The doc still does not name PR #20 / `0926913d` as a prerequisite. Add one clause. |
| 2 (`SearchQuerySystem` / `ReadQuery` / `PHONE` filter duplicate `ParsedClientQuery`) | Open, and not in the Critic list as a cut. See B3.                                                                                                                                                           |
| 3 (listener machinery vs few-dollar saving)                                          | Open. The reports patch it instead of questioning it. See B1 and B2.                                                                                                                                         |
| 4 (cap vs "every future visit")                                                      | Reduced to a wording fix. Keep it small (A above).                                                                                                                                                           |
| 5 (search older)                                                                     | Open. See A, cut.                                                                                                                                                                                            |
| 6 (`ui-search-token` vs `uiChip`)                                                    | Open and dropped by the Critic. See B4.                                                                                                                                                                      |
| 7 (hint parser, facets, `patch`, `SearchWindowSystem`, `SearchRecentsSystem`)        | Open. See B3 and B4.                                                                                                                                                                                         |
| 8 (split the design)                                                                 | Open and still recommended. See B5.                                                                                                                                                                          |
| 9 (altitude of the implementation half)                                              | Open. See B6.                                                                                                                                                                                                |
| 10 (Goal 7 says event card, plan uses `lib-visit-row`)                               | Carried as M2. Wording fix only.                                                                                                                                                                             |
| 11 (conversation leaks, line 756)                                                    | Carried as M4. Delete, do not rewrite.                                                                                                                                                                       |
| 12 (sign-out hook, parallel arrays)                                                  | The Critic's N2 asks to name the hook. The simpler fix is to drop the claim. The parallel-arrays vs Law 3 "arrays of structs" question is unanswered.                                                        |

## D. What is good (keep)

- Range query on `utcEpochMs` with no new index (lines 257, 356-359).
- Not rewriting the user's text under the caret (Alternative E).
- Rejection of a hosted search service and of a server prefix index.
- Stages 1 and 2 ship the bug fixes first.
- The honest correction at lines 57-60 (the pool is stale, not re-read per write).

## Files referenced

- `docs/designs/staff-search.md`
- `libs/ecs-core/src/systems/text-match.system.ts`
- `libs/ecs-core/src/systems/client-query.system.ts`
- `libs/ecs-core/src/components/booking-policy.data.ts`
- `libs/features/staff/dashboard/src/lib/staff-day.store.ts`
- `libs/ui/controls/src/lib/chip/chip.ts`
- `firestore.rules`
