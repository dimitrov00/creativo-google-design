# UI library: element index, reuse enforcement, accessibility checklist and spring motion

- **Author:** Dimitar Dimitrov
- **Status:** Proposed — reviewed, not ready to build (see the note below)
- **Date:** 2026-11-25

> **Review outcome, 2026-11-25: do not build from this document as written.**
> A five-stage review returned "revise" at every stage and the findings are
> unresolved. The implementation plan has six open blockers. Known faults
> include:
>
> - Item 20 deletes `booking-select.css`, which the booking schedule step
>   still uses (`.booking-pick` has four uses in three components, not three
>   in two).
> - The `creativo/ds-controls-only` rule as specified fails every legitimate
>   `<textarea uiTextField>` and passes the number inputs it was meant to
>   catch.
> - The motion trial (item 40) targets a `transform` transition that the
>   segmented control thumb does not have.
> - The lag CI job (item 35) contradicts `tools/verify/ci/ci-workflow.spec.mjs`,
>   and nothing runs the keyboard checklist.
> - Per-site outcomes for 14 role files and 14 key handlers are undecided.
>
> The Stage 8 reviewer recommends cutting this design to about 15 of its 43
> items (the index, the four tab lists, the choice-tiles fix, the booking
> picker with corrected facts, a narrow lint rule) and moving motion and
> selectable list rows to designs of their own.
>
> Reports, in [`ui-library-parity-review/`](./ui-library-parity-review/):
> [zoom out](./ui-library-parity-review/zoom_out_report.md),
> [comprehension](./ui-library-parity-review/comprehension_report.md),
> [critic](./ui-library-parity-review/critic_report.md),
> [intermediate zoom out](./ui-library-parity-review/intermediate_zoom_out_report.md),
> [implementation readiness](./ui-library-parity-review/implementation_readiness_report.md).

---

## Overview

`libs/ui` is the design system of the web app: about 83 `ui-*` elements, 14
modifier directives and one set of `--sys-*` tokens. The owner wants it to
behave the way Apple's SwiftUI does for an app developer: there is one obvious
element for each job, every screen uses it, keyboard and screen-reader support
come with it, and motion feels the same everywhere.

A review of the library (`concepts_brief.md`, 2026-11-25) found that the
library itself is close to that already. Most keyboard and focus behaviour is
handed to the browser or shared by composition. What is missing sits around
the library:

- no list of elements that a person or an AI agent can search;
- no check that feature code uses the library;
- no test that every control meets one keyboard and ARIA standard;
- no measurement of interaction lag;
- motion tokens that are Material's curves, with a 300 ms cap that rules out
  Apple-style springs.

This design adds those five things and makes a small number of repairs. It
does not rebuild the library on headless primitives.

## The Problem

1. **The right element cannot be found.** An AI agent built its own dropdown
   look in a feature when `ui-choice-menu` already existed. No file an agent
   reads names that element. `libs/ui/controls/README.md` is a generated stub,
   the showcase covers about 42 of more than 110 selectors, and searching the
   docs for "select", "dropdown" or "picker" leads elsewhere.

2. **The reuse rule is prose.** `docs/styling-conventions.md` says features
   never hand-roll focus management or key handling. Nothing enforces it, and
   feature code breaks it today:
   - four tab lists with no keyboard support (`admin-programs.html`,
     `client-appointments.html`, `marketing-courses.html`,
     `marketing-events.html`);
   - two radio groups that answer clicks only (`staff-block-editor.html`,
     `staff-visit-editor.html`);
   - native number inputs where `ui-unit-field` exists
     (`admin-programs.html`);
   - a feature-owned picker look (`.booking-pick` in
     `libs/features/client/booking/src/lib/chrome/booking-select.css`).

3. **Accessibility is checked by hand.** `docs/accessibility-conventions.md`
   is prose. axe runs from a few end-to-end specs, not per control. One
   library defect went unnoticed as a result: `ui-choice-tiles` copies the
   arrow-key code of `ui-segmented-control` but lacks Home/End and a single
   tab stop.

4. **"No lag" is not measured.** The owner's main requirement is that
   controls, sheets and page changes never lag. There is no gate and no
   baseline for it.

5. **Motion is not Apple's.** `--sys-motion-ease-standard` is Material's
   `cubic-bezier(0.4, 0, 0.2, 1)`. There is no spring token. The conventions
   cap control motion at 300 ms, and a spring settles later than that.

The proposed solution has five parts, built in this order: a generated element
index; lint enforcement and the feature fixes; a keyboard and ARIA checklist
with three library repairs; a lag harness; spring motion.

## Goals

- **G1 — One searchable index.** Every exported `ui-*` element and `ui*`
  directive has a row giving: what it is for, its SwiftUI counterpart (type
  and style) or "app pattern", the common web names people search by, and what
  to use in its place when it is the wrong choice. A check fails when a
  selector has no row. Agent rule files load the index.
- **G2 — Features cannot hand-roll a control unnoticed.** Lint fails on a raw
  form control, a typed widget role or a key handler in a feature template,
  and on a native-control selector in feature CSS, outside a short reviewed
  allow-list. Each message names the element to use. The sites listed in The
  Problem 2 are fixed.
- **G3 — One keyboard and ARIA standard, tested.** A Playwright checklist,
  keyed by role (radio group, menu, dialog, slider, switch), runs against the
  showcase page of every control with that role. `ui-choice-tiles` and
  `ui-segmented-control` share one implementation and both pass.
- **G4 — Lag has a number.** A script on a production build at 4× CPU
  throttle performs four interactions (open a sheet, switch a sheet page,
  open a menu, change route) and fails on a main-thread task over 50 ms
  during the interaction. A baseline is recorded before any motion change.
- **G5 — Apple-style motion on moving parts.** Three spring tokens
  (`smooth`, `snappy`, `bouncy`), each with a paired duration, drive
  everything that changes position or size. The 300 ms cap is replaced by
  three rules: response is bounded, every animation can be interrupted, and
  moving parts animate only `transform` and `opacity`. G4's numbers do not
  get worse.
- **G6 — Names that read like SwiftUI where it costs little.** `ui-stepper`
  (a progress trail) gets a new name and `ui-count-stepper` becomes
  `ui-stepper`. `ui-modal-sheet` inputs take the `ui` prefix.
