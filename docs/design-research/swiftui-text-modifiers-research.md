# Research: SwiftUI-named text-modifier directives vs. `data-*` attributes

**Date:** 2026-07-21. **Question (owner):** "Wouldn't it be better to use directives
instead of data-attrs — or directives translating to them, or classes? They're
type-safe and can be dynamic. I want SwiftUI-like directive namings, e.g.
`[fontWeight]=""`." **Follow-up to** the
[styling & typography case study](./styling-typography-case-study.md) §4, which
shipped `TextDirective` (`crText` + `weight/design/width/tone/…` inputs → `data-text-*`).

---

## 1. Reframing: it's not directives _versus_ data-attributes

The system already IS a directive — the real question is the **authoring
surface's shape and naming**. Three layers, only one of which is in question:

| Layer                     | What                                                | Status          |
| ------------------------- | --------------------------------------------------- | --------------- |
| **Authoring** (templates) | typed directive inputs — names, granularity         | ← the question  |
| **Paint format** (DOM)    | `data-text-*` attributes                            | keep (below)    |
| **Rendering** (CSS)       | `typography.css` attribute selectors on role tokens | keep, unchanged |

**Why the paint format stays `data-*`, not classes:** valued attributes
(`data-text-weight="semibold"`) carry one axis with N values in one greppable
hook; classes would explode into `text-weight-regular/medium/semibold/bold …`
per axis (Tailwind-by-the-back-door), violate the house grammar (class =
identity only, [styling-conventions.md](../styling-conventions.md)), and lose
the "unknown value simply doesn't match" property of attribute selectors.
Radix-style systems settled this the same way. Also decisive: **static markup
keeps working** — `<p data-text="footnote">` costs zero JS; a class-compiled or
style-compiled scheme would make the directive mandatory everywhere.

**Type safety and dynamism are already there** — directive inputs are typed
unions bound to signals (`[fontWeight]="w()"` recompiles the attr reactively).
Nothing about the current mechanism is less type-safe than a per-modifier
split; only the _names_ differ from SwiftUI today.

## 2. The naming/granularity options

**A. One `TextDirective`, inputs renamed to the SwiftUI vocabulary** (upgrade
in place). Template reads exactly as wished:

```html
<h2 crText="title" fontWeight="semibold">…</h2>
<p crText="body" foregroundStyle="secondary" [italic]="isQuote()">…</p>
<a crText="footnote" underline>Terms</a>
<span crText bold>inherits size, just bold</span>
<!-- role becomes optional -->
```

Note `crText` as bare marker ≈ SwiftUI's `Text(…)` itself — modifiers never
float free in SwiftUI either; `.fontWeight()` always hangs off a `Text`/`View`.
That is _faithful_, not a compromise.

