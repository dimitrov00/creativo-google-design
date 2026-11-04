# Stage 5: Initial Zoom Out Review

Target: `docs/designs/staff-search.md` (lines 1-793, full file)
Reviewer: `egm-zoom-out` (Mode: REVIEW)
Context supplied: `CLAUDE.md`, `docs/styling-conventions.md`

## Verdict

Do not pass as one design. The objective is clear (context sufficiency is met). The root-cause fixes are sound and small: the `088…` phone bug and the stale, count-based window. They are bundled with a large feature set (Spotlight sheet, filters, chips, facet counts, recents, hint parser, search-older). The feature set adds about 6 new systems, 1 component slice, 2 DS elements, 2 ports and a store, and the design does not justify it against YAGNI. One baseline claim is also false in this tree (finding 1).

Code-search results the reviewer used:

- `TextMatchSystem`: no file matches `**/text-match*` anywhere in `libs/`. The only repo hit for the name is this design doc.
- `staff-visit__mark`, `ui-marked-text`, `sys-color-mark`, `titleRuns` and `lineRuns`: all absent from the code.
- `splitOnTerm` / `splitOnDigits` (`staff-search.presenter.ts:70,97`), `ClientQuerySystem.nameSegments` / `phoneInternationalDigits` (`client-query.system.ts`; called at `visit-client-row.presenter.ts:101,124` and `staff-visit-editor.ts:3984`), `SearchFieldsSystem.digitQuery` (`search-fields.system.ts:137`), `PhoneSystem.callingCodeOr` (`phone.system.ts:198`) and `formatDraft` (`phone.system.ts:263`): all exist.
- Staleness confirmed: `openSearch` returns early when the pool is non-empty (`staff-day.store.ts:1784`), and `SEARCH_WINDOW_PER_SIDE = 300` (`staff-day.store.ts:137`).

## Findings

### 1. Blocker (confirm before approving)

**Scope:** lines 46-49, 70-72, 337, 645-669 (Stage 1), 485-486 and the Problem bullet at 45-49.

The design's baseline is not in this checkout. Line 337 says `TextMatchSystem` is "already committed in `0926913d`", and the Problem section says "the service list now has `TextMatchSystem`" and a `.staff-visit__mark` wash. On branch `docs/staff-search-design`, `TextMatchSystem`, `text-match.system.ts`, `.staff-visit__mark`, and `titleRuns`/`lineRuns` in `staff-visit-editor.html` do not exist. A fresh reader cannot verify "three copies, two styles", and Stage 1 mixes "extend" with "create". Either state which branch or PR carries `0926913d`, and make it an explicit prerequisite, or restate Stage 1 as creating the system. The token derivation at line 658 ("as `.staff-visit__mark` is now") cannot be checked here either. If the commit is unmerged, the claim that Stage 1 "depends on: none" (line 635) is also wrong.

