# Styling & Typography Architecture Case Study — marketing-app audit

**Date:** 2026-07-20. **Scope:** full audit of `apps/marketing` + `libs/shared/{ui,design-tokens,cursor}` styling — component styling mechanics, typography, token naming/usage — assessed against production design-system practice (Radix/Ark/React Aria data-attribute conventions, Apple HIG/SwiftUI text roles, Material elevation, W3C DTCG token tiering). **Stance:** this is a greenfield project — complete refactors and renames are in scope; no back-compat constraints. Successor to the [design system modernization proposal](./design-system-proposal.md) (largely implemented) — this doc audits what the first real consumer (the marketing app) did to those foundations.

**Method note:** counts below come from a full-repo audit (four parallel sweeps: styling mechanics, typography call sites, token census, plus first-hand reads of every house-pattern file). All numbers are grep-verified against the working tree on the date above.

---

## 1. Verdict in one paragraph

The **foundation layer is genuinely strong** — the Button/Card/Input host API (class for identity, `data-*` for variants, ARIA paired with state), the ShapeDirective/MaterialDirective patterns, `@layer` discipline, semantic-only color tokens with theme-parity tests, zero `::ng-deep`, zero encapsulation hacks. The failure is **adoption collapse at the app layer**: the marketing app re-invented typography ad hoc (82% of font-sizes raw, ~60 distinct sizes vs. 9 tokens, the "eyebrow" role hand-copied ~13 times in ~10 drifting variants), re-styled the CTA button by hand in 8 places instead of using `Button`, and switched state grammar from `data-*` to `is-*` classes. The token system's typography axes (size + separate line-height lists) are structurally wrong — they invite unpaired usage, and 7 of 9 line-height tokens are dead. The fix is not "more discipline"; it is **making the right thing the easy thing**: role-based composite type tokens, a `crText` modifier directive (SwiftUI-style), an `a[crButton]` anchor variant, one state grammar, and lint enforcement.

---

## 2. What is already A-grade — keep, and extend from

| Pattern                                                                                                                                                                                                 | Where                                                                                             | Why it's right                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selector: 'button[crButton]'` + `class: 'cr-button'` + `data-variant/size/shape/tone`                                                                                                                  | `button.ts`                                                                                       | Native element upgraded in place; class = identity, data-attr = variant. Exactly the Radix/Ark/React Aria convention.                                                             |
| ARIA paired with visual state, CSS never selects on `aria-*`                                                                                                                                            | `button.ts` (`aria-busy`+`aria-disabled`+click guard), `input.ts` (`data-invalid`+`aria-invalid`) | Single-source state, AT-correct.                                                                                                                                                  |
| ShapeDirective: static class + CSS custom properties + presence data-attr                                                                                                                               | `shape.directive.ts` + `shape.css`                                                                | The canonical "directive compiles to paintable DOM" pattern; border-radius-not-clip-path rationale documented; override hooks (`--cr-shape-radius`, free `clip-path`) deliberate. |
| MaterialDirective: single input → single `data-material` attr, global `@layer` CSS, `@supports` + `prefers-reduced-transparency` fallbacks                                                              | `material.directive.ts` + `material.css`                                                          | Pure consumer-driven directive; correct `hostDirectives` candidate.                                                                                                               |
| `@layer cr-tokens, cr-reset, cr-base, cr-components, cr-utilities` declared once per app; every lib file opts in                                                                                        | each `styles.css:1`                                                                               | Specificity-fight-free override model.                                                                                                                                            |
| Tokens are plain hand-edited CSS, semantic-only color layer, two-hue palette, theme parity + contrast enforced by `tokens.spec.ts`                                                                      | `libs/shared/design-tokens/css/*`                                                                 | Right-sized for this repo; the spec-as-schema idea is better than most codegen pipelines.                                                                                         |
| Elevation model: shadow-only light / tint-ramp dark, `surface-plain`/`surface-tint` split                                                                                                               | `light.css`/`dark.css` + [elevation case study](./elevation-surface-case-study.md)                | Asymmetric by evidence, not by formula.                                                                                                                                           |
| Angular mechanics: signals + `input()` + `computed()`, `host: {}` metadata (0 decorators), OnPush, **0 `::ng-deep`**, 0 encapsulation overrides, `display: contents` hosts, `@starting-style`, `:has()` | everywhere                                                                                        | Current-idiom Angular; nothing to migrate.                                                                                                                                        |
| Heading semantics decoupled from visual size (h1–h6 carry structure, roles carry size)                                                                                                                  | `reset.css`, templates                                                                            | Correct; the same display style legitimately sits on an `h1` and an `h2`.                                                                                                         |
| `docs/design-research/decisions.md` as a rejection log                                                                                                                                                  | docs                                                                                              | Rare, valuable practice. Keep feeding it.                                                                                                                                         |

These are the house patterns. Everything below is measured against them.