**B. Per-modifier directives with bare selectors (`[fontWeight]`)** —
**rejected.** Angular's [style guide](https://angular.dev/style-guide) and
[angular-eslint's `directive-selector` rule](https://github.com/angular-eslint/angular-eslint/blob/main/packages/eslint-plugin/docs/rules/directive-selector.md)
require prefixed selectors for a concrete reason: a bare `[fontWeight]`
directive instantiates on **any** element carrying that attribute — including
`<third-party-chart [fontWeight]="12">`, where it would silently bind our
directive to a number meant for the chart's own input. That's a
whole-app-lifetime hazard traded for zero template-syntax benefit over A.

**C. Per-modifier directives with compound selectors (`[crText][fontWeight]`)**
— safe (only activates alongside the marker) and template-identical to A.
What it adds over A: one file/class per modifier, per-modifier imports.
What it costs: ~12 directive classes + an aggregate export const for
ergonomic imports, plus the compound-selector boilerplate. **Template syntax,
type safety, and DOM output are byte-identical to A** — so this is an internal
code-organization choice, not an API choice. Defensible later; not needed now.
(If Angular ships selectorless directives in a future major, C gets cheaper —
revisit then.)

**D. Wrapper `<cr-text>` element** — already rejected in case study §4 (DOM
per text run, fights native heading semantics). Unchanged.

**Verdict: A now, C only if a modifier ever needs independent logic or reuse
outside `crText`.** A delivers the requested authoring surface exactly, is a
rename away, and the migration window is ideal — Phase 2 shipped mostly static
`data-text` markup, so directive call sites are few.

## 3. The full SwiftUI mapping (what ports, what deliberately doesn't)

Confirmed against Roboto Flex's actual variable axes
([v-fonts](https://v-fonts.com/fonts/roboto-flex),
[web.dev variable fonts](https://web.dev/articles/variable-fonts)): `wght`
100–1000, `wdth` 25–151, `slnt` 0…−10, `GRAD` −200…150, `opsz`, plus
micro-axes.

| SwiftUI                                                                  | Ours (input on `crText`)                    | Compiles to                   | Notes                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Text(…)`                                                                | `crText` (role optional)                    | `data-text` when role given   | marker ≈ Text itself                                                                                                              |
| `.font(.title)`                                                          | `crText="title"`                            | `data-text="title"`           | role tokens = `Font.TextStyle`                                                                                                    |
| `.font(.system(size: 12, …))`                                            | **not ported — deliberate**                 | —                             | arbitrary sizes reopen the ramp bypass the whole Phase 2 migration closed; an off-ramp size is a token change                     |
| `.fontWeight(.semibold)`                                                 | `fontWeight="semibold"`                     | `data-text-weight`            | rename of `weight`                                                                                                                |
| `.bold()` / `.bold(Bool)`                                                | `bold` / `[bold]="b"`                       | `data-text-weight="bold"`     | sugar: transform into fontWeight; explicit `fontWeight` wins                                                                      |
| `.italic()` / `.italic(Bool)`                                            | `italic` / `[italic]="b"`                   | `data-text-italic`            | **newly portable**: Roboto Flex `slnt` −10 → CSS `font-style: oblique 10deg` (typography.css rule)                                |
| `.fontDesign(.serif/.monospaced)`                                        | `fontDesign="heading\|content"`             | `data-text-design`            | our two families are the design vocabulary; add `mono` only with a real mono token                                                |
| `.fontWidth(.condensed/.expanded)`                                       | `fontWidth="condensed\|standard\|expanded"` | `data-text-width`             | `wdth` axis via `font-stretch` (already shipped)                                                                                  |
| `.foregroundStyle(…)`                                                    | `foregroundStyle="secondary\|accent\|…"`    | `data-text-tone`              | rename of `tone`; semantic color roles only                                                                                       |
| `.underline(Bool)` / `.strikethrough(Bool)`                              | `underline` / `strikethrough`               | `data-text-underline/-strike` | shipped; per-decoration `color:`/`pattern:` params deferred — no demonstrated need                                                |
| `.monospacedDigit()`                                                     | `monospacedDigit`                           | `data-text-monospaced-digit`  | `font-variant-numeric: tabular-nums` — work-gallery's meters already need exactly this                                            |
| `.kerning(…)` / `.tracking(…)`                                           | `tracking="tight\|wide"`                    | `data-text-tracking`          | tokens only, no raw CGFloat-style numbers (ramp discipline); kerning (font-kerning toggle) has no use case here                   |
| `.textCase(.uppercase)`                                                  | `textCase="uppercase\|lowercase\|none"`     | `data-text-case`              | shipped                                                                                                                           |
| `.baselineOffset`, `.textScale`, `TruncationMode`, `DateStyle`, `Layout` | deferred                                    | —                             | niche or not-web-portable; `lineLimit`-style truncation (`-webkit-line-clamp`) is the first worth adding _when a consumer exists_ |

**Bonus found during axis research:** Roboto Flex's `GRAD` axis changes
apparent weight _without changing glyph width_ — the canonical fix for
hover-bolding layout shift. Worth a future `--cr-font-grade-*` token if any
hover treatment ever wants weight emphasis.

## 4. Recommended change list (S effort)

1. Rename `TextDirective` inputs: `weight`→`fontWeight`, `design`→`fontDesign`,
   `width`→`fontWidth`, `tone`→`foregroundStyle` (keep `textCase`, `tracking`,
   `underline`, `strikethrough`). Make the role input optional
   (`crText` bare = marker only, stamps no `data-text`).
2. Add sugar/new modifiers: `bold` (booleanAttribute → weight), `italic`
   (booleanAttribute → `data-text-italic` + `font-style: oblique 10deg` rule +
   `@supports` fallback comment), `monospacedDigit` → tabular-nums rule.
3. `typography.css`: add the two new modifier rules; everything else unchanged.
4. Migrate the handful of existing directive call sites (static `data-text`
   markup untouched); extend `text.directive.spec.ts` + the showcase modifier
   grid.
5. Convention note in styling-conventions.md: modifier inputs follow SwiftUI
   names verbatim; new modifiers require a SwiftUI counterpart or a
   documented deviation.

**Sources:** [angular.dev style guide](https://angular.dev/style-guide) ·
[angular-eslint directive-selector](https://github.com/angular-eslint/angular-eslint/blob/main/packages/eslint-plugin/docs/rules/directive-selector.md) ·
[web.dev — variable fonts](https://web.dev/articles/variable-fonts) ·
[Roboto Flex axes (v-fonts)](https://v-fonts.com/fonts/roboto-flex) ·
[Apple — SwiftUI Text](https://developer.apple.com/documentation/swiftui/text)
