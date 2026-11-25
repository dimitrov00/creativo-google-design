# Implementation readiness review (Stage 9, round 1): `docs/designs/ui-library-parity.md`

- **Date:** 2026-11-25
- **Range:** DetailedRange, lines 610 to 955
- **Reviewers:** `egm-implementation-readiness` (completed, text search of
  the repo, nothing built), `egm-codebase-details` (completed, checked paths,
  counts and config against the repo), `egm-style` (completed, wording only)
- **Standard:** `implementation-readiness-standard` for the first two

**Verdict: not implementation-ready.** After merging: 6 Blockers, 16 Major,
about 20 Nit. The round is not clean.

Ids are `<reviewer>-<round>-<n>` with `ready`, `code` and `style` as the
reviewer names. Merged findings list every id.

## Blockers

### ready-1-B1, code-1-B1 — Item 20: the `.booking-pick` inventory is wrong and the delete breaks the build

The plan says three triggers in two components. There are four in three:
`booking-bag-sheet.html:26`, `booking-services-step.html:368` and `:418`,
`booking-schedule-step.html:211`. Three components list the stylesheet
(`booking-bag-sheet.ts:210`, `booking-services-step.ts:149`,
`booking-schedule-step.ts:166`). The schedule step appears nowhere in the
plan, so deleting `booking-select.css` leaves a dangling `styleUrls` entry.
Undecided: what the schedule-step time pick becomes. Unlisted dependents:
`accent-rule.spec.ts:495` (`.booking-pick__check`), `booking-bag-sheet.css:185`.

### ready-1-B2, code-1-B2 — Item 40: the trial targets a `transform` transition that does not exist

`segmented-control.css:72-75` transitions `inset-inline-start` and `opacity`.
The thumb is positioned by `inset-inline-start` and `inline-size`. "Takes the
spring token. Nothing else changes" cannot be carried out. The choices are:
spring `inset-inline-start`, which breaks the plan's own rule 3 (transform and
opacity only); or re-position the thumb with `translateX`, a rewrite with
right-to-left handling. The plan also does not say which token applies. The
whole of stage 5 depends on this trial.

### ready-1-B3, code-1-B4 — Item 31: the phone-field change does not match the code

`phone-field.ts:448-572` implements two presentations chosen at open time: a
`ui-modal-sheet` at 760px or narrower, and an anchored popover with a search
box. "About lines 480-572 is removed" would cut through `openPicker` and
delete the presentation choice, the trigger's combobox key handler, the sheet
close sequence and the focus hand-back. Undecided: whether the compact sheet
survives, how a search box lives inside `ui-menu`, whether the ARIA pattern
changes, which spec assertions change, what changes in `phone-field.lazy.ts`.

### ready-1-B4, code-1-M6 — Items 16 and 17: the outcome per site is not decided

Four rows of item 16 say only "Triage" for files not read. Two rows leave the
element open. Item 17 gives no outcome for any of the 14 bindings in 9 files
and no full paths. The allow-list is path-based, but the bindings named for
exemption sit in the two editor templates; exempting those would switch the
rule off for files item 16 says must be fixed. The rule sees only templates,
so key handling in TypeScript (`swipe-to-delete.directive.ts`,
`staff-visit-editor.ts`) is invisible to it. The role-to-selector map is not
written out. At `warn` (2a), `nx run-many -t lint` does not fail, which
contradicts CUJ 2 until 2b.

### code-1-B3, ready-1-M2 — Item 33: the modal-sheet input inventory is wrong

`modal-sheet.ts:67-145` declares 13 inputs: 12 unprefixed and
`uiPresentationSizing`. The plan says eleven and omits `titleCollapsed`. The
mapping is irregular (`open` → `uiPresented`) then "likewise" for six names.
Outputs `dismissed`, `closeFinished`, `sheetScrolled` are not addressed.
Whether `uiPresented` is an `input` or a `model` is not said. The 29 users
include library files and two showcase pages, so `pnpm nx build showcase` is
needed as well as the web build.

### code-1-B5, code-1-B6 — Items 7, 25, 26, 35: CI edits contradict a pinned workflow spec, and the checklist is never wired to run