> **Update (orchestrator):** `origin/main` (including PR #20, which carries `0926913d`) was merged into `docs/staff-search-design` after this report. `text-match.system.ts` now exists in the tree, so the missing-baseline part of this finding no longer applies to the code. The doc still does not name the commit as a prerequisite. The reviewer's other code-search claims ran against the pre-merge tree.

### 2. Major

**Scope:** lines 283-285, 301-305, 318, 675-683 (Stage 2), 714 (`PHONE` filter variant).

A typed-query reader and a phone-reading rule already exist. `ClientQuerySystem` has `ParsedClientQuery` (`client-query.system.ts:14-30`: `name`, `nameTokens`, `phoneDigits`, `phoneInternational`, `email`, `clientQueryShape`) and `phoneInternationalDigits(parsed, callingCode)`. The design's own table (line 204) admits the latter already does the `0`→code, `00`/`+` rule. The design still adds `SearchQuerySystem.read` and `ReadQuery { queryTerms, queryPhone, queryHints }`, plus `PhoneSystem.searchDigitsOf`, a `PhoneReading` tagged struct and `PhoneSystem.readingMatches`. The result is a third parse shape beside `ParsedClientQuery` and `ReadQuery`, while the text claims to replace "three ad-hoc readings".

- The minimal fix for the live bug is to have the schedule search call `ClientQuerySystem.phoneInternationalDigits`.
- Stage 2 should then be a relocation or extension of the existing function, with `SearchQuerySystem` built on `ParsedClientQuery`. It should not introduce a parallel type.
- The `PHONE` filter variant (line 714) duplicates the phone reading as a filter. Pick one representation.
- The table at lines 292-299 leaves exactly 3 bare digits undefined ("4+ digits" vs "under 3"); line 675 repeats the gap.

### 3. Major

**Scope:** lines 118, 361-398, 689, 697-698, 783-784 (D2, the live listener).

The staleness bug is real, but the fix drags in machinery that is disproportionate to a few-dollar-a-month saving. The design adds the following, and the file table adds a store plus its spec:

- a page-lifetime pair of range listeners;
- a `visibilitychange` timer with a 20-minute detach;
- attach and detach logging;
- a "may be out of date" footnote with retry;
- a `stale` signal;
- a "Firestore resumes under 30 minutes" billing argument.

The design's own numbers show the cost is trivial. A window load is about 4,800 reads, about US$0.003, and the whole shop spends US$0.45 to US$1.80 a month (lines 373-382). That much cost modelling is itself a sign of weeds.

- Simpler candidate: keep the one-shot read, and re-read on sheet open when the pool is older than N minutes. Alternatively, keep the existing read and patch the pool from writes the app already knows about.
- Reuse for the listener path, if kept: `libs/infrastructure/firestore/src/lib/observe.ts` and `subscribe-with-retry.ts` already hold the retry and listener handling. The design should state that it reuses them, not invent a detach policy.
- The store's own comment (`staff-day.store.ts:1773-1778`) records an earlier deliberate decision against a held listener. The design addresses it (line 389), but it should be raised as a reversal of a recorded ruling in the ADR.

### 4. Major

**Scope:** lines 77-79, 116, 352-354, 365, 785-787 (D1, the cap).

The goal "finds every future visit" (Goal 3) conflicts with the safety cap of 3,000 per side. The default horizon is two months (`booking-policy.data.ts:61`), so about 2,400 future visits fit. The policy accepts other values: the rules integration spec seeds `horizonMonths: 12`. At the design's own 40 visits a day, 12 months is about 14,600 visits, so the cap silently truncates to about 75 days and the goal fails. Either size the cap from the horizon or drop the "all future" promise to "up to the cap". The reads/cost table also assumes the default horizon only. The Open Question on "120 days" (line 125) is also inconsistent with the 2-month default used elsewhere.

### 5. Major

**Scope:** lines 77-79, 177-183 (CUJ 5), 371, 689, 691, 693, 135-138 (Open Question).

"Search older" is speculative. It adds `readAppointmentRange`, `olderRange`, an `olderReached` signal, merge-by-id logic and a result row, all for a case ("in the spring") that nobody has asked for. The design's own Open Question says the client card already has a paged history (`observeHistory` exists in `appointments.adapter.ts`). Cut it from v1. If kept, jump to the client card instead of widening the sheet's window.

### 6. Major

**Scope:** lines 447-450, 729-731.

The design adds a new DS element `ui-search-token` with its own spec, showcase page and CSS (a pill with a remove button, 36 px target, accent-wash grammar). A removable chip already exists: `button[uiChip]` (`libs/ui/controls/src/lib/chip/chip.ts`). Its docblock says "a trailing `ui-icon` (a removable token's ✕)", it has `uiSelected` and size, and it follows the interaction grammar. `styling-conventions.md` says to extend the original in `libs/ui`, never copy it beside itself. Compose `uiChip` inside `ui-search-field` through `uiTokens`, and use the same `uiChip` for the idle suggestion chips.

### 7. Major

**Scope:** lines 118, 314-318, 168, 183 (filter hints), 326-335 and 720 (facets), 719 (`patch`), 721, 689.

Several pieces are speculative or over-built for the stated need.

- The hidden `barber:`/`бръснар:` typed-hint parser. The design states "nobody has to know it" (line 21) and calls it a "hidden extra" (line 118). Its cost is a key table, prefix resolution, ambiguity rules, and bg/en keys. Cut it, since the chips and suggestions already cover the need. Alternative F's justification ("costs one small parser") understates this.
- `facets` with "each facet's own filter lifted" counts. This is the most algorithmically complex piece and exists only to print "(4)" next to suggestions. Offer suggestions from the distinct values in the text-matched set, without counts, and add counts later if wanted.
- `SearchIndexSystem.patch` (incremental) is premature. The design itself says one linear scan over about 4,800 visits is a few milliseconds (line 531); building the folded index per listener batch is enough. A 10,000-visit operation-count spec is not needed either.
- `SearchWindowSystem` (a whole system, spec and three named constants) wraps one date subtraction plus the existing `BookingPolicy.horizonEndFrom` (`booking-policy.data.ts:252`). Put the constants next to the store or the policy and call `horizonEndFrom` directly.
- `SearchRecentsSystem` (push/remove/clear) is an eight-line dedupe. A small function beside the recents store is enough.

### 8. Major

**Scope:** lines 20-28, 626-756 overall.

The scope is five features in one design with a cross-cutting rewrite. Stages 1-2 (highlighter, phone reading, plus the staleness fix) are root-cause and shippable. Stage 3 (reach and freshness) bundles the bug fix with the `AppointmentRangePorts` rewrite. Stages 4-5 are the Spotlight feature and need their own justification. The owner's request was a better search, but the design does not say which of filters, recents, grouped dates and event cards is required versus nice. Recommend splitting this into: (a) a short design for the highlighter and phone reading (Stages 1-2 plus a minimal freshness fix), and (b) a separate Spotlight/filters design that takes the cuts in findings 3, 5, 6 and 7.

### 9. Major (altitude)

**Scope:** Detailed Implementation, lines 626-793; also 363-371, 373-383, 493-505.

A design document is carrying an implementation plan. Examples:

- file-by-file tables that cite line numbers in other files ("about line 4023", "lines 8628 to 8638", "near 326 and 706 to 751");
- pixel values (3px radius, 1px padding, 36px target, 80 ms debounce);
- the `localStorage` key name;
- test counts and fixtures;
- per-row dollar arithmetic;
- the type-spec contents.

Those line references go stale as soon as another PR lands. Keep the architecture in the design and move the file tables to the PR plans for each stage.

### 10. Nit

**Scope:** lines 61-64 vs 88-89 vs 430-439, 593-602.

The Problem and Goal 7 say results should be "the agenda's event card (`lib-staff-event-head`, regular size)". The plan then uses `lib-visit-row` (`libs/features/shared/visits/src/lib/visit-row/visit-row.ts:67`) and admits the agenda's `.agenda-card` is not reusable. Reword Goal 7 to match the decision. The row VM and options changes (`VisitRowFields`, `VisitRowOptions`, `visit-row.html`, `visit-row-text.*`) are a cross-feature edit worth naming as a risk, not just a table row.

### 11. Nit

**Scope:** lines 30-34, 109-121, 587-591, 756.

The text depends on a conversation the reader never saw ("You asked", "Decisions made on your delegation", "pick your recommendations"). A new team member cannot check what was requested, so record the requirement in neutral terms. Line 756 is a leftover draft-skill instruction (`design_draft.md → …`) and should go.

### 12. Nit

**Scope:** lines 301-303, 336-337 vs recents at 506-508, 739.

Law checks look fine: the flat query slice follows Law 6, systems decide and presenters word (Law 10.2), and the Firestore access stays in the store and adapters. Two small things:

- Recents "cleared on sign-out" is a new coupling between the store and the auth session that the plan never specifies. Prefer a per-device-only note and drop the sign-out hook, or name its integration point. `localStorage` is already used in `staff-day.store.ts` and `agenda-fields.ts`, so follow that existing pattern.
- `SearchIndexSystem` is described as "parallel arrays". CLAUDE.md Law 3 says arrays of structs scanned linearly, so confirm that this struct-of-arrays layout is intended.

## What is good (keep)

- Range on `utcEpochMs` with no new index (lines 257, 356-359).
- Not rewriting the user's text under the caret (Alternative E).
- The explicit rejection of a hosted search service and of a server prefix index.
- No new Firestore fields or rules.
- The Stage 1-2 order that ships the bug fixes first.

## Files referenced

- `docs/designs/staff-search.md`
- `libs/ecs-core/src/systems/client-query.system.ts`
- `libs/ecs-core/src/systems/phone.system.ts`
- `libs/ecs-core/src/systems/search-fields.system.ts`
- `libs/ecs-core/src/components/booking-policy.data.ts`
- `libs/ecs-core/src/systems/visit-list.system.ts`
- `libs/ui/controls/src/lib/chip/chip.ts`
- `libs/features/staff/dashboard/src/lib/staff-day.store.ts`
- `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-search.presenter.ts`
- `libs/features/shared/visits/src/lib/visit-row/visit-row.ts`
- `libs/infrastructure/firestore/src/lib/observe.ts`
- `libs/infrastructure/firestore/src/lib/subscribe-with-retry.ts`
