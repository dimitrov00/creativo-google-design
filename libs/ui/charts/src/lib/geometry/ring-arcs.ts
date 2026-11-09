import type { ChartPoint } from './line-path';
import { px } from './linear-scale';

const TURN = 2 * Math.PI;

/** One drawn segment of a ring: the index of its value, and its `d`. */
export type RingArc = {
  readonly index: number;
  readonly d: string;
};

/**
 * THE POINT AT `angle` ON A CIRCLE — the angle in radians clockwise from
 * 12 o'clock (SVG's y grows downwards), so `0` is straight up and `π ÷ 2`
 * is 3 o'clock.
 */
export function ringPoint(
  angle: number,
  radius: number,
  centre: ChartPoint,
): ChartPoint {
  return {
    x: centre.x + radius * Math.sin(angle),
    y: centre.y - radius * Math.cos(angle),
  };
}

/**
 * THE `d` OF AN ARC from `start` to `end` (radians clockwise from 12
 * o'clock), drawn clockwise: one SVG `A`, its large-arc flag set past half
 * a turn. A span of a whole turn or more is the full circle, as two half
 * arcs closed at the top (one `A` cannot start and end on the same point).
 * A span of zero or less is a lone point drawn as a zero-length segment,
 * which a round cap turns into a dot.
 */
export function arcPath(
  start: number,
  end: number,
  radius: number,
  centre: ChartPoint,
): string {
  const span = end - start;
  const r = px(radius);
  if (span >= TURN) {
    const top = ringPoint(0, radius, centre);
    const bottom = ringPoint(Math.PI, radius, centre);
    return (
      `M${px(top.x)} ${px(top.y)}` +
      ` A${r} ${r} 0 1 1 ${px(bottom.x)} ${px(bottom.y)}` +
      ` A${r} ${r} 0 1 1 ${px(top.x)} ${px(top.y)} Z`
    );
  }
  const from = ringPoint(start, radius, centre);
  if (span <= 0) {
    return `M${px(from.x)} ${px(from.y)} L${px(from.x)} ${px(from.y)}`;
  }
  const to = ringPoint(end, radius, centre);
  const large = span > Math.PI ? 1 : 0;
  return (
    `M${px(from.x)} ${px(from.y)}` +
    ` A${r} ${r} 0 ${large} 1 ${px(to.x)} ${px(to.y)}`
  );
}

/**
 * THE SEGMENTS OF A RING OF SHARES — each value's share of the total as an
 * arc, the first from 12 o'clock and the rest clockwise after it. Between
 * two segments `gap` px of the circumference (measured at `radius`) is left
 * out, half from each side: the caller passes the air it wants plus the
 * stroke's thickness, because a round cap reaches half the thickness past
 * each end of its arc. A segment too short to survive its gap becomes a
 * dot at the middle of its share.
 *
 * A value is clamped to zero; a zero draws nothing and takes no gap. One
 * value with a share is the whole circle with no gap; no share at all
 * (a zero total) draws nothing — the caller's track says "empty".
 */
export function ringArcs(
  values: readonly number[],
  radius: number,
  centre: ChartPoint,
  gap: number,
): readonly RingArc[] {
  let total = 0;
  let drawn = 0;
  for (const value of values) {
    if (value > 0) {
      total += value;
      drawn++;
    }
  }
  if (total === 0 || radius <= 0) return [];
  const halfGap = drawn > 1 ? gap / radius / 2 : 0;
  const arcs: RingArc[] = [];
  let start = 0;
  values.forEach((raw, index) => {
    const value = Math.max(0, raw);
    if (value === 0) return;
    const end = start + (value / total) * TURN;
    if (drawn === 1) {
      arcs.push({ index, d: arcPath(0, TURN, radius, centre) });
    } else {
      const from = start + halfGap;
      const to = end - halfGap;
      const middle = (start + end) / 2;
      arcs.push({
        index,
        d:
          to > from
            ? arcPath(from, to, radius, centre)
            : arcPath(middle, middle, radius, centre),
      });
    }
    start = end;
  });
  return arcs;
}
