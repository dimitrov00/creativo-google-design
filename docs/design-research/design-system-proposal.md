# Design System Modernization Proposal — creativo-google-design

**Scope:** Angular 22 idiom alignment, CSS token architecture extension, type-safe token authoring, surface/materials layering, ARIA conventions, and SwiftUI-style modifier directives — synthesized from a full-repo audit plus six research tracks. This is a proposal to implement, not a survey; every recommendation is additive to the existing Style Dictionary pipeline (`libs/shared/design-tokens`) and the existing component conventions (`libs/shared/ui`, `libs/shared/cursor`) unless explicitly marked as a fix.

---

## 1. Executive summary

- **Angular 22 idiom baseline is already good.** Signals, `input()`/`viewChild.required()`, `host` object bindings, OnPush — all present and correct per [angular.dev/guide/signals](https://angular.dev/guide/signals) and [angular.dev/guide/components/host-elements](https://angular.dev/guide/components/host-elements). No component rewrite is warranted. The only structural gap is animation: zero use of `animate.enter`/`animate.leave` anywhere, and `@angular/animations` (deprecated since v20.2, [angular.dev/guide/legacy-animations](https://angular.dev/guide/legacy-animations)) must stay out of the dependency tree permanently.
- **Keep `createCursorTargetHost()` as a plain composable, do not migrate to `hostDirectives`.** Button feeds it an internally-`computed()` cursor style derived from its own `variant` input — a shape `hostDirectives` structurally cannot express, since composed-directive inputs are only settable by the _consuming_ template or a static default ([angular.dev/guide/directives/directive-composition-api](https://angular.dev/guide/directives/directive-composition-api)).
- **Extend, don't restructure, the token pipeline.** The primitive (`tokens/core/*`) → semantic (`tokens/semantic/{light,dark}.json`) → generated CSS split already matches 2025 DTCG best practice. Add `@layer`, add one `@property` registration, add `color-mix()`-derived _interaction-state_ and _surface-elevation_ tokens — but the 17 brand-pinned literal hex semantic values stay untouched. Skip `light-dark()`: the two theme files are independently authored, not mirror pairs, and it would fight `ThemeService`'s explicit `data-theme` model.
- **No CSS-in-JS.** Neither vanilla-extract nor StyleX has a supported esbuild-plugin path into `@angular/build:application` (the executor `apps/showcase` actually uses), and the repo doesn't want CSS-rule-authoring-in-TS anyway — it wants typed _token references_, which `generated/ts/*.ts` already delivers at zero runtime cost. Fix the DX gap (flat names → `vars.color.background`) by reshaping `build.mjs`'s custom Style Dictionary format, not by adding a dependency.
- **Surfaces/materials: bake, don't float.** Follow Material 3's own reversal away from live alpha-overlay elevation (Material 2/YouTube's technique) toward pre-baked opaque `color-mix()` surface tiers — safer for a design system where surfaces must compose and stay opaque. Reserve genuine translucency (alpha + `backdrop-filter`) for a separate, explicitly-named 5-tier Materials scale used only for true overlay/glass contexts (menus, cursor dot, toasts).
- **ARIA gaps are small and concrete, not architectural.** The `data-*` presentation / `aria-*` semantics split is already correct (matches Radix/Ark/React Aria conventions). Four fixes needed: Badge's hardcoded `role="status"`, Button's `aria-busy` not paired with `aria-disabled`, Input's missing per-size touch target floor, Input's missing label/`aria-describedby` story.
- **SwiftUI-style modifier directives: build `crMaterial`, skip `crShape`.** `crMaterial` is a clean, consumer-input-driven directive (compatible with `hostDirectives` re-exposure later). `crShape` duplicates the existing `data-shape` + radius-token system for no new capability — building it now is speculative, not need-driven.

---

## 2. Angular 22 adoption gaps

| Gap                                                        | Current state                                                                                                                                                                                               | Idiomatic Angular 22                                                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Effort                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| No enter/leave animation primitive anywhere                | Nothing mounts/unmounts with animation (repo-wide grep: zero `animate.enter`/`animate.leave`, zero `@angular/animations`)                                                                                   | `animate.enter`/`animate.leave` template syntax, stable, no dev-preview badge, is the documented default since v20.2 ([angular.dev/guide/animations](https://angular.dev/guide/animations))                                                   | Add `animate.enter="cr-enter"` / `animate.leave="cr-leave"` + `@keyframes` classes to any component that mounts conditionally (toast, dialog, filtered gallery cards). Start with a showcase gallery filter transition as the reference example.                                                                                                                                                                                                                                                                                                                                                                                     | S per component       |
| `@angular/animations` absent (correctly)                   | Confirmed absent                                                                                                                                                                                            | Deprecated since v20.2; **do not add it, ever** — no removal version is officially confirmed but the docs already steer all new code away from it                                                                                             | No action — codify as a standing rule in `CLAUDE.md` / a lint note so nobody adds it later chasing a tutorial that predates the deprecation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | S (docs only)         |
| No route transitions                                       | `apps/showcase` has no `withViewTransitions`                                                                                                                                                                | `provideRouter(routes, withViewTransitions({ onViewTransitionCreated }))` remains **Developer Preview** since v19, still not stable in v22 ([angular.dev/api/router/withViewTransitions](https://angular.dev/api/router/withViewTransitions)) | Adopt as progressive enhancement only. Must call `transition.skipTransition()` inside `onViewTransitionCreated` when `matchMedia('(prefers-reduced-motion: reduce)').matches` — mirror the exact OS-preference-read pattern `theme.service.ts` already uses for `prefers-color-scheme`. `::view-transition-old/new` CSS must live in `apps/showcase/src/styles.css` (global), never in a component stylesheet — Angular's emulated encapsulation blocks pseudo-element selectors from component-scoped CSS ([angular.dev/guide/routing/route-transition-animations](https://angular.dev/guide/routing/route-transition-animations)). | M                     |
| `createCursorTargetHost()` composable vs. `hostDirectives` | Plain factory function called from an injection context, reused identically by Button, Input, `CursorTargetDirective`                                                                                       | Both patterns are current-idiomatic; `hostDirectives` is _not_ strictly newer/better                                                                                                                                                          | **No change.** Button needs to push an internally-`computed()` value (`cursorStyle` derived from its own `variant` input) into the shared behavior — `hostDirectives`' inputs are only settable by the consuming template or a static default, never by the host component's own class logic ([angular.dev/guide/directives/directive-composition-api](https://angular.dev/guide/directives/directive-composition-api)). Migrating would break Button and fragment the codebase into two composition mechanisms for the same behavior.                                                                                               | — (explicitly reject) |
| Duplicated cursor host-binding boilerplate                 | `button.ts`, `input.ts`, `cursor-target.directive.ts` each hand-declare the same four host bindings (`pointerenter`/`pointerleave`/`data-cr-cursor-hover`/`data-cr-cursor-style`) around the shared factory | Not a correctness gap, a naming/documentation gap                                                                                                                                                                                             | Rename `createCursorTargetHost` → `useCursorTarget` to signal "this is a signal composable" per current community terminology, and document the pattern once in `libs/shared/cursor/README.md`. Do not restructure to `hostDirectives`.                                                                                                                                                                                                                                                                                                                                                                                              | S                     |
| `theme.service.ts` signal architecture                     | Already `signal<Theme>` + `effect()` writing to `documentElement.dataset`/`localStorage`, `matchMedia` listener via `addEventListener`                                                                      | Matches `angular.dev/guide/signals/effect`'s canonical case for `effect()`: syncing signal state to an imperative/non-reactive API (DOM/localStorage)                                                                                         | No change. This is the textbook-correct use of `effect()`, not a case that should be `computed()`/`linkedSignal()` instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                     |
| Future async/derived-state needs                           | None exist yet                                                                                                                                                                                              | `resource()`/`rxResource()`/`httpResource()` and `linkedSignal()` are now stable in v22 ([blog.ninja-squad.com/2026/06/03/what-is-new-angular-22.0](https://blog.ninja-squad.com/2026/06/03/what-is-new-angular-22.0))                        | When any future feature needs async-derived or writable-derived state, use these APIs directly — do not hand-roll `effect()`-based synchronization, which `angular.dev/guide/signals/effect` explicitly warns against ("if you're copying one signal into another via effect, it's a sign you should move your source-of-truth higher up").                                                                                                                                                                                                                                                                                          | — (standing guidance) |
| `@HostBinding`/`@HostListener` usage                       | Zero instances repo-wide (audit-confirmed)                                                                                                                                                                  | `host` object is the only recommended mechanism; decorators are back-compat only ([angular.dev/guide/components/host-elements](https://angular.dev/guide/components/host-elements))                                                           | No change — already compliant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                     |

**Net verdict:** treat `libs/shared/ui` and `libs/shared/cursor` as the _idiom baseline to extend_, not a legacy surface to migrate. The only real gap is enter/leave animation adoption, which is additive.

---

## 3. CSS token architecture proposal

### 3.1 Layering scheme (new)

Declare one global layer order, once, in `apps/showcase/src/styles.css`:

```css
@layer cr-tokens, cr-reset, cr-base, cr-components, cr-utilities;
```

- Wrap the three generated files in `@layer cr-tokens { ... }`. This requires a small addition to `build.mjs`'s CSS format step (wrap the emitted selector blocks), not a restructuring — `tokens.css`, `light.css`, `dark.css` keep their exact current paths, selectors (`:root`, `[data-theme="light"]`, `[data-theme="dark"]`), and content.
- Every `libs/shared/ui/src/lib/**/*.css` file gets `@layer cr-components { ... }` wrapped around its existing rules (button.css, card.css, badge.css, input.css, theme-toggle inherits from button.css).
- Reserve `cr-utilities` for anything the showcase app or future consumers add to override component internals without specificity hacks (`!important` should never be needed again).

This is zero-risk: `@layer` is Baseline "widely available" since September 2024 ([MDN @layer](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer)) and esbuild (underlying `@angular/build`) correctly parses and merges layer ordering across bundled files with no polyfill needed ([github.com/evanw/esbuild/issues/3137](https://github.com/evanw/esbuild/issues/3137)). Angular's attribute-selector encapsulation (`button[crButton]`) doesn't interact with layer resolution — layers are matched purely by declaration order, independent of selector specificity.

### 3.2 Primitive → semantic → (new) derived-state tiers

Keep exactly the current two authored tiers. Add one **computed** tier that is not hand-authored JSON but literal `color-mix()` expressions emitted into the generated CSS — this is new in section 5, not a new _authored_ tier, so it doesn't grow the token-explosion risk the primitive/semantic split was designed to avoid.

```
tokens/core/*.json         (primitive, build-time only, unchanged)
        ↓
tokens/semantic/*.json     (17 keys today, unchanged — the only public brand-pinned API)
        ↓
generated/css/*.css        (public --cr-* vars: semantic aliases, unchanged, now @layer-wrapped)
        ↓  [NEW, additive]
color-mix()-derived tokens (computed at CSS-parse time from semantic aliases; see §5)
```

Do **not** add a fourth mandatory "component token" tier system-wide. Only add a component-local custom property (e.g. `--cr-button-state-layer-opacity`) inside an individual component's `.css` file when that specific component needs a token no other component shares, and require it to resolve to `var(--cr-color-*)` / `var(--cr-alpha-*)` — never a raw core-ramp value. This matches the audit's own finding that `--cr-cursor-fill-color` is already exactly this kind of component-local, cross-library contract.

### 3.3 `@property` — one concrete candidate, not a blanket policy

Register exactly one `@property` now, for the one custom property that is genuinely cross-component and currently untyped:

```css
@property --cr-cursor-fill-color {
  syntax: '<color>';
  inherits: false;
  initial-value: transparent;
}
```

Place this in `libs/shared/design-tokens/generated/css/tokens.css` (theme-independent) or `libs/shared/cursor`'s own stylesheet — either is defensible; prefer `libs/shared/cursor` since that's the library that _consumes_ it via `var(--cr-cursor-fill-color, var(--cr-color-foreground))`, keeping the registration next to its usage.

Do not add `@property` for the button state-layer opacity (`0`/`0.08`/`0.16`) unless/until that opacity is driven by a `transition`/animation timeline rather than the current hard toggle — plain `var()` custom properties are fine for discrete on/off values; `@property` only pays for itself when you need typed validation or smooth interpolation ([MDN @property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property), Baseline "newly available" July 2024).

### 3.4 `color-mix()` — extend narrowly, additively

`color-mix()` is Baseline "widely available" as of Nov 2025 (shipped since mid-2023) — safe to depend on with no fallback ([MDN color-mix](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix), [caniuse](https://caniuse.com/mdn-css_types_color_color-mix)), and it's already validated in this repo (`input.css`'s focus-ring box-shadow). Extend it for:

1. **Interaction-state tokens** (hover/active/disabled overlays) — replace future one-off literal hex per state with `color-mix()` blends of existing semantic tokens. Do not touch the _existing_ button.css hardcoded `0.08`/`0.16` opacities yet (see §5's alpha-scale token, which supersedes them in one pass rather than two).
2. **Elevation-tier surfaces** — see §5.

Do **not** use `color-mix()` (or any derivation) to replace the 17 literal hex semantic values themselves. Their `$description` fields state they are independently, deliberately pixel-matched to design.google's live bundle and WCAG-AA-verified per theme — algorithmic derivation risks drifting off that reference and is explicitly out of scope.

### 3.5 `light-dark()` — explicitly rejected for the generated pipeline

`light-dark()` is usable today (Chrome 123+/Firefox 120+/Safari 17.5+, [MDN light-dark](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark)) but two things argue against using it in `build.mjs`'s output:

- `tokens/semantic/light.json` and `dark.json` are **independently authored palettes**, not mirror-image values (e.g. `analogous-0/1/2` are all `#000000` in light but `#c3ecd0`/`#ffdad3`/`#bff28d` in dark) — `light-dark(a, b)` only pays off when both branches are cheap to co-locate, and here it would just relocate values already correctly split across two files, saving nothing.
- `light-dark()` is driven by the `color-scheme` property (typically OS-preference-linked), which would compete with `theme.service.ts`'s **explicit, user-driven** `data-theme` attribute + `localStorage` toggle. Reconciling the two mechanisms (`color-scheme: light dark` vs. a manual `[data-theme]` selector) adds a real correctness hazard for a token count savings that doesn't exist here.

Keep the current `[data-theme="light"]`/`[data-theme="dark"]` selector-pair generation in `build.mjs` exactly as-is. `light-dark()` remains fine for one-off _inline_ overrides in future application code that genuinely wants OS-preference-only behavior outside the theme system — just not in the generated pipeline.

### 3.6 Container style queries — defer

Firefox doesn't ship CSS container _style_ queries (`@container style(--variant: compact)`) until mid-2026 per current data; inline-size container queries are broadly supported today and are fine to adopt independently for any genuinely size-responsive component (e.g. `cr-card`), but that's a layout concern, not a theming concern — out of scope for this proposal.

---

## 4. Type-safe token authoring

**Decision: do not adopt vanilla-extract or StyleX.** Both require an unsupported esbuild-plugin path into this repo's actual build executor. `apps/showcase`'s `project.json` configures `@angular/build:application` directly, which exposes no plugin hook at all (verified against [angular.dev/reference/configs/workspace-config](https://angular.dev/reference/configs/workspace-config) and the builder's `schema.json`). The only pluggable esbuild surfaces in this workspace are the Nx-specific `@nx/angular:application`/`browser-esbuild` executors (not what `apps/showcase` uses) or the third-party `@angular-builders/custom-esbuild` wrapper (unofficial, version-locked to Angular releases). Even with a plugin wired in, Angular's own component-stylesheet resolution (`styleUrl`, AOT resource loading) is a separate mechanism from a generic app-level esbuild plugin — vanilla-extract's `.vanilla.css` / StyleX's atomic-class output isn't naturally something `styleUrl` can point at without hand-written glue that undercuts the "no extra tooling" value proposition ([vanilla-extract esbuild docs](https://vanilla-extract.style/documentation/integrations/esbuild/), [stylexjs esbuild docs](https://stylexjs.com/docs/learn/installation/esbuild/)).

More fundamentally: this repo doesn't want CSS-rule-authoring-in-TypeScript — styling stays in per-component `.css` files by design (no CSS-in-JS, no Tailwind installed). What's actually wanted is **typed token references**, and `libs/shared/design-tokens` already delivers that at zero runtime cost via the custom Style Dictionary format `typescript/css-var-refs` in `build.mjs`. The only real gap is ergonomics: flat `colorBackground` consts vs. a namespaced `vars.color.background` object.

### 4.1 Concrete change: nest the generated TS instead of flattening it

**Before** (current `generated/ts/color.ts`, excerpt):

```ts
export const colorBackground = 'var(--cr-color-background)';
export const colorSurface = 'var(--cr-color-surface)';
export const colorForeground = 'var(--cr-color-foreground)';
export const colorAccent = 'var(--cr-color-accent)';
export const colorAccentActive = 'var(--cr-color-accent-active)';
// ...18 flat exports, alphabetically sorted
```

**Before** (current `generated/ts/core.ts`, excerpt — note the alphabetical-string-sort artifact):

```ts
export const space0 = 'var(--cr-space-0)';
export const space1 = 'var(--cr-space-1)';
export const space10 = 'var(--cr-space-10)'; // sorts before space2 — string sort, not numeric
export const space12 = 'var(--cr-space-12)';
export const space16 = 'var(--cr-space-16)';
export const space2 = 'var(--cr-space-2)';
// ...
export const radiusMd = 'var(--cr-radius-md)';
export const shadow0 = 'var(--cr-shadow-0)';
```

**After** (proposed — nested `vars` object, generated from the same token path arrays Style Dictionary already provides, no re-flattening via `toCamelIdentifier`):

```ts
// generated/ts/vars.ts (new, replaces the *shape* of core.ts + color.ts's output)
export const vars = {
  color: {
    background: 'var(--cr-color-background)',
    surface: 'var(--cr-color-surface)',
    foreground: 'var(--cr-color-foreground)',
    accent: 'var(--cr-color-accent)',
    accentActive: 'var(--cr-color-accent-active)',
    analogous: [
      'var(--cr-color-analogous-0)',
      'var(--cr-color-analogous-1)',
      'var(--cr-color-analogous-2)',
    ],
    border: 'var(--cr-color-border)',
    focusRing: 'var(--cr-color-focus-ring)',
    link: 'var(--cr-color-link)',
    linkHover: 'var(--cr-color-link-hover)',
    success: 'var(--cr-color-success)',
    successActive: 'var(--cr-color-success-active)',
    warning: 'var(--cr-color-warning)',
    warningActive: 'var(--cr-color-warning-active)',
    danger: 'var(--cr-color-danger)',
    dangerActive: 'var(--cr-color-danger-active)',
  },
  space: {
    0: 'var(--cr-space-0)',
    1: 'var(--cr-space-1)',
    2: 'var(--cr-space-2)',
    3: 'var(--cr-space-3)',
    4: 'var(--cr-space-4)',
    5: 'var(--cr-space-5)',
    6: 'var(--cr-space-6)',
    7: 'var(--cr-space-7)',
    8: 'var(--cr-space-8)',
    10: 'var(--cr-space-10)',
    12: 'var(--cr-space-12)',
    16: 'var(--cr-space-16)',
  },
  radius: {
    none: 'var(--cr-radius-none)',
    xs: 'var(--cr-radius-xs)',
    sm: 'var(--cr-radius-sm)',
    md: 'var(--cr-radius-md)',
    lg: 'var(--cr-radius-lg)',
    xl: 'var(--cr-radius-xl)',
    full: 'var(--cr-radius-full)',
  },
  shadow: { 0: 'var(--cr-shadow-0)', 1: 'var(--cr-shadow-1)' /* ... 2-5 */ },
  motion: {
    duration: {
      fast: 'var(--cr-motion-duration-fast)',
      base: '…',
      slow: '…',
      slower: '…',
    },
    easing: {
      standard: '…',
      decelerate: '…',
      accelerate: '…',
      emphasized: '…',
    },
  },
  // font, border — same pattern
} as const;

// vars.color.background        -> 'var(--cr-color-background)'
// vars.space[4]                -> 'var(--cr-space-4)'
// vars.motion.easing.standard  -> 'var(--cr-motion-easing-standard)'
```

Implementation notes:

- Change is confined to `libs/shared/design-tokens/build.mjs`'s custom format function (the `registerFormat('typescript/css-var-refs', ...)` block, ~lines 52–69): build a nested object from each token's `path` array (already available from Style Dictionary) instead of collapsing it through `toCamelIdentifier`, then `JSON.stringify`/serialize as one `export const vars = { ... } as const;`.
- `core.ts` and `color.ts` are produced by two separate platform calls today (`buildStaticTokens` vs. `buildThemeCss('light')`). Merge them into one `vars` export either by (a) a small hand-written barrel `index.ts` that spreads both into one object, or (b) extending the format function to run once across both dictionaries. Prefer (a) first — lower risk, no build.mjs control-flow changes.
- **Keep the existing flat exports (`colorBackground`, `space4`, etc.) alongside `vars` for at least one deprecation cycle.** Grep actual consumers in `libs/shared/ui`, `libs/shared/cursor`, `apps/showcase` before removing anything — names like `colorBackground` are very likely already imported. Ship `vars` as an additive parallel export, not a breaking rename.
- Note the existing `dark.css`/dark theme has **no TS export today** (only light's `buildThemeCss` call emits `color.ts`) — this is orthogonal to the flat-vs-nested question (both forms are just `var()` references that resolve correctly under either `[data-theme]` at runtime regardless of which theme is active), so no change needed there; flag it only if a future need arises for build-time-resolved (not runtime `var()`) dark-specific TS constants.

---

## 5. HSL alpha surface-layering & Materials system

### 5.1 Resolving the "HSL" framing against the repo's literal-hex tokens

The research brief asked for "base HSL surface colors per theme." The audit is unambiguous: `--cr-color-background/surface/foreground/accent` etc. are **literal hex**, deliberately pinned to design.google's real bundle and WCAG-AA-verified — they must not be converted to HSL or regenerated. Resolution: keep every existing base token exactly as literal hex; use `color-mix()` (which accepts hex operands natively, no HSL conversion required) to compute the _derived_ alpha/elevation/material tokens. `hsl()` syntax is used only inside the new `--cr-material-*` tier where an alpha channel needs to be layered onto a _sampled_ tint color for glass effects — see §5.4. This gets the alpha-layering benefit both research reports converged on without touching a single brand-pinned value.

### 5.2 New core token: alpha scale (theme-independent)

New file `tokens/core/surface-alpha.json`, built into `generated/css/tokens.css` alongside the existing `elevation.json` shadow tokens (same theme-independent `:root` selector, `@layer cr-tokens`-wrapped per §3.1):

```
--cr-alpha-1: 4%;
--cr-alpha-2: 6%;
--cr-alpha-3: 8%;
--cr-alpha-4: 11%;
--cr-alpha-5: 14%;
```

Shape mirrors Material 2's dark-theme overlay-opacity-by-elevation progression (non-linear, ~4/6/8/11/14%) rather than a linear ramp — deliberately reusing a validated reference curve instead of inventing new numbers. This same scale replaces button.css's two hardcoded literals: hover uses `--cr-alpha-1` (4%, was hardcoded `0.08`) and press uses `--cr-alpha-3` (8%, was hardcoded `0.16`) — **note this is a value change, not just a token wrap**; re-verify the visual hover/press weight against the current design before landing, since the new scale is intentionally shared across elevation _and_ interaction-state, so it can't be a 1:1 copy of the old bespoke numbers.

### 5.3 New semantic alias: `surface-tint` (per theme, one new key)

Add exactly one new key to `tokens/semantic/light.json` and `tokens/semantic/dark.json` — this is the only new _authored_ semantic value in this whole proposal:

- **Dark theme:** `surface-tint` → `foreground` value (`#ffffff`, near-white) — lighten-with-elevation, matching Material 2/YouTube's white-overlay-on-dark technique.
- **Light theme:** `surface-tint` → a dark neutral core-ramp step (**not** white) — darken-with-elevation, matching Atlassian's documented light-mode inversion ([atlassian.design/foundations/elevation](https://atlassian.design/foundations/elevation)): light-mode surfaces darken slightly as elevation increases, opposite direction from dark mode.

This directly resolves the brief's requirement for "explicit different strategies for dark vs. light" — they are opposite tint directions by design, not a single formula naively inverted.

### 5.4 Derived, opaque elevation-tier surfaces — primary strategy

**Primary strategy: bake to opaque via `color-mix()`, do not ship live translucent surfaces for stacked/composable UI.** This is the resolution to the one real tension between the research tracks: Material 2/YouTube's _live_ white-alpha-on-dark technique is well-documented and simple, but Material 3 explicitly abandoned it for exactly this use case — "if you use the Material styles... the container color will no longer respond to the elevation overlay color" ([m3.material.io/blog/tone-based-surface-color-m3](https://m3.material.io/blog/tone-based-surface-color-m3)) — because compounding transparency breaks down once surfaces stack on surfaces (a card on a sheet on a page). This repo's `cr-card`/`cr-badge`/future dialogs are exactly that composable case, so bake:

```css
/* generated/css/{light,dark}.css — new tokens, computed not authored, via a small
   addition to build.mjs's custom format, same pattern as the existing
   typescript/css-var-refs registerFormat() */
--cr-color-surface-1: color-mix(
  in srgb,
  var(--cr-color-surface-tint) var(--cr-alpha-1),
  var(--cr-color-surface)
);
--cr-color-surface-2: color-mix(
  in srgb,
  var(--cr-color-surface-tint) var(--cr-alpha-2),
  var(--cr-color-surface)
);
--cr-color-surface-3: color-mix(
  in srgb,
  var(--cr-color-surface-tint) var(--cr-alpha-3),
  var(--cr-color-surface)
);
--cr-color-surface-4: color-mix(
  in srgb,
  var(--cr-color-surface-tint) var(--cr-alpha-4),
  var(--cr-color-surface)
);
--cr-color-surface-5: color-mix(
  in srgb,
  var(--cr-color-surface-tint) var(--cr-alpha-5),
  var(--cr-color-surface)
);
```

These resolve to fully opaque colors at parse time (the browser computes `color-mix()` once the custom properties are known; there's no compounding because each tier mixes from the same flat `--cr-color-surface` base, not from the previous tier). Map to the existing `data-elevation="0"`..`"5"` attribute on `cr-card` 1:1 with the existing shadow tokens: `--cr-color-surface` = tier 0 (unchanged), `--cr-color-surface-1`..`-5` pair with `--cr-shadow-1`..`-5`. This is additive — `--cr-color-surface` itself remains the base/tier-0 token, so nothing regresses; migrate `card`/`badge` incrementally.

### 5.5 Materials scale — separate, explicitly translucent tier

Reserve genuine translucency for a **second, explicitly distinct** system, used only where content must visibly show through (dropdowns/menus, toasts, `cr-cursor-dot`), mirroring SwiftUI/UIKit's five-tier scale ([Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)):

```
tokens/core/material.json  →  generated/css/tokens.css (theme-independent shape,
                                theme-aware tint via --cr-color-surface-tint)

--cr-material-none:        none;                                  /* opaque escape hatch */
--cr-material-ultra-thin:  hsl(from var(--cr-color-surface-tint) h s l / 20%);
--cr-material-thin:        hsl(from var(--cr-color-surface-tint) h s l / 40%);
--cr-material-regular:     hsl(from var(--cr-color-surface-tint) h s l / 60%);
--cr-material-thick:       hsl(from var(--cr-color-surface-tint) h s l / 80%);
--cr-material-ultra-thick: hsl(from var(--cr-color-surface-tint) h s l / 92%);

--cr-material-blur-thin:    8px;
--cr-material-blur-regular: 16px;
--cr-material-blur-thick:   24px;
```

Applied via paired custom properties, e.g.:

```css
[data-material='regular'] {
  background: var(--cr-material-regular);
  backdrop-filter: blur(var(--cr-material-blur-regular)) saturate(1.2);
}

@supports not (backdrop-filter: blur(1px)) {
  [data-material] {
    background: var(--cr-color-surface);
  } /* opaque fallback */
}

@media (prefers-reduced-transparency: reduce) {
  [data-material] {
    backdrop-filter: none;
    background: var(--cr-color-surface-4);
  }
}
```

`hsl(from ... / alpha)` relative-color syntax is used here specifically because a material needs a genuine alpha channel sampled from the tint (not an opaque mix) — this is the one place actual `hsl()`-family syntax earns its keep, confined entirely to the new, additive materials tier and never touching the base hex tokens.

### 5.6 Guardrails

- Every `[data-material]` rule gets the `@supports`/`prefers-reduced-transparency` guard above — matches this repo's existing `prefers-reduced-motion` discipline in `button.css`.
- Because `color-mix()`-derived surfaces are computed, not hand-picked, add a CI check that resolves the `color-mix()` formula in Node against the known endpoint colors and re-verifies WCAG AA whenever `surface-tint`, `surface`, or the alpha scale changes — the existing literal-hex tokens' manual verification doesn't cover computed values.
- Ship everything in §5 as strictly additive/opt-in. Do not migrate any existing component off `--cr-color-surface` in the same pass that introduces the new tokens.

---

## 6. ARIA / data-attribute conventions

The existing split is already correct and matches how Radix UI, Ark UI, and React Aria draw this line: `data-*` is a pure styling hook, `aria-*` carries all assistive-technology-relevant state, and CSS must never select on `aria-*` (repo-wide grep confirms this holds today). Formalize it and fix four gaps.

| Attribute pattern                                         | Purpose                                                                  | When to use                                                                                                      | Current example                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `data-variant` / `data-size` / `data-shape` / `data-tone` | Visual variant selection, zero AT meaning                                | Any component with mutually-exclusive style variants                                                             | `button[data-variant='primary']`                               |
| `data-elevation` / `data-padded`                          | Layout/visual state, zero AT meaning                                     | Boolean or scalar style toggles (empty-string-or-null for booleans)                                              | `cr-card[data-elevation='2']`                                  |
| `data-invalid` **paired with** `aria-invalid`             | Style hook mirrored 1:1 from a real ARIA attribute, single source signal | Whenever a styling data-attribute has AT-relevant meaning — always pair, driven from one signal                  | `input[crInput]` — canonical template, reuse verbatim          |
| `data-cr-cursor-*`                                        | Cross-library styling contract (ui ↔ cursor libs), zero AT meaning       | Internal only, never a public component API surface                                                              | `--cr-cursor-fill-color` consumers                             |
| `role="status"` / `aria-live`                             | Only for content that _dynamically updates_ (announces changes)          | Never on static content — opt-in only                                                                            | **Gap: see below**                                             |
| `aria-busy`                                               | Signals ongoing content mutation                                         | Pair with `aria-disabled`/`disabled` if activation must be blocked — `aria-busy` alone does not block activation | **Gap: see below**                                             |
| `aria-pressed` (stable label across states)               | Two-state toggle buttons, label text must stay constant                  | `theme-toggle` — keep as the canonical template                                                                  | Compliant today                                                |
| `:host(:focus-visible)` → `--cr-color-focus-ring`         | Focus ring on keyboard/AT focus only, ≥3:1 contrast (WCAG 1.4.11)        | Every interactive component, always via `:focus-visible` not bare `:focus`                                       | `button.css`/`input.css` — keep as the mandatory standing rule |

**Fixes required:**

1. **Badge hardcodes `role="status"` unconditionally** (`libs/shared/ui/src/lib/badge/badge.ts`) — turns every static tone chip (e.g. the gallery's `accent`/`neutral` demo badges) into an unnecessary live region. Add `live = input(false)` and only bind `role="status"` when true. **Effort: S.**
2. **Button's `aria-busy` isn't paired with a disabled state** (`libs/shared/ui/src/lib/button/button.ts`) — a loading button stays keyboard-activatable, allowing double-submit. Bind `aria-disabled`/native `disabled` alongside `aria-busy` whenever `loading()` is true. **Effort: S.**
3. **Input has no per-size touch-target floor** (`libs/shared/ui/src/lib/input/input.css`) — button.css already enforces WCAG 2.5.8 (24×24px AA) via `min-block-size: 36/40/48px`; input.css has no equivalent, and `sm` risks falling under 24px. Add the matching ladder. **Effort: S.**
4. **Input has no label-association or `aria-describedby` story** (`libs/shared/ui/src/lib/input/input.ts`, `apps/showcase/.../gallery.page.html`) — placeholder-only demo inputs are a documented WCAG 3.3.2 anti-pattern. Add real `<label>` elements to the showcase demos now; add an `errorId = input<string>()` → `[attr.aria-describedby]` affordance to `crInput` for future validation-message association. **Effort: S (showcase fix) / M (describedby affordance).**

**No change needed:** `card.ts`/`card.html` stays non-interactive (no `role`/`tabindex`) — codify in a new conventions doc that a future clickable-card variant must make a real `<a>`/`<button>` the host or first focusable child, pre-empting the `div` + `role="button"` + `tabindex` anti-pattern before anyone builds it.

**Deliverable:** `docs/accessibility-conventions.md` (new) — formalize the table above as the house style, using `input.ts`'s `data-invalid`/`aria-invalid` pairing and `theme-toggle.html`'s `aria-pressed` as the two canonical copy-paste templates.

---

## 7. SwiftUI-modifier-style directives — feasibility verdict

### `crMaterial` — build it

**Verdict: yes, build as a standalone attribute directive.** Unlike Button's cursor-style problem, a material tier is naturally **consumer-supplied**, not internally computed from another signal — exactly the shape `input()` (and, if ever needed, `hostDirectives` re-exposure) handles well. It's a thin, reusable wrapper around the `data-material` attribute + the token scale from §5.5.

```ts
// libs/shared/ui/src/lib/material/material.directive.ts
import { Directive, ElementRef, input, inject } from '@angular/core';

export type MaterialTier =
  'none' | 'ultra-thin' | 'thin' | 'regular' | 'thick' | 'ultra-thick';

@Directive({
  selector: '[crMaterial]',
  host: {
    '[attr.data-material]': 'tier()',
  },
})
export class MaterialDirective {
  readonly tier = input<MaterialTier>('regular', { alias: 'crMaterial' });
}
```

```css
/* libs/shared/ui/src/lib/material/material.css, @layer cr-components */
[data-material] {
  backdrop-filter: blur(var(--cr-material-blur-regular)) saturate(1.2);
  background: var(--cr-material-regular);
}
[data-material='thin'] {
  background: var(--cr-material-thin);
  backdrop-filter: blur(var(--cr-material-blur-thin));
}
[data-material='thick'] {
  background: var(--cr-material-thick);
  backdrop-filter: blur(var(--cr-material-blur-thick));
}
/* ...none/ultra-thin/ultra-thick */
```

Usage: `<div crMaterial="thin">…</div>` for a dropdown/menu, or on `cr-cursor-dot`'s own host. Because this directive's input is purely consumer-driven (never internally computed), it's also a good future candidate for `hostDirectives` re-exposure — e.g. a future `Dialog`/`Menu` component could bake in `hostDirectives: [{ directive: MaterialDirective, inputs: ['crMaterial: material'] }]` to ship a sensible default tier while still letting the consumer override it, which is exactly the input shape `hostDirectives` supports well (per §2's finding — this is the case that _does_ fit the pattern, unlike Button/cursor). **Effort: S.**

### `crShape` — skip, not worth building yet

**Verdict: skip.** The capability gap doesn't exist: `data-shape` (`rounded`/`pill`) is already a first-class part of the Button/Input/Card host API, backed by the `radius.*` token scale (`none`/`xs`/`sm`/`md`/`lg`/`xl`/`full`), and `full` (`9999px`) already approximates a circle for any square element. A `crShape` directive would only add value for **non-design-system arbitrary content** (e.g. clipping an ad-hoc `<img>` in the showcase gallery to a circle) — a real but currently-hypothetical use case. Building a directive for it now is speculative generalization ahead of a demonstrated need, which cuts against this repo's own "component tokens added only on demonstrated need" discipline (§3.2). If that need materializes, the fix is a two-line utility class (`.cr-clip-circle { border-radius: var(--cr-radius-full); aspect-ratio: 1; object-fit: cover; }`), not a directive — no signals, no `hostDirectives`, no new API surface. Revisit only if a second and third concrete consumer shows up. **Effort: — (deferred).**

---

## 8. Prioritized implementation punch list

Ordered so each step's prerequisites land first. All paths relative to repo root.

1. **[S] Codify the animation/CSS-in-JS/hostDirectives rejections as standing rules.** Add a short section to `CLAUDE.md` or a new `docs/design-research/decisions.md`: no `@angular/animations`, no vanilla-extract/StyleX, no `hostDirectives` for cursor composition. Prevents future churn chasing outdated tutorials.
2. **[S] Fix Badge's hardcoded `role="status"`.** `libs/shared/ui/src/lib/badge/badge.ts` — add `live = input(false)`, gate the role binding. Update `badge.spec.ts`.
3. **[S] Fix Button's `aria-busy`/`aria-disabled` pairing.** `libs/shared/ui/src/lib/button/button.ts` — bind `aria-disabled`/`disabled` alongside `loading()`. Update `button.spec.ts`.
4. **[S] Fix Input's touch-target floor.** `libs/shared/ui/src/lib/input/input.css` — add the 36/40/48px `min-block-size` ladder matching `button.css`.
5. **[S] Fix showcase Input demos' missing labels.** `apps/showcase/src/app/pages/gallery/gallery.page.html` — add real `<label for>` to both `crInput` demos.
6. **[M] Add `errorId`/`aria-describedby` affordance to Input.** `libs/shared/ui/src/lib/input/input.ts` + spec.
7. **[S] Write `docs/accessibility-conventions.md`.** Formalize §6's table; cite `input.ts`'s `data-invalid`/`aria-invalid` and `theme-toggle.html`'s `aria-pressed` as canonical templates.
8. **[S] Rename `createCursorTargetHost` → `useCursorTarget`.** `libs/shared/cursor/src/lib/cursor-target.behavior.ts` and its three call sites (`button.ts`, `input.ts`, `cursor-target.directive.ts`). Pure rename, document as a "signal composable" in a new `libs/shared/cursor/README.md`.
9. **[M] Add `@layer` ordering.** Declare `@layer cr-tokens, cr-reset, cr-base, cr-components, cr-utilities;` once in `apps/showcase/src/styles.css`; wrap `build.mjs`'s CSS emission in `@layer cr-tokens { }`; wrap each `libs/shared/ui/src/lib/**/*.css` file's rules in `@layer cr-components { }`. Verify no visual regression (layer order should be inert until an override is introduced).
10. **[S] Register `@property --cr-cursor-fill-color`.** In `libs/shared/cursor`'s stylesheet, per §3.3.
11. **[M] Add `tokens/core/surface-alpha.json`** (`--cr-alpha-1`..`-5`) and wire into `buildStaticTokens()` in `build.mjs`. Replace button.css's hardcoded `0.08`/`0.16` state-layer opacities with `var(--cr-alpha-1)`/`var(--cr-alpha-3)` — **visually re-verify hover/press weight**, this changes rendered values, not just token names. Update `button.spec.ts`/tokens.spec.ts as needed.
12. **[M] Add `surface-tint` semantic key** to `tokens/semantic/light.json` and `dark.json` (dark → `foreground`; light → a dark neutral core-ramp step, not white). Update `tokens.spec.ts`.
13. **[M] Emit `--cr-color-surface-1`..`-5`** via a new/extended Style Dictionary format in `build.mjs` (`color-mix()` string literals per §5.4), into `generated/css/{light,dark}.css`. Add a CI/Node contrast-check script resolving the formula against known endpoints.
14. **[M] Migrate `cr-card`'s `data-elevation` CSS** to consume `--cr-color-surface-1`..`-5` alongside the existing shadow tokens, incrementally (card first; badge/future dialogs later, not in this pass).
15. **[M] Add `tokens/core/material.json`** (`--cr-material-{none,ultra-thin,thin,regular,thick,ultra-thick}` + blur values) per §5.5, with `@supports`/`prefers-reduced-transparency` guards.
16. **[S] Build `MaterialDirective` (`crMaterial`).** New `libs/shared/ui/src/lib/material/material.directive.ts` + `.css` + spec, per §7's sketch.
17. **[M] Restructure `generated/ts/*.ts` into a nested `vars` object.** Modify `build.mjs`'s `typescript/css-var-refs` format (~lines 52–69) per §4.1; keep flat exports alongside `vars` for one deprecation cycle; grep and confirm current consumers in `libs/shared/ui`/`libs/shared/cursor`/`apps/showcase` before any future removal pass.
18. **[S] Adopt `animate.enter`/`animate.leave` on one reference component** (e.g. a showcase gallery card filter transition) using `@keyframes` classes gated by the existing `prefers-reduced-motion` pattern from `button.css`. Establishes the template before wider rollout.
19. **[M] Adopt `withViewTransitions` in `apps/showcase`'s router config** as progressive enhancement, with `onViewTransitionCreated` calling `transition.skipTransition()` under `prefers-reduced-motion`, and global `::view-transition-old/new` CSS added to `apps/showcase/src/styles.css`.
20. **[S] Update all touched `.spec.ts` files** alongside each step above rather than as a separate pass — every audited file already has a matching spec; this repo's convention is to keep them in lockstep, not backfill later.
