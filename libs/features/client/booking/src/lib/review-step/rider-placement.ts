import type {
  BookingDraftRider,
  ScheduleSelection,
} from '@creativo/application/booking';
import {
  BarberId,
  type MoveRider,
  MoveSystem,
  ServiceId,
  type ServiceVariantId,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). Where each rider lands is
 * `MoveSystem.placeRiders` — the server's one shift, restated for the
 * review card. This keeps the legacy signature and only converts.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toRiderData(rider: BookingDraftRider): MoveRider {
  return {
    serviceId: ServiceId.of(rider.serviceId),
    variantId: rider.variantId as ServiceVariantId | null,
    barberId: BarberId.of(rider.barberId),
    offsetMinutes: rider.offsetMinutes,
    durationMinutes: rider.durationMinutes,
    setupMinutes: rider.setupMinutes,
    cleanupMinutes: rider.cleanupMinutes,
  };
}

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
  return MoveSystem.placeRiders(
    selection.assignments.map((assignment) => assignment.slot.start.toMillis()),
    riders.map(toRiderData),
  ).map((placed, index) => ({
    rider: riders.at(index) as BookingDraftRider,
    startMs: placed.startMs,
  }));
}