- `tools/verify/ci/ci-workflow.spec.mjs:45-53, 114-116` asserts exactly seven
  job names; a new lag job fails `verify-tools:test`. The same spec forbids
  `continue-on-error`, so "non-required" has no mechanism. It also fixes the
  first steps of every job and the list of jobs that install Chromium.
- `pnpm icons:check` is in job `main` (`ci.yml:73`); the Technical Plan says
  "the static job".
- `apps/showcase/project.json` has no explicit `e2e` target, no CI job runs
  the showcase suite, and `package.json` has no script for it. The plan names
  no command for `a11y-checklist.spec.ts`.
- The existing showcase suite is a screenshot spec with `chromium-darwin`
  baselines, which would fail on Linux CI.

## Major

- **ready-1-M1 — Items 11, 16: the `<input>` finding misses the site it is
  meant to fix.** The number inputs carry `uiTextField type="number"` and
  pass. Not specified: the set of field directives, the `type` → element map,
  the `datetime-local` input at `admin-programs.html:302`.
- **ready-1-M3, code-1-M2 — Which element gets which `@uiRole` is never
  stated.** `role: 'dialog'` is on `sheet.ts:64`, not on modal-sheet or
  detail-sheet; alert is `alertdialog`; toast and count-stepper match none of
  the five roles. The page list is left to trial and error. The role-to-page
  artifact the spec reads is not defined.
- **ready-1-M4 — Items 24, 25: the runner cannot work for closed overlays.**
  Contracts take one locator but assert opening and focus return. No trigger
  convention or function signatures.
- **ready-1-M5 — Item 1: the generator's contract is not specified.** Tag
  grammar, the `@uiShowcase` format, export resolution, attribute and compound
  selectors, output order.
