import type { ChartPoint } from './line-path';
import { px } from './linear-scale';

/** A radar axis runs 0 … 100: a value is a share of this. */
export const RADAR_FULL = 100;

/** Where a word sits relative to its axis's outer end: the SVG `text-anchor`, and above / beside / below. */
export type RadarAnchor = {
  readonly textAnchor: 'start' | 'middle' | 'end';
  readonly vertical: 'above' | 'middle' | 'below';
};

/** One axis line, from the centre to its outer end. */
export type RadarAxisLine = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

/** The direction of axis `index` of `count`: the first straight up, then clockwise (SVG's y grows downwards). */
function axisAngle(index: number, count: number): number {
  return -Math.PI / 2 + (2 * Math.PI * index) / count;
}

/**
 * THE VERTEX OF AXIS `index` OF `count` at `radius` from `centre` — the
 * first axis straight up, the rest clockwise at equal angles. The one
 * trigonometric fact of the radar; everything else is this at a radius.
 * No axes at all puts the vertex on the centre.
 */
export function radarVertex(
  index: number,
  count: number,
  radius: number,
  centre: ChartPoint,
): ChartPoint {
  if (count <= 0) return centre;
  const angle = axisAngle(index, count);
  return {
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * Math.sin(angle),
  };
}

/**
 * THE `points` OF A RADAR POLYGON — one vertex per value, at
 * `radius × value ÷ 100` along its axis; a `null` (an axis without data)
 * sits on the centre, so the shape visibly collapses there instead of
 * inventing a figure. A value is clamped to 0 … 100: the kit never draws
 * past its outer ring. Coordinates to a hundredth; empty for no values.
 */
export function polygonPoints(
  values: readonly (number | null)[],
  radius: number,
  centre: ChartPoint,
): string {
  const count = values.length;
  let points = '';
  for (let index = 0; index < count; index++) {
    const value = values.at(index) ?? null;
    const share =
      value === null ? 0 : Math.min(1, Math.max(0, value / RADAR_FULL));
    const vertex = radarVertex(index, count, radius * share, centre);
    points += `${points ? ' ' : ''}${px(vertex.x)},${px(vertex.y)}`;
  }
  return points;
}

/** A guide ring: the polygon every axis reaches at `radius` (the 100 % shape at a smaller radius for 50 %). */
export function ringPoints(
  count: number,
  radius: number,
  centre: ChartPoint,
): string {
  return polygonPoints(
    Array.from({ length: count }, () => RADAR_FULL),
    radius,
    centre,
  );
}

/** The axis hairlines, centre to outer end, in axis order. */
export function axisLines(
  count: number,
  radius: number,
  centre: ChartPoint,
): readonly RadarAxisLine[] {
  return Array.from({ length: count }, (_, index) => {
    const end = radarVertex(index, count, radius, centre);
    return { x1: px(centre.x), y1: px(centre.y), x2: px(end.x), y2: px(end.y) };
  });
}

/**
 * WHICH SIDE OF THE CENTRE an axis's outer end sits on, so its words go
 * outward: to the right of the centre they start at the point, to the left
 * they end at it, straight up or down they are centred; above the centre
 * they stack upwards, below it downwards, level with it around it. The
 * thresholds (a twentieth of the radius) keep an axis a hair off the
 * vertical or horizontal from flipping sides.
 */
export function axisAnchor(index: number, count: number): RadarAnchor {
  if (count <= 0) return { textAnchor: 'middle', vertical: 'middle' };
  const angle = axisAngle(index, count);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const edge = 0.05;
  return {
    textAnchor: dx > edge ? 'start' : dx < -edge ? 'end' : 'middle',
    vertical: dy < -edge ? 'above' : dy > edge ? 'below' : 'middle',
  };
}
