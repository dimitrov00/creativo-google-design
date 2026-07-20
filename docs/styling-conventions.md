# Styling conventions

House rules for every app and lib in this workspace. Derived from the
[styling & typography case study](./design-research/styling-typography-case-study.md)
(2026-07-20); exceptions belong in
[decisions.md](./design-research/decisions.md), not in code comments.

## The grammar: class for identity, data-attr for variant and state

- **Class = identity.** A class names _what an element is_: the component
  host class (`cr-button`, `cr-shape`) or a BEM-ish structural class inside a
  component (`location-card__meta`, `site-footer__grid`). Classes never
  encode variants or runtime state.
- **`data-*` = variant AND state.** Mutually-exclusive variants use a valued
  attribute (`data-variant="primary"`, `data-size="large"`, `data-text="title"`).
  Exclusive state machines use `data-state="open"` (Radix convention);
  independent booleans use presence attributes (`data-visible`, bound as
  `'cond ? "" : null'`). `is-*` state classes are banned — one grammar,
  greppable everywhere, shared by templates, host bindings, and CSS alike.
- **ARIA carries semantics, and only real semantics.** Never mirror state
  into `aria-*` just to style it, and never style hand-authored `aria-*`
  attributes — pair them (`data-invalid` + `aria-invalid`, driven by one
  signal; see `input.ts`, the canonical template). **Refinement (Angular 22):**
  when an `@angular/aria` directive _owns_ an ARIA attribute as the single
  source of truth (e.g. `aria-expanded` on a managed menu trigger), styling
  that attribute directly is correct — adding a parallel `data-*` there would
  duplicate state.
- Cross-library styling contracts use the `data-cr-*` / `--cr-*` namespace
  (`data-cr-cursor-hover`, `--cr-cursor-ink`) and are internal API — never
  documented as consumer surface.

## Naming

- Shared-lib classes and tokens are `cr-`-prefixed. App-level section
  classes are unprefixed BEM blocks (`hero`, `location-card`) — apps are
  leaves; nothing imports them. Do not abbreviate block names
  (`work-gallery__card`, not `wg-card`).
- Token names follow SwiftUI-style semantic scales (`tight/…/spacious`,
  `caption/…/title`, `mini/…/extraLarge`), never `sm/md/lg` or bare numbers.
  Numbered names are allowed only for coupled elevation tiers
  (`--cr-shadow-N` / `--cr-color-surface-N` / `--cr-elevation-alpha-N`) and
  SwiftUI's own `title2`/`title3`.
- A token name must encode its usage contract: a yellow surface that must
  never be text is `--cr-color-highlight`, not an "-active" state of
  something else.

## Tokens are the only source of design values

- **Typography:** components never declare `font-size`, `font-weight`,
  `line-height`, `letter-spacing`, or `text-transform`. Text gets a role —
  `crText`/`data-text` — and at most a modifier. Role metrics live only in
  `libs/shared/ui/src/lib/typography/typography.css`, built from
  `--cr-text-*` role tokens. Fluid sizing (`clamp()`) lives inside role
  tokens, never at call sites. `TextDirective` modifier inputs follow
  SwiftUI's Text modifier names **verbatim** (`fontWeight`, `fontDesign`,
  `fontWidth`, `foregroundStyle`, `bold`, `italic`, `monospacedDigit`, …);
  a new modifier needs a SwiftUI counterpart or a documented deviation
  (see docs/design-research/swiftui-text-modifiers-research.md §3 for the
  mapping and the deliberate non-ports, e.g. `.font(.system(size:))`).
- **Color:** only `--cr-color-*` semantic tokens (plus `currentColor` /
  `transparent` / `inherit`). No hex, `rgb()`, or ad-hoc `color-mix()`
  emphasis blends in app CSS — muted text uses the
  `foreground-secondary/tertiary` hierarchy; scrims/glass use the scrim
  tokens. App-level custom properties (`--page-*`, `--radius-frame`) are
  fine, but must resolve to a `--cr-*` token whenever one exists.
- **Motion:** durations and easings come from `--cr-motion-*` in CSS and
  from the `motion` mirror in `@creativo/shared/design-tokens` in TS (WAAPI).
  Inline `cubic-bezier(...)` or raw `ms` literals are banned outside the
  token files. Reduced motion is handled globally in `@layer cr-base` — do
  not add per-component `prefers-reduced-motion` blocks unless _adding
  back_ motion that carries meaning.
- **Stacking:** page-level tiers (nav, scrims, sheets, cursor — anything
  ≥10) only via `--cr-layer-*`. Single-digit z-index is allowed _inside a
  component's own stacking context_ (pair with `isolation: isolate` on the
  section) — collapsing deliberate sibling orderings (1 vs 2) into one
  token would reorder paint; local micro-stacking is not what the scale is
  for.
- **Space/radius/border:** use `--cr-space-*`, `--cr-radius-*`
  (`--cr-radius-full` for pills/circles — never `9999px` or `50%` on
  square-locked elements), `--cr-border-width-*`.

## Breakpoints

One set, viewport queries: **480 / 760 / 1024 / 1280 px** (px deliberately —
media queries don't track user font size). CSS custom properties can't drive
`@media`, so these are documented constants; anything else (819, 820, 980,
1100…) is drift — normalize on touch. Prefer container queries (size _and_
style — cross-browser since 2026) when a component responds to its container
or an inherited context rather than the viewport; the nav-tone system is the
reference (`@container style(--nav-tone: dark)`).

## Angular mechanics

- Variants/state bind via `host: {}` metadata (`'[attr.data-variant]':
'variant()'`); decorators (`@HostBinding`/`@HostListener`) are banned.
- Native elements are upgraded in place: `selector:
'button[crButton], a[crButton]'` — never wrapper elements for things the
  platform already has. Typography is a directive (`crText`) compiling to
  `data-text-*` attributes, never a wrapper element.
- Directives without a view ship global CSS in a named `@layer`
  (`shape.css`, `material.css`, `cursor-target.css` pattern), imported once
  per app `styles.css`.
- `ViewEncapsulation` stays default; `::ng-deep` is banned (currently 0
  occurrences — keep it that way).
- Popups/menus/tabs/listboxes start from `@angular/aria` primitives (GA in
  v22) — do not hand-roll focus management or key handling.
- OnPush is the v22 default — omit `changeDetection` on new components.

## Layers

`@layer cr-tokens, cr-reset, cr-base, cr-components, cr-utilities;` declared
once per app `styles.css:1`. Lib CSS opts into its layer; app component CSS
stays unlayered (encapsulation-scoped, deliberately wins). `cr-utilities` is
reserved for consumer overrides of component internals — if you reach for
`!important` against a lib style, add a utility there instead.
