# design.google reconnaissance notes

Research performed once, at Phase 1 kickoff, to inform the design-token
architecture. **Inspiration only** — see the framing note below before adding
anything sourced from here.

## Method

Fetched the live site's raw HTML and its public, statically-served Next.js CSS
bundles (`https://design.google/_next/static/css/*.css`) — the same content
any browser's "view source" / dev-tools network tab shows. No authentication
bypass, no scraping of anything not already served to an anonymous visitor.

## Findings

- **Framework**: Next.js (`id="__next"` root, `/_next/static/...` asset paths).
- **CSS Modules**: hashed, scoped class names like
  `Heading_title__h3--section_subtitle_h3__cY0kx` and
  `ContributorsList_contributors_list__r1P_x` confirm they use CSS Modules —
  this validated the "scoped styles" instinct, though we get the same
  isolation from Angular's native `ViewEncapsulation` instead of a CSS-Modules
  build loader (see the Phase 1 plan for why).
- **Semantic color custom properties**: `--theme-accent`, `--theme-accent-active`,
  `--theme-background`, `--theme-foreground`, `--theme-surface`, `--theme-bright`,
  and — most interesting — `--theme-analogous-0`, `--theme-analogous-1`,
  `--theme-analogous-2`. That last group is a generative/analogous
  color-relationship pattern: a small family of accent hues related to each
  other, rather than one single accent color.
- **Typography custom properties**: `--font-heading` (sans-serif) and
  `--font-content` (serif) — a two-typeface split between headings and body
  content.
- **Google Sans Flex**: confirmed open-source (SIL Open Font License),
  published on Google Fonts in 2025. Unlike the rest of Google's branding,
  this is safe to actually use.

## How this shaped our tokens (inspiration, not reproduction)

| Their pattern                             | Our tokens                                                             | What's original vs. borrowed                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--theme-analogous-0/1/2`                 | `color.analogousRamp0/1/2` (core) → `color.analogous-0/1/2` (semantic) | The _technique_ (rotate the brand hue in a perceptual color space to derive a coherent accent family) is inspired by theirs. The hue angles, chroma, and every resulting hex value are ours — see `libs/shared/design-tokens/scripts/generate-color-ramp.mjs`. |
| `--font-heading` / `--font-content` split | `font.family.heading` / `font.family.content`                          | Same two-role split. `font-heading` = Google Sans Flex (genuinely OFL-licensed, safe to reuse directly). `font-content` = Source Serif 4, an original pairing choice, not one of Google's typefaces.                                                           |
| CSS Modules scoping                       | Angular `ViewEncapsulation.Emulated` + data-attributes                 | Different mechanism entirely, same underlying goal (no class collisions, no global leakage).                                                                                                                                                                   |

**What we deliberately did not take**: any literal computed values (their exact
hex codes, spacing numbers, or type scale), logos, illustrations, copy, or any
proprietary Google brand assets beyond the one confirmed-open font.

## Update: exact-match theme + cursor (explicit user request)

The framing above (derive our own values, inspiration only) was the default
for Phase 1's original token system. The user then explicitly asked to match
design.google's _actual_ palette and cursor behavior pixel-for-pixel, and
supplied real browser-devtools-computed values themselves. Two follow-up
research passes (re-fetching the live site + its CSS/JS bundles) confirmed
and completed those values. Given that, `tokens/semantic/{light,dark}.json`
now use literal pinned hex values instead of core-ramp aliases for this
palette — see the `$description` field in each file.

**Colors** — design.google doesn't do OS-driven light/dark switching; it
looks to be a per-page/server-rendered inline theme. What we captured:

- Light/default (genuinely monochrome — this is what "true black and white"
  refers to): background `#fff`, surface `#e3e3e3`, foreground/accent/links
  all literal `#000`.
- Dark (the page's current live theme, confirmed via 3 separate fetches):
  background `#12110c`, surface `#32302a`, foreground `#fff`, accent
  `#fae366`, accent-active `#fff1b3`, three analogous accents (`#c3ecd0`
  mint, `#ffdad3` peach, `#bff28d` lime).

**Fonts** — confirmed via the actual Google Fonts `<link>` URLs the site
loads: `Roboto Flex` (heading) and `Roboto` (content), not "Google Sans
Flex"/"Source Serif 4" as originally guessed. Both are Apache-2.0, long
established, not brand-exclusive — swapped in directly.

**Cursor mechanism** — not a magnetic pull. The custom cursor dot tracks the
pointer with _zero lag_ (`gsap.set`, not an eased tween — CSS `transition`
only covers `transform/width/height/opacity`, never `top/left`). On hovering
a `.js-cursor-target`-equivalent element, the dot itself resizes/repositions
(continuously re-measured) to exactly overlay the target's bounding box —
`mix-blend-mode: exclusion` does the contrast work with no color logic
needed. Separately, the target gets a `filter: invert(1)`-style treatment.
Our reimplementation (`libs/shared/cursor`): `CursorService.activeTarget`
signal + `CursorTargetDirective` ([crCursorTarget]) + `CursorDotComponent`
follow the same model, simplified (no perpetual rAF loop — re-measure on
enter/scroll/ResizeObserver instead).
