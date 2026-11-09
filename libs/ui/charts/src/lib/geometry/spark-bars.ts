import { linearScale, px } from './linear-scale';

/**
 * The widest a spark bar gets, however few there are — a week across a
 * card is a row of real columns, not hairlines (owner, 2026-11-09: "those
 * pillars very thin"; Fitbit's and Liven's week bars).
 */
export const SPARK_BAR_MAX_WIDTH = 24;
/** The least air between two spark bars. */
export const SPARK_BAR_MIN_GAP = 3;
/** A bar takes at most this share of its slot; the rest is air. */
export const SPARK_BAR_SHARE = 0.55;
/** The height a zero (or a sliver) still draws, so its slot reads. */
export const SPARK_BAR_STUB = 2;
/** A wide bar's corner: rounded, not a pill — a thin one stays a capsule. */
export const SPARK_BAR_RADIUS = 6;

/** A bar's TRACK: the whole it is a part of, drawn behind it on the same scale. */
export type SparkBarTrack = {
  readonly y: number;
  readonly height: number;
  readonly ry: number;
};

/** One spark bar: its box in the drawing's pixels, its corner radii, and its track when it has one. */
export type SparkBarRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly ry: number;
  readonly track: SparkBarTrack | null;
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
 * The corners are round to {@link SPARK_BAR_RADIUS} (a bar thinner than
 * twice that is a capsule), `ry` no more than half the bar's height.
 *
 * `tracks`, when given, is each bar's WHOLE on the same scale — the day's
 * working time behind its free part — drawn as a box from the bottom to
 * that height; a missing or zero track draws none.
 */
export function sparkBarRects(
  values: readonly number[],
  width: number,
  height: number,
  top: number,
  tracks: readonly number[] = [],
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
    const radius = Math.min(barWidth / 2, SPARK_BAR_RADIUS);
    const whole = tracks.at(index) ?? 0;
    const trackHeight =
      whole > 0 ? Math.min(height, length(Math.max(0, whole))) : 0;
    return {
      x: px(slot * index + (slot - barWidth) / 2),
      y: px(height - barHeight),
      width: px(barWidth),
      height: px(barHeight),
      rx: px(radius),
      ry: px(Math.min(radius, barHeight / 2)),
      track:
        trackHeight > 0
          ? {
              y: px(height - trackHeight),
              height: px(trackHeight),
              ry: px(Math.min(radius, trackHeight / 2)),
            }
          : null,
    };
  });
}
