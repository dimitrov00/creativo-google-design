# Zoom Out review (Stage 5): `docs/designs/ui-library-parity.md`

- **Date:** 2026-11-25
- **Reviewer:** `egm-zoom-out`, fresh context, no extra context supplied
- **Range:** full file, lines 1 to 955

**Verdict: does not pass the Zoom-Out Standard as written.** Context
sufficiency passes and the rejected alternatives A to H are sound. It fails
Simplicity and Anti-Weeds: five separable projects are bundled, the fix for a
findability incident has grown to 43 work items, and two feature-fix plans
contradict the code.

The reviewer read the persona, the standard, the full target,
`concepts_brief.md` and the repo files cited below. It did not read
`README.md`, so alignment with root docs is unchecked.

## Major

### 1. Five projects in one design; only two address the stated root problem

- **Scope:** Overview (29-30), "five parts" (67-69), Stages 3c, 4, 5.
- **Evidence:** `concepts_brief.md:37-52` says the one reported incident is a
  findability problem and that renames, behaviour directives and spring
  tokens would not have changed it. Alternative J concedes "no pain is
  reported".
- **Rationale:** Parts 1 and 2 answer the incident. The lag harness, spring
  motion and renames are independent workstreams with their own open
  questions (Q4, Q5, the owner trial).
- **Suggestion:** Split into at least three designs: index and enforcement;
  accessibility checklist and repairs; motion with its measurement.

### 2. The `.booking-pick` plan is wrong about the code

- **Scope:** Part 2 (297-302), item 20.
- **Evidence:** The doc says the class is used three times in two booking
  templates. It is used four times in three: `booking-bag-sheet.html:26`,
  `booking-services-step.html:368` and `:418`, and
  `booking-schedule-step.html:211`.
- **Why it matters:** The schedule-step use opens a time sheet, not a
  `ui-menu`, so it cannot become `ui-choice-menu`. It still needs the look in
  `booking-select.css`, which item 20 deletes.
- **Rationale:** The large glass pill with a placeholder has a consumer that
  is not a choice menu. The look belongs on the button tier, not as new
  `ui-choice-menu` inputs (item 19, Q2).

### 3. The two "radio groups" are owner-ruled list-row checklists

- **Scope:** Problem 2 (46-47), Part 2 (293), item 16.
- **Evidence:** `staff-block-editor.html:31-77` is `ul[uiListGroup]` with
  `button[uiListRow][role=radio]`, a two-line label and a trailing check. Its
  comment cites "Apple's Repeat page" and an owner ruling of 2026-09-24.
  `staff-visit-editor.html:2167-2185` is the same shape over a variable-length
  shop list.
- **Why it matters:** `ui-choice-tiles` is a grid of figures and a segmented
  control cannot hold N shops with detail lines. Either replacement is a
  visual redesign, which is a Non-Goal.
- **Rationale:** The honest fix is keyboard support for a list-row radio
  group inside `libs/ui`. That would be a third user of roving focus, which
  is the doc's own trigger to reconsider Alternative A.

### 4. The lag harness is a permanent CI gate built before any lag is observed

- **Scope:** G4, Part 4, items 34-36, Q4.
- **No baseline exists:** if any interaction already exceeds 50 ms at 4×
  throttle, the gate is red on day one, and the doc does not say what happens
  then.
- **Flake is designed in:** the margin is undefined (Q4), and the plan needs
  medians of five runs plus a two-week non-required period.
- **Prior art is not referenced:**
  `docs/design-research/staff-analytics/perf/pr1-entry.mjs` already measures a
  production build at 4× CPU throttle on a phone viewport.
- **Suggestion:** a one-off before/after measurement scoped to the motion
  change, reusing that script's approach. Promote it to a gate only if a
  regression is ever seen.

### 5. The spring-token machinery is built ahead of the trial that decides its shape

- **Scope:** Part 5, items 37, 38, 41.
- **The trial may change the tokens.** It needs one hand-pasted `linear()`
  value on one thumb.
