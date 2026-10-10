import { BookingStatus as BookingStatusData } from '@creativo/ecs-core';

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

function toStatusData(status: AppointmentStatus): BookingStatusData {
  return status.kind === 'cancelled'
    ? BookingStatusData.cancel(0, status.reason)
    : { kind: status.kind, atMs: 0 };
}

/**
 * A status with no outgoing transitions — a GRAPH question. `no_show` has
 * its correction edge, so it is not terminal although it is settled; ask
 * `isSettled` whether a visit should still appear in a live list.
 */
export function isTerminal(status: AppointmentStatus): boolean {
  return BookingStatusData.isTerminal(toStatusData(status));
}

/** The visit is over, whatever became of it — a LIFECYCLE question. */
export function isSettled(status: AppointmentStatus): boolean {
  return BookingStatusData.isSettled(toStatusData(status));
}

/** Whether `from.kind → to` is a legal lifecycle move. */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatusKind,
): boolean {
  return BookingStatusData.canTransition(toStatusData(from), to);
}
