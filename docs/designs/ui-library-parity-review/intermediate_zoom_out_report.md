# Intermediate Zoom Out review (Stage 8): `docs/designs/ui-library-parity.md`

- **Date:** 2026-11-25
- **Reviewer:** `egm-zoom-out`, fresh context, given the Stage 5, 6 and 7
  reports
- **Range:** full file, lines 1 to 955. The document was not edited between
  Stage 5 and this stage.

**Verdict: does not pass the Zoom-Out Standard.** Context sufficiency passes.
The document fails Simplicity and Anti-Weeds more clearly than at Stage 5,
because Stages 6 and 7 found that four of its five parts cannot be built as
written. Fixing each part in place would make the design larger, so the
answer is to cut scope.

The reviewer read the persona, the standard, the full target, the three
reports and `README.md`, and ran code searches. It did not read `CLAUDE.md`,
`concepts_brief.md` or `admin-programs.html`.

## Findings, most serious first

### 1. Major: the lint rule would not have caught the incident that motivates the design

- **Scope:** Problem 1, Part 2, G2.
- **Evidence:** the incident is `.booking-pick`, a class on `button uiButton`
  that opens a `ui-menu`. The design concedes the rule cannot see that case.
- **Rationale:** only the index answers the root problem. Stage 7's Blocker
  asks for per-type and per-role maps to repair a rule that addresses a
  secondary problem.

### 2. Major: the choice-tiles defect needs a unit spec, not a Playwright checklist

- **Scope:** Part 3, items 23-28.
- **Evidence:** the design says jsdom cannot test focus. But
  `libs/ui/controls/src/lib/segmented-control/segmented-control.spec.ts:84-133`
  already asserts arrows, wrapping, Home/End and `tabindex` in the unit
  runner.
- **Rationale:** the one known keyboard defect can be fixed and pinned by
  copying that spec. The role contracts, the new `libs/shared/e2e-a11y`
  library, eight forced showcase pages and a CI job are infrastructure for a
  generic runner with one known failure to find.

### 3. Major: the feature "violations" are a missing library capability

- **Scope:** Problem 2, items 16-17.
- **Evidence:** two `radiogroup` sites and six `role="checkbox"` sites in
  feature templates, all on `uiListRow` or a feature button.
- **Rationale:** eight sites of one shape mean the library lacks a selectable
  list row. Lint plus an allow-list hides that; the fix is in `libs/ui`. It
  needs its own short design and an owner decision.

### 4. Major: the `.booking-pick` plan deletes a stylesheet still in use

- **Scope:** Part 2, items 19-20.
- **Evidence:** four uses in three templates. The fourth is
  `booking-schedule-step.html:211`, a time pick that is not a menu.
- **Rationale:** item 20 breaks that screen. The look belongs on a button
  tier, not as new `ui-choice-menu` inputs.

### 5. Major: the lag gate should be cut, not repaired

- **Scope:** G4, Part 4, items 34-36.
- **Evidence:** `apps/showcase/playwright.config.mts:32-41` says the showcase
  production build prerenders and ships a service worker that fights the
  tests. That is a fourth obstacle beside the three in Stage 7.
- **Rationale:** no lag has been observed. Every repair adds machinery to a
  gate with no proven bottleneck.

### 6. Major: one planned motion item is already done

- **Scope:** the exit-timer audit, item 42.
- **Evidence:** both exit timers already cancel on re-open and already read a
  duration token from computed style.
- **Rationale:** the audit as written is a no-op. The real coupling is that
  `sheet.ts:185-192` finishes on the first `transform` or `opacity`
  transition to end, so a short opacity fade would hide a sheet mid-spring.
  Not checked: whether the sheet surface transitions opacity.

### 7. Nit: counts

- 110 selector declarations sit in 105 non-spec files under `libs/ui`, which
  reconciles "110+" with "105 files". "83 elements plus 14 directives" is
  still unexplained.
- Of the 14 key bindings, 6 are `keydown.enter` or `keydown.escape`, not 7.

## (a) Stage 5 findings after Stages 6 and 7

