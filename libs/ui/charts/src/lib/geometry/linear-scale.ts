/** `[min, max]` of a domain, or `[from, to]` of a pixel range. */
export type ScaleSpan = readonly [number, number];

/**
 * A LINEAR SCALE — the one mapping every chart draws with: a value in
 * `domain` to a position in `range`, both ends inclusive, straight
 * interpolation (a value outside the domain lands outside the range; the
 * caller clamps where it must). A flat domain (`min === max`) maps every
 * value to the range's start, so an all-zero series draws on the baseline
 * instead of dividing by zero.
 *
 * Display geometry over plain numbers: the values were decided elsewhere.
 */
export function linearScale(
  domain: ScaleSpan,
  range: ScaleSpan,
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => r0;
  const ratio = (r1 - r0) / span;
  return (value) => r0 + (value - d0) * ratio;
}

/**
 * The zero-anchored extent of a series: `[0, max]` over every number given,
 * `null`s skipped, never below zero at the top (`[0, 0]` for nothing).
 */
export function zeroExtent(values: readonly (number | null)[]): ScaleSpan {
  let max = 0;
  for (const value of values) {
    if (value !== null && value > max) max = value;
  }
  return [0, max];
}

/** A coordinate rounded to a hundredth of a pixel: short attributes, no drift. */
export function px(value: number): number {
  return Math.round(value * 100) / 100;
}
