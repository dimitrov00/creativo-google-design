import type { MinuteRange } from '@core/components';
import { type BarberId, type LocalDate, MinuteOfDay } from '@core/primitives';
import { IntervalSetSystem } from '@core/systems';
import type { BlockEditorLane } from '../block-editor/staff-block-editor';
import type { BarberDayLane, StaffDayCell } from '../staff-day.store';
import { occupantNeighbours, occupyingRows } from './staff-day.presenter';
import type { LaneVm, StaffDayWords } from './staff-day.vm';

const MIDNIGHT = MinuteOfDay.ofProven(0);

/** The roster's outer window — NO ROSTER IS A SHUT DAY (midnight to midnight), never an open one. */
function windowsOf(rostered: readonly MinuteRange[]) {
  const roster = IntervalSetSystem.hull(rostered);
  return {
    rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
    rosterEndMinute: roster?.endMinutes ?? MIDNIGHT,
  };
}

/**
 * One chair's real day for the block sheet's frame: the agenda's own rows
 * on the shown day, the probe's documents on any other — the same two
 * sources `visitFrameDay` reads, for the same reason. A chair standing
 * down all day draws as a shut day, not one free from midnight to midnight.
 */
export function blockLaneOf(input: {
  readonly barberId: BarberId;
  readonly frameDay: LocalDate;
  readonly shownDay: LocalDate;
  /** The shown day's drawn lanes and the store's own. */
  readonly lanes: readonly LaneVm[];
  readonly storeLanes: readonly BarberDayLane[];
  /** The frame day's probed cell, when it is not the shown day. */
  readonly cell: StaffDayCell | null;
  readonly tone: number;
  readonly words: StaffDayWords;
}): BlockEditorLane {
  const { barberId } = input;
  if (input.frameDay === input.shownDay) {
    const lane = input.lanes.find((entry) => entry.barberId === barberId);
    const storeLane = input.storeLanes.find(
      (entry) => entry.barberId === barberId,
    );
    return {
      barberId,
      // What occupies the chair — the server's rule (DEP-2).
      neighbours: occupyingRows(lane, storeLane?.appointments ?? [], null),
      ...windowsOf(storeLane?.rostered ?? []),
    };
  }
  const draftLane = input.cell?.lanes.find(
    (entry) => entry.barberId === barberId,
  );
  return {
    barberId,
    neighbours: occupantNeighbours(
      draftLane?.appointments ?? [],
      barberId,
      null,
      input.tone,
      input.words,
    ),
    ...windowsOf(draftLane?.rostered ?? []),
  };
}
