# Stage 6: Comprehension Test

Target: `docs/designs/staff-search.md` (lines 1-793, full file)
Reviewer: `egm-comprehension` (Mode: REVIEW)
Context supplied: `CLAUDE.md`, `docs/styling-conventions.md`. The reviewer found that the doc links no other files.

Note: `origin/main` was merged into the branch while this reviewer was running. The design doc did not change. Code lookups the reviewer made may reflect either the old or the new tree.

## What this proposes

Turn the staff schedule's search sheet («Търсене») into the model for every search in the app. There are five parts:

- One shared match-highlighter (`TextMatchSystem` plus a new design-system element `ui-marked-text`, accent-wash style). It replaces three copies.
- A single reading of typed phone numbers (`PhoneSystem.searchDigitsOf`), so `088…` and `00…` find `+359 88…`.
- Filters (barber, service, status, date, has-note). They are offered as counted suggestions and removable chips, with a hidden typed `barber:` form.
- A Spotlight-style sheet. When idle it shows recents (kept in `localStorage`) and suggestions. When searching it shows `lib-visit-row` event cards grouped under day headings.
- A date-range window: 60 days back to the booking horizon. It is kept current by Firestore live listeners and held in memory, with an explicit "search older" read. A pure index and filter system scans it per keystroke.

The work is cut into six PR-sized stages.

## How the existing system works, per this document

- The sheet reads the 300 visits nearest to now on each side, once, on first open (`SEARCH_WINDOW_PER_SIDE` in `staff-day.store.ts`). `openSearch` returns early when the pool is non-empty, so the window never refreshes.
- Matching re-folds every field of every visit on each keystroke. The phone fallback compares digits, so a typed `088…` never equals the stored `35988…`.
- Three separate "mark the match" implementations exist: `splitOnTerm`/`splitOnDigits`, `ClientQuerySystem.nameSegments` and `TextMatchSystem`. They use two styles, ink-only and a background wash.
- Results are plain rows (name, matched field, time). The agenda uses a hand-built `.agenda-card` in the dashboard template. `lib-visit-row` is the reusable card used by the client card and account pages.
- Firestore has a single-field index on `utcEpochMs` and a persistent local cache. The client directory uses a server-side `searchPrefixes` index.

## Findings

### 1. Blocker

**Scope:** Technical Plan §2 "Phone reading" and `SearchFilterSystem.keep`. How text terms and the phone reading combine is unspecified.

- `keep` applies "text terms (all must match, in any field), the phone reading, then each filter".
- `SearchQuerySystem.read` "splits words" and also reads the number. For `088 333` this gives terms `088` and `333` plus a phone reading.
- If the terms are ANDed with the phone reading, `088` matches nothing stored as `+359 88 333 4455`, and CUJ 1 fails.
- The doc never says that a phone-shaped query replaces the terms, nor what happens to a mixed query such as `Иван 088`.
- The reviewer could not paraphrase this part into a working rule.

### 2. Major

**Scope:** CUJ 1 vs §2 "What the user sees".

CUJ 1 says "The field reads `+359 88 333` as the user types". §2 and Alternative E say the field is deliberately not rewritten, and the reading appears only as a suggestion row and a phone chip. The two cannot both be built. Neither the CUJ's Then-clause nor the §2 text says which one wins.

### 3. Major

**Scope:** Goals 1 and 7, CUJ 6 vs Stage 1 and Risks. The word-start vs "anywhere" marking decision is open, but Goal 1 and CUJ 6 assume it is closed.

- Goal 1: "the three older copies are deleted".
- Stage 1 (`client-query.system.ts`) and Risks: `nameSegments` "stays" if the add-client page's word-start rule differs from "anywhere". Stage 1's first commit "settles" it.
- CUJ 6 claims the same run is marked identically in the service list, the add-client page and the search. That would be false if word-start remains.
- Which behaviour is intended is unresolved in a document marked ready for review.

### 4. Major

**Scope:** Goal 7 and the Overview vs §4 and Alternative H.

The Overview and Goal 7 say results are "the same event cards the agenda uses". §4 and Alternative H say the agenda's `.agenda-card` is not reusable and the design uses `lib-visit-row`, a different card. The mismatch is mentioned only deep in §4, with "I have not planned that". A reader of the Overview will expect the wrong visual outcome.

### 5. Major

**Scope:** §3 and Open Questions. The 120-day fallback horizon contradicts the cap and the cost model.

- The Open Questions say the plan uses 120 days if the policy has no horizon. The Technical Plan says `BookingPolicy.horizonMonths` exists, with a two-month default. Does the policy have a horizon or not?
- With a 120-day horizon, at 40 visits a day the future side is about 4,800 visits. That exceeds the 3,000 per-side cap, so "all future visits" is truncated.
- The cost table's "40 × 120 days ≈ 4,800" assumes 120 days in total, not 60 back plus 120 ahead.
- The Overview's "covers every future visit" is also bounded by the horizon. A visit past it is invisible, for example after a policy shortening, or if staff can book beyond it. The doc does not say whether staff can.