- **code-1-M1 — Item 4: "81 do" is false, and tag content is left to the
  implementer.** `≙ SwiftUI` appears 56 times across 41 files including CSS
  and HTML; at most 47 non-spec element files have any `≙`. Well over half of
  the 105 files have no starting material. Files with several decorators
  (`menu.ts`, `sheet-headline.ts`, `choice-menu.ts`, `quick-actions.ts`) have
  no rule for which class gets tags. (Also style-1-M7: "proves none was
  missed" is stronger than the check.)
- **ready-1-M6, code-1-M12 — Item 19: the new choice-menu API is a design
  task.** `ui-choice-menu` does not own its trigger; the consumer projects it
  through `[uiMenuTrigger]`. New trigger inputs mean choice-menu must start
  rendering a trigger. No names, types or template shape.
- **ready-1-M7, code-1-M9 — Items 37 to 39: the spring maths is not pinned,
  and the wrong comment is targeted.** No mapping from (duration, bounce) to
  stiffness and damping, settle threshold, stop count or comparison format.
  `tokens.css:283-287` documents the marketing tiers; the control scale is at
  line 279. The conventions bullet spans 119-125, and 123-125 hold the literal
  ban, which must survive.
- **ready-1-M8, code-1-M4, code-1-M5 — Items 14 and 41: the stylelint claims
  do not match the config.** Spring tokens in `transition` already pass.
  Nothing refuses `linear(` today. The existing override nulls the value lists
  for `libs/ui/**` and `libs/features/**`. No regexes are given, and the new
  override collides with the existing one for `libs/features/**/*.css`.
- **ready-1-M9, code-1-M3 — Item 42: the exit timers already cancel on
  re-open.** `menu.ts:325-327`, `sheet.ts:150-155`. The real issue is
  unaddressed: both timers are sized from the old duration tokens plus 50 ms,
  so a spring exit would be cut short. No token per site, no per-step file
  lists. (Also style-1-M10.)
- **code-1-M10 — Item 43: "two literal durations" is three**
  (`staff-dashboard.chrome.css:65` 180 ms, `:120` 160 ms, `:122` 40 ms). No
  180 or 160 token exists, so behaviour changes. Replacement tokens unnamed.
- **ready-1-M10, code-1-M11 — Items 34 to 36: the harness is not buildable
  from the plan.** No server, routes, selectors, measurement method, baseline
  schema or margin. The showcase production build prerenders and ships a
  service worker (`apps/showcase/playwright.config.mts:32-41`).
  `measure-lag.spec.mjs` must be a `node:test` spec, and the cached test
  target's inputs do not cover `apps/showcase`. Item 36's target file is
  undecided. (Also style-1-M8.)
- **ready-1-M11, code-1-M7 — Item 32: rename scope incomplete, showcase pages
  collide.** `stepper/` today shows the progress trail; 3a creates
  `count-stepper/`; 3c renames. Unlisted: `date-field.ts`, the CSS class
  prefixes (28 in `count-stepper.css`, 7 in `stepper.css`), snapshot
  baselines. New class names are not stated.
- **code-1-M8 — Item 23: the new library is under-specified.** No project
  name, alias, tags or targets. `eslint.config.mjs:124-131` puts
  `/libs/shared/` in the UI layer, so production-code guards would apply to
  Playwright helpers. `tools/verify/project.json:50` needs a new cache input.
- **code-1-M13 — Phasing of `--check`.** `ui-index-tools` importing the lint
  rule needs `tools/lint-rules/**` as a cache input. Item 18's function has no
  signature.
- **style-1-M1, M2, M3 — Structure of the plan.** "Two lists are incomplete"
  undercounts: items 16, 21, 26, 32 and 42 are all open. Stages 2, 3 and 5
  carry no Conventional Commit title. Items are not assigned to their
  sub-pull-requests.
- **style-1-M4, M5, M6, M9 — Precision.** Item 3's paths read as root files.
  Item 16's heading count, table and outcome column disagree. Item 17 locates
  files by a search output the reader does not have. Owner acceptance of the
  trial has no criterion or defined outcomes.

## Nit

- Item 21's stylesheet list is "number unknown"; the standard requires an
  explicit list. 2a must fix or disable every CSS hit to land green.
- Verification Plan: no named test cases for items 19, 20, 30, 31; feature
  specs that query replaced roles are not listed (`staff-visit-editor.spec.ts`
  holds 12 role selectors); `pnpm nx build functions` is unrelated.
- Item 9: the exact line for `CLAUDE.md` / `AGENTS.md` is not given.
  `CLAUDE.md` §3 is "Workspace map".
- Item 3: say which inputs and tags the copied project config keeps.
- Item 8 is conditional; decide it.
- Items 16, 17, 21, 32, 42 drop the Type / Proposed Changes structure.
- Wording (style nits 11 to 21): "file N" for "item N"; "about lines
  480-572"; "small library"; unnamed tokens and durations; the Unit Tests
  bullet runs more than unit tests; item 34 has no change statement of its
  own.

## Verified as accurate

- 105 element files; 14 role files; 14 key bindings in 9 templates.
- Six importers of the axe helper; 29 files using `ui-modal-sheet`.
- `menu.ts:387` and `sheet.ts:201` are the exit timers.
- `docs/styling-conventions.md:119-121` holds the motion cap.
- The `tools/icons/` config trio, `path-scope.mjs`, the `**/*.html` lint
  block and the `max-lines` caps exist.
- `rhythm-card.css:83` uses the undefined token.
- The feature user list for the stepper rename matches the search.
- No existing roving utility to reuse.

## Position after all five stages

Every stage returned "revise". The implementation plan's blockers fall into
two groups:

- **Facts I got wrong:** the booking picker's uses, the segmented thumb's
  transition property, the modal-sheet input count, what the exit timers
  already do, the stylelint config, the SwiftUI comment count.
- **Decisions never made:** per-site outcomes for 14 role files and 14 key
  bindings, the role tag per element, the choice-menu trigger API, the
  phone-field pattern, the spring maths, the harness definition, the CI
  wiring.

Stage 8 recommended cutting the design to about 15 items (index, four tab
lists, the choice-tiles fix, the booking picker with corrected facts, a
narrow lint rule) and moving motion and selectable list rows to their own
designs. Under that cut, blockers B2, B3, B5 (lag job) and the checklist half
of B6 leave this document, and most of the undecided items go with them.
