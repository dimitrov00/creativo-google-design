# Styling conventions

House rules for every app and lib in this workspace. The design system is
`libs/ui/*` — `ui-*` elements and `ui*` modifier directives — over the
`--sys-*` tokens of `libs/ui/tokens`. The rules were first derived from the
[styling & typography case study](./design-research/styling-typography-case-study.md)
(2026-07-20, written against the retired `cr` system — its rules carry over,
its file names do not) and extended by the owner's later rulings in
`docs/design-research/*` (the accent law, the interaction grammar, the
SwiftUI-parity rulings). Exceptions belong in
[decisions.md](./design-research/decisions.md), not in code comments.

## The grammar: class for identity, data-attr for variant and state

- **Class = identity.** A class names _what an element is_: the design
  system's host class (`ui-button`, `ui-card`, `ui-list-row` — global, the
  system's styling contract, [migration blueprint](./migration-blueprint.md)
  §3.1) or a BEM-ish structural class inside a component
  (`ui-button__progress`, `staff-sheet__pill`, `site-footer__grid`). Classes
  never encode variants or runtime state.
- **`data-*` = variant AND state.** Mutually-exclusive variants use a valued
  attribute (`data-button-style="bordered"`, `data-control-size="large"`,
  `data-font="title"`). Exclusive state machines use `data-state`
  (`data-state="loading"` on a busy `ui-button`); independent booleans use
  presence attributes (`data-spread`, `data-selected`, bound as
  `'cond ? "" : null'`). `is-*` state classes are banned — one grammar,
  greppable everywhere, shared by templates, host bindings, and CSS alike.
- **ARIA carries semantics, and only real semantics.** Never mirror state
  into `aria-*` just to style it, and never style a hand-authored `aria-*`
  attribute — pair it with a `data-*` hook driven by the same signal
  (`data-invalid` + `aria-invalid`; `ui-text-field` is the canonical
  template). **Refinement:** when a component _owns_ an ARIA attribute as the
  single source of truth — the `aria-expanded` a disclosure trigger sets,
  the `aria-disabled` of a surface that only claims disabled — styling that
  attribute directly is correct (the expand chevron in `icon.css`, the
  disabled gate in `modifiers.css`); a parallel `data-*` there would
  duplicate state. See [accessibility-conventions.md](./accessibility-conventions.md).
- **A component's knobs are `--ui-<component>-*` custom properties** it reads
  with a fallback (`var(--ui-avatar-ink, currentColor)`,
  `--ui-quick-action-fill`). Its docblock names them; a consumer may set
  them. Nothing else inside a component is consumer surface — never reach
  into its structural classes from outside.

## Naming

- Design-system classes, selectors and knobs are `ui`-prefixed
  (`ui-button`, `button[uiButton]`, `[uiText]`, `--ui-avatar-ink`); tokens are
  `--sys-*`, with the `--control-*` family (sizes, radii, insets) beside them
  in `tokens.css`. Feature components are `lib-*` (the older marketing pages
  still carry the apps' own `cr-` prefix, as `cr-root` and the showcase
  pages do; the showcase scaffold is `sc-`). Feature and app section classes
  are unprefixed BEM blocks (`hero`, `location-card`) — features and apps are
  leaves; nothing imports them. Do not abbreviate block names
  (`work-gallery__card`, not `wg-card`).
- Token names follow SwiftUI-style semantic scales
  (`none/tight/compact/regular/comfortable/loose/spacious`,
  `caption/…/largeTitle`, `small/regular/large`, `thin/regular/thick`), never
  `sm/md/lg` or bare numbers. Numbered names exist only where SwiftUI has
  them (`title2`/`title3`).
- A token name must encode its usage contract:
  `--sys-color-secondary-label-on-fill` is the quiet word _on a fill_ and
  never text on a bare surface; `--sys-elevation-raised-drop` is only ever
  inside `drop-shadow()`.

## Tokens are the only source of design values

