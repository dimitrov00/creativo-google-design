import {
  type BookingDraftRider,
  type ScheduleSelection,
  carriedStartMs,
} from '@creativo/application/booking';

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
  const starts = selection.assignments.map((assignment) =>
    assignment.slot.start.toMillis(),
  );
  if (starts.length === 0) return [];
  const earliestMs = Math.min(...starts);
  return riders.map((rider) => ({
    rider,
    startMs: carriedStartMs(earliestMs, rider.offsetMinutes),
  }));
}
