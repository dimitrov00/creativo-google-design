**What this proposes**

The document proposes five pieces of tooling around the existing UI library
(`libs/ui`), plus a few repairs, instead of rebuilding the library. In build
order they are:

1. A generated, searchable element index (`docs/ui-elements.md`) built from
   tags in each element's docblock, with a check that fails when an element
   has no row.
2. ESLint and stylelint rules that stop feature code from hand-building
   controls, plus fixes to the feature sites that already do.
3. A Playwright keyboard and ARIA checklist, keyed by role, run against
   showcase pages. It comes with three library repairs: shared arrow-key logic
   for the segmented control and choice tiles, the phone field reusing
   `ui-menu`, and two renames.
4. A "lag harness" that measures long main-thread tasks on a CPU-throttled
   production build against a committed baseline.
5. Three SwiftUI-style spring motion tokens for parts that move or resize,
   first trialled on one control and judged by the owner, replacing a 300 ms
   cap.

**How the existing system works, per this document**

`libs/ui` is an Angular design system of roughly 83 `ui-*` elements and 14
modifier directives, split into sub-libraries (controls, layout, patterns,
modifiers, charts, icons), sharing `--sys-*` CSS tokens. A separate showcase
app demonstrates about 42 of 110+ selectors. Feature code lives under
`libs/features/**` and `apps/web/**` and is meant to use only library
elements. That rule, and the accessibility rules, exist only as prose in
`docs/styling-conventions.md` and `docs/accessibility-conventions.md`, and
several feature templates break them. Accessibility is checked by axe in a few
end-to-end specs, and nothing measures interaction lag. Motion uses Material
ease curves with control durations capped at 300 ms, following an owner ruling
of 2026-11-09. Existing gates the new work copies include an icon-usage check,
custom lint rules in `tools/lint-rules/`, and bundle budgets.

The reviewer could paraphrase every section. No Blockers.

## Findings

Stage 6 (Comprehension Test), 2026-11-25, reviewer `egm-comprehension`, fresh
context, target `docs/designs/ui-library-parity.md` lines 1 to 955.

**1. Major — `@uiRole` and the list of forced showcase pages (lines 228-229,
325-328, stage 3 file 26).** `@uiRole` is defined as naming one of five roles,
and the checklist has contracts for those five only. Yet the pages "forced
into existence" include toast and count-stepper. In the code, toast is
`role="status"` (`toast.ts:83`) and count-stepper is `role="group"`
(`count-stepper.ts:51`). The reader cannot tell whether `@uiRole` accepts
roles with no contract, what the checklist does on such a page, or why these
two are listed.

**2. Major — Part 2 findings table, "the element with that `@uiRole`" (line
269).** The lint rule bans 15+ roles, including `tablist`, `tab`, `listbox`,
`option`, `combobox`, `spinbutton` and `checkbox`. Its message is said to name
"the element with that `@uiRole`", but `@uiRole` has five values, and none is
`tablist`. CUJ 2 says `tablist` yields `ui-segmented-control`, which is a
`radiogroup`. Several elements also share one role, so "the element" is
ambiguous. Line 272 mentions "a small map in the rule", which seems to be the
real mechanism; the table should say so and say what the message names when
several elements fit.

**3. Major — How an element is tied to its showcase page (lines 319-328, stage
1 file 1, stage 3 file 25).** The Technical Plan says the runner finds each
element carrying a covered role on every showcase control page, and that the
index check fails when a role-bearing element has no showcase page. Stage 25
instead says the spec reads the index's role-to-page list. An optional
`@uiShowcase` tag appears once (line 627) and is never defined. The reader
cannot tell how the index knows a page exists for an element, or whether the
runner is driven by page scanning or by the index.

**4. Major — The lag interactions do not match across sections (G4 lines
87-90, CUJ 6 line 181, Part 4 lines 356-358).** G4 and CUJ 6 say four
interactions. Part 4 lists five, adding "move a segmented control". The pass
rule also differs: G4 mentions only the 50 ms limit; CUJ 6 says "exceeds the
recorded baseline"; Part 4 says "exceeds the baseline by more than the
margin". The document never says whether today's build is expected to pass the
50 ms limit at 4× throttle, or what happens if the first baseline already
fails it.

