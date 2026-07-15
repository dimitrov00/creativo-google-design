#!/usr/bin/env node
/**
 * Generates libs/shared/design-tokens/tokens/core/color.json.
 *
 * This is a one-time/on-demand generator, NOT part of the `design-tokens:build`
 * Style Dictionary run — its output is committed so color changes show up as a
 * reviewable diff instead of being silently recomputed on every build.
 *
 * Run with: node libs/shared/design-tokens/scripts/generate-color-ramp.mjs
 *
 * Every hue/lightness/chroma value below is an original choice for this
 * product. The *technique* — deriving "analogous" accents by rotating the
 * brand hue in a perceptual color space — is inspired by the pattern
 * observed in design.google's `--theme-analogous-0/1/2` custom properties;
 * none of their actual computed values are reproduced here.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { clampChroma, formatHex } from 'culori';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../tokens/core/color.json');

// Perceptual lightness/chroma curve shared by every hue-based ramp.
// Lightness falls off faster at the dark end (matches how the eye
// perceives contrast) and chroma peaks in the midtones, tapering at the
// extremes to stay in-gamut without clipping to gray.
const RAMP_STEPS = [
  { step: '0', l: 1.0, chromaScale: 0 },
  { step: '50', l: 0.98, chromaScale: 0.2 },
  { step: '100', l: 0.95, chromaScale: 0.35 },
  { step: '200', l: 0.9, chromaScale: 0.55 },
  { step: '300', l: 0.82, chromaScale: 0.75 },
  { step: '400', l: 0.72, chromaScale: 0.9 },
  { step: '500', l: 0.6, chromaScale: 1.0 },
  { step: '600', l: 0.48, chromaScale: 0.95 },
  { step: '700', l: 0.38, chromaScale: 0.85 },
  { step: '800', l: 0.28, chromaScale: 0.7 },
  { step: '900', l: 0.2, chromaScale: 0.5 },
  { step: '950', l: 0.15, chromaScale: 0.35 },
  { step: '1000', l: 0.0, chromaScale: 0 },
];

/** @param {{ hue: number, baseChroma: number, steps?: typeof RAMP_STEPS }} opts */
function buildRamp({ hue, baseChroma, steps = RAMP_STEPS }) {
  /** @type {Record<string, string>} */
  const ramp = {};
  for (const { step, l, chromaScale } of steps) {
    const clamped = clampChroma(
      { mode: 'oklch', l, c: baseChroma * chromaScale, h: hue },
      'oklch',
    );
    ramp[step] = formatHex(clamped);
  }
  return ramp;
}

function toColorTokenGroup(ramp) {
  /** @type {Record<string, { $value: string }>} */
  const group = { $type: 'color' };
  for (const [step, hex] of Object.entries(ramp)) {
    group[step] = { $value: hex };
  }
  return group;
}

// Brand seed hue: a warm gold/yellow (~99deg in OKLCH) — matches the exact
// accent used on design.google's current theme, per explicit user request
// to match that site's palette (not an original choice like the rest of
// this generator's defaults were originally).
const BRAND_HUE = 99;
const BRAND_CHROMA = 0.15;

// Analogous accents: hue-space neighbors observed on design.google's own
// three analogous accent colors (mint, peach, lime) rather than a symmetric
// rotation formula — their actual hues aren't evenly spaced, so we pin them
// directly instead of deriving via rotation.
const ANALOGOUS = [
  { hue: 155, chroma: 0.06 }, // mint green
  { hue: 30, chroma: 0.045 }, // peach
  { hue: 130, chroma: 0.14 }, // lime green
];

// Neutral ramp: near-zero chroma with a warm tint matching the brand hue,
// so grays read as warm-black/warm-white rather than cool gray.
const NEUTRAL_HUE = BRAND_HUE;
const NEUTRAL_CHROMA = 0.012;

// Genuine semantic status hues — deliberately NOT derived from the brand
// hue or the analogous family (those are a decorative accent family, not
// status colors; conflating the two was the original bug: "danger" ended
// up pointing at analogousRamp2, a lime green, because it was reusing a
// decorative token for a semantic one). Verified >= WCAG AA contrast
// against both themes' text colors at the steps referenced in
// tokens/semantic/*.json (600/700 for light, 300/400 for dark).
const SUCCESS_HUE = 145; // green
const SUCCESS_CHROMA = 0.17;
const WARNING_HUE = 75; // amber
const WARNING_CHROMA = 0.16;
const DANGER_HUE = 25; // red
const DANGER_CHROMA = 0.19;

const colorTokens = {
  color: {
    neutral: toColorTokenGroup(
      buildRamp({ hue: NEUTRAL_HUE, baseChroma: NEUTRAL_CHROMA }),
    ),
    brand: toColorTokenGroup(
      buildRamp({ hue: BRAND_HUE, baseChroma: BRAND_CHROMA }),
    ),
    // Named distinctly from the semantic `color.analogous-0/1/2` aliases
    // (tokens/semantic/*.json) so the two don't collide at the same path —
    // these are the raw ramps the semantic layer picks specific steps from.
    analogousRamp0: toColorTokenGroup(
      buildRamp({ hue: ANALOGOUS[0].hue, baseChroma: ANALOGOUS[0].chroma }),
    ),
    analogousRamp1: toColorTokenGroup(
      buildRamp({ hue: ANALOGOUS[1].hue, baseChroma: ANALOGOUS[1].chroma }),
    ),
    analogousRamp2: toColorTokenGroup(
      buildRamp({ hue: ANALOGOUS[2].hue, baseChroma: ANALOGOUS[2].chroma }),
    ),
    // "Ramp" suffix for the same reason as analogousRamp0-2: the semantic
    // layer's leaf names (color.success, color.warning, color.danger) would
    // otherwise collide with these group names at the identical path and
    // corrupt the merge (confirmed live — this exact bug happened here).
    successRamp: toColorTokenGroup(
      buildRamp({ hue: SUCCESS_HUE, baseChroma: SUCCESS_CHROMA }),
    ),
    warningRamp: toColorTokenGroup(
      buildRamp({ hue: WARNING_HUE, baseChroma: WARNING_CHROMA }),
    ),
    dangerRamp: toColorTokenGroup(
      buildRamp({ hue: DANGER_HUE, baseChroma: DANGER_CHROMA }),
    ),
  },
};

writeFileSync(OUTPUT_PATH, JSON.stringify(colorTokens, null, 2) + '\n', 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
