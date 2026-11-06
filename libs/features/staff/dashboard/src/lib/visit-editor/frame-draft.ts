import { type DraftLegMinutes, VisitDraftSystem } from '@core/systems';
import type { DurationMinutes, TrackMinute } from '@core/primitives';

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
