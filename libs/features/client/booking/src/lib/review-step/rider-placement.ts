import type { MoveRider, ScheduleSelection } from '@core/components';
import { MoveSystem, type PlacedRider } from '@core/systems';

export type { PlacedRider };

/**
 * Where each rider lands when `selection` is committed as a move.
 *
 * Not arithmetic of its own: the move's one shift (`MoveSystem.placeRiders`)
 * — the same one the server seats the carried seat with
 * (`reschedule-appointment` pipeline) and the availability engine keeps the
 * rider's chair free by (`AvailabilityRider`). A carried seat lands its
 * stored wall-clock distance from the move anchor after the selection's
 * earliest start, on the ONE shop day the move lands on (`null` when that
 * distance would take it off the day, which the server refuses). Sequential
 * stays sequential, side by side stays side by side, and the minute on the
 * review card is the minute the server writes.
 *
 * The selection's starts ARE the shop's wall clock — minutes of its day.
 *
 * Empty when there is nothing to anchor to — no assignments, no placement.
 */
export function placeRiders(
  selection: ScheduleSelection,
  riders: readonly MoveRider[],
): readonly PlacedRider[] {
  return MoveSystem.placeRiders(selection.assignments, riders);
}