### 6. Major

**Scope:** §3 cost model omits triggers and does not reconcile the cache.

- The window load is described as happening when "the sheet first opens". Stage 3 also makes the add-client «Скорошни» read `StaffSearchStore.window` (via `ensureWindow`). So opening the add-client page may trigger the 4,800-document load. This is not in the cost table, and nobody checks that «Скорошни» still means the same thing over a 120-day window.
- The persistent local cache is said to serve first paint, yet every page load is costed as a full cold read. The doc does not say how the cache and resume tokens interact with the cost row for a first open.
- The 20-minute detach is justified as "Firestore would bill that re-read anyway for a listener off over 30 minutes". That holds only beyond 30 minutes. A user returning at 20 to 30 minutes now pays a full 4,800-document re-read that Firestore would not have billed. The Firestore 30-minute behaviour is asserted without a source.

### 7. Major

**Scope:** §3 "Query shape" and "Reads". The window's boundaries are fixed at attach time.

The two queries use `now` and `today−60` when the listener attaches, and the listener is "kept for the page session". A desk tablet left open for days never rolls its window forward. The "past" listener keeps its old `now` split and the 60-day edge drifts. Nothing says when the range is recomputed (day rollover, re-attach).

### 8. Major

**Scope:** §3 "What is not read". The location-scope claim is unsupported.

The doc says "Nothing outside the shop's own location scope is read", and "Scope rules stay as they are". The query shape is two range queries on `utcEpochMs` only, with no location or barber constraint. With "no new Firestore fields, indexes or rules", the reader cannot see what enforces the scope. Does a staff member see all barbers' visits? Is there more than one location per tenant? Neither is stated.

### 9. Major

**Scope:** Stage 3 vs Stage 4. An interim performance regression.

Stage 3 is claimed to leave the app working. It feeds the old sheet an 8x larger window (4,800 vs 600). The old per-keystroke path (`searchableFields` re-folds every field of every visit) stays until Stages 4 and 5 replace it. The doc itself calls this path expensive. The doc does not discuss the interim cost, or whether Stage 3 should wait for the index.

### 10. Major

**Scope:** Index rebuild vs patch.

- §2 and Cross-cutting: the index is "rebuilt only when the window changes (a listener batch)".
- Stage 4: `SearchIndexSystem` has an incremental `patch(index, changedVisits)` "so one change does not rebuild 4,800 rows".
- These contradict each other.
- Under Law 3 (no input mutation), patching flat parallel arrays means copying them. Removals (a visit that moved out of range, or was deleted) are not covered by the `patch` signature.

### 11. Major

**Scope:** Facets API and semantics are inconsistent.

§2: `facets(index, kept)`, with "each facet's own filter lifted". Stage 4: `facets(index, read, filters)`. A `kept` set already has the filters applied, so the filters cannot be lifted from it. The signature in §2 cannot implement its own rule.

### 12. Major

**Scope:** Filters whose input or definition is missing.

- Goal 5 offers "a chosen day or range", but no picker or entry exists in the wireframe, the sheet description or Stage 5. "This week" is undefined (calendar week or next seven days). `dayBucketOf` returns only `TODAY`, `TOMORROW`, `LATER` and `PAST`, so it cannot answer "this week".
- "No-show" is listed under Status, and the filter type is `filterBookingStatuses: BookingStatus[]`. CLAUDE.md Law 6 puts `NO_SHOW` under `attendanceState`, not `bookingStatus`. The doc does not say how the filter models it.
- D3's third entry ("text that resolves to a filter when it matches a barber, service or status name") appears nowhere in §2 to §4. Typing «Николай» may be a client or a barber, and the rule for that is not given.
- A `PHONE` filter variant exists in §1 but not in Goal 5's list.

### 13. Major

**Scope:** Phone-reading table gaps.

- A bare 3-digit run has no row. The table defines "under 3 digits: none" and "4+ digits: bare".
- `PhoneSystem.readingMatches` appears only in Stage 2 and is never specified in the Technical Plan.
- Stage 2's spec list includes `+0088…` with no row or rationale.
- Typed `0` followed by 8 or more digits that are really a foreign national number is not discussed (the Open Questions only cover `044`).

### 14. Major

**Scope:** Sections and decisions are cross-referenced wrongly.

- Non-Goals: "see Alternatives, section 4". The Alternatives are lettered A to K, and the hosted-service one is A.
- §2: "(Alternative: rewrite in place, section 4.)". It is Alternative E.
- Open Questions and §6 say "Section 5 lists it as 'inspect, then adopt or exclude'". Technical Plan §5 is "One highlighter". §6 or Stage 5 holds the row.
- The Decisions table says the reasoning is in "the Technical Plan (section 2)". It is spread over §2 to §5.
- Stage 6 says the ADR records "D1 to D7". Only D1 to D6 exist.