- **G7 — No route exceeds its bundle ceiling** in
  `tools/verify/bundle/budgets.json`.

## Non-Goals

- A library of headless behaviour directives. About 150 lines are duplicated
  today and each proposed directive would have one or two users.
- Adopting `@angular/aria`, `@angular/cdk` or ui-sdk.dev code.
- Merging `ui-modal-sheet`, `ui-detail-sheet` and `ui-detent-sheet` into one
  sheet, or the choice elements into one Picker.
- Renaming elements to SwiftUI names beyond G6.
- A new `ui-tabs` element. The four tab lists become `ui-segmented-control`.
- Replacing the ease curve on colour and opacity transitions.
- A JavaScript spring for sheet drag release. It is considered only if the
  lag harness or review shows a visible speed jump at release.
- Restructuring the `controls` / `layout` / `patterns` sub-libraries.
- Visual redesign of any element.

## Open Questions

- **Q2 — What `.booking-pick` needs from `ui-choice-menu`.** Narrowed.
  `UiChoiceOption` already has `avatarSrc`, `detail` and `description`, so
  the option rows are covered. What remains is the trigger: the large glass
  pill tier and the placeholder ("unset") look. The implementer confirms
  this by reading the choice-menu template in stage 2.
- **Q4 — Regression margin for G4.** The 50 ms long-task limit is set. The
  margin over baseline that counts as a regression needs the first baseline
  runs, to see how much the numbers vary between runs.
- **Q5 — Oldest supported Safari.** The repo has no browserslist file.
  `linear()` needs Safari 17.2 and `@starting-style` needs 17.5. The plan
  includes a fallback, but the owner should confirm the floor.

Resolved during drafting: Q1 (`linear()` in Web Animations calls) and Q3
(index source) are answered in the Technical Plan, parts 5 and 1.

## Critical User Journeys (CUJs)

### CUJ 1: An agent needs a dropdown

- **Given**: an AI agent is asked to add a "choose one of five" field to a
  feature form, and has loaded `.claude/rules/angular-ui.md`.
- **When**: it searches the index for "select" or "dropdown".
- **Then**: it finds the `ui-choice-menu` row, with its SwiftUI counterpart
  and a note on when `ui-segmented-control` or `ui-choice-tiles` is the
  better choice, and uses it without writing CSS for a control.

### CUJ 2: A raw control reaches a feature template

- **Given**: a change adds `<div role="tablist">` or `<input type="number">`
  to a file under `libs/features/`.
- **When**: `pnpm nx run-many -t lint` runs.
- **Then**: lint fails with a message that names the element to use
  (`ui-segmented-control`, `ui-unit-field`).

### CUJ 3: A keyboard user changes a choice

- **Given**: any radio-group control in the app (segmented control, choice
  tiles) has focus.
- **When**: the user presses arrow keys, Home, End, then Tab.
- **Then**: selection moves the same way in every such control, and Tab
  leaves the group in one press.

### CUJ 4: A new element is added to the library

- **Given**: a developer exports a new `ui-*` element.
- **When**: the index check and the checklist run.
- **Then**: the index check fails until the element has a row, and the
  checklist runs against its showcase page if it declares a covered role.

### CUJ 5: A user taps twice quickly

- **Given**: a segmented control whose thumb is mid-glide, or a sheet that is
  still opening.
- **When**: the user taps another segment, or dismisses the sheet.
- **Then**: the running animation retargets from where it is; the second
  input is not ignored or queued until the first animation ends.

### CUJ 6: A motion change slows the app

- **Given**: a change to motion tokens or to an element's transition.
- **When**: the lag harness runs against the production build.
- **Then**: it fails if any of the four interactions produces a main-thread
  task over 50 ms or exceeds the recorded baseline.

## Technical Plan (Architecture)

The work adds tooling around `libs/ui` and changes little inside it. Five
parts, each shippable on its own, in this order.

```text
 libs/ui/**/<element>.ts              tools/ui-index/build-ui-index.mjs
 ┌──────────────────────────┐  read   ┌───────────────────────────────┐
 │ @Component selector      │ ──────▶ │ collect selectors + index tags│
 │ docblock index tags      │         │ --check: fail on missing row  │
 └──────────────────────────┘         │          or stale output      │
                                      └──────────────┬────────────────┘
                                                     │ writes
                                                     ▼
   .claude/rules/angular-ui.md  ── points to ──▶ docs/ui-elements.md
   AGENTS.md / CLAUDE.md                          (one row per element)
                                                     │ names used in messages
                                                     ▼
 libs/features/**, apps/web/**        creativo/ds-controls-only (templates)
 ┌──────────────────────────┐  lint   stylelint selector ban (feature CSS)
 │ templates + CSS          │ ◀────── allow-list in eslint.config.mjs
 └──────────────────────────┘

 apps/showcase (one page per control)
        │ Playwright                          │ production build, 4× CPU
        ▼                                     ▼
 role checklist + axe  (part 3)        lag harness + baseline  (part 4)
                                              ▲
 libs/ui/tokens/tokens.css spring tokens ─────┘ must not regress (part 5)
```

### Part 1 — Element index

**Source of truth: tags in each element's own docblock.** The class docblock
of every exported `ui-*` component and `ui*` directive gains four tagged
lines:

| Tag          | Content                                  | Example for `ui-choice-menu`                             |
| ------------ | ---------------------------------------- | -------------------------------------------------------- |
| `@uiPurpose` | One sentence: what job it does           | Choose one option from a list that opens on tap          |
| `@uiSwiftUI` | SwiftUI type and style, or `app pattern` | `Picker` with `.pickerStyle(.menu)`                      |
| `@uiAliases` | Words people search by                   | select, dropdown, combobox, picker                       |
| `@uiNotThis` | When another element is right            | 2–4 short options always visible: `ui-segmented-control` |

An optional fifth tag, `@uiRole`, names the ARIA role the element implements
(`radiogroup`, `menu`, `dialog`, `slider`, `switch`). Part 3 uses it.

The 81 existing `≙ SwiftUI` comment lines are the starting material for
`@uiSwiftUI`.

