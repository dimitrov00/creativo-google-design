# Case study: surface elevation & base-surface color, light vs dark

Commissioned to test three claims against the wider industry before changing this repo's
already-shipped elevation system (`tokens/core/surface-alpha.json`, `tokens/semantic/{light,dark}.json`'s
`surface-tint`, `--cr-color-surface-1..5`, `cr-card`'s `data-elevation`). Research method:
multi-angle web search + fetch + 3-vote adversarial verification per claim (25 claims tested,
18 confirmed / 7 refuted). Full source list at the end.

## Claim 1 — "Dark mode: stack translucent white at increasing alpha as elevation increases"

**Real, but it's Material Design 2 specifically, not current best practice.** Google's own docs
frame the white-overlay-on-dark technique as a _workaround_: shadows "don't reliably portray" on
dark backgrounds, so a semi-transparent white (`onSurface`) overlay substitutes, opacity rising
with elevation (0% → ~16% at 24dp). [m2 dark-theme codelab; Flutter's `applyElevationOverlayColor`]

Material 3 has since moved **twice** away from this: first to a primary-tinted "tonal elevation"
overlay, then to fully **baked, elevation-independent tonal surface-container roles**
("surfaceBright/Dim/Container-Low..High") that Google's own blog says are "no longer tied to
elevation" at all. [m3.material.io/blog/tone-based-surface-color-m3 — confirmed 3-0]

Atlassian independently converges on the same _rationale_ (shadows are hard to see on dark
surfaces, so lighten instead) but still **pairs** color-lightening with shadow at higher
("raised"/"overlay") tiers rather than using tint alone. [atlassian.design/foundations/elevation —
confirmed 3-0]

**Where this repo already lands correctly:** `--cr-color-surface-1..5` bakes the mix to opaque via
`color-mix()` at parse time rather than compositing live translucent layers — which is exactly the
compounding problem M3 cited as its reason for abandoning live overlays. So this repo isn't doing
naive M2; it already resolved M3's specific objection. Keep as-is.

## Claim 2 — "Light mode: shadow alone, no background-color/tint change"

**Well supported, but by one strong primary source rather than broad convergence.** M2's own spec
makes shadow the **unqualified default** for elevation and explicitly flags background-color-only
or opacity-only substitutes with a "Caution" label — they show _that_ surfaces are separated, not
_how much_. [m2.material.io/design/environment/elevation.html — confirmed 3-0/2-1]

No system studied was confirmed using background-tint as the _primary_ light-mode mechanism — a
claim that Atlassian does this was tested and **refuted 0-3**. GitHub Primer, Carbon, and Polaris's
specific tokens didn't survive verification either way (evidence gap, not a contradiction). Josh
Comeau's widely-cited shadow article treats layered, hue-matched shadow as the entire light-mode
depth vocabulary, with no tint mechanism — corroborating evidence, though it's one author's
opinion, not a governed system, and never addresses dark mode.

**Net:** your instinct is the best-supported reading of the evidence that exists. But see the
repo-specific counter-evidence below before treating this as settled for adoption.

## Claim 3 — base/root surface: literal #000/#fff vs off-black/off-white

**Clear, near-unanimous pattern, and asymmetric between themes:**

- Dark root should be **off-black, not pure #000**: Material `#121212`, Ant Design `#141414`,
  Radix gray-scale step 1–2 (~`#161616`–`#1c1c1c`). Rationale: high contrast against colorful
  content increases eye strain; pure black is reserved for system-chrome OLED power-saving, not
  app surfaces. [confirmed 3-0 across three independent systems — the best-supported finding in the
  whole set]
- Light root is commonly **literal white** (`#fff`) — Radix explicitly recommends it, with no
  eye-strain/OLED baggage to avoid. [confirmed 3-0]

**Synthesis (inference, medium confidence, not a single sourced claim):** this asymmetry plausibly
_explains_ why light leans on shadow and dark leans on tint — a pure-white base has zero headroom
to lighten further as elevation increases, so shadow has to carry the whole signal; an off-black
base has ample headroom to lighten toward white, which is what makes a tint-based mechanism viable
in the first place.

**This repo already matches the pattern:** dark background `#12110c` (off-black, not `#000`), light
background `#ffffff` (literal white). No change needed here — a literal `#000` dark base would be
going _against_ the consensus, not adopting it.

## The repo-specific tension this case study surfaces

`libs/shared/design-tokens/build.mjs`'s `appendDerivedSurfaceTokens()` comment documents that an
**earlier version of this exact system tried flat (untinted) light-mode surfaces and reverted it**,
because cards "read as a static grey box sinking into the white page instead of lifting toward the
light — confirmed live as a real bug, not just a hypothetical." That was with this repo's actual
shadow scale (`--cr-shadow-1..5`, `elevation.json`) and `cr-card`'s existing border
(`1px solid var(--cr-color-border)`) — i.e., not a hypothetical, a rendered result.

This doesn't refute Claim 2 — M2's own spec is still the most authoritative source and it says
shadow-only is correct. It does mean the _implementation_ matters: this repo's current shadow scale
was tuned assuming a tint would also be doing work, and swapping to shadow-only cold may reproduce
the exact "flat grey box" problem already observed once. Two credible options if adopting shadow-only
for light mode:

1. **Increase shadow contrast** at low tiers (1–2) — current `--cr-shadow-1` is `0px 1px 2px
rgba(21,22,25,0.08)`, quite subtle against a `1px solid` border of similar weight. M2's own
   examples use noticeably more separation at low dp than this repo's tier 1–2.
2. **Drop the border at elevated tiers**, or lighten it — a card that's already delineated by a
   border has less need for a tint to read as "separate," but the border itself may be part of what
   makes the shadow-only look flat (competing edge signal).

Recommend testing option 1 visually before committing, since the repo has direct prior evidence
that "just swap to shadow, keep everything else" produced a bad result once already.

## Sources

Primary/high-confidence: m2.material.io/design/environment/elevation.html,
m3.material.io/blog/tone-based-surface-color-m3, developer.android.com/.../material3,
atlassian.design/foundations/elevation, codelabs.developers.google.com/codelabs/design-material-darktheme,
ant.design/docs/spec/dark, radix-ui.com/colors/docs/palette-composition/understanding-the-scale.
Secondary/corroborating: joshwcomeau.com/css/designing-shadows,
medium.com/@sotti/android-design-history-material-design-3-material-you.

Refuted during verification (do not cite as support): "Atlassian's light mode pairs tint as
primary mechanism"; "dark mode elevation cannot use shadow at all"; "Polaris elevation is
shadow-only"; "M3 tonal elevation applies in both light and dark via primary-color overlay";
"dark bases should avoid pure black specifically due to OLED blooming" (the eye-strain/contrast
rationale survived; the OLED-hardware-artifact framing did not).
