import { px } from './linear-scale';

/** A point in the SVG's own pixels. */
export type ChartPoint = { readonly x: number; readonly y: number };

/**
 * THE `d` OF A POLYLINE — straight segments, no smoothing (a smoothed line
 * invents values between the days it has). A `null` breaks the line: the
 * next point starts a new sub-path, so a day with no comparison leaves a
 * gap instead of a slope across it. One point draws a `M` alone (a marker
 * stands on it); nothing draws the empty string.
 */
export function linePath(points: readonly (ChartPoint | null)[]): string {
  let d = '';
  let open = false;
  for (const point of points) {
    if (point === null) {
      open = false;
      continue;
    }
    d += `${d ? ' ' : ''}${open ? 'L' : 'M'}${px(point.x)} ${px(point.y)}`;
    open = true;
  }
  return d;
}

/** `-1` below zero, else `1` — d3's `sign`, so a flat run counts as rising. */
function sign(value: number): number {
  return value < 0 ? -1 : 1;
}

/**
 * The tangents of one unbroken run of points, by Fritsch–Carlson (d3's
 * `curveMonotoneX`): at an inner point the harmonic-style blend of the two
 * neighbouring slopes, zero where they disagree in sign (a peak or a
 * valley stays flat, so the curve never swings past it); at either end the
 * one-sided estimate `(3 × slope − the neighbour's tangent) ÷ 2`.
 */
function monotoneTangents(run: readonly ChartPoint[]): readonly number[] {
  const count = run.length;
  const tangents = new Array<number>(count).fill(0);
  for (let i = 1; i < count - 1; i++) {
    const before = run[i - 1] as ChartPoint;
    const at = run[i] as ChartPoint;
    const after = run[i + 1] as ChartPoint;
    const h0 = at.x - before.x;
    const h1 = after.x - at.x;
    const s0 = (at.y - before.y) / (h0 || (h1 < 0 ? -0 : 0));
    const s1 = (after.y - at.y) / (h1 || (h0 < 0 ? -0 : 0));
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    tangents[i] =
      (sign(s0) + sign(s1)) *
        Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const end = (from: ChartPoint, to: ChartPoint, neighbour: number): number => {
    const h = to.x - from.x;
    return h ? ((3 * (to.y - from.y)) / h - neighbour) / 2 : neighbour;
  };
  if (count > 2) {
    tangents[0] = end(
      run[0] as ChartPoint,
      run[1] as ChartPoint,
      tangents[1] as number,
    );
    tangents[count - 1] = end(
      run[count - 2] as ChartPoint,
      run[count - 1] as ChartPoint,
      tangents[count - 2] as number,
    );
  }
  return tangents;
}

/** One unbroken run as a `d`: a move, then a straight segment (two points) or cubic pieces (three or more). */
function monotoneRun(run: readonly ChartPoint[]): string {
  const first = run[0];
  if (first === undefined) return '';
  let d = `M${px(first.x)} ${px(first.y)}`;
  if (run.length === 2) {
    const last = run[1] as ChartPoint;
    return `${d} L${px(last.x)} ${px(last.y)}`;
  }
  const tangents = monotoneTangents(run);
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i] as ChartPoint;
    const b = run[i + 1] as ChartPoint;
    const third = (b.x - a.x) / 3;
    const ta = tangents[i] as number;
    const tb = tangents[i + 1] as number;
    d +=
      ` C${px(a.x + third)} ${px(a.y + third * ta)}` +
      ` ${px(b.x - third)} ${px(b.y - third * tb)}` +
      ` ${px(b.x)} ${px(b.y)}`;
  }
  return d;
}

/**
 * THE `d` OF A SMOOTH LINE — a monotone cubic through every point
 * (Fritsch–Carlson, the maths of d3's `curveMonotoneX`): it passes through
 * each point and never overshoots between two of them, so a smoothed day
 * never reads as more (or less) than the days either side of it. The
 * points' x must run left to right. A `null` breaks the line as
 * {@link linePath} does; a run of two points is a straight segment, one a
 * lone move, nothing the empty string.
 */
export function monotonePath(points: readonly (ChartPoint | null)[]): string {
  let d = '';
  let run: ChartPoint[] = [];
  const flush = (): void => {
    const piece = monotoneRun(run);
    if (piece) d += `${d ? ' ' : ''}${piece}`;
    run = [];
  };
  for (const point of points) {
    if (point === null) flush();
    else run.push(point);
  }
  flush();
  return d;
}

/**
 * THE AREA UNDER A LINE — the line's own `d` (straight or smooth, as
 * drawn) closed down to `baseline` under its last point, back along it and
 * up to its first: the shape a wash fills. Empty for fewer than two points
 * (one point has no area). The line must be one unbroken run.
 */
export function areaPath(
  line: string,
  points: readonly ChartPoint[],
  baseline: number,
): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!line || first === undefined || last === undefined || points.length < 2) {
    return '';
  }
  const base = px(baseline);
  return `${line} L${px(last.x)} ${base} L${px(first.x)} ${base} Z`;
}