**Generator.** `tools/ui-index/build-ui-index.mjs` walks `libs/ui/**`, reads
each decorator's `selector` and the docblock tags, and writes
`docs/ui-elements.md`: one table per sub-library, plus an alias table sorted
by alias ("dropdown → `ui-choice-menu`"). The file is committed.

**Check.** The same script with `--check` exits non-zero when an exported
selector lacks a required tag, or when the committed file differs from the
generated one. It runs as an Nx target beside the existing icon check and in
CI's static job. Its structure copies `tools/icons/check-icon-usage.mjs`.

**Agents.** `.claude/rules/angular-ui.md` gains one instruction: before
writing any control in a template, look it up in `docs/ui-elements.md`; a new
element is created only when the owner asks. `CLAUDE.md` §3 and `AGENTS.md`
(kept identical) gain one line pointing at the index.

Alternatives for the source of truth, both set aside:

- _One central manifest file._ Simpler to parse and to read as a whole, but
  adding an element means editing two places, and the description sits away
  from the code it describes.
- _The showcase registry as the index._ Already exists, but it covers 42 of
  110+ selectors, is not readable without running the app, and agents do not
  load it.

### Part 2 — Enforcement and feature fixes

**Template rule `creativo/ds-controls-only`** in `tools/lint-rules/`, with a
spec beside it, registered in the existing `**/*.html` block of
`eslint.config.mjs` (which already parses inline templates). It applies to
`libs/features/**` and `apps/web/**` and reports:

| Finding                                                                                                                                                                                       | Message names                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `<select>`, `<dialog>`, `<textarea>`                                                                                                                                                          | `ui-choice-menu`, `ui-alert` / `ui-modal-sheet`, `ui-text-field` |
| `<input>` with no DS field directive, except `type="file"` and `type="hidden"`                                                                                                                | the field element for that `type`                                |
| A static widget `role` (`tablist`, `tab`, `radiogroup`, `radio`, `listbox`, `option`, `menu`, `menuitem*`, `combobox`, `slider`, `switch`, `dialog`, `alertdialog`, `spinbutton`, `checkbox`) | the element with that `@uiRole`                                  |
| A `(keydown…)` or `(keyup…)` binding                                                                                                                                                          | "key handling belongs to the DS element"                         |

The replacement names in messages are read from a small map in the rule; the
index check verifies every name in that map is a real selector, so the two
cannot drift.

**Allow-list.** An `allowIn` option, like the icon rule's `allowInlineSvg`,
with a comment per entry. Initial entries: the staff time grid and timeline
(canvas-specific slider handles), `site-menu.component` and
`frame-fullscreen.ts`. A new entry is a design decision made in review.

**Stylelint.** A new override for `libs/features/**/*.css` and
`apps/web/**/*.css` adds `selector-disallowed-list` entries for native
control element selectors (`input`, `select`, `textarea`, `button`,
`dialog`) and for `[role=…]` attribute selectors.

**What this cannot see**, stated so nobody assumes otherwise: a control built
from `div`s with no role, and a feature class that restyles a DS element
(the `.booking-pick` case). Part 1 and review cover those.

**Feature fixes**, done before the rule is switched to `error`:

- Four tab lists → `ui-segmented-control`.
- Two radio groups → `ui-choice-tiles` or `ui-segmented-control`.
- Native number inputs in `admin-programs.html` → `ui-unit-field`.
- The two time-grid slider key handlers share one pure function
  (key → step) and are allow-listed.
