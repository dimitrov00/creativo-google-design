# Critic review (Stage 7, round 1): `docs/designs/ui-library-parity.md`

- **Date:** 2026-11-25
- **Range:** FeatureRange, lines 1 to 609
- **Reviewers:** `egm-design` (completed, checked claims against the repo),
  `egm-structural` (completed, document only), `egm-style` (completed,
  document only)
- **Standard:** `feature-spec-standard` for design and structural

**Verdict: revise before approval.** 1 Blocker, 17 Major and 17 Nit after
merging the three reports (2 structural and 6 style Majors repeat another
reviewer's finding and are folded in). The round is not clean.

Finding ids are `<reviewer>-<round>-<n>`. Where two reviewers raised the same
issue, the ids are listed together.

## Blocker

### design-1-B1 — The lint rule contradicts the library's own API and misses its motivating defect

Lines 48-49, 78-82, 148-152, 265-274, 294.

- **`<textarea>` is banned with `ui-text-field` as the replacement.** No such
  element exists. The text field is a directive on native elements:
  `input[uiTextField], textarea[uiTextField]`
  (`libs/ui/controls/src/lib/text-field/text-field.ts:11`). Features use
  `<textarea uiTextField>` in many places, for example
  `admin-programs.html:68,77,178,187,284,293`. The rule as written fails all
  of them.
- **The design's own drift guard would reject the rule's map**, because
  `ui-text-field` is not a selector.
- **The motivating number inputs pass the rule.** They carry `uiTextField`
  plus `type="number"` (`admin-programs.html:148-150, 254-256, 350-352`). CUJ
  2 holds only for a bare `<input type="number">`, which the codebase does not
  contain.
- **Most banned roles have no replacement element.** `@uiRole` covers five
  roles; `tab`, `tablist`, `listbox`, `option`, `combobox`, `spinbutton` and
  `checkbox` have nothing to name. (Also `comprehension` finding 2.)
- **`role="checkbox"` has six unlisted feature sites and no DS checkbox**, all
  on `button uiListRow` or a feature button:
  `admin-team-account.html:108`, `member-shops-sheet.html:80`,
  `showcase-gallery.component.html:44,74`, `client-card.html:734`,
  `staff-visit-editor.html:199`. None is in the fix list or the allow-list.

**Recommendation:** respecify the rule against the real selectors. Allow
`input` and `textarea` that carry `uiTextField`; add a per-`type` restriction
(for example `type="number"` requires `ui-unit-field` or `ui-amount-field`);
give the role map an explicit entry per role, including "no element; allowed
on `uiListRow`" where that is the decision; add the checkbox sites to the fix
list or the allow-list.

## Major

### design-1-M1 — The key-handler ban has more hits than planned, and the allow-list granularity defeats the rule

Lines 270, 276-279, 295-296, 474-476. Feature templates hold 14 `(keydown…)`
bindings in 9 files. Not covered by the plan: `client-auth.html:319`,
`booking-services-step.html:65`, `locations.component.html:44`,
`staff-dashboard.html:671,716`, `staff-time-grid.html:244`,
`staff-timeline.html:166`. The allow-list names `frame-fullscreen.ts`, but the
bindings are in `staff-block-editor.html:520` and
`staff-visit-editor.html:1543`. A per-file allow-list would switch the rule
off in the files that hold the hand-rolled radio groups. **Recommendation:**
state the count and a disposition per site; make the allow-list per finding
kind, not per file.

### design-1-M2, structural-1-M3, style-1-M1, style-1-M2 — The lag gate is unproven and defined three ways

Lines 87-90, 95-96, 125-128, 181-182, 356-364. Under 4× throttle a 50 ms limit
is about 12.5 ms of real main-thread work, which must cover a route change
with a lazy chunk. The limit is fixed before any baseline exists, with no plan
if today's build fails. G4 and CUJ 6 list four interactions; Part 4 lists
five. The regression rule reads "do not get worse", "exceeds the recorded
baseline" and "exceeds the baseline by more than the margin" in three places.
**Recommendation:** record the baseline first and derive the limit from it;
use one definition throughout.

### design-1-M3 — The harness does not measure what Part 5 changes

Lines 91-96, 359-361, 432-437, 576-577. All measured figures are main-thread.
Part 5 moves motion to CSS on `transform` and `opacity`, which runs off the
main thread, so dropped compositor frames are invisible to the gate. The
measurement window ("until animations finish") grows with a spring that
settles near 0.7 s, so unrelated tasks fall inside it. Rollout steps 1 and 2
(switch knob, slider thumb, press scale) are not harness interactions.
**Recommendation:** add a frame-level measure, fix the window, align the
interaction list with the rollout steps.

### design-1-M4 — Springs will be cut short by two existing exit timers; the planned audit targets the wrong fault

Lines 439-444. Both timers already cancel on re-open (`sheet.ts:152-155,182`;
`menu.ts:384`). The real coupling is their length: the menu timer fires at
about 200 ms and the sheet timer at about 350 ms, then each hides the popover.
A 0.5 s spring is about 71% through at 200 ms and about 89% at 350 ms (the
reviewer's calculation), so the surface would leave the top layer mid-exit.
**Recommendation:** make "exit timers read the spring's duration part" an
explicit design item, and audit other code that mirrors a duration token.

### design-1-M5 — The web-app half of the lag harness cannot run as described

Lines 352-358. A statically served production build of the web app has
`projectId: 'REPLACE_ME'` and no emulators
(`apps/web/src/environments/environment.production.ts:14,20`), and the landing
reads the stored catalogue. It would measure an error or empty state.
**Recommendation:** name the build configuration and data source (emulator
backed, as the CSP smoke does), or drop the route-change interaction.

### design-1-M6 — The checklist has no CI home, and its generic runner is underspecified

Lines 83-86, 319-331, 467-469. `ci.yml` has no showcase job. The showcase
Playwright config starts the dev server, and its snapshots are
`chromium-darwin` only. `menu` and `dialog` contracts need the page's own
trigger and opener, so "finds each element with a role and runs the contract"
cannot be generic. **Recommendation:** add a CI job with its build mode and
browsers; define a showcase page convention the contracts rely on.

### design-1-M7 — The role coverage mechanism does not cover what the design says it forces

Lines 228-229, 311-317, 325-328. Toast is `role="status"`, count-stepper is
`role="group"`, alert is `alertdialog`, phone field is `combobox` plus
`listbox`, and the slider is a native range input with an implicit role.
`@uiRole` is optional, so an author who omits it escapes both the checklist
and the page requirement. (Also `comprehension` findings 1 and 3.)
**Recommendation:** make `@uiRole` required with an explicit `none`, or derive
coverage from the rendered DOM; correct the page list.

### design-1-M8, style-1-M12 — The phone-field repair changes its ARIA pattern without saying so

Lines 340-342. The country picker is a deliberate editable combobox: focus
stays in a search box, options are reached by `aria-activedescendant`, and it
has a sheet presentation on compact widths. `ui-menu` has its own arrow-key
focus model. The design does not say which `ui-menu` capabilities are reused
or how the listbox behaviour survives. "`controls` may import `patterns`" is
already true (`phone-field.ts:27`), not a new allowance. **Recommendation:**
state what is reused and that combobox behaviour is kept; add a combobox
contract or drop this repair.

### design-1-M9, structural-1-M2 — G6 and G7 have no home in the plan; G7 has no estimate

Lines 97-101, 297-302, 383-404, 472-486. G1 to G5 map to Parts 1 to 5. G6 is a
bullet under "Repairs". G7 (bundle ceilings) has no plan section, check or
journey, while this design adds every-route bytes: new `ui-choice-menu` inputs
and CSS, three `linear()` curves with split parts and a fallback in the global
tokens, and `ui-menu` composed into the phone field. **Recommendation:**
estimate bytes per part, say whether a ceiling raise is expected, list it
under Risks.

### structural-1-M1 — Risks is a subsection and is incomplete

Lines 472-486. The standard treats risks and limits as a top-level
requirement. The section says nothing on security or scale, and omits risks
raised elsewhere: the Safari floor and fallback (Q5), bundle headroom, the
lint blind spots. The design critic adds (N7): CI time and flakiness of the
new suites, `@starting-style` support, and the semantic change from `tablist`
to `radiogroup` at four sites including specs that query `[role="tab"]`.

### structural-1-M4 — The index-source alternatives are written twice

Lines 249-256 and 590-596. Part 1 and Alternative I repeat the same two
options. Alternative I also merges two alternatives into one entry.

### style-1-M3 — Choice tiles "keeps" a tab stop it does not have

Lines 55-57 against 337-338. (Also `comprehension` finding 5.)

### style-1-M4 — Q2 and Part 2 disagree on what `ui-choice-menu` lacks

Lines 120-124 against 299-303. Part 2 still lists a leading avatar and a
second option line as possibly missing; Q2 says they are covered.

### style-1-M5 — Element counts do not reconcile

Lines 11-12, 37, 231, 254, 594. About 83 elements plus 14 directives is 97,
against "110+" selectors, "105 files" and "81" SwiftUI comment lines. The
design critic counts 146 uses of the standard easing token against the
document's 141. (Also `comprehension` finding 9, `structural` nit 4.)

### style-1-M6 — Motion rule 1 replaces a measurable cap with an unmeasurable one

Lines 376-378, 93-94. "Most of its travel within about 300 ms" has two hedges.
State a fraction and a time.

### style-1-M7 — "Only a handful" defines the scope of Part 5

Lines 410-413, 564. Give the count of uses that get a spring.

### style-1-M8 — The trial step is unclear

Lines 421-423. Two tokens on one thumb; "behind nothing else" has no evident
meaning. (Also `comprehension` finding 6.)

### style-1-M9 — The rollout gate differs between the plan and the risk

Lines 432-437 against 479-481. The plan says each step is checked against the
harness; the risk says each is reviewed by the owner on a phone. "Today's
200 ms" conflicts with the 150/200/300 ms scale stated elsewhere.

### style-1-M10 — "Each shippable on its own" conflicts with stated dependencies

Lines 186-187. Part 3 depends on Part 1's tags, Part 5 on Part 4's baseline,
Part 2's map on Part 1's check.

### style-1-M11 — "Cannot be used in this app" overstates the evidence

Lines 527-530. ui-sdk.dev lists Web Components as a target. State the actual
reasons.

## Nit

- **design-1-N1.** A stylelint override replaces the whole rule, so the new
  one must restate the icon-font bans. No count of current feature-CSS hits.
- **design-1-N2.** Rule scope must be path fragments inside the rule, not a
  `files` glob (`eslint.config.mjs:528-541`).
- **design-1-N3.** `.booking-pick` appears four times in three templates; the
  schedule-step use is a time pick. (Also zoom-out finding 2.)
- **design-1-N4.** The promotion rule for the lag job is circular: the margin
  is derived from variance, and the job is required when variance is below the
  margin.
- **design-1-N5.** The typechecker misses CSS and test selectors on
  `ui-stepper`, the showcase route, and uses with no inputs.
- **design-1-N6.** The cited `tokens.css:283-286` comment describes the
  marketing tiers; `ui-detent-sheet` already runs at 480 ms.
- **structural-1-N1, style-1-N16.** Open questions numbered Q2, Q4, Q5;
  drafting history ("Narrowed.", "was Q1") left in the text.
- **structural-1-N2, style-1-N17.** Three step vocabularies: Part, stage,
  Step; "stage 2" is undefined in the range.
- **structural-1-N3, style-1-N21.** The five-part summary is repeated three
  times; one copy closes The Problem.
- **structural-1-N5, style-1-N20.** `concepts_brief.md` is untracked and cited
  with no path; "the reviewers" and the owner rulings have no reference.
- **structural-1-N6.** File references mix full paths and bare names; line
  anchors will go stale.
- **structural-1-N7.** The feature-fix list adds sites The Problem does not
  list, while G2 scopes fixes to The Problem's list.
- **structural-1-N8.** Alternative entries are uneven in shape.
- **style-1-N13, N14, N15, N24, N26.** Unquantified or subjective wording:
  "close to that already", "a small number", "never lag", "Apple-style",
  "where it costs little", "sluggish", "cheap", "large churn". "Overshoot is
  wrong" does not apply to `smooth`, which has no bounce.
- **style-1-N18.** "Part 1 and review cover those" does not say how an index
  catches a role-less `div` control.
- **style-1-N19.** "And the rest" ends a list that defines required work.
- **style-1-N22.** "DS", "ui-sdk.dev" and "the owner" are not introduced.
  (Also `comprehension` finding 10.)
- **style-1-N23.** G1 says agents "load" the index; Part 1 says they look it
  up.
- **style-1-N25.** Idiom: "mid-flight", "tags rot", "no pain is reported".
- **style-1-N27.** 26,819 becomes 26,800; "at least ten places" cannot be
  derived from The Problem.

## Claims the design critic verified as accurate

- `ui-choice-tiles` lacks Home/End and a single tab stop;
  `ui-segmented-control` has both.
- The four tab-list sites and two radio-group sites exist.
- There are 14 modifier directives.
- The icon check, bundle budgets, axe helper and reduced-motion file exist
  and behave as described.
- There is no browserslist configuration.
- `--sys-motion-ease-standard` is `cubic-bezier(0.4, 0, 0.2, 1)`, and the
  SwiftUI preset parameters are correct.
- Showcase pages are missing for choice-menu, choice-tiles, alert,
  modal-sheet, detail-sheet, switch, toast and count-stepper.

## Open from earlier stages

`zoom_out_report.md` (8 Major) and `comprehension_report.md` (10 Major) were
carried forward unresolved. The findings above overlap with most of them; the
zoom-out scope objections (split the design, drop the stepper swap, defer the
spring machinery, shrink the lag harness to a one-off) are not repeated here
and still need a decision.
