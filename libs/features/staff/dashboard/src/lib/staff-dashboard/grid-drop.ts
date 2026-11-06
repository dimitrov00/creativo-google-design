import type { MinuteRange } from '@core/components';
import { GridLayoutSystem } from '@core/systems';
import {
  type FrameInterval,
  readableShiftOf,
} from '../visit-editor/frame-draft';
import type { VisitEditorVm } from '../visit-editor/staff-visit-editor';

/** Where a block dropped on the page grid goes. */
export const DropRoute = {
  /** Nothing moved: the block goes back down. */
  Stay: 'STAY',
  /** It saves on the spot, the receipt's «Отмени» the way back. */
  Save: 'SAVE',
  /** It needs a decision the gesture cannot make: the sheet opens on it. */
  Sheet: 'SHEET',
} as const;
export type DropRoute = (typeof DropRoute)[keyof typeof DropRoute];

/**
 * A DROP APPLIES ITSELF (owner, 2026-11-06: "auto apply with the toast, as
 * on save" — Google Calendar, Apple Calendar, Outlook): a move or a resize
 * released on the grid is saved where it landed, «Промените са запазени ·
 * Отмени» the way back. The sheet opens only for what a drag cannot say:
 * a span that runs into another visit or blocked time, or leaves the
 * chair's shift (`GridLayoutSystem.frameVerdict`, the sheet frame's own
 * verdict — its line then says which). A chair of a party saves like any
 * other (owner, 2026-11-06: "it still opens the sheet?"): its chairs keep
 * times of their own, and the sheet would save this one the same way.
 */
export function dropRouteOf(
  vm: VisitEditorVm,
  blocks: readonly MinuteRange[],
  frame: FrameInterval,
): DropRoute {
  if (
    frame.startMinute === vm.startMinute &&
    frame.endMinute === vm.endMinute
  ) {
    return DropRoute.Stay;
  }
  const occupied = [
    ...vm.neighbours,
    ...blocks.map((block) => ({
      startMinute: block.startMinutes,
      endMinute: block.endMinutes,
    })),
  ];
  const placed = GridLayoutSystem.frameVerdict(
    frame,
    occupied,
    readableShiftOf(vm),
  );
  return placed.placementVerdict === null ? DropRoute.Save : DropRoute.Sheet;
}
