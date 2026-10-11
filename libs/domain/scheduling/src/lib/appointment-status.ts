import {
  BookingLifecycle,
  BookingStatus,
  CancellationReasonSet,
  UtcEpochMs,
  defect,
} from '@creativo/ecs-core';

/**
 * Lifecycle status of an `Appointment`. A discriminated union (not a status
 * string plus a separate optional `cancellationReason` field) — `cancelled`
 * structurally *carries* its reason, so there is no reachable state where a
 * non-cancelled appointment has a dangling cancellation reason (see
 * `docs/architecture/domain-model.md`'s `Appointment` section).
 *
 *   - `pending`   — awaiting confirmation (the gate before a slot holds).
 *   - `confirmed` — holds the slot.
 *   - `completed` — the service happened (terminal).
 *   - `cancelled` — called off by either side (terminal), reason attached.
 *   - `no_show`   — the subject did not turn up. Only assignable when the
 *                   appointment is reachable — enforced by
 *                   `Appointment.markNoShow`, not here (this module only
 *                   knows about the `kind` lifecycle graph). NOT terminal:
 *                   the client who walks in ten minutes late is the most
 *                   ordinary correction a shop makes, and the stamp has to
 *                   be takeable back. See `reopenNoShow`.
 */
export type AppointmentStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'completed' }
  | { readonly kind: 'cancelled'; readonly reason: string }
  | { readonly kind: 'no_show' };

export type AppointmentStatusKind = AppointmentStatus['kind'];

export const PENDING: AppointmentStatus = { kind: 'pending' };
export const CONFIRMED: AppointmentStatus = { kind: 'confirmed' };
export const COMPLETED: AppointmentStatus = { kind: 'completed' };
export const NO_SHOW: AppointmentStatus = { kind: 'no_show' };

export function cancelled(reason: string): AppointmentStatus {
  return { kind: 'cancelled', reason };
}

/*
 * THIN SHIM (ECS migration Phase 2). The lifecycle graph — the ONE source of
 * truth for which move is legal (`pending → confirmed | cancelled`,
 * `confirmed → completed | cancelled | no_show`, the single correction edge
 * `no_show → confirmed`, `completed`/`cancelled` terminal) — is the ECS
 * `BookingStatus` companion. These functions keep the legacy signatures and
 * only convert (the legacy status carries no instant; the graph reads none).
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** The stored lower-case tag → the ecs-core `BookingStatus` (flatten-spec §8.9). */
const LEGACY_BOOKING_STATUS = {
  pending: BookingStatus.Pending,
  confirmed: BookingStatus.Confirmed,
  completed: BookingStatus.Completed,
  no_show: BookingStatus.NoShow,
  cancelled: BookingStatus.Cancelled,
} as const satisfies Record<AppointmentStatusKind, BookingStatus>;

/** The graph reads no instant; the legacy status carries none. */
function noInstant(): UtcEpochMs {
  const epoch = UtcEpochMs.of(0);
  // Unreachable: the epoch is an instant.
  if (!epoch.ok) defect('unreachable: the epoch');
  return epoch.value;
}

/** A legacy tag as the ecs-core `BookingStatus` — the shims' one door for it. */
export function toEcsBookingStatus(kind: AppointmentStatusKind): BookingStatus {
  return LEGACY_BOOKING_STATUS[kind];
}

/**
 * A legacy status as the ecs-core lifecycle slice (Phase 4 deletes it). The
 * legacy status carries no instant, so every entering stamp is the epoch —
 * read by no graph, guard or roll-up; a cancellation's reason rides verbatim
 * as the stored set.
 */
export function toEcsLifecycle(status: AppointmentStatus): BookingLifecycle {
  const at = noInstant();
  switch (status.kind) {
    case 'pending':
      return BookingLifecycle.pending(at);
    case 'confirmed':
      return BookingLifecycle.confirm(at);
    case 'completed':
      return BookingLifecycle.complete(at);
    case 'no_show':
      return BookingLifecycle.noShow(at);
    case 'cancelled':
      return BookingLifecycle.cancel(
        at,
        CancellationReasonSet.fromStored(status.reason),
      );
  }
}

/**
 * A status with no outgoing transitions — a GRAPH question. `no_show` has
 * its correction edge, so it is not terminal although it is settled; ask
 * `isSettled` whether a visit should still appear in a live list.
 */
export function isTerminal(status: AppointmentStatus): boolean {
  return BookingLifecycle.isTerminal(toEcsLifecycle(status));
}

/** The visit is over, whatever became of it — a LIFECYCLE question. */
export function isSettled(status: AppointmentStatus): boolean {
  return BookingLifecycle.isSettled(toEcsLifecycle(status));
}

/** Whether `from.kind → to` is a legal lifecycle move. */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatusKind,
): boolean {
  return BookingLifecycle.canTransition(
    toEcsLifecycle(from),
    LEGACY_BOOKING_STATUS[to],
  );
}