---

## 3. Flagged decisions — the full list

Severity: 🔴 architectural (drives many downstream bugs) · 🟠 systemic inconsistency · 🟡 local cleanup.

### Typography (the disaster zone)

**F1 🔴 Three competing type systems coexist.**
(1) The token scale (`--cr-font-size-*` 9 steps + 9 paired line-heights, 4 weights) — used by libs/app-shells only. (2) The `data-text` role sheet (`typography.css`: display/title/eyebrow/body/footnote) — hardcodes its own raw metrics (weight 630/610/760, `clamp()` slopes, letter-spacings), bypassing the very tokens it should be built from. (3) The marketing app's ad-hoc layer — 138 raw font-sizes, 65 raw weights, 44 raw letter-spacings across 6 CSS files.
_Production practice:_ ONE system — role tokens (composite: family+size+leading+weight+tracking per role) are the public API; primitive axes are internal feedstock for roles only. Apple, Material, Primer all publish _roles_, never loose axes, to consumers.

**F2 🔴 The size/line-height token design invites the bug it then suffers.**
Two parallel 9-entry lists that authors must mentally zip: of 30 token-based `font-size` sites, only **5** pair the matching line-height, **24** omit it, 1 mismatches (`cursor-dot.component.css:40,42` — subheadline size with raw `line-height: 1.24`). **7 of 9 `--cr-font-line-height-*` tokens have zero consumers.**
_Production practice:_ never ship leading as a separately composable axis. Bundle per role — either `font: var(--cr-text-title)` composite shorthand tokens, or role selectors that always set both. Delete the freestanding line-height token family.

**F3 🔴 The type ramp doesn't cover the design, so authors route around it.**
Tokens top out at `title` = 3rem fixed; the marketing design needs fluid display sizes up to `clamp(6rem, 19vw, 22rem)` (`work-gallery.component.css:33`). Result: ~45 hand-written `clamp()` expressions with per-file vw slopes — the _same visual role_ uses 6vw, 6.3vw, 9vw, 12vw, 19vw slopes in different files.
_Production practice:_ the ramp must cover the real design (add `display`/`extraLargeTitle`-class steps, following the SwiftUI `Font.TextStyle` naming already adopted: largeTitle/extraLargeTitle exist in that vocabulary); fluidity is defined once, inside the token (`clamp()` lives in the token value), never at call sites.