- **Typography:** text gets a role and at most a modifier —
  `uiText uiFont="title"` (≙ `.font(.title)`, writes `data-font`), then
  `uiWeight` (≙ `.fontWeight`) and `uiForegroundStyle`
  (≙ `.foregroundStyle`) only when the role's own weight or ink is not the
  answer. Role metrics live only in the `--sys-font-*` shorthand tokens of
  `libs/ui/tokens/tokens.css` (family, weight, size and line-height in one
  value) with tracking in `--sys-tracking-*`; fluid sizing (`clamp()`) lives
  inside role tokens, never at call sites. A DS sheet writes
  `font: var(--sys-font-<role>)` and at most a literal weight from 400–700.
  Modifier inputs follow SwiftUI's names **verbatim**; a new modifier needs a
  SwiftUI counterpart or a documented deviation
  ([swiftui-text-modifiers-research.md](./design-research/swiftui-text-modifiers-research.md) §3).
- **Every number lines up.** Tabular figures are the default: the DS digits
  come from Onest (`Sys Figures`, by unicode-range, in each app's
  `styles.css`) and `sys-base` re-asserts `font-variant-numeric:
tabular-nums` on every element because the `font` shorthand resets it. An
  unlayered feature sheet that writes its own `font:` shorthand says
  `font-variant-numeric: tabular-nums` after it.
- **Color:** only `--sys-color-*` semantic tokens (plus `currentColor` /
  `transparent` / `inherit`). No hex, `rgb()`, or ad-hoc `color-mix()`
  emphasis blends in feature CSS — quiet text is
  `secondary-label`/`tertiary-label` (on a fill:
  `secondary-label-on-fill`), a tone wash is the tone at `--sys-alpha-tint`,
  a field is `--sys-color-fill`, hover and press are `--sys-state-layer-*`,
  scrims are `--sys-color-scrim` / `--sys-color-media-scrim`. App-level and
  component custom properties are fine, but must resolve to a `--sys-*` token
  whenever one exists.
- **The accent law** ([client card revision 3](./design-research/client-card-revision-3.md)
  §1; guarded by `libs/ui/tokens/src/lib/accent-rule.spec.ts` and
  `accent-label.spec.ts`): _one orange; colour is a shape, words are ink._
  1. Everything seen as colour — a fill, a wash, a ring, a track, a dot, a
     disc, a glyph — is `--sys-color-accent` (#f26b22), the same value in
     both themes. There is no darker or lighter cut of it.
  2. Words are ink: primary, or secondary where they are quiet. A small word
     is never tinted; when it has to feel orange it gets an orange _thing_ —
     a glyph or dot before it, a wash capsule behind it, an accent underline
     under a link.
  3. A **display figure** (≥ 24 px, or ≥ 18.66 px at weight ≥ 700) may itself
     be the accent: on a white or elevated surface in light, on any opaque
     surface in dark — never on a grey segment, a fill or a wash.
  4. On the solid accent: white marks and white display figures only.
  5. At most one solid-orange object taller than 52 per page; marks of 52
     or smaller as often as the page needs.
- **Fills and materials:** a field paints the translucent
  `--sys-color-fill` (≙ `.systemFill`), never an opaque surface colour, so it
  reads one step lifted on any ground. `uiMaterial` (`thin`/`regular`/`thick`
  glass) is chrome only — sheets, toolbars, bars over media — never a field
  or a card.
- **Motion:** durations and easings come from `--sys-motion-*` — `instant`
  (150 ms), `regular` (200), `deliberate` (300) for controls; `slow`,
  `slowest`, `cinematic` only for marketing-scale reveals — and in TS
  (WAAPI) from the same custom properties read with `getComputedStyle`, a
  literal fallback beside them (`reveal.directive.ts`, `alert.ts`). Inline
  `cubic-bezier(...)` or raw `ms` literals are banned outside the token
  files.
- **Reduced motion** is handled globally: `libs/ui/tokens/reduced-motion.css`
  (`@layer cr-base`) cuts every transition and animation to 1 ms. Do not add
  per-component `prefers-reduced-motion` blocks to null durations; a block
  exists only to _add back_ motion that carries meaning
  (`data-motion-essential`) or to drop a transform the kill-switch cannot
  reach (the press scale, which is a state and not an animation).
- **Stacking:** page-level tiers (shell, header, banner, overlay, alert,
  popover) only via `--sys-layer-*`. Single-digit z-index is allowed _inside
  a component's own stacking context_ (pair with `isolation: isolate`) —
  collapsing deliberate sibling orderings (1 vs 2) into one token would
  reorder paint; local micro-stacking is not what the scale is for.
- **Space, size, radius, stroke:** `--sys-space-*` (density-aware),
  `--control-size-small/regular/large` (36 / 44 / 52), `--control-radius-*`
  (`--control-radius-capsule` for pills and circles — never a raw `9999px`
  or `50%` on square-locked elements), `--sys-stroke-mark` /
  `--sys-stroke-emphasis` for drawn marks. A divider is `ui-divider` on
  `--sys-color-separator`, never a border hairline.

## Interaction grammar

- **One hover/press grammar.** A pressable card, row or tile carries
  `uiInteractive` (`data-interactive`, `modifiers.css`): a state-layer overlay
  of `currentColor` at the theme's alpha ladder (`--sys-state-layer-hover`,
  `--sys-state-layer-press`) and the surface press scale
  (`--sys-press-scale-surface`, 0.99); controls press at
  `--sys-press-scale-control` (0.97). `ui-button` and `ui-chip` carry their
  own per-variant tiers. Surfaces never invent their own hover treatment.