- `.booking-pick`: it is a class on `button uiButton` that opens a `ui-menu`,
  used three times in two booking templates, with its look in
  `booking-select.css` (72 lines). It becomes `ui-choice-menu`. Anything it
  has that choice-menu lacks (the large glass pill tier, a leading avatar in
  the trigger, the placeholder state, a second line under an option's name)
  is added to choice-menu as inputs, and `booking-select.css` is deleted.
  See Q2.

### Part 3 — Keyboard and ARIA checklist, and library repairs

**Role contracts.** One file of Playwright helpers, one function per role,
each asserting the keyboard and ARIA behaviour of the WAI-ARIA pattern for
that role:

| Role         | Asserted                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `radiogroup` | One tab stop; arrows move and select, wrapping; Home/End; `aria-checked` follows; disabled options skipped                                      |
| `menu`       | Opens on Enter, Space and ArrowDown; arrows move; Escape closes and returns focus to the trigger; outside press closes; `aria-expanded` follows |
| `dialog`     | Focus moves inside on open; Tab stays inside; Escape closes; focus returns to the opener; has an accessible name                                |
| `slider`     | Arrows step; Home/End; `aria-valuenow` / `aria-valuetext` follow                                                                                |
| `switch`     | Space and Enter toggle; `aria-checked` follows                                                                                                  |

**Runner.** A spec in `apps/showcase/e2e/` visits every showcase control
page, finds each element carrying a covered role, runs that role's contract
against it, and then runs the existing axe scan
(`apps/web/e2e/support/axe.ts`, moved to a location both apps' e2e can
import) on the page.

**Coverage is enforced through the index.** The index check fails when an
element declares `@uiRole` and has no showcase page. That forces the missing
pages into existence: choice-menu, choice-tiles, alert, modal-sheet,
detail-sheet, switch, toast, count-stepper and the rest.

Unit specs stay as they are. jsdom cannot test focus or popovers, so the
contracts run only in Playwright.

**Repairs.**

- _Segmented control and choice tiles._ The arrow-key arithmetic moves into
  one pure function (current index, key, count, direction, disabled set →
  next index) with its own spec. Both elements call it and both keep a single
  tab stop. No shared directive: the reviewers found `hostDirectives` binds
  only the host, and the items are in the template.
- _Phone field._ Its country popover composes `ui-menu` and drops its own
  copy of the open, position and dismiss code. `controls` may import
  `patterns`.
- _Renames._ `ui-stepper` → `ui-step-trail`; then `ui-count-stepper` →
  `ui-stepper`. Both in one change, so no commit has two meanings for one
  name. `ui-modal-sheet` inputs `open`, `closing`, `sheetId` → `uiPresented`,
  `uiClosing`, `uiSheetId`.

### Part 4 — Lag harness

A Node script under `tools/verify/lag/`, run as an Nx target, never cached.

- **Build under test:** production builds of the showcase and the web app,
  served statically.
- **Conditions:** Chromium through Playwright, CPU throttled 4× over the
  DevTools protocol, a phone viewport.
- **Interactions:** in the showcase, open a sheet, push a sheet page, open a
  menu, move a segmented control; in the web app, one route change between
  two public pages (no sign-in or emulator needed).
- **Measured, from the input event until animations finish:** the longest
  main-thread task, the count of long animation frames, and the time from
  input to the first changed frame.
- **Pass rule:** median of five runs; fail if the longest task exceeds 50 ms,
  or if any figure exceeds the committed baseline by more than the margin
  (Q4).
- **Baseline:** `tools/verify/lag/baseline.json`, committed, changed only
  with a dated note, the same discipline as `budgets.json`.

It starts as a local gate and a non-required CI job. It becomes required
once two weeks of runs show the variance is below the margin.

### Part 5 — Motion

**Rules.** `docs/styling-conventions.md` and the comment at
`libs/ui/tokens/tokens.css:283-286` drop the 300 ms cap and state:

1. A control shows the start of its reaction in the frame after input and
   covers most of its travel within about 300 ms. A spring's tail may run
   longer.
2. Every animation can be interrupted: a state change during an animation
   continues from the current position.
3. Moving parts animate only `transform` and `opacity`.

**Tokens.** Three springs with SwiftUI's preset parameters:

| Token                        | SwiftUI preset | Parameters                  |
| ---------------------------- | -------------- | --------------------------- |
| `--sys-motion-spring-smooth` | `.smooth`      | duration 0.5 s, bounce 0    |
| `--sys-motion-spring-snappy` | `.snappy`      | duration 0.5 s, bounce 0.15 |
| `--sys-motion-spring-bouncy` | `.bouncy`      | duration 0.5 s, bounce 0.3  |

Each token holds a duration and a `linear()` curve together, so it is used as
`transition: transform var(--sys-motion-spring-smooth)` and the two cannot be
mixed up. SwiftUI's "duration" is the perceived duration; the CSS duration is
the longer time the spring takes to settle, computed from the same spring
equation. The parts are also exposed separately
(`…-smooth-duration`, `…-smooth-easing`) for JavaScript.

Tokens stay plain CSS, edited by hand. A spec in `libs/ui/tokens` recomputes
each curve from its parameters and fails if the committed token differs, so
the numbers are checked without a build step.

**Fallback.** Inside `@supports not (transition-timing-function: linear(0, 1))`
the three tokens resolve to `--sys-motion-ease-emphasized` with the
`deliberate` duration (Q5).

**Reduced motion.** `libs/ui/tokens/reduced-motion.css` is a global switch
that removes transitions and animations from every element not marked
`data-motion-essential`. Spring transitions fall under it with no change.

**Where springs go.** Only where position or size changes. A search finds
141 uses of `--sys-motion-ease-standard`, and only a handful are on a
`transform` or size property; the rest are colour and opacity and keep the
ease curve.

**Trial first (owner ruling 2026-11-25).** On 2026-11-09 the owner found a
480 ms segmented glide sluggish and held controls to 150/200/300 ms. Apple's
presets run 0.5 s of perceived duration. A spring covers most of its distance
early, so it may not read the way the 480 ms ease curve did, but that is
untested here. The owner chose to try Apple's values as they are:

- Step 0 puts `--sys-motion-spring-snappy` and `-smooth` on the segmented
  control thumb only, behind nothing else, and the owner judges it on a
  phone.
- If it reads as sluggish, controls (thumbs, knobs, press) get a
  shorter-duration variant of the same springs, about 0.3 s perceived, and
  the 0.5 s presets stay for sheets and other large surfaces. The token
  table then gains a control tier, and the 2026-11-09 ruling stands for
  controls.
- If it reads well, the 2026-11-09 ruling is replaced by rule 1 above, and
  the rollout continues with Apple's values.

Rollout order after the trial, each step checked against the lag harness:

1. Switch knob (the segmented thumb is done in step 0).
2. Slider thumb, press scale of `uiInteractive`.
3. Menu open and close.
4. Sheet present and dismiss, detent snaps.

**Interruption (rule 2).** CSS transitions already retarget from the current
value when the state changes mid-flight, so moving parts use transitions,
not keyframe animations, for state changes. Entrances that need a starting
state use `@starting-style`. Two exit timers are audited and made to cancel
when the element is re-opened before they fire: `menu.ts:387` and
`sheet.ts:201`.

**JavaScript animation sites (was Q1).** `alert.ts`, `toast.ts`, `metric.ts`
and `reveal.directive.ts` pass a token to `element.animate()`. They animate
opacity, a countdown ring and a scroll reveal, none of which takes a spring
under the rule above, so they keep their current tokens. `element.animate()`
accepts `linear()` in the same browser versions as CSS; if a later step
needs a spring there, it reads the `…-easing` part and falls back the same
way.

**Not in this part.** Sheet drag release keeps its current code. CSS cannot
pass the finger's speed into a transition, so a release always starts its
spring from rest. If that shows as a visible jump, a JavaScript spring for
the two drag surfaces is a separate, measured change.

**Existing faults fixed here.** The undefined `--sys-motion-duration-quick`
in `rhythm-card.css`, and the literal durations in
`staff-dashboard.chrome.css`.

### What changes for someone building a screen

- Look the element up in `docs/ui-elements.md`.
- Lint refuses a raw control and names the element.
- A new DS element needs index tags and, if it has a role, a showcase page;
  the checklist then tests it without a new spec being written for keyboard
  behaviour.
- Moving parts take a spring token; colour and opacity take an ease token.

### Risks

- **The lint rule produces false positives** on legitimate `keydown`
  bindings (a form submitting on Enter). Mitigation: fix or allow-list every
  current hit before the rule becomes an error; count them first.
- **Lag numbers vary between machines.** Mitigation: medians, a margin set
  from observed variance, and a non-required CI period.
- **Springs make controls feel slower**, since the tail is longer than
  today's 200 ms. Mitigation: rollout in four steps, each reviewed by the
  owner on a phone before the next.
- **The rename of `ui-stepper` swaps a name's meaning.** Mitigation: one
  change, and the typechecker catches input mismatches because the two
  elements take different inputs.
- **Docblock tags rot.** The check proves a tag exists, not that it is true.
  Mitigation: review, and the alias table makes wrong rows visible.

## Alternatives Considered

### Alternative A: A library of headless behaviour directives

Roving focus, listbox, type-to-find, popup and dismissal, and focus trap
written once as directives and attached to components through
`hostDirectives`. This was the original idea, modelled on ui-sdk.dev.

- **Pros**: one spec per behaviour; a new element gets keyboard support by
  composition; the checklist in part 3 becomes mechanical.
- **Cons**: little to extract. About 150 lines are duplicated today. Roving
  focus would have two users, popup two, listbox one, type-to-find one, and
  the focus trap already exists as `UiSheetBehavior`. The estimated spec
  saving is 500 to 900 of 26,819 lines. `hostDirectives` attaches only to the
  host element, cannot be conditional, and a host cannot feed its own
  computed values into a composed directive's input; the items that need key
  handling sit inside templates. Shared code loads on every route, and
  routes sit 0.45 to 5 kB under their ceilings. A public behaviours library
  also gives features the parts to build their own controls.
- **Reason for Rejection**: the cost is certain and the saving is small.
  Reconsider when one behaviour gains a third real user, or when a checklist
  failure traces to duplicated behaviour code.

### Alternative B: Adopt `@angular/aria`

- **Pros**: maintained by the Angular team; listbox, menu and tabs follow the
  WAI-ARIA patterns; less code to own.
- **Cons**: a dependency, against the owner's wish to keep `libs/ui` free of
  them. It does not replace the code that is large here: about 700 of the 930
  lines in `menu.ts` are positioning and layering, and the sheet behaviour is
  product-specific. Its bundle cost and its fit with the existing elements
  were not measured. The repo removed it once before
  (`docs/architecture/HANDOFF.md`).
- **Reason for Rejection**: it solves a problem the library mostly does not
  have. Reconsider if a tabs element is ever built.

### Alternative C: Adopt ui-sdk.dev

- **Pros**: the composition model the owner liked.
- **Cons**: targets React, Vue, Svelte, Solid and Web Components, not
  Angular; in beta; ships unstyled parts and no token system, so it adds
  nothing for theming.
- **Reason for Rejection**: cannot be used in this app. Only the idea
  carries over, and Alternative A is that idea.

### Alternative D: Merge to one sheet and one Picker

One `ui-sheet` with detents in place of the modal, detail and detent sheets;
one `ui-picker` with styles in place of segmented control, choice menu and
choice tiles. This is how SwiftUI names them.

- **Pros**: the SwiftUI vocabulary exactly; fewer element names.
- **Cons**: the three modal sheets already share one behaviour, so a merge
  changes names only. `ui-detent-sheet` is non-modal on purpose (no scrim, no
  focus trap); as a parameter, "modal or not" becomes an accessibility
  setting a caller can get wrong. One Picker would put three ARIA patterns
  (radio group, menu with radio items, tiles) behind one set of inputs;
  `UiSegment` has 6 fields and `UiChoiceOption` has 13. "Picker" already
  names the date elements.
- **Reason for Rejection**: it hides differences that matter for
  accessibility. The index records the SwiftUI type and style per element,
  which gives the vocabulary without the merge.

### Alternative E: Rename every element to its SwiftUI name

- **Pros**: one vocabulary across code and Apple's documentation.
- **Cons**: `ui-list-row` has 211 uses in features, `ui-list-group` 139, the
  menu directives 52 lines, `ui-modal-sheet` 30, `ui-choice-menu` 29. Feature
  CSS depends on sheet class names, 21 docs hold 213 mentions of current
  names, and two large feature files are under a shrink-only line cap.
- **Reason for Rejection**: large churn for vocabulary alone. Only the two
  renames that remove real confusion are kept (G6).

### Alternative F: Replace the standard easing token with a spring everywhere

- **Pros**: one change; every transition becomes a spring.
- **Cons**: most of the 141 uses animate colour and opacity, where overshoot
  is wrong. A spring fixes duration and easing together, and today each use
  picks them separately.
- **Reason for Rejection**: it would make most transitions worse. Springs go
  only on parts that move.

### Alternative G: A JavaScript spring engine for all motion

- **Pros**: true springs with velocity carried over from a drag, as on iOS.
- **Cons**: runs on the main thread, which is the opposite of the "no lag"
  requirement on slow phones; more code on every route; CSS transitions
  already retarget when interrupted.
- **Reason for Rejection**: CSS `linear()` gives the spring shape off the
  main thread. A JavaScript spring is kept as a possible later step for the
  two drag-release surfaces only.

### Alternative H: A new `ui-tabs` element for the four feature tab lists

- **Pros**: matches what the features wrote.
- **Cons**: SwiftUI has no in-page tab strip; switching between views of one
  page is a segmented `Picker`, and `ui-segmented-control` exists. A new
  element needs its own keyboard model, showcase page and tests.
- **Reason for Rejection**: the existing element covers all four sites.
  Build `ui-tabs` only if a page needs more sections than a segmented control
  can hold, and the owner asks.

### Alternative I: Index kept in a central manifest, or in the showcase

- **Pros**: a manifest is simpler to parse; the showcase already exists.
- **Cons**: a manifest means two files to edit per element. The showcase
  covers 42 of 110+ selectors and cannot be read without running it.
- **Reason for Rejection**: tags beside the code are edited with the code,
  and the check fails when one is missing.

### Alternative J: Do nothing

- **Pros**: no pain is reported; modal behaviour has one source; 26,800 lines
  of specs pin current behaviour; budgets are tight.
- **Cons**: features already break the reuse rule in at least ten places,
  one library element has a keyboard defect, and the next agent still cannot
  find `ui-choice-menu`.
- **Reason for Rejection**: the index, the lint rule and the checklist are
  cheap and fix defects that exist today.

---

## Detailed Implementation Plan

Five stages. Each is one pull request unless noted, lands green on its own,
and is titled as a Conventional Commit. Paths are from the repository root.

Two lists below are known to be incomplete until a tool runs, and say so:
the lint triage in stage 2 and the motion sites in stage 5. Counts in this
section come from text search on 2026-11-25.

### Stage 1 — Element index (`feat(ui): …`)

#### 1. `tools/ui-index/build-ui-index.mjs` (Create)

- **Type / Scope**: Node script.
- **Proposed Changes**: Walk `libs/ui/**/*.ts` (not specs). For each
  `@Component` or `@Directive` exported through a sub-library `index.ts`,
  read `selector` and the class docblock tags `@uiPurpose`, `@uiSwiftUI`,
  `@uiAliases`, `@uiNotThis` (required) and `@uiRole`, `@uiShowcase`
  (optional). Default mode writes `docs/ui-elements.md`. `--check` exits 1
  on: a missing required tag; a `@uiNotThis` or alias that names an unknown
  selector; committed output that differs from generated output; and (from
  stage 3) an element with `@uiRole` and no showcase page. Structure follows
  `tools/icons/check-icon-usage.mjs`.

#### 2. `tools/ui-index/build-ui-index.spec.mjs`, `tools/ui-index/__fixtures__/**` (Create)

- **Type / Scope**: Unit test and fixtures.
- **Proposed Changes**: Cases: tags parsed; missing tag refused; unknown
  selector in `@uiNotThis` refused; stale output refused; a non-exported
  class ignored; output is stable across runs.

#### 3. `tools/ui-index/project.json`, `eslint.config.mjs`, `vite.config.mts` (Create)

- **Type / Scope**: Nx project config, copied from `tools/icons/`.
- **Proposed Changes**: Project `ui-index-tools` with a `test` target.

#### 4. `libs/ui/{controls,layout,patterns,modifiers,charts,icons}/src/lib/**/*.ts` (Modify, 105 files)

- **Type / Scope**: Every file holding a `@Component` or `@Directive`.
- **Proposed Changes**: Add the tag lines to the class docblock. No code
  changes. `@uiSwiftUI` is taken from the existing `≙ SwiftUI` line where one
  exists (81 do); elements with no counterpart say `app pattern`. Listed by
  glob because the edit is the same in each file; the check in file 1 is what
  proves none was missed.

#### 5. `docs/ui-elements.md` (Create, generated, committed)

- **Type / Scope**: Documentation.
- **Proposed Changes**: Generated tables per sub-library and the alias table.

#### 6. `package.json` (Modify)

- **Proposed Changes**: Scripts `ui:index` (write) and `ui:index:check`.

#### 7. `.github/workflows/ci.yml` (Modify)

- **Proposed Changes**: Run `pnpm ui:index:check` beside `pnpm icons:check`.

#### 8. `.stylelintrc.json` (Modify)

- **Proposed Changes**: Add `tools/ui-index/__fixtures__/**` to `ignoreFiles`
  if fixtures include CSS; otherwise untouched.

#### 9. `.claude/rules/angular-ui.md`, `CLAUDE.md`, `AGENTS.md` (Modify)

- **Proposed Changes**: The rule file gains a section "Choosing an element":
  look it up in `docs/ui-elements.md` first; never style a native control in
  a feature; a new element only on the owner's request. `CLAUDE.md` §3 and
  `AGENTS.md` (byte-identical) gain one line naming the index.

#### 10. `libs/ui/controls/README.md` (Modify)

- **Proposed Changes**: Replace the generated stub with two lines pointing at
  `docs/ui-elements.md` and the showcase.

### Stage 2 — Enforcement and feature fixes

Two pull requests: 2a fixes and the rule at `warn`; 2b switches it to
`error` once the triage list is empty.

#### 11. `tools/lint-rules/ds-controls-only.mjs`, `ds-controls-only.spec.mjs` (Create)

- **Type / Scope**: ESLint rule over Angular templates, and its spec.
- **Proposed Changes**: Options `{ include: string[], allowIn: string[] }`
  using `path-scope.mjs`. Reports the four findings of Technical Plan part 2.
  The replacement map (element or role → DS selector) is exported so file 1
  can verify its names. Spec cases: each finding; `type="file"` and
  `type="hidden"` pass; an input carrying a DS field directive passes; a
  bound `[attr.role]` is not reported; an allow-listed path passes.

#### 12. `tools/lint-rules/index.mjs` (Modify)

- **Proposed Changes**: Register the rule.

#### 13. `eslint.config.mjs` (Modify)

- **Proposed Changes**: In the existing `**/*.html` block, enable
  `creativo/ds-controls-only` for `libs/features/**` and `apps/web/**` with
  the allow-list and a comment per entry.

#### 14. `.stylelintrc.json` (Modify)

- **Proposed Changes**: New override for `libs/features/**/*.css` and
  `apps/web/**/*.css` adding native-control element selectors and
  `[role=…]` to `selector-disallowed-list`. The existing override replaces
  whole rules, so the icon-font entries are restated in it.

#### 15. `tools/ui-index/build-ui-index.mjs` (Modify)

- **Proposed Changes**: `--check` imports the replacement map of file 11 and
  fails on a name that is not an indexed selector.

#### 16. Feature templates with a typed widget role (Modify, 14 files)

Each is triaged to one of: replace with a DS element, or allow-list with a
reason.

| File                                                                                                  | Expected outcome                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `libs/features/admin/programs/src/lib/admin-programs/admin-programs.html`                             | Tab list → `ui-segmented-control`; native inputs → DS fields |
| `libs/features/client/appointments/src/lib/client-appointments/client-appointments.html`              | Tab list → `ui-segmented-control`                            |
| `libs/features/marketing/courses/src/lib/marketing-courses/marketing-courses.html`                    | Tab list → `ui-segmented-control`                            |
| `libs/features/marketing/events/src/lib/marketing-events/marketing-events.html`                       | Tab list → `ui-segmented-control`                            |
| `libs/features/staff/dashboard/src/lib/block-editor/staff-block-editor.html`                          | Radio group → `ui-choice-tiles` or `ui-segmented-control`    |
| `libs/features/staff/dashboard/src/lib/visit-editor/staff-visit-editor.html`, `staff-visit-editor.ts` | Radio group → DS element; other roles triaged                |
| `libs/features/staff/dashboard/src/lib/time-grid/staff-time-grid.html`                                | Allow-list (canvas slider handles)                           |
| `libs/features/staff/dashboard/src/lib/timeline/staff-timeline.html`                                  | Allow-list (same)                                            |
| `libs/features/shared/shell/src/lib/menu/site-menu.component.html`                                    | Allow-list (hosts `UiSheetBehavior`)                         |
| `libs/features/admin/team/src/lib/admin-team-account/admin-team-account.html`                         | Triage                                                       |
| `libs/features/admin/team/src/lib/member-shops-sheet/member-shops-sheet.html`                         | Triage                                                       |
| `libs/features/shared/catalog/src/lib/gallery/showcase-gallery.component.html`                        | Triage                                                       |
| `libs/features/staff/client-card/src/lib/client-card/client-card.html`                                | Triage                                                       |

The four "Triage" files were found during drafting and not read. The
component `.ts` and `.css` beside each changed template change with it.

#### 17. Feature templates with a key handler (Modify, 9 files, 14 bindings)

`client-auth.html`, `booking-services-step.html`,
`locations.component.html`, `site-menu.component.html`,
`staff-block-editor.html`, `staff-dashboard.html`, `staff-time-grid.html`,
`staff-timeline.html`, `staff-visit-editor.html` (paths as in the search
output under `libs/features/`). Each binding is either removed because the
DS element now handles the key, or allow-listed with a reason.

#### 18. `libs/features/staff/dashboard/src/lib/shared/slider-keys.ts` and spec (Create); `time-grid/staff-time-grid.ts`, `timeline/staff-timeline.ts` (Modify)

- **Proposed Changes**: One pure function mapping a key to a step in
  minutes; both components call it. `staff-dashboard.ts` is under a
  shrink-only line cap and is not grown.

#### 19. `libs/ui/controls/src/lib/choice-menu/choice-menu.ts`, `.css`, `.spec.ts` (Modify)

- **Proposed Changes**: Add what the booking trigger needs and choice-menu
  lacks (Q2): a large glass trigger tier and the placeholder look when no
  option is chosen. New inputs carry the `ui` prefix.

#### 20. `libs/features/client/booking/src/lib/bag-sheet/booking-bag-sheet.html`, `.ts`; `services-step/booking-services-step.html`, `.ts` (Modify); `chrome/booking-select.css` (Delete)

- **Proposed Changes**: The three `.booking-pick` triggers and their
  `ui-menu` become `ui-choice-menu`. The stylesheet is removed from both
  components' `styleUrls` and deleted.

#### 21. Feature stylesheets with a native-control selector (Modify, number unknown)

- **Proposed Changes**: The stylelint override's first run produces the
  list. A text search gives 34 candidate files but also matches words in
  comments, so the true number is lower. Each hit is moved to a DS input or
  modifier, or keeps a `stylelint-disable` comment with its reason. This
  list is produced in pull request 2a and recorded in its description.

#### 22. `docs/styling-conventions.md` (Modify)

- **Proposed Changes**: The "features never hand-roll" paragraph names the
  lint rule and the allow-list as its enforcement.

### Stage 3 — Checklist and repairs

Three pull requests: 3a checklist, 3b repairs, 3c renames.

#### 23. `libs/shared/e2e-a11y/**` (Create); `apps/web/e2e/support/axe.ts` (Move); `tsconfig.base.json` (Modify); six `apps/web/e2e/*.spec.ts` importers (Modify)

- **Proposed Changes**: A small library holding the axe helper so both apps'
  e2e can import it by alias. Tags follow
  `docs/architecture/module-boundaries.md`. The six importing specs change
  their import path only.

#### 24. `libs/shared/e2e-a11y/src/lib/role-contracts.ts` (Create)

- **Proposed Changes**: One exported function per role (`radiogroup`,
  `menu`, `dialog`, `slider`, `switch`) taking a Playwright locator and
  asserting the table in Technical Plan part 3.

#### 25. `apps/showcase/e2e/a11y-checklist.spec.ts` (Create)

- **Proposed Changes**: Reads the index's role-to-page list, visits each
  page, runs the matching contract on every element with that role, then
  axe on the page.

#### 26. `apps/showcase/src/app/pages/controls/{choice-menu,choice-tiles,alert,modal-sheet,detail-sheet,switch,toast,count-stepper}/*.page.{ts,html,css}` (Create); `apps/showcase/src/app/app.routes.ts`, `pages/controls/controls.page.ts` (Modify)

- **Proposed Changes**: A page per element that declares a role and has no
  page today, registered in the routes and the controls list. The list is
  final when `--check` passes.

#### 27. `tools/ui-index/build-ui-index.mjs` and spec (Modify)

- **Proposed Changes**: Turn on the "role without showcase page" check.

#### 28. `docs/accessibility-conventions.md` (Modify)

- **Proposed Changes**: State the five role contracts and name the spec that
  enforces them.

#### 29. `libs/ui/controls/src/lib/roving/roving-index.ts`, `roving-index.spec.ts` (Create)

- **Proposed Changes**: Pure function: (current index, key, item count,
  writing direction, disabled indexes) → next index or none. Spec covers
  wrap, Home/End, right-to-left, disabled skipping, a single item.

#### 30. `libs/ui/controls/src/lib/segmented-control/segmented-control.ts`, `.spec.ts`; `choice-tiles/choice-tiles.ts`, `.spec.ts` (Modify)

- **Proposed Changes**: Both call the function of file 29 and keep one tab
  stop. Choice tiles gains Home/End. Arithmetic assertions move from the two
  element specs to the function's spec.

#### 31. `libs/ui/controls/src/lib/phone-field/phone-field.ts`, `.html`, `.css`, `.spec.ts`, `phone-field.lazy.ts` (Modify)

- **Proposed Changes**: The country list opens through `ui-menu`; the
  field's own open, position and dismiss code (about lines 480–572) is
  removed. Type-to-find stays in the field.

#### 32. Rename `ui-stepper` → `ui-step-trail` and `ui-count-stepper` → `ui-stepper`

- **Move**: `libs/ui/patterns/src/lib/stepper/*` →
  `libs/ui/patterns/src/lib/step-trail/*`;
  `libs/ui/controls/src/lib/count-stepper/*` →
  `libs/ui/controls/src/lib/stepper/*`. Class names follow.
- **Modify**: `libs/ui/patterns/src/index.ts`,
  `libs/ui/controls/src/index.ts`;
  `apps/showcase/src/app/pages/controls/stepper/*` and its route;
  `libs/features/client/auth/src/lib/client-auth/client-auth.{html,ts}`;
  `libs/features/client/booking/src/lib/client-booking/client-booking.{html,ts}`;
  `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.{html,ts}`;
  `libs/features/admin/loyalty/src/lib/admin-rhythm-sheet/admin-rhythm-sheet.{html,ts,spec.ts}`;
  `libs/features/staff/dashboard/src/lib/visit-editor/staff-visit-editor.spec.ts`;
  `libs/ui/tokens/src/lib/accent-rule.spec.ts`; feature CSS and docs that
  name either selector (found by search in the change).

#### 33. `libs/ui/controls/src/lib/modal-sheet/modal-sheet.{ts,html,spec.ts}` and its 29 using files (Modify)

- **Proposed Changes**: All eleven inputs take the `ui` prefix (`open` →
  `uiPresented`, `closing` → `uiClosing`, `sheetId` → `uiSheetId`,
  `labelledBy` → `uiLabelledBy`, `closeLabel` → `uiCloseLabel`,
  `titleAlwaysVisible`, `bareHeader`, `closeControl`, `fitted`, `fullScreen`,
  `resetScrollOnOpen` likewise). The 29 templates binding them are updated
  by search; `pnpm nx build web` proves none was missed, since plain
  typecheck does not see templates.

### Stage 4 — Lag harness (`test(perf): …`)

#### 34. `tools/verify/lag/measure-lag.mjs`, `measure-lag.spec.mjs`, `baseline.json` (Create)

- **Proposed Changes**: As Technical Plan part 4. The spec covers the pure
  parts (median, comparison against baseline, margin). `baseline.json`
  carries a dated note field per entry.

#### 35. `tools/verify/project.json`, `package.json`, `.github/workflows/ci.yml` (Modify)

- **Proposed Changes**: Target `verify-tools:lag` (never cached), script
  `verify:lag` that builds showcase and web first, and a non-required CI job.

#### 36. `docs/architecture/HANDOFF.md` or the gates list it points to (Modify)

- **Proposed Changes**: Add the new gates (`ui:index:check`, `verify:lag`,
  the checklist spec) to the list of gates to run before pushing.

### Stage 5 — Motion

Pull request 5a is the trial; later ones follow the owner's judgement.

#### 37. `libs/ui/tokens/tokens.css` (Modify)

- **Proposed Changes**: Add the three spring tokens, their `-duration` and
  `-easing` parts, and the `@supports not` fallback. Rewrite the comment at
  lines 283–286 to the three motion rules.

#### 38. `libs/ui/tokens/src/lib/spring.ts`, `spring.spec.ts` (Create)

- **Proposed Changes**: Pure function from (perceived duration, bounce) to
  settle time and `linear()` stops. The spec recomputes each token and
  compares it with the value in `tokens.css`.

#### 39. `docs/styling-conventions.md` (Modify)

- **Proposed Changes**: Replace the 300 ms cap (lines 119–121) with the
  three rules and the "springs for position and size, ease for colour and
  opacity" rule. Record the trial and its outcome.

#### 40. `libs/ui/controls/src/lib/segmented-control/segmented-control.css` (Modify) — the trial, 5a

- **Proposed Changes**: The thumb's `transform` transition (line 72) takes
  the spring token. Nothing else changes. The owner judges it on a phone.

#### 41. `.stylelintrc.json` (Modify)

- **Proposed Changes**: Allow the spring tokens in `transition`; keep
  refusing literal `linear(` and `cubic-bezier(` outside the token files.

#### 42. After the trial: `libs/ui/controls/src/lib/switch/switch.css`, `slider/slider.css`, `libs/ui/modifiers/modifiers.css`, `libs/ui/patterns/src/lib/menu/menu.css` and `menu.ts`, `libs/ui/layout/src/lib/sheet/sheet.css` and `sheet.ts`, `libs/ui/patterns/src/lib/detent-sheet/detent-sheet.css` (Modify)

- **Proposed Changes**: One pull request per rollout step of Technical Plan
  part 5. `menu.ts:387` and `sheet.ts:201` cancel their exit timer on
  re-open. The full list of moving-part transitions is produced by search at
  the start of this stage; these are the known ones.

#### 43. `libs/features/staff/client-card/src/lib/rhythm-card/rhythm-card.css`, `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.chrome.css` (Modify)

- **Proposed Changes**: Replace the undefined `--sys-motion-duration-quick`
  and the two literal durations with tokens.

### Verification Plan

- **Compilation/Build**: `pnpm nx build web`, `pnpm nx build showcase`,
  `pnpm nx build functions`. The web build is required after stages 2 and 3
  because template errors do not show in typecheck.
- **Unit Tests**: `pnpm nx affected -t test build typecheck --base=origin/main`
  after every stage; a clean typecheck (`rm -rf dist/out-tsc`,
  `--skip-nx-cache`) after the renames.
- **Static Analysis & Linting**: `pnpm nx run-many -t lint`,
  `pnpm run lint:styles`, `pnpm ui:index:check`, `pnpm icons:check`,
  `pnpm nx run verify-tools:layering`, `pnpm nx format:check`.
- **Test Coverage Requirement**: every new rule, script and pure function
  has a spec beside it; every element with `@uiRole` is covered by the
  checklist (enforced by the index check).
- **E2E/Integration**: the showcase Playwright suite including
  `a11y-checklist.spec.ts`; the web e2e suite after stages 2 and 3; the
  showcase snapshot spec after stage 5, with snapshots updated only where a
  resting state changed.
- **Budgets and lag**: `pnpm run verify:bundle` after every stage;
  `pnpm run verify:lag` from stage 4 on, compared with the baseline.
- **Owner check**: stage 5a on a phone before any further motion change.

---

_Drafted with EGM_