### 15. Major

**Scope:** The window's lifecycle and the "older" step are underspecified.

- CUJ 5 is a client from about 200 days ago, but each "search older" step reads 60 days. That is up to about 3 taps, and the CUJ does not say so.
- "The row is absent once the beginning of the data is reached". How the beginning is detected is not defined; an empty 60-day range is not proof. `olderReached` is a signal with no rule.
- Older data merged into the window is not under a listener, so it goes stale. After a 20-minute detach, the doc does not say whether the merged data is kept or dropped on re-attach.
- The cost of an older read is called "bounded" but is not quantified. 60 days is about 2,400 reads, or up to 3,000 with the cap.

### 16. Major

**Scope:** Draft-process and conversation context leaks into the design.

- The doc addresses "you" ("You asked for all future visits", "Where you left a choice to me", "If you prefer the in-field rewrite", "pick your recommendations"). A fresh reader does not know who "you" is or what the 2026-11-03 conversation said.
- "How this draft was made", "Status: awaiting `egm-review`" and the last Stage 6 row (`design_draft.md → docs/designs/staff-search.md`, "saved by the draft skill's final step") are process notes. That file is already saved at its destination.
- `egm-review` is not defined.
- The owner decisions of 2026-09-22 and 2026-09-24 (ink-only highlighting) are cited without a link or location, beyond a CSS comment.

### 17. Major

**Scope:** Design-system reuse is not justified against the conventions.

- `ui-search-token` is a new pill beside the existing `ui-chip`. The conventions say to extend the original in `libs/ui` and never copy it beside itself. The doc does not say why `ui-chip` cannot be used.
- `ui-marked-text` is a wrapper element around the platform's `<mark>`. The conventions say not to wrap things the platform already has, so an attribute-style upgrade (`mark[uiMarkedText]`) is the likely form. The choice is not argued.
- The mark CSS uses a raw `3px` radius and `1px` padding. The conventions require `--sys-space-*` and `--control-radius-*` tokens, even though `libs/ui` is lint-exempt.
- The doc does not name the sheet primitive that hosts the search (`ui-sheet` or `ui-modal-sheet`).

### 18. Nit

**Scope:** Undefined or unlinked project terms.

- Used without a definition or link: `lib-visit-row`, `StaffEventHead`/`lib-staff-event-head`, `visitRowOf`, `AppointmentRowVm`, `VisitSectionVm`, `VisitListSystem`, `VisitStorySystem.outwardFromNow`, `ShopNow`, `ReadGuard`, `observeQuery`, `deployment.defaultCountry`, `callingCodeOr`, the "log port", `searchGlyphOf`, `focusFirstHit`.
- `Law 3`, `Law 10.2` and `L6` are used in §2 and §3 before any pointer to `CLAUDE.md`. Only the Detailed Implementation preface names it.
- Bulgarian UI strings («Търсене», «Скорошни», «Търси по-назад», «По-рано», «Изчисти») appear unglossed in several places.
- The "40 visits a day, 3 to 5 chair shop" figure is attributed to a code comment, not to data.

### 19. Nit

**Scope:** Naming drift.

- The truncation flag is `windowTruncated` in §3 and `capped` in Stage 3 and the adapter.
- The sheet has "three states" in §4, but the diagram shows two blocks (IDLE and "TYPING / RESULTS"). The VM has `IDLE|RESULTS|EMPTY`.
- The idle suggestions list in CUJ 2 omits the Service group that the wireframe shows.
- State is undefined for "chip present, empty text" (CUJ 2 after tapping «Утре»). IDLE is defined as "no chips".

### 20. Nit

**Scope:** Other consistency and process notes.

- The Mermaid arrow `Win2 --> FS` (`SearchWindowSystem` → Firestore) reads as a pure system doing I/O, which contradicts "systems get plain arrays".
- Stage 4's description lists a "window" system, but `SearchWindowSystem` is created in Stage 3.
- Stages 1 and 2 both edit `staff-search.presenter.ts` and its spec yet are marked "Depends on: none". Stage 3 also rewires the same dashboard files.
- "A spec asserts operation counts, not wall time" does not say how a pure function exposes an operation count.
- The 20-minute detach decision sits in the store, a threshold that CLAUDE.md would want in a system. It is named as a constant in `SearchWindowSystem` but compared in the store.
- The wireframe uses emoji glyphs. The registry-only icon rule means Stage 5 should list the new icon registry entries (clock, phone), which it does not.
- A match on a selected row (accent wash on accent wash) has a showcase case but no stated contrast rule.
