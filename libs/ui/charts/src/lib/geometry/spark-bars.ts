import { linearScale, px } from './linear-scale';

/** The widest a spark bar gets, however few there are. */
export const SPARK_BAR_MAX_WIDTH = 8;
/** The least air between two spark bars. */
export const SPARK_BAR_MIN_GAP = 3;
/** A bar takes at most this share of its slot; the rest is air. */
export const SPARK_BAR_SHARE = 0.6;
/** The height a zero (or a sliver) still draws, so its slot reads. */
export const SPARK_BAR_STUB = 2;

/** One spark bar: its box in the drawing's pixels and the radii that make it a capsule. */
export type SparkBarRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly ry: number;
};

/**
 * THE BOXES OF A BAR SPARKLINE — `values` as evenly spaced bars across
 * `width`, standing on the bottom of a `height`-tall box, zero-anchored
 * with `top` as the full height (the caller passes the largest value, or a
 * larger figure an average line needs room for). Each bar is centred in
 * its slot (`width ÷ n`), as wide as {@link SPARK_BAR_SHARE} of the slot
 * but never wider than {@link SPARK_BAR_MAX_WIDTH} and never so wide that
 * less than {@link SPARK_BAR_MIN_GAP} of air is left (a crowded run thins
 * to a pixel at the least). A negative value counts as zero; a zero, or a
 * value too small to show, still draws a {@link SPARK_BAR_STUB} tall stub.
 * The ends are fully round: `rx` is half the width, `ry` the same unless
 * the bar is shorter than it is wide.
 */
export function sparkBarRects(
  values: readonly number[],
  width: number,
  height: number,
  top: number,
): readonly SparkBarRect[] {
  const count = values.length;
  if (count === 0) return [];
  const slot = width / count;
  const barWidth = Math.max(
    1,
    Math.min(
      SPARK_BAR_MAX_WIDTH,
      slot * SPARK_BAR_SHARE,
      slot - SPARK_BAR_MIN_GAP,
    ),
  );
  const length = linearScale([0, Math.max(0, top)], [0, height]);
  return values.map((value, index) => {
    const barHeight = Math.min(
      height,
      Math.max(SPARK_BAR_STUB, length(Math.max(0, value))),
    );
    const radius = barWidth / 2;
    return {
      x: px(slot * index + (slot - barWidth) / 2),
      y: px(height - barHeight),
      width: px(barWidth),
      height: px(barHeight),
      rx: px(radius),
      ry: px(Math.min(radius, barHeight / 2)),
    };
  });
}
