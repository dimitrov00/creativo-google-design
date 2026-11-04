# Stage 9: Implementation Readiness Test

Target: `docs/designs/staff-search.md`, DetailedRange lines 626..793 (Detailed Implementation to the end)
Reviewers, all three completed:

- `egm-implementation-readiness` against `implementation-readiness-standard.md`: 25 findings (4 Blocker, 14 Major, 7 Nit). Raw ids `ir-B1..B4`, `ir-M1..M14`, `ir-N1..N7`.
- `egm-codebase-details` against `implementation-readiness-standard.md`: 32 findings (1 Blocker, 16 Major, 15 Nit). Raw ids `cd-B1`, `cd-M1..M16`, `cd-N1..N15` (the reviewer's nits were unnumbered; I numbered them in the order it listed them).
- `egm-style`, no standard: 20 findings (0 Blocker, 9 Major, 11 Nit). Raw ids `st-1..st-20`.

Context supplied: `CLAUDE.md`, `docs/styling-conventions.md`. The repo had `origin/main` merged (commit `44318d0f`), and the reviewers checked the plan's file paths, symbols and line anchors against it. Most cited paths, symbols and line anchors exist (for example `staff-day.store.ts:137`, `staff-dashboard.ts:3912`, `app.config.ts:431`, the eslint caps 4683 and 6682, the Stage 6 paths).

## Verdict

Not ready. An engineer new to the codebase could not execute Stages 1, 2, 3 and 5 without making design decisions. The two reviewers who checked the plan against the code agree on the phone-reading blocker and on the Stage 1 and Stage 3 gaps. The design edits asked for in Stages 5 to 8 (for example splitting the design, or cutting the listener) would remove or reshape several of these findings, so decide those first.

## 🔴 Blockers

### B1. The `088 333` / `0088 333` example contradicts the plan's own phone rule

**Scope:** lines 675, 676, 751; design 74, 149, 292-299. **Source:** cd-B1, ir-B2 (part).

- The table reads `00` as `+`, so `0088 333` becomes international digits `88333` and is matched "starts with" `88333`. Stored numbers look like `35988333…`, so it cannot match.
- The existing code does the same: `ClientQuerySystem.parse` drops `00` and sets `phoneInternational`, and `phoneInternationalDigits` returns `[digits]` unchanged.
- The e2e at line 751 ("`088 333` and `0088 333` find the same client") cannot pass as specified. Only `00359 88 333` is equivalent to `088 333`.
- The spec rows at line 676 (`0088…`, `+0088…`) give no expected output, so an implementer has to invent one.
- Fix: change the example to `00359…`, or define a rule for `00` followed by a non-calling-code prefix, and state the expected result for each spec row.

### B2. `PhoneReading`, `searchDigitsOf` and `readingMatches` are not implementable as written

**Scope:** lines 675-678, 680-683. **Source:** ir-B2, cd-M3, st-7, st-8.

- `phoneReadingDigits` is one string, but the existing rule (`phoneInternationalDigits`, `client-query.system.ts:126`) returns a candidate list: a bare run gives `[code+digits, digits]`. The plan never says what `BARE` holds, or how "the code + the run, else the run anywhere" is matched. The reading also needs the calling code and does not carry it.
- `PhoneSystem.readingMatches(reading, storedDigits)` is introduced only in the `search-fields.system.ts` row (678). It is absent from the `phone.system.ts` row (675) and its spec row (676), and has no signature or semantics.
- Exactly three bare digits is undefined: line 675 says four or more is bare and fewer than three is none. The existing `MIN_PHONE_DIGITS` is 3, so the plan's threshold also disagrees with current behaviour. "The table in the Technical Plan" does not name a section.
- Line 681 expects `+359 88 333` to be marked, but `ClientQuerySystem.phoneSegments` leaves the `+` unmarked (pinned in `client-query.system.spec.ts`). Decide which behaviour stands.
- `PhoneReading` uses raw literals `'INTERNATIONAL' | 'BARE' | 'NONE'`. Law 1 requires an `as const` dictionary, Law 6 prefers a domain name (for example `phoneReadingKind`) over a bare "kind", and the plan places the type in a system instead of a components file.
- "Behaviour unchanged" for `phoneAsTyped` (682) is unproven, since a single-value reading replaces a two-candidate list. `staff-visit-editor.ts:3981` also calls `phoneInternationalDigits` and is not listed.

### B3. Stage 1 leaves a design decision open and misses a fourth marking copy

**Scope:** lines 650, 652, 778-781. **Source:** ir-B3, cd-M4, st-1, st-2 (part), ir-N7, cd-N15.

- Line 652 says `nameSegments` is rewritten on `segmentsAny`, then "if that rule differs… `nameSegments` stays… the first commit of the stage settles this". The code settles it now: `nameSegments` marks word beginnings only (longest token wins, once per word) and `TextMatchSystem.segments` marks anywhere. The rules differ. The Risks bullet repeats the same caveat.
- The plan must state the result: keep `nameSegments`, give `segmentsAny` a word-start mode, or accept the behaviour change and amend the spec. Goal 1 ("older copies deleted") is not actionable for the add-client path until then.
- `ClientQuerySystem.phoneSegments` (`client-query.system.ts:524-569`, called at `visit-client-row.presenter.ts:76`) and `emailSegments` (`:68`) are further marking copies. The plan adds a new `TextMatchSystem.phoneSegments(formatted, digits)` and never says what happens to the existing ones. The existing function uses candidate-priority matching, which the new signature does not reproduce.
- Type-only cycle (nit): `text-match.system.ts` imports `TextSegment` from `client-query.system.ts`. Once `client-query` imports `TextMatchSystem` at runtime, only a type-only edge keeps it cycle-free. Consider moving `TextSegment` to a neutral file.

### B4. Stage 5 result card cannot show what the search matches

**Scope:** lines 733, 735-738; design 430-439. **Source:** ir-B1, cd-M8, cd-M7.

- `visitRowOf` (`libs/features/shared/visits/src/lib/visit-row.presenter.ts`, staff perspective) builds a card per subject. Its title is the services. Its lines are time, shop, party and barber. Its only free text is the booker's `quote`. It never emits the client name, phone, e-mail or note lines, yet CUJ 1 needs "`+359 88 333` marked in the phone line".
- Line 735 only adds `titleRuns` / `lineRuns` to `VisitRowFields`. The plan does not say which new lines the search row carries or where they come from, how a note match is shown (`quote` has no runs in `StaffEventHead`), or how one `lineRuns` array maps to several lines.
- Redundant fields (cd-M8): `StaffEventLine.parts` already exists (`event-head/staff-event-line.ts:25`) and `lib-staff-event-head` already draws it. `visitRowOf` already returns `lines: StaffEventLine[]`. Only a title-runs field is missing. The title is the services, but search marks the client name as the title (`searchHits`, `titleFieldOf`), which the plan leaves undecided.
- `visitRowOf` needs a full `VisitRowOptions` (`perspective`, `grain`, `subjectUserId`, `subjectCustomerId`, `currentAppointmentId`, one `now: ShopNow`, `timeZone`, `locale`, `words`) plus a `VisitLookup`. The plan names none of them, and line 733 uses a per-visit `shopNowAt(locationId)` while `VisitRowOptions.now` is one `ShopNow` per list. A multi-location result list is unexplained.
- Reuse miss (cd-M7): `lib-visit-list`, `VisitSectionVm`, `sectionVisits` and the paging foot (`visit-list/visit-list.ts`, `visit-sections.ts`) already give headings, `ul[uiListGroup]`, an `openRow` output and More/Loading/Failed/End states. The plan invents `SearchGroupVm { key; heading; rows }`, and «Търси по-назад» is the existing `loadMore` foot. `VisitSectionVm` also requires `detail` and `testId`.

### B5. Stage 3's `StaffSearchStore` omits state the existing sheet needs

**Scope:** lines 697, 699, 701-703, 738-740. **Source:** ir-B4, cd-M9.

- Line 697 lists signals `window, capped, loading, stale, olderReached`, and line 699 deletes `_searching`, `_term`, `_pool`, `searchLoading`, `openSearch`, `closeSearch` and `setTerm` from `staff-day.store.ts`.
- The old sheet still reads `store.searching()` (`staff-dashboard.html:309`), `store.term()` (`:349`, `staff-dashboard.ts:1031, 1059, 1062`) and `store.pool()` (`:1032`), and must keep working until Stage 5. The new store has no `searching`, `term`, `setTerm` or `closeSearch`; `query` arrives only in Stage 5. The plan lists the html bindings "about 169, 351 to 360" and misses 309 and 349. The method is `open()` at line 697 but `store.openSearch()` at lines 701-702.
- The «Скорошни» path (`browseClients`, `staff-dashboard.ts:3912-3948`) awaits `ensureWindow()` and reads `window()`. The plan does not say how a caller awaits the first emission, or that «Скорошни» opens the listener without the sheet.
- The store's dependencies are unnamed: the booking policy (`rangeOf`; the web source is `SCHEDULING_READ_PORTS.observePolicy`, no port or token named), `today`, the shop zone and `readNow`, the log port, the sign-out hook and `DOCUMENT`. `StaffDayStore.zone`, `todayKey`, `zoneAt` and `shopNowAt` are component-scoped (`@Injectable()` without `providedIn`), so the provider scope of the new store is unstated. The extracted sheet (738) needs `catalogNames`, `companionNames`, `dayWords().unnamedClient`, `shopNowAt`, `zone`, `content.locale` and `store.goToDay`, and the plan does not say how they reach it.

## 🟡 Majors

### M1. Stage 1 leaves existing specs failing

**Scope:** lines 628, 646-670. **Source:** ir-M1, cd-M1.

`staff-dashboard.spec.ts:4120` queries `.staff-search__mark`, which Stage 1 deletes. Lines 4103-4143 and 5439-5474 test `staff-search-hit`, `-headline` and `-sheet` and are listed in no stage's spec updates (Stage 3 lists 797, 8628-8638, 8808 and 8996-9020; Stage 5 about 8990-9030). `staff-visit-editor.spec.ts:3974, 3995, 4021` assert `.staff-event-head__hit`, which Stage 1 removes by moving the head to `ui-marked-text`. Neither spec is in the Stage 1 file list, so "each green on its own" (line 628) fails. Check `stylesheets.spec.ts` in the same lib for `.staff-visit__mark` rules.

### M2. The mark token and its wash-guard spec are vague and likely to fail

**Scope:** lines 658-659. **Source:** ir-M2, cd-M13, st-13.

- Line 659 says "the existing token spec that lists tokens, e.g. `accent-label.spec.ts`'s neighbour". The real home is `libs/ui/tokens/src/lib/accent-rule.spec.ts`, with a `WASHES` map (line 184: "A new wash under words joins this list, and its stylesheet the test target's inputs in `project.json`") and a "with room to spare" test pinning the worst ink contrast at ≥14.5 (light) and ≥9.7 (dark), measured at today's 14% and 20% rungs.
- The new mark is twice the rung (28% and 40%), which likely drops the worst contrast below those floors. Name the file, the `WASHES` entry, the `project.json` input and the revised thresholds.
- `--sys-alpha-segment-selected` is defined in `theme-light.css` and `theme-dark.css`, not `tokens.css`, where the plan puts the new token. Confirm the declaration scope so `var()` resolves per theme. "Alpha rung" is unexplained jargon, and "so the token inventory stays honest" is figurative.

### M3. `VisitGrain.Day` touches far more than `sectionKeyOf`

**Scope:** lines 722, 743; design 440-446. **Source:** ir-M3, cd-M5, st-9.

- `VisitGrain` is a dictionary in `libs/ecs-core/src/components/visit-grain.data.ts` (`Month` / `Year`), absent from the plan's file list, with about 84 usages. Adding `Day` breaks `visitGrainWords … satisfies Record<VisitGrain, string>` in `libs/infrastructure/i18n/src/lib/visit-list-words.ts` and its spec, and touches `tileGrain`, `sections` and `staff-ui-dictionaries.type-spec.ts`. The stage would not typecheck.
- `rowSectionKey` and `sections()` file every upcoming visit under the single `upcoming` key, so `sectionKeyOf(Day)` applies only to past rows. Today / Tomorrow / weekday headings for future days cannot come from it. The plan names both `sectionKeyOf(Day)` and `dayBucketOf` but not which feeds the headings, where the `TODAY | TOMORROW | LATER | PAST` tags live or the shape of the "day offset".
- The design's past headings are "weekday and date" (Goal 7), but the mock and line 743 have one «По-рано» group. Pick one. The i18n row uses "today, tomorrow, earlier" and "this week" against the `dayBucketOf` tags; use one vocabulary, and replace "and so on" and "one key per status" with a checkable key list.

### M4. The live-range adapter cannot be built as described

**Scope:** lines 691-693, 697. **Source:** ir-M4, cd-M10.

`observeQuery` (`observe.ts:340-357`) admits each query's snapshot separately, with a per-query systemic refusal. The whole-window admission lives in `windowOf` (`appointments.adapter.ts:216-256`) through the one-shot `readRawQuery` and `keepAdmitted`. No live raw-read helper exists to merge two listeners and judge them jointly. The plan does not give the helper, the merge operator (`combineLatest`, ordering, retry via `subscribeWithRetry`), what `capped` means once snapshots update, or how `readAppointmentRange` shares the guard. Line 697 says "listener pair" while the port at line 691 is one `Observable`. Say whether the methods are registered as `LazyMethod.Observable` and `LazyMethod.Promise` (line 696), and that the shared `scheduling.port.contract.ts` is not extended for the new range functions (line 692).

### M5. The range goes stale across days; older rows have no home

**Scope:** lines 689, 691, 697; design 354, 371, 395. **Source:** ir-M5, cd-M11.

`ObserveAppointmentRange(fromUtcMs, toUtcMs, nowUtcMs, cap)` fixes the bounds and the "now" split at attach time, and the listener lives for the page session. The plan has no re-range or re-attach trigger on a shop-day rollover and no spec case (the store's own comment says counter tabs stay open overnight). `readOlder()` results are "merged by id" into a window that every listener snapshot replaces, so older rows need a separate store. The end-of-data rule for `olderReached` is undefined; an empty 60-day range does not mean no older data.

### M6. The search systems have no data shapes

**Scope:** lines 718-720; design 335-336. **Source:** ir-M6, cd-M12.

- Missing shapes: `ReadQuery` fields (`queryPhone` type, `queryHints` element), `SearchIndex` (parallel-array element types), the `names` structure for services, barbers and statuses, the `facets` result, the `keep` return type and the key table "passed in". Hint grammar is undefined (multi-word values such as `barber:николай иванов`, ties, case).
- `build(visits, names)` takes no companion names or unnamed-client word. Today those come from `guestLabelOf(seat)` (`staff-day-guest.words`, a features helper) and `companionNames`, which are not reachable from an ecs-core system and arrive asynchronously. The plan does not say how they enter the index.
- "The same Bulgarian lowercasing as `TextMatchSystem`": `TextMatchSystem` exports no fold function.
- D3's third entry (design line 118) has no file or function. `facets(index, kept)` (design 335) disagrees with `facets(index, read, filters)` (plan).
- Several values are not declared as dictionaries: `dayBucketOf` results and `SearchSheetVm.state` (`IDLE | RESULTS | EMPTY`). Law 6 asks for a domain-prefixed field (for example `searchSheetState`) and `as const` values.

### M7. Date filters have no producer

**Scope:** lines 714, 718-722; design Goal 5. **Source:** ir-M7.

"Today / Tomorrow / This week" needs a `WHEN` filter built from `ShopNow`, including a week-start rule. No system builds it. `dayBucketOf` returns buckets, not date ranges. "A chosen day or range" has no entry point in any stage.

### M8. Recents persistence has no read guard

**Scope:** lines 721, 739; design 456-458. **Source:** ir-M8, cd-N11.

`SearchQuery` is stored as JSON in `localStorage` key `creativo.staff.search.recents` and read back with branded ids and dates. Law 7 requires a validated smart constructor or guard for foreign input, but the companion (line 714) lists only `empty`, `withFilter`, `withoutFilter`, `isEmpty` and `equals`. No stored shape, versioning or corrupt-entry behaviour is given, and "cleared on sign-out" names no signal or port. Reuse the `agenda-fields.ts` `localStorage` pattern and the `StaffDayStore` `visibilitychange` precedent (`staff-day.store.ts:663`).

### M9. The Stage 5 test plan is mostly missing

**Scope:** lines 729-731, 738-739. **Source:** ir-M9, cd-M14 (part).

The `search-field`, `search-token` and `staff-search-sheet` spec rows list no cases. Line 739 modifies the store (`query`, `recents`, `rememberCurrent`, `localStorage`) with no row for `staff-search.store.spec.ts`. Missing sheet cases include debounce, focus order and `openHit`. `uiTokenActivate` (729) has no defined effect, and "announces it" has no mechanism. The DS input for `ui-marked-text` is named `runs` (654), while DS inputs use the `ui` prefix (`uiTokens`, `uiValue`).

### M10. `SearchSheetVm` is incomplete

**Scope:** line 732. **Source:** ir-M10.

Types for `chips`, `recents`, `phoneReading` and `footnote` are not given. `state` is a raw union on a bare field (Law 6). `SearchGroupVm.rows` should be `AppointmentRowVm`, not `VisitRowVm`.

### M11. The presenter needs the shop's dial code

**Scope:** lines 680, 733. **Source:** ir-M11.

Retiring `digitQuery` forces `searchHits` and `SearchInput` to carry a `PhoneReading` or `callingCode`. The plan does not add it to `SearchInput` or to `staff-dashboard.ts`.

### M12. The directory-lookup change (line 683) rests on a wrong assumption

**Scope:** lines 677, 683; design 488. **Source:** ir-M12, cd-M2.

`staff-dashboard.ts:4023` receives `key` from `ClientQuerySystem.lookupKeys`, which already emits `0…`, `359…` and national variants through `phoneLookupVariants` (`client-query.system.ts:376`), and the index already holds both the E.164 digits and the `0…` form (`SearchFieldsSystem.fromForms`). So `088…` already works there and the row is redundant. `normalizeQuery(key)` has no calling code in scope, and `phoneLookupVariants` stays a separate copy of the dial-code rule while line 677 says "the second copy of the rule goes" only for `phoneInternationalDigits`.

### M13. Stages marked "Depends on: none" conflict

**Scope:** lines 633-640, 681. **Source:** ir-M13.

Stages 1 and 2 both rewrite `staff-search.presenter.ts`. Stages 1 and 3 both edit `staff-dashboard.html`. Stages 2 and 3 both edit `staff-dashboard.ts`. Stage 2's expected mark (681) needs Stage 1's `phoneSegments`. State a merge order or add the dependencies. Stage 4's summary (638) lists the "window" system, but `search-window.system.ts` is delivered in Stage 3 (689).

### M14. Decisions left to the implementer

**Scope:** lines 652, 743, 744, 753, 788-790. **Source:** ir-M14, cd-M16, st-2, st-3.

- Line 744: `admin-rhythm-sheet` "inspect, adopt or exclude". The code answers it: `admin-rhythm-sheet.html:23-35` is a services search with a filter (`servicesSearch`). Decide now, with files, spec and expectations.
- Hedges at 652, 743 ("if present"), 744 and 753 ("if the file lists live decisions") are investigations, not instructions. Resolve them or label them "decide during the stage". The i18n parity spec exists (`catalogue-parity.spec.ts`), so "(if present)" is unneeded.
- Lines 788-790: the Risks bullet says small CSS changes may be needed in `visit-row.css` "which is why stage 5 lists the files", but the Stage 5 table (735-737) does not list `visit-row.css`.

### M15. Reuse miss: `ui-search-token` duplicates `button[uiChip]`

**Scope:** lines 729-731, 743. **Source:** cd-M6.

`libs/ui/controls/src/lib/chip/chip.ts` is documented as "a removable token's trailing ✕", and the `chip.page.html` showcase says "a trailing ✕ says it comes off". `styling-conventions.md` says to extend the original in `libs/ui`, never copy it beside itself. The idle suggestion chips also have no stated element. Use `uiChip` inside `ui-search-field` through projection or `uiTokens`, and drop the new element.

### M16. Showcase wiring is incomplete

**Scope:** lines 668, 731. **Source:** cd-M14.

Showcase pages are registered in `apps/showcase/src/app/app.routes.ts` (a lazy route such as `controls/chip`) and in the `links` list of `controls.page.ts`. The plan lists `controls.page.ts` / `.html` but not `app.routes.ts`. "The field's existing showcase page" (731) does not exist; `ui-search-field` is used nowhere in `apps/showcase`.

### M17. Phantom edits

**Scope:** lines 742, 754. **Source:** cd-M15.

`staff-day.presenter.ts` and `staff-day.vm.ts` contain no search words or types, only comments that mention the sheet, so "remove the search-related words and types that moved" has no target. "The only docs matching the sheet's test ids" is wrong: `staff-schedule-remediation-plan.md` has no `staff-search` test id. The files that name `searchHits`, `splitOnTerm` or `staff-search.presenter.ts` are `docs/architecture/flips/f-08-dashboard-wording.md`, `docs/architecture/review/f08-dashboard-inventory.md`, `docs/architecture/flips/pass-d-brands-shapes.md` and `docs/design-research/staff-visit-editor-design.md`.

### M18. Unmeasurable or self-contradicting plan text

**Scope:** lines 756, 785, 791-793, 719-720. **Source:** st-4, st-5, st-6, ir-N3.

- Lines 791-793: "the rewrite replaces them rather than adapting them, and the old expectations are carried over case by case" contradicts itself, and the label "Rename churn" does not describe the content (nothing is renamed).
- Line 785: "well over 40" is unmeasurable and does not match the cap (3,000 per side over 60 past days is 50 a day; 40 a day gives 2,400). State a numeric trigger. Lines 719 ("4,800 rows") and 720 ("10,000 synthetic visits") are not tied to the 3,000 cap.
- Line 756: the `design_draft.md` → `docs/designs/staff-search.md` row is authoring-process residue ("saved by the draft skill's final step"). The file is already at that path and no `design_draft.md` exists. Remove the row.

## 🟢 Nits

- **N1. Ratchet timing** (lines 663, 686, 755). Caps are said to be lowered "the moment a file shrinks", but the ratchet is deferred to Stage 6, while `staff-visit-editor.ts` shrinks in Stage 1 and `staff-dashboard.ts` in Stage 3. "Ratchet" is used without a definition. _Source:_ ir-N1, st-11.
- **N2. ADR range** (line 752). The ADR covers "D1 to D7" but only D1 to D6 exist. _Source:_ ir-N2, cd-N7.
- **N3. Seed and fixtures** (lines 723, 750). Fixtures are listed as new in two rows and use bare filenames against full paths elsewhere. Stage 6 hand-adds rows to `book.fixtures.ts`, but the seed already has cancellations, no-shows, notes and «Николай Иванов» (`dev-client-6`), so only a visit about 24 days ahead appears new. Seed tooling importing `@core/testing` is unaddressed. _Source:_ ir-N4, cd-N5, st-16.
- **N4. e2e and emulator wording** (lines 750, 751, 767, 770). "Reading document reads in the emulator's request log" gives no command or tool. `apps/web/e2e/support/sign-in.ts` already provides `signInAs(page, uid, roles)`, while the plan names the lower-level `mintCustomToken` and `window.__e2eSignIn`. "CUJ 4" (750) and "Journeys 1 to 6" (751) are named differently, and "the notes on this app's Playwright runs" cites an undefined source (state the `waitUntil: 'commit'` constraint). _Source:_ ir-N5, cd-N6, st-17, st-18.
- **N5. i18n keys** (line 743). Hint-name keys (`barber`, `бръснар`) should live in the words table per the design (318). The existing `staff.day.searchLabel`, `searchScope`, `searchPlaceholder`, `searchEmpty` and `searchLoading` keys are not marked for removal, and `searchClear` stays in use by the visit editor (`staff-visit-editor.html:180, 494`). _Source:_ ir-N6, cd-N4.
- **N6. Line and size claims that do not match the code** (lines 655, 699, 700). The existing `.staff-visit__mark` rule (`staff-visit-editor.visit.css:251-261`) has no `box-decoration-break`; the plan adds it. The store section to delete is about 60 lines (`staff-day.store.ts:1761-1821` plus the constant at 137), not about 90. `staff-day.store.spec.ts` has only the double at line 189 and no search cases, so "and the search cases" has no target. "About 90 / about 150 lines" and "Net lines go down" are unverifiable. _Source:_ cd-N1, cd-N2, cd-N3, st-15.
- **N7. Run types and DS conventions for `ui-marked-text`** (lines 654, 735). `runs: {text, hit}[]` is a third structurally identical run type beside `TextSegment` and `StaffEventRun`; drop the identity mapper `markedRuns` if possible. The plan does not say that DS components use `ViewEncapsulation.None` with CSS inside `@layer sys-components`. _Source:_ cd-N12, cd-N13.
- **N8. Billing assumption behind the 20-minute rule** (lines 698, 782-784). A listener is billed as a new query after being disconnected for more than 30 minutes, not merely because the tab is hidden; state the connection assumption. The 30-minute claim has no source, and the detach prevents the cost while only the log catches it. "Hidden 19 minutes keeps it, 21 detaches" is telegraphic; write "stays attached after 19 hidden minutes; detaches after 21". _Source:_ cd-N14, st-20.
- **N9. Style: references and jargon** (lines 631, 638, 640, 644, 658-659, 663, 678, 680, 683, 693-703, 738, 741). "(L-Angular row)" and "L6 and so on" are not laws; cite CLAUDE.md §2's Angular row or list the laws. Line references mix "about", "near" and ranges ("8628 to 8638", "8996 to 9020"), which go stale; prefer symbol names. "Stages 1 and 2 change what users see on their own and fix a live bug" is loose (only Stage 2 fixes it), and "all specced", "the live bug", "ReadGuard admission" are colloquial or unexplained. _Source:_ st-10, st-11, st-12, st-19.
- **N10. Style: fillers and vague terms** (lines 655, 678, 720, 730, 767-768, 774). "One rule for every search", "a small pill", "the accent-wash grammar of a selected segment", "real screenshots", "if it ever fails" and "Browser pane" (undefined tool name) should be removed or named. "With that facet's own filter lifted" reads better as "removed". The `PhoneSystem`'s "matching helper `PhoneSystem.readingMatches(…)`" is redundant. Several cells pack changes, rationale and parentheticals into one sentence, and the "Change and why" column often omits the why. _Source:_ st-14, st-19, st-18.

## Traceability matrix

| Raw finding | Severity | Consolidated |
| ----------- | -------- | ------------ |
| ir-B1       | Blocker  | B4           |
| ir-B2       | Blocker  | B2, B1       |
| ir-B3       | Blocker  | B3           |
| ir-B4       | Blocker  | B5           |
| ir-M1       | Major    | M1           |
| ir-M2       | Major    | M2           |
| ir-M3       | Major    | M3           |
| ir-M4       | Major    | M4           |
| ir-M5       | Major    | M5           |
| ir-M6       | Major    | M6           |
| ir-M7       | Major    | M7           |
| ir-M8       | Major    | M8           |
| ir-M9       | Major    | M9           |
| ir-M10      | Major    | M10          |
| ir-M11      | Major    | M11          |
| ir-M12      | Major    | M12          |
| ir-M13      | Major    | M13          |
| ir-M14      | Major    | M14          |
| ir-N1       | Nit      | N1           |
| ir-N2       | Nit      | N2           |
| ir-N3       | Nit      | M18          |
| ir-N4       | Nit      | N3           |
| ir-N5       | Nit      | N4           |
| ir-N6       | Nit      | N5           |
| ir-N7       | Nit      | B3           |
| cd-B1       | Blocker  | B1           |
| cd-M1       | Major    | M1           |
| cd-M2       | Major    | M12          |
| cd-M3       | Major    | B2           |
| cd-M4       | Major    | B3           |
| cd-M5       | Major    | M3           |
| cd-M6       | Major    | M15          |
| cd-M7       | Major    | B4           |
| cd-M8       | Major    | B4           |
| cd-M9       | Major    | B5           |
| cd-M10      | Major    | M4           |
| cd-M11      | Major    | M5           |
| cd-M12      | Major    | M6           |
| cd-M13      | Major    | M2           |
| cd-M14      | Major    | M16, M9      |
| cd-M15      | Major    | M17          |
| cd-M16      | Major    | M14          |
| cd-N1       | Nit      | N6           |
| cd-N2       | Nit      | N6           |
| cd-N3       | Nit      | N6           |
| cd-N4       | Nit      | N5           |
| cd-N5       | Nit      | N3           |
| cd-N6       | Nit      | N4           |
| cd-N7       | Nit      | N2           |
| cd-N8       | Nit      | M13          |
| cd-N9       | Nit      | M4           |
| cd-N10      | Nit      | M4           |
| cd-N11      | Nit      | M8           |
| cd-N12      | Nit      | N7           |
| cd-N13      | Nit      | N7           |
| cd-N14      | Nit      | N8           |
| cd-N15      | Nit      | B3           |
| st-1        | Major    | B3           |
| st-2        | Major    | M14, B3      |
| st-3        | Major    | M14          |
| st-4        | Major    | M18          |
| st-5        | Major    | M18          |
| st-6        | Major    | M18          |
| st-7        | Major    | B2           |
| st-8        | Major    | B2           |
| st-9        | Major    | M3           |
| st-10       | Nit      | N9           |
| st-11       | Nit      | N1, N9       |
| st-12       | Nit      | N9           |
| st-13       | Nit      | M2           |
| st-14       | Nit      | N10          |
| st-15       | Nit      | N6           |
| st-16       | Nit      | N3           |
| st-17       | Nit      | N4           |
| st-18       | Nit      | N4, N10      |
| st-19       | Nit      | N9, N10      |
| st-20       | Nit      | N8           |

Two entries differ from how a reviewer labelled their own findings. The codebase reviewer listed its first finding as "B1" and the readiness reviewer's phone finding as "B2"; both describe the same plan lines (the phone rule), and I kept `0088 333` as its own item (B1) because it is a contradiction between the plan and the code, while B2 covers the under-specified shape. The codebase reviewer also notes that `staff-day.store.ts:137`, `staff-dashboard.ts:3912`/`4023`, `app.config.ts:431` and the eslint caps 4683 and 6682 were verified correct, so those anchors do not need changing.
