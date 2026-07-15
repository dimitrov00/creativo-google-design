# Standing design-system decisions

Explicit rejections from the [design system modernization proposal](./design-system-proposal.md), codified here so they don't get re-litigated by a future tutorial or dependency suggestion that predates them.

## No `@angular/animations`

`@angular/animations` has been deprecated since Angular v20.2 in favor of native `animate.enter`/`animate.leave` template syntax and CSS-driven transitions. Do not add it as a dependency, even if a tutorial or Stack Overflow answer suggests it — use `animate.enter`/`animate.leave` (see `apps/showcase`'s gallery card filter transition for the reference pattern) or plain CSS `transition`/`@keyframes` instead.

## No CSS-in-JS (vanilla-extract, StyleX, etc.)

Neither vanilla-extract nor StyleX has a supported esbuild-plugin path into `@angular/build:application`, the executor `apps/showcase` actually uses — and this repo doesn't want CSS-rule-authoring-in-TypeScript in the first place. Styling stays in per-component `.css` files. What the repo actually wants — typed, zero-runtime-cost token _references_ — is already delivered by `libs/shared/design-tokens`'s generated `vars` object (see `generated/ts/vars.ts`). Do not add a CSS-in-JS dependency to chase that ergonomics goal; extend the Style Dictionary pipeline instead.

## Light-mode elevation is shadow-only; dark-mode keeps the tint stack

Supersedes part of §5.4 of the [design system modernization proposal](./design-system-proposal.md),
which had `--cr-color-surface-1..5` tint toward `surface-tint` identically in both themes. A
[case study](./elevation-surface-case-study.md) (2026-07-15) found this symmetric approach isn't
what the industry actually does: Material 2's own spec makes shadow the unqualified default for
light-mode elevation and flags background-tint-only as "Caution" (it shows separation, not degree);
dark mode's tint-based approach is real (Material 2, Atlassian) but specifically because shadows
barely register against a dark base — an asymmetry, not a single formula applied twice.

`build.mjs`'s `appendDerivedSurfaceTokens` now takes a `tinted` flag: dark theme keeps the
`color-mix()` stack (`tinted: true`), light theme aliases `--cr-color-surface-1..5` flatly to
`--cr-color-surface` (`tinted: false`) — elevation there reads via `--cr-shadow-N` alone.
`tokens/core/elevation.json`'s shadow tiers 1-2 were strengthened alongside this change, because an
earlier attempt at flat light-mode surfaces (visible in `build.mjs`'s history/comments) had reverted
for looking like "a static grey box sinking into the white page" — that was a real regression, but
it was the old, weaker shadow values failing to carry the elevation signal alone, not evidence that
shadow-only can't work. If light-mode elevation ever looks flat again, re-tune the shadow scale
before reintroducing a tint.

Base surface colors (`background`: `#12110c` dark / `#ffffff` light) were checked against the same
case study and left unchanged — off-black-not-pure-black for dark and literal white for light both
already match the cross-system consensus.

**Follow-up correction (same day):** the first pass above only stopped card.css from mixing tint
into the elevation _tiers_ — it left Card's resting/tier-0 background wired to `--cr-color-surface`
(`#efeeeb`, a warm grey used deliberately by badge/button for chip-like chrome), so cards still
looked grey against the white page even with tint removed. Added a new `surface-plain` semantic
token — equal to `background` in light theme (a card is flush with the page; only shadow shows
elevation) and equal to `surface` in dark theme (keeps the validated lifted-off-the-page look).
`--cr-color-surface-1..5` and Card/Material's resting background now derive from `surface-plain`,
not `surface`. Card's `1px solid border` was also dropped entirely — it was a second competing edge
signal alongside the (previously too-subtle) shadow.

## No `hostDirectives` for the cursor-target composition

`hostDirectives`' inputs are only settable by the consuming template or a static default — never by the host component's own internal class logic. Button needs to feed the shared cursor-target behavior an internally-`computed()` value (`cursorStyle`, derived from Button's own `variant` input), which `hostDirectives` structurally cannot express. Keep the plain composable pattern (`useCursorTarget`, called from an injection context) for this specific case. `hostDirectives` remains a good fit for purely consumer-driven inputs — e.g. `MaterialDirective`'s `crMaterial` tier — just not for this one.

## `window`/`document` feature-detect for SSR, don't just null-check

Discovered building `apps/marketing` (the first SSR consumer of `libs/shared/ui`/`libs/shared/cursor`): Angular's SSR/prerender DOM shim provides a truthy `document.defaultView` that does **not** implement `matchMedia`/`localStorage` the way a real browser does, and a `document.documentElement` whose `.dataset` property is `undefined` even though `setAttribute` works fine. `ThemeService`/`CursorService`'s original `this.window?.matchMedia(...)` guards only protect against `window` being nullish — they don't protect against `window` existing but lacking the method, which is exactly the SSR shim's shape, and threw `TypeError: ... is not a function` during prerender.

Fixed in both services: feature-detect with `typeof this.window?.matchMedia === 'function'` (not just `?.`) before calling it, wrap `localStorage` access in try/catch (some real-browser privacy modes throw on access too, not just SSR), and use `setAttribute('data-theme', ...)` instead of `.dataset['theme'] = ...` for the one DOM write that has to survive SSR. Apply the same pattern to any future shared service that touches `window`/`document` APIs beyond basic presence — a component/service only being exercised by CSR apps so far doesn't mean it's actually SSR-safe, it means it's untested against SSR.
