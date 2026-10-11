import type {
  BookingDraftRider,
  ScheduleSelection,
} from '@creativo/application/booking';
import { carriedStartMs } from '@creativo/domain/scheduling';

/*
 * THIN SHIM (ECS migration Phase 2). Where each rider lands on the review
 * card is the SERVER's shift, restated: until the booking-flow flip moves
 * the server's carried seat onto the shop's wall clock, the server writes it
 * with the domain's instant shift (`carriedStartMs`, `move-shift.ts`, as
 * `RescheduleBookingUseCase` writes it), so the card shifts by the same
 * instants — never by a wall-clock placement the server does not make, which
 * would name a different minute whenever a DST transition lies between the
 * anchor and the rider. Both sides move together, in the flip's commit.
 */

/** A rider, and the instant the server will seat them at. */
export interface PlacedRider {
  readonly rider: BookingDraftRider;
  readonly startMs: number;
}

/**
 * Where each rider lands when `selection` is committed as a move.
 *
 * Not arithmetic of its own: the domain's one shift (`carriedStartMs`) —
 * the same call the server writes the carried seat with
 * (`RescheduleBookingUseCase`) and the availability engine keeps the
 * rider's chair free by (`AvailabilityRider`). A carried seat lands its
 * stored distance from `Appointment.moveAnchor` after the selection's
 * earliest start. Sequential stays sequential, side by side stays side by
 * side, and the minute on the review card is the minute the server writes.
 *
 * Empty when there is nothing to anchor to — no assignments, no placement.
 */
export function placeRiders(
  selection: ScheduleSelection,
  riders: readonly BookingDraftRider[],
): readonly PlacedRider[] {
  const first = selection.assignments.at(0);
  if (first === undefined) return [];
  let earliestMs = first.slot.start.toMillis();
  for (const assignment of selection.assignments) {
    const startMs = assignment.slot.start.toMillis();
    if (startMs < earliestMs) earliestMs = startMs;
  }
  return riders.map((rider) => ({
    rider,
    startMs: carriedStartMs(earliestMs, rider.offsetMinutes),
  }));
}
