/**
 * WCAG 2.x contrast, computed the way axe-core measures it in the browser.
 *
 * Channels stay UNROUNDED 0–255 floats: Chrome resolves `color-mix()` to a
 * float colour and axe flattens a translucent background over the opaque
 * one beneath it in that same space, so rounding a composite to a hex here
 * would disagree with the audit by a few hundredths — exactly the margin a
 * token sized to 4.6:1 lives in.
 */

/** An sRGB colour, channels 0–255. */
export type Srgb = readonly [red: number, green: number, blue: number];

/** SC 1.4.3 minimum for normal-size text. */
export const WCAG_AA_TEXT = 4.5;
/** SC 1.4.3 minimum for large text (24px, or 18.66px bold) and SC 1.4.11. */
export const WCAG_AA_LARGE_TEXT = 3;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** `#rrggbb` → channels. Throws on anything else: a token is a literal. */
export function parseHex(hex: string): Srgb {
  const match = HEX.exec(hex.trim());
  if (!match) throw new Error(`"${hex}" is not a #rrggbb colour`);
  const [, red = '', green = '', blue = ''] = match;
  return [parseInt(red, 16), parseInt(green, 16), parseInt(blue, 16)];
}

/**
 * `top` at `alpha` (0–1) painted over an opaque `under` — what
 * `color-mix(in srgb, top N%, transparent)` renders on its ground, and what
 * `color-mix(in srgb, top N%, under)` resolves to outright.
 */
export function composite(top: Srgb, alpha: number, under: Srgb): Srgb {
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new RangeError(`alpha ${alpha} is outside 0–1`);
  }
  return [
    top[0] * alpha + under[0] * (1 - alpha),
    top[1] * alpha + under[1] * (1 - alpha),
    top[2] * alpha + under[2] * (1 - alpha),
  ];
}

function linear(channel: number): number {
  const c = channel / 255;
  // 0.03928 is the WCAG 2.x text (and axe's) knee, not sRGB's 0.04045.
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance([red, green, blue]: Srgb): number {
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2.x contrast ratio, 1–21, symmetric in its arguments. */
export function contrastRatio(a: Srgb, b: Srgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** An OKLab colour: lightness 0–1, and the two opponent axes. */
export type Oklab = readonly [lightness: number, a: number, b: number];

function linearSrgb(channel: number): number {
  const c = channel / 255;
  // The sRGB transfer knee itself (0.04045): OKLab is defined over it.
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB → OKLab (Björn Ottosson, 2020): a perceptual space in which the
 * Euclidean distance between two colours tracks how different they LOOK,
 * with neither lightness nor hue dominating. The chart palette pins the
 * distance between adjacent parts in it.
 */
export function oklab([red, green, blue]: Srgb): Oklab {
  const r = linearSrgb(red);
  const g = linearSrgb(green);
  const b = linearSrgb(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The Euclidean distance between two colours in OKLab, × 100 (so 8 is a readable step). */
export function oklabDistance(a: Srgb, b: Srgb): number {
  const [la, aa, ba] = oklab(a);
  const [lb, ab, bb] = oklab(b);
  return 100 * Math.hypot(la - lb, aa - ab, ba - bb);
}
