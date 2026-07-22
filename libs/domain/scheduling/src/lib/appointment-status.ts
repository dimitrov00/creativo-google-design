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
 *   - `no_show`   — the subject did not turn up (terminal). Only
 *                   assignable when the appointment is reachable — enforced
 *                   by `Appointment.markNoShow`, not here (this module only
 *                   knows about the `kind` lifecycle graph).
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

/**
 * Legal forward transitions. Terminal states map to `[]`. This is the
 * single source of truth for the lifecycle graph — `Appointment`'s
 * transition methods (`confirm()`/`cancel()`/`complete()`/`markNoShow()`)
 * all defer to `canTransition` rather than re-encoding the graph.
 */
const TRANSITIONS: Record<
  AppointmentStatusKind,
  readonly AppointmentStatusKind[]
> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** A status with no outgoing transitions. */
export function isTerminal(status: AppointmentStatus): boolean {
  return TRANSITIONS[status.kind].length === 0;
}

/** Whether `from.kind → to` is a legal lifecycle move. */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatusKind,
): boolean {
  return TRANSITIONS[from.kind].includes(to);
}
