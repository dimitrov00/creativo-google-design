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