| Stage 5 finding                          | Status                   | Why                                                                                                           |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1. Five projects in one design           | Strengthened             | Each part now has its own unresolved fault, and the parts are not independently shippable.                    |
| 2. `.booking-pick`                       | Strengthened             | Confirmed by search; Q2 and Part 2 also disagree.                                                             |
| 3. Radio groups are list-row checklists  | Strengthened and widened | Six checkbox sites share the shape.                                                                           |
| 4. Lag harness                           | Strengthened             | Cannot run on the web app, does not measure compositor motion, and 50 ms at 4× is about 12.5 ms of real work. |
| 5. Spring machinery ahead of the trial   | Strengthened             | Neither Stage 6 nor Stage 7 could parse the trial step.                                                       |
| 6. Lint rule too wide                    | Strengthened to Blocker  | It bans `<textarea uiTextField>`, the library's own API.                                                      |
| 7. Renames                               | Strengthened             | Scope differs in three places; the typechecker misses CSS and test selectors.                                 |
| 8. Index check does four jobs            | Strengthened             | Its drift guard would reject the rule's own map; `@uiShowcase` is undefined.                                  |
| Nit: `switch` contract tests the browser | Weakened                 | `ui-switch` is a `button role="switch"`, so `aria-checked` is library code.                                   |
| Nit: phone-field repair                  | Raised to Major          | It would change a deliberate combobox pattern.                                                                |
| Suggestion: split into three designs     | Revised                  | The checklist should not be a design yet.                                                                     |

Nothing is overturned.

## (b) The Stage 7 mitigations

| Mitigation                                | Breaks the standard?                                    | Better answer                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint rule with per-type and per-role maps | Yes: most entries would read "no element, allowed".     | Ban only what has a real replacement and no hits after the fixes: `tablist`, `tab`, `<select>`, and bare `<input>` or `<textarea>` without `uiTextField`. Drop the key-handler ban and the stylelint ban. Bare inputs were not counted. |
| Per-finding allow-list                    | Yes: needed only by the wide rule.                      | With the narrow rule, an inline disable comment with a reason at the site.                                                                                                                                                              |
| Frame-level lag measure                   | Yes: a second measurement inside an unproven gate.      | Cut the gate. One before/after run inside the motion work, measuring frames, built on `docs/design-research/staff-analytics/perf/pr1-entry.mjs`, which already uses the `csp-smoke` build, emulators, 4× throttle and a phone viewport. |
| Showcase CI job and page convention       | Yes: the convention exists to serve the generic runner. | Cut the runner; use the unit spec of finding 2.                                                                                                                                                                                         |
| Required `@uiRole`                        | Yes: a tag on 105 files that mostly says `none`.        | Its only consumers are the runner and the lint map. Cut both and the tag goes.                                                                                                                                                          |
| Exit timers read the spring duration      | No.                                                     | Keep, in the motion design, with the check in finding 6.                                                                                                                                                                                |
| Byte estimates per part                   | Mostly paperwork.                                       | Drop G7 as a goal; `verify:bundle` already gates it.                                                                                                                                                                                    |

## (c) Recommended shape

**Stays in this design, retitled "UI element index and reuse fixes" (about 15
of the 43 items):**

- The index generator and check, with two required tags (purpose, aliases)
  and two optional ones (SwiftUI counterpart, not-this).
- The agent rule lines and the README stub.
- Four tab lists become `ui-segmented-control`, with the role change and the
  specs that query `[role="tab"]` named as a risk.
- `ui-choice-tiles` gains Home/End and a single tab stop, pinned by a unit
  spec.
- `.booking-pick` with corrected facts: four uses, look moved to a button
  tier.
- The narrow lint rule, enabled once it has no hits.

**Moves to a motion design:** the literal-curve trial first, then tokens
shaped by its outcome, the exit coupling, the Safari floor (Q5) and the
one-off measurement.

**Moves to a short design or owner decision:** selectable list rows in
`libs/ui` for the eight radio and checkbox sites.

**Dropped:**

- The lag harness as a CI gate.
- Both renames (G6).
- G7 as a goal.
- The phone-field repair.
- The role-contract runner, `libs/shared/e2e-a11y`, the forced showcase
  pages, `@uiRole` and `@uiShowcase`.
- The key-handler and stylelint bans, the `allowIn` option and
  `slider-keys.ts`.
- `spring.ts`, the `bouncy` token and the split duration and easing parts.

**Reasoning:** the cut design answers the reported incident and the one
confirmed library defect with existing patterns: the icon check, the unit
runner and inline lint disables. Everything dropped either has no observed
problem or exists to support something else that is dropped. Revisit the
checklist when a second keyboard defect appears.