**F4 🔴 Weight tokens ignore the variable font.**
Tokens define 400/500/600/700; the design actually uses **18 additional raw weights** (430, 560, 590, 610, 620, 630, 640, 650, 680, 690, 720, 740, 750, 760, 780 …) because Roboto Flex is variable and 630 ≠ 600 visually at display sizes. `--cr-font-weight-bold` has **zero consumers**.
_Production practice:_ per-role weight is part of the role token (display wants 630, eyebrow wants 760 — that's role identity, not a modifier); the _modifier_ weight scale stays small and semantic (regular/medium/semibold/bold → the closest variable-font values the design actually validated).

**F5 🔴 Role drift: the same visual role re-declared with different metrics.**
"Eyebrow" exists as `[data-text='eyebrow']` _and_ as a `.eyebrow` class _and_ raw — **~13 declarations, ~10 distinct (size, weight, tracking) triplets** (0.55–0.68rem / 700–780 / 0.04–0.15em) across `home.page.css`, `services.page.css` (4 variants in one file), `app.css`, `team-showcase`, `locations`, `work-gallery`. The display heading is byte-identical copy-pasted into 3 files. `home.page.css:43` even documents the duplication ("kept as a class only for the sections that still reference it").
_Production practice:_ a role has exactly one definition; if two sections genuinely need different metrics, that's two roles with two names. Delete `.eyebrow`; delete every local re-declaration.

**F6 🟠 `data-text` adoption is ~5%.** 9 usages in 2 templates; `title`/`footnote` roles defined but never used; `locations.component.html` uses the roles while its own CSS re-declares ~50 raw font rules. No enforcement, so the abstraction lost to inertia.
_Production practice:_ abstractions that are optional at FAANG scale come with lint gates (see §8) and with ergonomics good enough that bypassing is _more_ work (see §5, `crText`).

**F7 🟡 No tracking (letter-spacing) axis at all.** 44 declarations, 24 distinct values, 0 tokens. Same for `text-transform` (16 raw `uppercase`). These are part of role identity (eyebrow = caps + wide tracking) — fold into role tokens, plus a tiny modifier scale (`tight`/`normal`/`wide`).

### Variant & state grammar

**F8 🔴 Two state grammars: libs say `data-*`, the app says `is-*`.**
Libs/state contract: presence data-attrs (`data-cr-cursor-hover`, `data-invalid`, `data-active`, `data-morphing`…). The marketing app: 14 `[class.is-*]` bindings (`is-open`, `is-active`, `is-visible`, `is-closing`, `is-dragging`, `is-today`, `is-soon`, `is-expanded`) — same concept, different mechanism, so a reader can't grep one pattern and CSS can't share state selectors across the boundary.
_Production practice (and the owner's stated rule):_ class for identity, data-attr for variant _and state_. Greenfield fix: migrate every `is-*` to `data-state` attrs (Radix-style `data-state="open"` where states are exclusive; presence attrs `data-open`/`data-visible` where independent). One grammar, everywhere.

**F9 🔴 The CTA pill is hand-rolled 8 times instead of being a Button.**
`.hero-book`, `.services__all`, `.final-book > a`, `.site-footer__book`, `.wg-end a`, `.location-sheet__book`, `.barber-sheet__profile > a`, `.service-sheet__summary > a` — all re-implement `background: var(--cr-color-action-background)` + pill radius + weight 720 + hover swap. Root cause: `Button`'s selector is `button[crButton]` only — **there is no anchor story**, and marketing CTAs are links.
_Production practice:_ every serious design system's button renders as `<a>` too. Extend the selector to `'button[crButton], a[crButton]'` (guard the loading/aria-disabled logic for anchors), then replace all 8 copies. This one change deletes ~120 lines and ends the drift.

**F10 🟠 Verbatim duplicated interaction blocks across components.**
(a) "explore label + icon" affordance: `team-showcase.component.css:165-204` ≈ `services.page.css:193-232`; (b) media hover-morph (`clip-path: inset(0 round 50%)` → frame radius + scale/rotate/saturate, 750/900ms): `team-showcase:62-95` ≈ `services:96-129`, each with duplicated `hover:none` and reduced-motion overrides; (c) sheet content-in keyframes duplicated under two names (`services:503-514` ≈ `locations:736-747`); (d) off-screen toolbar reveal duplicated (`locations:662-682` ≈ `services:242-260`); (e) film-frame video treatment duplicated (`home.page.css:142-151` ≈ `318-328`).
_Production practice:_ second occurrence = extract. (b) is a `crMediaMorph`-style directive/class in the ShapeDirective mold; (a)/(d)/(e) are shared `@layer cr-components` classes or tiny components; (c) is one shared keyframe.

**F11 🟠 Element-selector styling couples CSS to markup shape.** `.service-card h3`, `.service-sheet__summary > p / > div / > a`, bare `figure`/`img` — renaming a tag silently drops styling, and child-combinator chains break on wrapper insertion. Tolerable under emulated encapsulation at this scale, but most of these _are text roles_ — they disappear once F1–F5 land (`<h3 crText="headline">` replaces `.service-card h3`).

**F12 🟡 Naming drift in blocks.** `team-card` / `service-tile` / `wg-card` / `location-card` are four names for "card in a section grid," and `wg` is the only abbreviated block prefix in the codebase. Greenfield: rename `wg-*` → `work-card`/`work-gallery__*`; pick one of `-card`/`-tile`. Also: lib classes are `cr-`-prefixed, app sections unprefixed — that boundary is actually fine (leaf app, encapsulated), but write it down as a rule so it reads as intent, not accident.

### Tokens — naming & usage

**F13 🔴 `--cr-color-accent-active` is a lie.** It is not the active state of accent — it's the expressive **yellow highlight surface** (`#f6d800`), with a hard usage contract (surface-only, never text-on-background) that the name actively hides. It has 20 consumers, so the misnomer is spreading. Rename → `--cr-color-highlight` (and document the pairing rule in the token comment). Same review for `warning-active`/`success-active`/`danger-active` — `-active` elsewhere genuinely means state, which makes the accent case worse.

**F14 🟠 Semantic aliases are value-copies, not references.** In `light.css`: `accent` = `action-background-active` = `link` = `#0b46c8`; `focus-ring` = `action-background` = `#145cf3` — four hand-repeated hexes. Editing the brand blue now requires coordinated edits the files don't express.
_Production practice:_ alias chains — `--cr-color-link: var(--cr-color-accent)`; only genuinely independent decisions get literal hex. (Keep literals where the two themes _deliberately_ diverge; the point is expressing which is which.)

**F15 🟠 Dead tokens.** Zero consumers: `--cr-color-analogous-0/1/2` (cryptic name, no contract), `success-active`/`warning-active`/`danger-active` (status ramp — plausibly future CRUD-app material, but unproven), `--cr-font-weight-bold`, 7 of 9 line-height tokens, `--cr-material-none`, `--cr-space-none`. Greenfield: delete `analogous-*` outright (reintroduce with real names if a need appears), fold line-heights into roles (F2), keep `*-none` as API completeness, decide status-active ramp when a consumer exists.

**F16 🟠 Missing token families the app visibly needed** (each gap = a cluster of hardcoding):

- **Z-index/layer scale:** 20 magic values (`1300`, `100`, `20`, `12`, `4`, `2`, `-1`…). Add `--cr-layer-{base,raised,nav,overlay,sheet,cursor}` and map all 20.
- **Scrim/glass/overlay colors:** ~28 raw `rgb(255 255 255 / x)` / `rgb(0 0 0 / x)` literals (hero veils, meter tracks, toolbar glass) that ignore theming. Add a small `--cr-color-scrim-*` / ink-overlay family (or derive via `color-mix` from foreground/background so they theme for free).
- **Tracking scale** (F7). **Fluid display sizes** (F3). **Focus-ring width/offset** (`2px` literals in `styles.css:89-90`).
- **Breakpoints:** `760` / `819` / `820` / `980` / `1100` px coexist (819 vs 820 is clearly drift). CSS vars can't drive `@media`, so this is a _documented constants_ problem: one written-down set (e.g. 480/760/1024/1280), lint-checked, plus container queries where the component really responds to its container, not the viewport.
- **Emphasis/opacity idiom:** `color-mix(in srgb, … calc(0.58 * 100%), transparent)` copy-pasted ~30× while `--cr-color-foreground-secondary/-tertiary` exist for exactly this. Route all through the foreground hierarchy; add a fourth step if the design truly needs it.

**F17 🟡 Numbered scales — mostly defensible, one rename.** `title/title2/title3` matches SwiftUI's own `Font.TextStyle` (keep). `shadow-0..5` / `surface-1..5` / `alpha-1..5` are coupled elevation _tiers_ — numbering is the industry norm for elevation. ~~Rename `--cr-alpha-N` → `--cr-elevation-alpha-N`~~ **withdrawn during Phase 1**: `button.css:39-45` documents the scale as deliberately shared between elevation tint _and_ interaction state-layer opacity — the generic name is accurate, not lazy. Keep `--cr-alpha-N`. `radius-small/regular/large/extra-large` matches the SwiftUI `ControlSize` vocabulary already used by `ButtonSize` (`mini…extraLarge`) — consistent; keep.

### Motion

**F18 🟠 Motion tokens exist but marketing hand-numbers everything.** Ad-hoc durations everywhere (`200ms`, `260ms`, `280ms`, `320ms`, `350ms`, `480ms`, `540ms`, `650ms`, `750ms`, `900ms`…), raw `ease`, and the **same** emphasized curve written three ways: `--cr-motion-easing-emphasized` = `cubic-bezier(0.16, 1, 0.3, 1)` (tokens.css) vs `'cubic-bezier(.16,1,.3,1)'` (`home.page.ts:99`) vs `'cubic-bezier(0.16, 1, 0.3, 1)'` (`showcase-gallery.component.ts:87`), plus a bespoke unnamed curve in `cursor-dot.component.css:83`. WAAPI code can't `var()` — so export motion constants for TS from the same source (a tiny `motion.ts` in design-tokens mirroring the CSS, or `getComputedStyle` reads) and ban inline curves.
Also: if the current 4-step duration scale is genuinely too coarse for choreography (650/750/900ms section work), _extend the scale_ (e.g. `--cr-motion-duration-slowest`, `-cinematic`) instead of abandoning it.

**F19 🟡 13 duplicated `prefers-reduced-motion` blocks**, each hand-listing selectors to null out. Adopt the standard global kill-switch in `@layer cr-base` (`*, ::before, ::after { transition-duration: 1ms; animation-duration: 1ms; … }` under the media query) plus rare opt-ins for motion that is _meaning_ (the map indicator opacity), and delete the 13 local blocks. One place, impossible to forget.

### Angular mechanics & misc

**F20 🟡 `ShapeDirective` follow-ups** (it's good; make it excellent):

- `transition: border-radius 0.1s` in `shape.css:11` hardcodes a duration — use `var(--cr-motion-duration-fast)`.
- `crShapeRadius` is stringly-typed (`'var(--cr-radius-regular)'`). Accept the token vocabulary as a typed union (`'none' | 'small' | 'regular' | 'large' | 'extraLarge' | 'full' | (string & {})`) and map names → `var()` internally — same enum→token mapping `crText` will use; raw CSS lengths stay the escape hatch.
- Vocabulary gaps vs SwiftUI: `ellipse` (50% radius without the aspect lock) and `unevenRoundedRectangle` (per-corner radii — `border-radius` 4-value syntax, still animatable) are cheap adds; add when a consumer shows up, but design the input shape now so they're non-breaking.
- Morph only reacts to `:hover`/cursor-hover; keyboard users never see it. Add `:focus-visible` to the morph selector for interactive hosts.

**F21 🟡 `applyNgContentAttr` scope-stamping** (`locations.component.ts:520-539`): reading Angular's `_ngcontent-*` attr off a sibling and stamping it onto MapLibre-created DOM is clever but couples to a framework private. Sturdier options: move `.locations-map__pin*` rules to an unscoped `@layer cr-components` block (the shape.css precedent — pins are effectively a mini-library), or render pins from an `<ng-template>` via `createEmbeddedView` and hand MapLibre the element. Either removes the private-attr dependency.

**F22 🟡 Small unifications.** `work-gallery.component.ts:33` sets `host: { style: 'display: contents' }` inline while every sibling uses CSS `:host` — pick CSS. `999px` (`work-gallery:185`) and 9 `border-radius: 50%` literals coexist with `--cr-radius-full` — one idiom. Raw `1px`/`2px` borders in cards/pins while the shell uses `--cr-border-width-hairline` — use the token (add `--cr-border-width-regular: 2px` if 2px is a real tier).

**F23 🟡 Doc drift.** `decisions.md` still instructs "extend the Style Dictionary pipeline" and cites `build.mjs`/`generated/ts/vars.ts` — the pipeline was removed in July 2026 (tokens are plain CSS now); `material.directive.ts:9` points at `generated/css/tokens.css`. Update both so the rejection log stays trustworthy.

---

## 4. The `crText` decision — component vs. directive

**Question:** should typography be a `<cr-text fontWeight=… foregroundStyle=…>` element (SwiftUI `Text` port) or modifier directives on native elements?

**Verdict: attribute directive on native elements. No `<cr-text>` element.**

Reasoning:

1. **DOM economy.** SwiftUI's `Text` works because SwiftUI has no separate semantic layer — the view _is_ the text. On the web, `<cr-text>` would wrap every text run in an extra element (or worse, force `<cr-text><h2>…` nesting), bloating the painted DOM the user explicitly wants lean. A directive compiles to _zero_ extra elements: `<h2 crText="title" weight="semibold">` renders as `<h2 data-text="title" data-text-weight="semibold">` — trivially parsed, trivially painted, style resolution is one attribute selector.
2. **Semantics stay native.** h1–h6/p/small/figcaption keep carrying document structure; the role is orthogonal (already the house philosophy — see §2, decoupled headings).
3. **It's the existing house pattern.** MaterialDirective is precisely this shape: typed input → data-attr → global `@layer` CSS. ShapeDirective adds custom-property plumbing for the continuous axes. `crText` composes both: enums → data-attrs, continuous values (tracking override) → custom property.
4. **Static escape hatch preserved.** Because the directive only writes `data-text-*`, plain static markup (`<p data-text="footnote">`) keeps working with zero JS — the directive adds type safety, autocomplete, and enum→token mapping, not a runtime dependency.

### API sketch (SwiftUI parity mapped to the web)

```ts
// libs/shared/ui/src/lib/text/text.directive.ts
export type TextRole =
  // = the role-token vocabulary, §6
  | 'display'
  | 'largeTitle'
  | 'title'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'subheadline'
  | 'body'
  | 'callout'
  | 'footnote'
  | 'caption'
  | 'eyebrow';
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold'; // per-role default baked into the role
export type TextDesign = 'heading' | 'content'; // ≙ fontDesign (Roboto Flex vs Roboto)
export type TextWidth = 'condensed' | 'standard' | 'expanded'; // ≙ fontWidth → font-stretch (Roboto Flex wdth axis)
export type TextTone =
  // ≙ foregroundStyle → semantic color roles ONLY
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'action'
  | 'danger'
  | 'success'
  | 'warning';
export type TextCase = 'uppercase' | 'lowercase' | 'none'; // ≙ textCase

@Directive({
  selector: '[crText]',
  host: {
    '[attr.data-text]': 'role()',
    '[attr.data-text-weight]': 'weight() ?? null', // null = role default; attr absent = no CSS match = role wins
    '[attr.data-text-design]': 'design() ?? null',
    '[attr.data-text-width]': 'width() ?? null',
    '[attr.data-text-tone]': 'tone() ?? null',
    '[attr.data-text-case]': 'textCase() ?? null',
    '[attr.data-text-underline]': 'underline() ? "" : null',
    '[attr.data-text-strike]': 'strikethrough() ? "" : null',
    '[style.--cr-text-tracking]': 'trackingOverride()', // rare continuous escape hatch
  },
})
export class TextDirective {
  /* signal inputs matching the host bindings */
}
```

```html
<h2 crText="title">Section title</h2>
<p crText="body" tone="secondary">Supporting copy…</p>
<span crText="eyebrow">Chapter 01</span>
<a crText="footnote" [underline]="true" tone="accent">Terms</a>
```

CSS stays ONE file (`typography.css`, rewritten): role selectors (`[data-text='title'] { font: var(--cr-text-title); letter-spacing: var(--cr-text-title-tracking); }`) + small modifier sections (`[data-text-weight='bold'] { font-weight: var(--cr-font-weight-bold); }`, `[data-text-tone='secondary'] { color: var(--cr-color-foreground-secondary); }`, decoration/case rules) — all in `@layer cr-base`, modifiers after roles so they win within the layer. Estimated total: ~150 lines replacing ~516 scattered declarations (≈380 raw) across 27 files.

**Deliberate non-goals:** no `kerning`/`baselineOffset` (no demonstrated need — the ShapeDirective "on demonstrated need" discipline); no free `[style.fontSize]`-style numeric inputs (that would re-open the ramp bypass the directive exists to close); no `italic` until a validated italic exists in the type ramp (Roboto Flex has no true italics).

---

## 5. Role tokens — the typography rebuild (§F1–F7 resolution)

Replace the freestanding size/line-height axes with **composite role tokens** in `tokens.css`, one `font` shorthand + tracking per role, fluid where the role is fluid:

```css
/* Roles are the public typography API. `font:` bundles style/weight/size/line-height/family
   so a role can never be half-applied (F2). Fluidity lives IN the token (F3). */
--cr-text-display: 630 clamp(3.3rem, 6vw, 6.6rem) / 0.86
  var(--cr-font-family-heading);
--cr-text-display-tracking: -0.074em;
--cr-text-title: 610 clamp(2rem, 3.1vw, 3.6rem) / 0.94
  var(--cr-font-family-heading);
--cr-text-title-tracking: -0.058em;
/* …title2, title3, headline, subheadline, body, callout, footnote, caption… */
--cr-text-eyebrow: 760 0.64rem / 1.2 var(--cr-font-family-heading);
--cr-text-eyebrow-tracking: 0.13em; /* + text-transform: uppercase in the role rule */
```

- Metrics come from what the design actually validated (the current `typography.css` + the dominant marketing variants — one deliberate value per role, killing the ~10 eyebrow variants). **Phase 2 implementation note:** the full SwiftUI ramp shipped, _including_ `subheadline` — the Button/Input ControlSize ladders (0.75/0.875/1/1.125/1.25) map 1:1 onto caption→callout, which is the demonstrated need §4's sketch said to wait for; `body` is 1.125rem/1.4 content-family (marketing's old 1rem `data-text="body"` copy migrates up a step deliberately).
- The marketing hero's mega-display (`clamp(6rem,19vw,22rem)`) becomes a real role (`display`-above? name it honestly: `extraLargeTitle` per SwiftUI, or keep it a documented one-off custom property in `home.page.css` if it's truly a single art-directed moment — _decide, don't drift_).
- Primitive `--cr-font-size-*` / `--cr-font-line-height-*` axes are **deleted** (greenfield); `--cr-font-weight-*` stays as the modifier scale; `--cr-font-family-*` stays.
- Buttons/inputs/badge consume role tokens too (their near-identical duplicated size ladders in `button.css:77-101` / `input.css:40-64` collapse onto `caption…callout` roles).

---

## 6. Prioritized plan (greenfield — renames and deletions encouraged)

Ordered by dependency; each phase is shippable. [S/M/L] = effort.

**Phase 0 — Codify (S).**

1. Write `docs/styling-conventions.md`: class = identity (BEM-ish blocks), `data-*` = variant AND state (Radix-style `data-state` for exclusive states, presence attrs for booleans), ARIA always paired and never styled against, tokens-only for color/type/motion/space/radius/z, one breakpoint set (pick: 480/760/1024/1280 — reconcile 819/820), app-level `--page-*`/section custom properties allowed but must resolve to `--cr-*` where a token exists. Add the F12 prefix rule.
2. Fix doc drift (F23): `decisions.md` Style-Dictionary paragraph, `material.directive.ts` path comment.

**Phase 1 — Token surgery (M).** All in `libs/shared/design-tokens/css/` + `tokens.spec.ts`: 3. Role tokens per §5; delete size/line-height axes; extend `tokens.spec.ts` to assert every role defines font+tracking and that `typography.css` covers every role (spec-as-schema, the house trick). 4. Renames: `accent-active` → `highlight` (F13); `alpha-N` → `elevation-alpha-N` (F17). Delete `analogous-*` (F15). Alias-chain `link`/`link-hover`/`focus-ring`/`accent` onto the action ramp where values are intentionally shared (F14). 5. New families (F16): `--cr-layer-*` z-scale; scrim/ink-overlay colors (theme-aware); tracking modifiers; focus-ring width/offset; extend motion durations for choreography (F18) + ship `motion.ts` TS mirror for WAAPI.

**Phase 2 — `crText` + typography rewrite (M).** 6. Build `TextDirective` per §4 + rewrite `typography.css` (roles + modifiers, `@layer cr-base`). 7. Migrate all 27 CSS files: replace every raw font-size/weight/leading/tracking/transform with `crText` roles or role tokens; delete `.eyebrow` classes and the copy-pasted display blocks. Migrate buttons/inputs/badge ladders onto roles. This phase deletes ~500 declarations; expect visual diffs where drift existed — resolve each to the canonical role deliberately (screenshot-compare per section).

**Phase 3 — Component reuse & state grammar (M).** 8. `Button` on anchors: `selector: 'button[crButton], a[crButton]'`; replace the 8 hand-rolled CTA pills (F9). 9. `is-*` → `data-*` state grammar across app components + their CSS (F8) — mechanical rename, do it in one sweep. 10. Extract duplicated blocks (F10): media hover-morph directive (ShapeDirective mold), explore-affordance component/class, shared sheet keyframes, toolbar-reveal class. Rename `wg-*` (F12). Rebuild the language menu on `@angular/aria` Menu (§A1); strip redundant OnPush declarations post-v22-migration (§A3).

**Phase 4 — Motion & polish (S–M).** 11. Global reduced-motion kill-switch, delete 13 local blocks (F19). Route all durations/easings through tokens incl. TS call sites (F18). Map 20 z-indexes onto `--cr-layer-*`. Radius/border idiom unification (F22). ShapeDirective follow-ups (F20). Map-pin CSS de-hack (F21). Migrate the nav-tone `:host-context` system to container style queries (§A2).

**Phase 5 — Enforcement (S).** 12. Stylelint (the piece that makes it stick): `declaration-property-value-allowed-list` — `font-size`/`font-weight`/`line-height`/`letter-spacing` only allowed in `typography.css` (elsewhere must be `var(--cr-text-*)`/inherit); `z-index` must be `var(--cr-layer-*)`; color literals banned outside token files (allow `transparent`/`currentColor`); duration/easing literals banned outside token files. Wire into `nx lint`. 13. Showcase page: render every role × modifier grid in `apps/showcase` so the vocabulary is visible and reviewable.

**Success criteria:** raw-value counts → ~0 (from 138 font-sizes / 65 weights / 44 trackings / 20 z-indexes / ~28 scrim literals); one state grammar; one CTA implementation; `typography.css` as the single type authority; lint keeping it that way.

---

## 7. Research addendum — Angular 22 & 2026 CSS baseline (verified 2026-07-20)

Post-audit verification against Angular 22 (released 2026-06-03) and current browser baselines. Three findings change the plan; the rest confirm it.

**A1 — `@angular/aria` is GA in v22: stop hand-rolling popup/menu plumbing.**
Angular now ships an official headless-directives library (GA, production-supported) covering Combobox, Listbox, Select, Multiselect, Menu, Menubar, Toolbar, Accordion, Tabs, Tree, Grid — keyboard interaction, focus management, and ARIA wiring handled; zero styles imposed (styling stays ours, on the attributes/classes it manages). Sources: [angular.dev/guide/aria/overview](https://angular.dev/guide/aria/overview), [Ninja Squad v22 write-up](https://blog.ninja-squad.com/2026/06/03/what-is-new-angular-22.0).
_Plan delta (Phase 3):_ the app shell's hand-rolled language menu (`app.html` `is-open` toggling + document click/keydown listeners in `app.ts:30`) becomes an `@angular/aria` Menu; any future dropdown/tabs/accordion starts from these primitives. `ModalSheet` stays custom — the library ships no dialog primitive, and the sheet's `inert`/drag mechanics are already sound.
_Convention delta:_ the house rule "CSS never selects on `aria-*`" gets a refinement: it targets _hand-mirrored_ state (never duplicate state into ARIA just to style it — keep `data-*` for that). When an `@angular/aria` directive _owns_ an ARIA attribute as the single source of truth (e.g. `[aria-expanded]` on a managed trigger), styling against it is correct and avoids a redundant parallel attribute. Encode both halves in `docs/styling-conventions.md`.

**A2 — Container _style_ queries are now cross-browser: retire `:host-context` tone theming.**
Firefox ships style queries for custom properties in 2026 (Interop 2026; enabled by default in Firefox 151 per [Bugzilla #2030645](https://bugzilla.mozilla.org/show_bug.cgi?id=2030645)); Chrome/Edge 111+ and Safari 18+ already had them ([MDN guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_size_and_style_queries)). The earlier proposal's "defer — Firefox mid-2026" ruling is now expired.
_Plan delta (Phase 4):_ ~~migrate nav-tone to style queries~~ **attempted and reverted during Phase 4 (2026-07-20)**: a live minimal probe (`@container style(--x: on)` + inline property flip) showed container style queries silently no-op in the embedded Chromium the site is previewed in — for a core theming mechanism, a silent no-op (black nav on dark section) is an unacceptable failure mode, so `:host-context` stays until style-query support is verified in every engine this site actually ships to. The original idea remains documented here: `@container style(--nav-tone: dark) { … }` driven by one inherited `--nav-tone` custom property set on `<html>` — no containment setup needed (every element is a style-query container for custom properties), no compiled `:host-context` selector coupling, and section-scoped overrides compose for free. Same option applies to the `[data-surface='film']` environment (§F16's surface contract): the attribute stays as the _declaration_ API; descendants may _query_ the inherited custom property instead of relying on ancestor selectors. Adopt for the nav-tone system first; keep plain data-attr selectors where they already read fine — this is a tool for context inheritance, not a new variant grammar.

**A3 — OnPush is the v22 default.**
Unannotated components now get OnPush automatically (the update migration pins legacy components to `Eager`). All audited components already declare OnPush explicitly — after the v22 migration lands, drop the boilerplate from new components and optionally strip existing declarations in the Phase 3 sweep. Also new in v22 and worth knowing during refactors: an element matched by multiple components is now a _compile-time_ error, and duplicate input/output/model names error out ([Ninja Squad](https://blog.ninja-squad.com/2026/06/03/what-is-new-angular-22.0)).

**Confirmed, no change:** `hostDirectives` got refinements (dedup, merged input/output mappings) but no new capability that would reopen the cursor-composable decision; no selectorless-directive or ViewEncapsulation changes; the §4 SwiftUI vocabulary matches the canonical `Font.TextStyle`/`Font.Width`/`Font.Design`/`Text.Case` enums (largeTitle…caption2, compressed/condensed/standard/expanded, default/serif/rounded/monospaced, uppercase/lowercase); the `light-dark()` rejection stands (explicit `data-theme` model, independently-authored palettes).

---

## 8. Implementation record (2026-07-20 → 2026-07-21)

All five phases of §6's plan are implemented, tested (12 projects green), stylelint-clean repo-wide, and verified live. Summary of what shipped and where the plan bent to reality:

- **Phase 0** — `docs/styling-conventions.md`; `decisions.md` de-drifted + "tokens are plain hand-edited CSS" codified.
- **Phase 1** — Composite `--cr-text-*` role tokens (12 roles, fluid clamp baked in, per-role tracking); `accent-active` → `highlight` **with new paired `highlight-foreground`** in both themes; `link`/`link-hover`/`focus-ring` alias-chained; `analogous-*` deleted; `--cr-layer-*`, focus-ring, tracking, icon-size token families; `slowest`/`cinematic` motion steps with spec-enforced `motion.ts` TS mirror. _Withdrawn mid-flight:_ the F17 `alpha→elevation-alpha` rename (the scale is deliberately shared with interaction state-layers — generic name is correct).
- **Phase 2** — `TextDirective` (`crText` + weight/design/width/tone/case/tracking/decoration modifiers → `data-text-*` attributes, zero wrapper DOM); `typography.css` rewritten as the single type authority; ~500 raw declarations migrated across 27 files; the ~10 eyebrow variants collapsed to one role; freestanding size/line-height axes **deleted**. Remaining raw type: 3 commented art-directed heroes + icon glyph sizes (now `--cr-icon-size-*`).
- **Phase 3** — Button: `a[crButton]` anchor hosts, new `action` variant (the previously-unconsumed action-* CTA pair), `--cr-button-radius` hook; 9 hand-rolled CTAs replaced; `is-*` → `data-*` state grammar everywhere incl. `<html>` menu state and imperative MapLibre code; `wg-*` → `work-gallery`/`work-card`; duplicated blocks extracted to shared patterns in `styles.css`; 25 redundant OnPush declarations stripped (v22 default). _Found via visual verification:_ unlayered element defaults were beating layered component styles (dark-blue-on-blue CTA labels) — element defaults now live in `@layer cr-base` in all four apps.
- **Phase 4** — All raw durations/easings/z-indexes tokenized (~85 sites); global reduced-motion kill-switch in `@layer cr-base` (13 local blocks deleted/trimmed; Button spinner exempted via `data-motion-essential` — the spin is the signal); ModalSheet stamps its own `data-open` (fixing locations' silently-dead sheet animations); MapLibre pin styles moved to global `locations-map.css`, `applyNgContentAttr` hack deleted; language menu rebuilt on `@angular/aria` Menu (GA in v22) with `menuitemradio` + `aria-checked`, typeahead, and focus-return-on-Escape. _Reverted with evidence:_ §A2's container-style-query migration (silent no-op in embedded Chromium — see the comment at the nav-tone block in `app.css`). _Refined:_ z-index lint allows single-digit local stacking; tiers ≥10 must be `--cr-layer-*`.
- **Phase 5** — `.stylelintrc.json` token gates enforced via lint-staged/husky pre-commit + `pnpm lint:styles`; showcase tokens page renders the full role ramp and every modifier axis.

**Open items (deliberate, not debt):** three >30% motion-delay snaps + the collapsed 70/120ms reveal stagger (design-review the token-scale fit); `.cr-shell__login` is the last hand-rolled CTA (candidate: `variant="outline"` Button); film-glass scrim literals stay art-directed until a color lint proves a scale is needed; container style queries revisit when support is verified in every shipping engine.
