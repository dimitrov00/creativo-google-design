import type { MinuteRange } from '@core/components';
import {
  BarberId,
  LocalDate,
  type LocationId,
  type TrackMinute,
} from '@core/primitives';
import { type BlockSavePlan, GridLayoutSystem } from '@core/systems';
import { minuteRangeOf } from './staff-day-save';
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
  /** It cannot land there: it goes back down, and the toast says why. */
  Refuse: 'REFUSE',
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

/** A block's chair and day, off its grid key (`block:<chair>:<day>:<start>`, read from its end so the chair is taken whole). */
export function blockKeyOf(
  id: string,
): { readonly barberId: BarberId; readonly localDate: LocalDate } | null {
  if (!id.startsWith('block:')) return null;
  const parts = id.split(':');
  const day = LocalDate.parse(parts.at(-2) ?? '');
  const chair = parts.slice(1, -2).join(':');
  return day.ok && chair !== ''
    ? { barberId: BarberId.of(chair), localDate: day.value }
    : null;
}

/** A span on the grid's minute track. */
type Span = {
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
};

/** What a block dropped on the grid does — and, when it saves, the move and its way back. */
export type BlockDrop = {
  readonly route: DropRoute;
  readonly move: BlockSavePlan | null;
  readonly back: BlockSavePlan | null;
};

/**
 * BLOCKED TIME MOVES LIKE A VISIT (owner, 2026-11-06: "a block and a break
 * are the same — easy to move"): a break or an admin hour dropped on the
 * grid saves where it landed — the block sheet's own edit, lift the old
 * range and write the new in ONE write (`moveScheduleBlock`) — and its way
 * back is the same move reversed. It may sit over a visit (the grid hatches
 * it, as the block sheet does: blocking over a booking is the desk's call),
 * but never on the chair's other blocked time that day: the two would MERGE
 * into one range, and the way back could not part them again — it goes back
 * down, said. A chair with no shop to file it at is the store's refusal.
 */
export function blockDropOf(input: {
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly from: Span;
  readonly to: Span;
  /** The chair's other blocks that day. */
  readonly others: readonly Span[];
  readonly locationId: LocationId | null;
}): BlockDrop {
  const { barberId, localDate, from, to } = input;
  const stay = { move: null, back: null };
  if (from.startMinute === to.startMinute && from.endMinute === to.endMinute) {
    return { route: DropRoute.Stay, ...stay };
  }
  if (
    GridLayoutSystem.frameVerdict(to, input.others, null).placementVerdict !==
    null
  ) {
    return { route: DropRoute.Refuse, ...stay };
  }
  const was = minuteRangeOf(from.startMinute, from.endMinute);
  const now = minuteRangeOf(to.startMinute, to.endMinute);
  if (was === null || now === null) return { route: DropRoute.Stay, ...stay };
  const plan = (lift: MinuteRange, write: MinuteRange): BlockSavePlan =>
    input.locationId === null
      ? { lift: null, writes: null, chairWithoutHome: barberId }
      : {
          lift: { barberId, range: lift, localDate },
          writes: [
            {
              barberId,
              locationId: input.locationId,
              ranges: [write],
              localDate,
              days: [localDate],
            },
          ],
          chairWithoutHome: null,
        };
  return { route: DropRoute.Save, move: plan(was, now), back: plan(now, was) };
}
