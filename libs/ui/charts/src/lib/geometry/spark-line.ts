import type { ChartPoint } from './line-path';

/**
 * A SPARK LINE's points in the drawing's own pixels: value `i` at slot `i`
 * of `slots` evenly across `width` (a single slot sits in the middle),
 * zero on the box's bottom less `inset` and `top` on its top plus `inset`
 * — the room an end dot and the stroke need inside the box. A negative
 * value counts as zero.
 */
export function sparkLinePoints(
  values: readonly number[],
  slots: number,
  width: number,
  height: number,
  top: number,
  inset: number,
): readonly ChartPoint[] {
  const count = Math.max(slots, values.length, 1);
  const left = inset;
  const span = Math.max(width - 2 * inset, 0);
  const bottom = height - inset;
  const rise = Math.max(height - 2 * inset, 0);
  const points: ChartPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = Math.max(0, values[i] as number);
    points.push({
      x: count === 1 ? width / 2 : left + (i / (count - 1)) * span,
      y: top > 0 ? bottom - (value / top) * rise : bottom,
    });
  }
  return points;
}
