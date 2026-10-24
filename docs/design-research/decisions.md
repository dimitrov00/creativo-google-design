# Standing design-system decisions

Explicit rejections from the [design system modernization proposal](./design-system-proposal.md), codified here so they don't get re-litigated by a future tutorial or dependency suggestion that predates them.

## No `@angular/animations`

`@angular/animations` has been deprecated since Angular v20.2 in favor of native `animate.enter`/`animate.leave` template syntax and CSS-driven transitions. Do not add it as a dependency, even if a tutorial or Stack Overflow answer suggests it — use `animate.enter`/`animate.leave` or plain CSS `transition`/`@keyframes` instead.

## No CSS-in-JS (vanilla-extract, StyleX, etc.)

Neither vanilla-extract nor StyleX has a supported esbuild-plugin path into `@angular/build:application`, the executor `apps/showcase` actually uses — and this repo doesn't want CSS-rule-authoring-in-TypeScript in the first place. Styling stays in per-component `.css` files. Do not add a CSS-in-JS dependency to chase typed-token ergonomics; the token source of truth is plain CSS (see the next decision), and the few TypeScript call sites that need token _values_ (WAAPI durations/easings) read the `--sys-motion-*` custom properties at run time with `getComputedStyle` (the reveal directive in `libs/ui/modifiers` is the pattern), not a codegen dependency.

## Tokens are plain hand-edited CSS — no build pipeline

The original Style Dictionary pipeline (`build.mjs`, `tokens/core/*.json`, `tokens/semantic/*.json`, `generated/{css,ts}/*`) was removed in July 2026. The token source of truth is now the three hand-edited files in `libs/ui/tokens/` (`tokens.css`, `theme-light.css`, `theme-dark.css`), with their invariants (contrast, the accent law, the pre-paint theme) enforced by the specs in `libs/ui/tokens/src/lib/` instead of build-time generation. (The first hand-edited set, the `--cr-*` files in `libs/shared/design-tokens`, was deleted in pass B, 2026-10-24.) Do not reintroduce a token build step, JSON token sources, or generated TS exports — edit the CSS directly and extend the spec when a new invariant appears. References to `build.mjs`/`generated/*` in older sections below are historical.

## Light-mode elevation is shadow-only; dark-mode keeps the tint stack

Supersedes part of §5.4 of the [design system modernization proposal](./design-system-proposal.md),
which had `--cr-color-surface-1..5` tint toward `surface-tint` identically in both themes. A
[case study](./elevation-surface-case-study.md) (2026-07-15) found this symmetric approach isn't
what the industry actually does: Material 2's own spec makes shadow the unqualified default for
light-mode elevation and flags background-tint-only as "Caution" (it shows separation, not degree);
dark mode's tint-based approach is real (Material 2, Atlassian) but specifically because shadows
barely register against a dark base — an asymmetry, not a single formula applied twice.

Dark theme keeps the `color-mix()` tint stack for `--cr-color-surface-1..5`; light theme aliases
them flatly to `--cr-color-surface-plain` — elevation there reads via `--cr-shadow-N` alone (see
`css/dark.css` / `css/light.css`; originally implemented via `build.mjs`'s
`appendDerivedSurfaceTokens(tinted)` flag before the pipeline's removal).
The shadow tiers 1-2 were strengthened alongside this change, because an
earlier attempt at flat light-mode surfaces had reverted
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

## Retired with the legacy design system (pass B, 2026-10-24)

Three earlier decisions governed code that no longer exists — `libs/shared/ui`, `libs/shared/cursor` and `libs/shared/design-tokens` were deleted in pass B: the cursor-target composition's refusal of `hostDirectives`, the SSR feature-detect fix in the old `ThemeService`/`CursorService`, and the bare `[text]` typography selector (the design system's typography modifier is `[uiText]`, prefixed like every other directive). The lesson that still applies: a service that touches `window`/`document` APIs feature-detects the method (`typeof window?.matchMedia === 'function'`) and wraps `localStorage` in try/catch, rather than only null-checking the global.

## Icons are inline SVG path data from a pinned Material Symbols revision — the ligature font is gone (2026-09-24)

`material-symbols` (a 5.1 MB variable ligature font, imported once in `styles.css`) is removed. Every icon is resolved by the registry in `libs/ui/icons` to inert path data — Material Symbols Rounded at the house cut (FILL 1 · wght 400 · GRAD 0 · opsz 24), fetched by `pnpm icons:glyphs` from `google/material-design-icons` at a pinned commit into a committed, generated table — and drawn as a 1em inline `<svg>` by `ui-icon`. Reasons, in order: the font rendered an unknown ligature as its own NAME in capitals and nothing at build time caught it (`media.gallery → collections` shipped that way); the house never varied the axes, so the variable font's one advantage was unused while its 5 MB and its flash-of-text-before-font were paid on every visit; and a manifest that can arrive from the backend needs an asset shape that is data, not markup — path data needs no sanitizer. Do not reintroduce an icon font, `@angular/material/icon`, or the `@material-symbols/svg-*` packages (they ship only the 48 px optical size). Adding a glyph = editing `UI_ICON_REGISTRY` and regenerating; the generator refuses names the pinned revision lacks. Full record: [icon-registry-design.md](./icon-registry-design.md).

## Backend-driven icon remapping: the seam ships, the backend does not

Owner ruling, 2026-09-24: "change icons without an app update" is a native-app concern (store review, slow adoption); on Firebase Hosting a redeploy takes a minute and reaches every user on the next load, so a live override layer would only add a document, rules, a cache, a listener and an admin surface to maintain. `libs/ui/icons` therefore exposes `UiIconManifestSource` / `provideUiIconManifest` and validates whatever arrives through it, and `apps/web` provides nothing. If it is ever wired, it is one Firestore document (`settings/branding`, public-read, admin-write like `settings/bookingPolicy`), read live with the SDK's persistent cache and kept as a last-known-good in `localStorage`, treated as a PATCH over the bundled manifest: an unsupported `schemaVersion` rejects the whole document, a bad entry drops only itself, an unknown key is skipped. Assets are `{ kind: 'material', glyph }`, `{ kind: 'vector', viewBox, paths }` (path data plus a closed set of presentation attributes) or, for the logo only, `{ kind: 'image', href, width, height }` through `<img>` from same-origin paths or allow-listed https origins. Remote Config was rejected: no emulator, no admin UI in this repo, and a second SDK for what a settings document already does. Accepting SVG markup was rejected: DOMPurify would be correct but unnecessary when the asset language cannot express anything executable.
