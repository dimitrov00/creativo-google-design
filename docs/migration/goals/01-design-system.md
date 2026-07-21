# Goal 01 — Design system (`--sys-*` tokens + `ui*` modifiers/controls)

**Depends on:** 00 · **Parallel with:** 02 · **Blueprint refs:** §3, §3.1, §4, §8 Phase 1

## Kickoff prompt

> Execute Phase 1 of `docs/migration-blueprint.md` (read §3, §3.1, §4 first — they contain the exact token values and directive code to implement). Reference for visual parity: `../v2/packages/styles/styles.css`, `../v2/packages/ui/src/` (read-only — never modify v2).
>
> 1. `libs/ui/tokens`: create `tokens.css`, `theme-light.css`, `theme-dark.css` per §3 (SwiftUI semantic names, scale vocabulary none/tight/compact/regular/comfortable/loose/spacious, control emphasis subtle/regular/prominent/capsule). Black-and-white brand ONLY — do not port `[data-brand="blue"]`. Fonts via @fontsource: Onest Variable, DM Sans, Geist Mono.
> 2. `libs/ui/modifiers`: UiFont, UiWeight, UiForeground, UiPadding, UiFrame, UiRadius directives + composed UiText (§4) — each writes only `[attr.data-*]`, zero styles in TS. Unit tests assert the attribute contract.
> 3. `libs/ui/controls` + `layout` + `patterns`: UiButton, UiInput, UiOtpField, UiChip, UiBadge, UiAvatar, UiCard, UiStack, UiToolbar, UiSheet, UiSkeleton, UiSpinner — native elements, CDK a11y, all variant/state styling via `.ui-*` class identity + `[data-*]` attribute selectors in co-located CSS (§3.1). No Tailwind, no t-shirt size names anywhere.
> 4. Rebuild `apps/showcase` pages on the new system: a page per control rendering every variant × size × state, a tokens catalog page, light/dark toggle via `data-theme`, density toggle via `data-density`.
> 5. Add a Playwright screenshot harness project (`apps/showcase-e2e` or Nx target) capturing each showcase control in light and dark.
>
> Migrate useful logic from `libs/shared/ui` (cr components) as donor code, then delete components you have replaced. Keep stylelint and all tests green.

## /goal condition

```
Phase 1 of docs/migration-blueprint.md is complete: (1) libs/ui/tokens/tokens.css, theme-light.css and theme-dark.css exist, define --sys-color-accent: #f26b22, --sys-font-family-display with 'Onest Variable', --control-size-regular, and contain no occurrence of "data-brand", "-sm", "-md:", "-lg", or "-xl" token names; (2) libs/ui/modifiers exports UiFontDirective, UiWeightDirective, UiForegroundDirective, UiPaddingDirective and a composed UiTextDirective using hostDirectives, with passing unit tests asserting data-* attribute output; (3) libs/ui/controls exports at least UiButton, UiInput, UiOtpField, UiChip, UiBadge, UiAvatar, UiCard, UiStack, UiSheet, UiSkeleton, UiSpinner, each styled exclusively via class identity plus [data-*] selectors in CSS (grep of libs/ui shows no Tailwind classes and no inline style bindings for variants); (4) apps/showcase builds and its pages render every control variant/state in light and dark via data-theme; (5) a Playwright screenshot target exists and runs green producing baseline images; (6) `pnpm nx run-many -t typecheck lint test` exits 0; (7) nothing under ../v2 was modified. Or stop after 50 turns.
```

## Scope guard

- No feature screens, no Firebase, no domain imports in `libs/ui` (boundary: `ui → ui|tokens|util` only).
- Pixel targets come from v2's values already transcribed in blueprint §3 — do not invent a new aesthetic.
- Blue brand explicitly out of scope.