- **Mobile press parity.** Hover rules sit inside `@media (hover: hover)`,
  and every hover-only effect has an ungated `:active` mirror, so a tap on a
  phone shows it.
- **Feedback is a promise.** Every hover and press state is gated on not
  being disabled (`:disabled`, `[aria-disabled='true']`, `[data-disabled]`);
  the shared disabled-cursor recipe is the
  `:disabled, [aria-disabled='true'], [data-disabled]` block of
  `modifiers.css` (the text field, slider and phone field restate it for
  their native controls).
- **Buttons** keep the exact 36 / 44 / 52 scale (`uiControlSize`), are
  capsules unless a panel is asked for, render white over media
  (`uiOnMedia`), and every async button binds `uiLoading` — the button draws
  its own ring; never compose a spinner into a label.
- **Focus:** one ring recipe — `outline: var(--sys-focus-ring-width) solid
var(--sys-color-ring)` at `--sys-focus-ring-offset`, ink and not a hue —
  and one field glow (`--sys-focus-glow-*`). Always `:focus-visible`, never
  a bare `:focus`.
- **Links:** a prose link is the ink around it on an accent underline (each
  app's `sys-base` rule); an inline link inside running copy is `uiLink`
  (secondary ink at rest, primary on hover and press). A DS-control anchor
  (`a[uiButton]`, `a[uiCard]`, `a[uiListRow]`) never takes link colour.

## Design system first — reuse, never hand-roll

Features compose `ui-*` elements and never hand-roll a control, a sheet, a
menu, a search band or a confirmation; features never style `input`. A typed
figure is `ui-unit-field`, a code `ui-code-field`, a sum that is the screen
`ui-amount-field`, a bounded value `ui-slider`; a yes/no question is
`ui-alert`, a form `ui-modal-sheet`; a sheet page's title and search are
`ui-sheet-headline` + `ui-search-field`. When the element is missing a
capability, extend the original in `libs/ui` — never copy it beside itself.
Icons are `ui-icon` over the registry in `libs/ui/icons` (inline SVG); no
stylesheet may summon an icon font.

## Breakpoints

One set, viewport queries: **640 / 760 / 1024 px.** 640 is the app column
(`--sys-container-content`, 40rem), 760/761 is where a sheet stops being a
phone's bottom sheet (`max-width: 760px` pairs with `min-width: 761px`),
1024 (64rem) opens the admin's wide grid. CSS custom properties can't drive
`@media`, so these are documented constants; anything else is drift —
normalize on touch. Prefer size container queries when a component responds
to its container rather than the viewport; the staff schedule's named
containers are the reference (`@container staff-column (width < 5.5rem)`).
Container _style_ queries were tried and reverted (a silent no-op in
embedded Chromium — case study, Phase 4).

## Angular mechanics

- Variants and state bind via `host: {}` metadata
  (`'[attr.data-control-size]': 'uiControlSize()'`); decorators
  (`@HostBinding`/`@HostListener`) are banned.
- Native elements are upgraded in place: `selector: 'button[uiButton],
a[uiButton]'`, `input[uiTextField]`, `a[uiCard]` — never wrapper elements
  for things the platform already has. Typography is a directive (`uiText`,
  composing `uiFont`/`uiWeight`/`uiForegroundStyle` through
  `hostDirectives`) writing `data-*` attributes, never a wrapper element.
- DS components are `ViewEncapsulation.None` with their CSS inside
  `@layer sys-components`: bare `.ui-*`/`[data-*]` selectors never match a
  component's own host under emulated encapsulation. (`ui-alert`, `ui-toast`
  and `ui-modal-sheet` keep their sheets unlayered on purpose; `alert.css`
  says why at its head.) Modifier directives have
  no view, so their CSS is the one global sheet `libs/ui/modifiers/modifiers.css`,
  imported once per app `styles.css`. DOM a library builds imperatively
  (MapLibre's pins) is styled from a global sheet the same way (`map.css`).
- Feature components keep the default encapsulation; `::ng-deep` is banned.
  (One showcase demo page still pierces its own `sc-demo` scaffold —
  `phone-field.page.css` — it is the one to fix, not the one to copy.)
- Popups, menus, choices and dialogs come from the DS — `ui-menu`,
  `ui-alert` (a native `<dialog>`), `ui-sheet` (stacking into the top layer),
  `ui-segmented-control` (a `radiogroup`), `button[uiSwitch]`
  (`role="switch"`). Features never hand-roll focus management or key
  handling; a missing primitive is built in `libs/ui`.
- OnPush is the v22 default; an explicit `ChangeDetectionStrategy.OnPush` is
  harmless, `Eager` needs a reason.

## Layers

Every `@import` sits in one leading block of each app's `styles.css`, and
their order registers the cascade layers — later layers win regardless of
specificity:

| App             | Layer order (lowest first)                                                     |
| --------------- | ------------------------------------------------------------------------------ |
| `apps/web`      | `cr-reset`, `cr-base`, `sys-tokens`, `sys-components`, `sys-base`, `sys-reset` |
| `apps/showcase` | `cr-reset`, `cr-base`, `sys-tokens`, `sys-components`, `sys-reset`, `sys-base` |

- `cr-reset` and `cr-base` are `libs/ui/tokens/reset.css` and
  `reduced-motion.css`, imported first; the names predate the `--sys-*`
  system (see `reset.css`). `cr-base` also holds each app's fallback
  `:focus-visible` ring — kept below `sys-components` so a field's own
  `outline: none` and glow win.
- `sys-tokens` is `tokens.css` and the two theme files; `sys-components`
  holds the DS sheets and `modifiers.css`; `sys-base` is each app's body, link and
  tabular-figure rules (the web registers it early through
  `landing-shared.css`); `sys-reset` is each app's box-sizing and body
  margin.
- Feature component CSS stays **unlayered** — encapsulation-scoped, and it
  deliberately beats every layer. It never restates type or ink that a
  `uiText`/`uiForegroundStyle` stamp on the same element already says. A
  feature sheet opts into `sys-components` only where it must lose to a DS
  rule. Never `!important` against a DS style — the reduced-motion
  kill-switch is the one sanctioned `!important`.

## Enforcement

- `.stylelintrc.json` (`pnpm lint:styles`): the typography, tracking,
  stacking and motion value lists above, on `--sys-*`, govern the two app
  stylesheets and the showcase; `libs/ui/**` and `libs/features/**` are
  exempt from the value lists until their remaining literal metrics move onto
  tokens, and every stylesheet keeps the icon-font ban.
- `libs/ui/tokens` specs: the accent law (`accent-rule.spec.ts`,
  `accent-label.spec.ts`), contrast (`contrast.spec.ts`) and the pre-paint
  theme script (`pre-paint.spec.ts`).
- `creativo/icon-registry-only` and the icon guards of the root
  `eslint.config.mjs`: icons come from `libs/ui/icons` only.
