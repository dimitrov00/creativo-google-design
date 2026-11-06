import { type DraftLegMinutes, VisitDraftSystem } from '@core/systems';
import {
  type DurationMinutes,
  EndMinute,
  MinuteOfDay,
  type TrackMinute,
} from '@core/primitives';

/** A frame's interval — a drag in the sheet's frame, or one dropped on the page grid. */
export interface FrameInterval {
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
}

/**
 * A frame's interval laid on a draft — the move's start, and the resize's
 * span pinned as the duration override. Floored at one grain, never
 * snapped: the grid drew on the grain (`VisitDraftSystem.floorSpan`).
 *
 * A move or resize DROPPED ON THE PAGE GRID (owner, 2026-11-06: "move it
 * and/or expand it on the calendar") seeds the sheet's draft through this
 * too: it opens dirty, «Запази» keeps it and ✕ asks before it is dropped —
 * the footing a drag in the sheet's own frame has had since 2026-09-23.
 *
 * ⚠ There is no `endMinute` FIELD to write. The end is derived from
 * `durationOverride ?? legs`, so a resize pins the duration and a move
 * leaves it alone — writing a phantom field made every resize snap back to
 * the services' sum and re-emit from the grid. Which span pins is the
 * frame's rule (`VisitDraftSystem.overrideFor`). The same draft comes back
 * when nothing moved: a redundant write is a redundant render, and a
 * redundant render mid-gesture is how a loop starts.
 */
export function withFrame<
  D extends {
    readonly startMinute: TrackMinute;
    readonly durationOverride: DurationMinutes | null;
    readonly legs: readonly DraftLegMinutes[];
  },
>(current: D, frame: FrameInterval): D {
  const span = VisitDraftSystem.floorSpan(frame.endMinute - frame.startMinute);
  const overrideNow = VisitDraftSystem.overrideFor(span, current.legs);
  if (
    current.startMinute === frame.startMinute &&
    current.durationOverride === overrideNow
  ) {
    return current;
  }
  return {
    ...current,
    startMinute: frame.startMinute,
    durationOverride: overrideNow,
  };
}

/** The chair's rostered window on the frame's day, as the frame reads it. */
export interface RosterDay {
  readonly rosterStartMinute: TrackMinute;
  readonly rosterEndMinute: TrackMinute;
}

/**
 * THE CHAIR'S SHIFT, or `null` when the roster cannot say.
 *
 * One reading, shared by the window, the closed-hour shading and the
 * outside-the-shift verdict, because three different readings of the same
 * two numbers is how a frame ends up drawn shut over a visit it is happily
 * editing. `null` means "no usable shift": an end at or below the start,
 * which is what a shift closing at midnight becomes when it is read as a
 * wall-clock minute without being anchored to the day.
 */
export function shiftOf(
  day: RosterDay,
): { startMinute: TrackMinute; endMinute: TrackMinute } | null {
  return day.rosterEndMinute > day.rosterStartMinute
    ? { startMinute: day.rosterStartMinute, endMinute: day.rosterEndMinute }
    : null;
}

/**
 * The shift as ONE shop day's range — the frame verdict's edge parse:
 * `null` for a pair `shiftOf` cannot read (inverted, empty) or one off the
 * day's clock (a start outside `MinuteOfDay`, an end outside `EndMinute`) —
 * no roster a visit can be OUTSIDE of.
 */
export function readableShiftOf(
  day: RosterDay,
): { startMinute: TrackMinute; endMinute: TrackMinute } | null {
  const shift = shiftOf(day);
  return shift !== null &&
    MinuteOfDay.of(shift.startMinute).ok &&
    EndMinute.of(shift.endMinute).ok
    ? shift
    : null;
}
