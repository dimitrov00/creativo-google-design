/**
 * THE GEOMETRY SYSTEM'S BOUNDARY (flatten pass; shared by the time grid and
 * the chair timeline since pass C, Y-16).
 *
 * `GridLayoutSystem` reads ONE shop day's track as branded minutes
 * (`MinuteOfDay` starts in `[0, 1440)`, `EndMinute` ends in `(0, 1440]`) and
 * tags a block by `gridEvent` (SCREAMING), the same tag the frames' own
 * `GridEvent` carries. The frames keep their `startMinute` / `endMinute`
 * on the anchored track axis (`TrackMinute`, which may reach 1440 and pass
 * it); the figures they draw are whole minutes of the column's day by
 * construction (a visit never crosses midnight, F-6), so the conversion
 * clamps onto the day rather than inventing a figure the track does not
 * have.
 *
 * NOT for a drafted block's verdict: `GridLayoutSystem.placementVerdict`
 * takes RAW track minutes (`TrackSpan`), because a clamp at 1440 would flip
 * `SHORT` and `OUTSIDE` past midnight (pass C, R-6).
 */

import { EndMinute, MinuteOfDay, TrackMinute } from '@core/primitives';
import { GridLayoutSystem, type MinuteRun } from '@core/systems';

/** A minute of the track as a start, clamped onto the day — proven, so no `Result` per drag tick. */
export function trackStart(minute: TrackMinute): MinuteOfDay {
  return MinuteOfDay.ofProven(Math.min(1439, Math.max(0, Math.round(minute))));
}

/** A minute of the track as an exclusive end, clamped onto the day — proven, so no `Result` per drag tick. */
export function trackEnd(minute: TrackMinute): EndMinute {
  return EndMinute.ofProven(Math.min(1440, Math.max(1, Math.round(minute))));
}

/** A stretch of the track — an open window, a laid block — as the system's run. */
export function toMinuteRun(stretch: {
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
}): MinuteRun {
  return {
    startMinutes: trackStart(stretch.startMinute),
    endMinutes: trackEnd(stretch.endMinute),
  };
}

/**
 * The stretches of the drawn span `[start, end)` that fall OUTSIDE a
 * column's working windows — `GridLayoutSystem.closedRuns` (the windows
 * clamped to the span, sorted, merged, complemented) on the span's own
 * bounds read as the track's. Each frame turns the runs into its own boxes.
 */
export function closedMinuteRuns(
  open: readonly MinuteRun[],
  start: TrackMinute,
  end: TrackMinute,
): readonly MinuteRun[] {
  return GridLayoutSystem.closedRuns(open, trackStart(start), trackEnd(end));
}