- **Speculative pieces committed before that:** a `spring.ts` solver with a
  spec; `-duration` and `-easing` split tokens "for JavaScript" when the doc
  says no JavaScript site takes a spring; a `bouncy` token with no named
  consumer; an `@supports not` fallback whose need depends on Q5.
- **Placement:** `spring.ts` under `libs/ui/tokens/src/lib` is library code
  that exists only to feed a spec.
- **Suggestion:** do step 0 with a literal curve, then design the tokens.

### 6. The lint rule is wider than the evidence, and its escape hatch hollows it

- **Scope:** Part 2 table, allow-list, items 17 and 21.
- **Any `keydown` is flagged.** The brief scoped this to non-trivial handlers
  (8 sites). Of the 14 current bindings, 7 are `keydown.enter` or
  `keydown.escape`.
- **The allow-list is per path.** Exempting `staff-visit-editor.html` (over
  2,400 lines) or the time grid switches the rule off for the whole file.
- **The rule misses its own example.** CUJ 2 says `<input type="number">`
  fails lint. The real sites are `input uiTextField type="number"`
  (`admin-programs.html:148-150`, `:254-256`, `:350-352`), which pass the
  "no DS field directive" test.
- **The stylelint ban has unknown scope.** It bans the bare `button`
  selector, with 34 candidate files and "number unknown".

### 7. G6 renames are vocabulary churn unrelated to the root problem

- **Scope:** G6, Part 3 renames, items 32 and 33.
- **The stepper swap is hazardous.** Swapping the meaning of `ui-stepper` in
  place leaves 213 doc mentions and every agent's prior knowledge pointing at
  the wrong element. The index's alias table already answers "which one is
  the Stepper".
- **The scope grows silently.** G6 and Part 3 name three `ui-modal-sheet`
  inputs; item 33 renames all eleven across 29 files.
- **Suggestion:** drop the swap, or rename only `ui-count-stepper` and retire
  the old name without reusing it.

### 8. The index check accretes four duties and couples three stages

- **Scope:** Part 1, items 1, 15, 27.
- **Evidence:** one script validates tags, output staleness, the ESLint
  rule's replacement map and showcase-page coverage.
- **Undeclared tag:** `@uiShowcase` appears only in item 1.
- **Filler metadata:** four required tags on all 105 files, including charts,
  icons and modifiers, will mostly read "app pattern".
- **Suggestion:** require only purpose and aliases, and keep the lint map
  check inside the lint rule's own spec.

## Nits

- **Native radios not weighed.** The brief lists them as a way to delete both
  arrow-key handlers; the design goes to a new `roving-index.ts` without
  considering it.
- **Phone-field repair.** It removes about 40 duplicated lines with no defect
  reported, and the doc does not say how a listbox with type-to-find fits
  `ui-menu`'s `menu` contract. Not verified in `phone-field.ts`.
- **Role contracts for `slider` and `switch`.** These are native elements, so
  the contract tests the browser.
- **Toast page.** Toast is forced to gain a showcase page "because it
  declares a role", but none of the five covered roles is a toast.
- **Altitude.** The Technical Plan carries line numbers that will rot. Name
  the behaviour instead.
- **Count mismatch.** "81 existing `≙ SwiftUI` comment lines": a search finds
  129 occurrences across 69 files. State what was counted.
- **Untracked source.** `concepts_brief.md` is the cited evidence base and is
  untracked, so the reference dangles unless it is committed.
- **New library for one helper.** `libs/shared/e2e-a11y` may be forced by
  module boundaries, but the doc should say so.

## Confirmed as stated

- `ui-choice-tiles` lacks Home/End and a single tab stop.
- `libs/ui/controls/README.md` is the Nx stub.
- `.claude/rules/angular-ui.md` names no element.
- The showcase e2e covers 13 hard-coded routes and runs no axe scan.
- There are no spring or `linear()` tokens in `tokens.css`.
- Role-bearing feature templates number 14 files, and key handlers number 14
  bindings in 9 files.