**5. Major — Whether choice tiles has a single tab stop today (Problem 3 lines
55-57; Part 3 line 337; stage 30).** Problem 3 says `ui-choice-tiles` lacks
Home/End and a single tab stop. The repair says both elements "keep" a single
tab stop. A search of the choice-tiles source found no tab-index handling, so
the Problem wording appears right. The repair text should say choice tiles
gains the single tab stop, and by what mechanism, since the shared pure
function only computes the next index.

**6. Major — The trial step is unclear (lines 421-423; stage 40).** "Step 0
puts `--sys-motion-spring-snappy` and `-smooth` on the segmented control thumb
only, behind nothing else". Two tokens cannot both drive one transition. The
reader cannot tell whether the owner compares two builds, a toggle, or two
properties. Stage 40 says "takes the spring token" (singular, unnamed).
"Behind nothing else" cannot be parsed; it may mean "no feature flag".

**7. Major — Scope of the `ui-modal-sheet` input rename differs (G6 line 99;
Part 3 lines 345-346; stage 33).** G6 says inputs take the `ui` prefix. Part 3
names three inputs. Stage 33 says all eleven and touches 29 files. A reader of
the feature section alone would underestimate the change. It is also
unexplained why `open` becomes `uiPresented` and not `uiOpen`.

**8. Major — The phone-field repair has no stated problem (lines 340-342;
stage 31).** The Problem section never mentions the phone field. "`controls`
may import `patterns`" is also ambiguous: an existing permitted dependency or
a new allowance. `docs/architecture/module-boundaries.md` suggests it already
holds; the document should say so.

**9. Major — Element counts cannot be reconciled (lines 11-12, 37, 231, 254,
stage 1 file 4).** The document gives "about 83 elements, 14 directives",
"more than 110 selectors", "105 files" and "81 `≙ SwiftUI` comment lines" and
never says how these relate. The index check is defined by "every exported
selector", so the reader needs to know which number is the population.

**10. Major — Project terms used without definition.**

- "DS" / "DS field directive": never expanded. It is also never said which
  field directives exist or how a native `<input>` legitimately appears in a
  feature template. The lint rule's main exception depends on this.
- "typed widget role" versus "static widget role": two words for what seems
  to be one idea.
- "shrink-only line cap": an existing gate that constrains the work, never
  explained.
- "large glass pill tier": undefined visual vocabulary on which Q2 depends.
- `uiInteractive`, `UiSheetBehavior`: named without a one-line description.
- "the `deliberate` duration" and `--sys-motion-ease-emphasized`: fallback
  tokens with no values given (300 ms and `cubic-bezier(0.22, 1, 0.36, 1)` in
  `tokens.css`).
- "the two drag surfaces": never named.
- "the owner": makes rulings throughout but is never identified as a role.
- "the reviewers": not identified.
- `path-scope.mjs`, "CI's static job", "app pattern": used with no
  explanation.

**11. Nit — Alternative D calls all three sheets modal (lines 540-542)**, then
says `ui-detent-sheet` is non-modal on purpose.

**12. Nit — "at least ten places" (Alternative J, line 602).** The Problem
section lists eight sites.

**13. Nit — `frame-fullscreen.ts` in the allow-list (line 279).** No reason is
given, it appears in neither stage 16 nor stage 17, and it is a `.ts` file
while the rule is said to apply to templates.

**14. Nit — Motion rule 1 is not testable as written (lines 376-378).** "Most
of its travel within about 300 ms" does not say how much is "most", and no
check is named.

**15. Nit — Rollout step count (Risks line 480 versus lines 421-437).** The
risk says four steps, each reviewed by the owner on a phone. The plan has a
step 0 plus four steps, and the Verification Plan lists an owner check only
for stage 5a.

**16. Nit — Loose references.** `concepts_brief.md` is cited with no path and
is untracked. Stage 36 leaves the file to edit undecided. The Verification
Plan includes `pnpm nx build functions` although nothing touches functions.
Open questions are numbered Q2, Q4, Q5, with the note about Q1 and Q3 after
them.
