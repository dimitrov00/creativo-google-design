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
  // The ONE correction edge. A no-show is a judgement made at a moment, and
  // the moment it is most often wrong is the ten minutes right after it: the
  // client was in traffic, and the chair is still theirs. Reachable only
  // through `Appointment.reopenNoShow`, which also clears the seat outcomes
  // the stamp wrote — a status that walked back while its seats stayed
  // `no_show` would be a worse state than the one we are undoing.
  //
  // Deliberately NOT symmetric with `completed`, which stays terminal: a cut
  // that was delivered cannot become un-delivered, and money will hang off
  // it. This edge exists because a no-show is an ASSERTION ABOUT THE FUTURE
  // that can be falsified minutes later; a completed cut is a fact.
  no_show: ['confirmed'],
};

/**
 * A status with no outgoing transitions — a GRAPH question.
 *
 * Note this is no longer the same question as "is this visit over": since
 * the no-show correction edge exists, `no_show` has an outgoing transition
 * and is not terminal, yet it is certainly settled. Anything asking "should
 * this still appear in a live list" wants `isSettled`.
 */
export function isTerminal(status: AppointmentStatus): boolean {
  return TRANSITIONS[status.kind].length === 0;
}

/**
 * The visit is over, whatever became of it — a LIFECYCLE question.
 *
 * Split out from `isTerminal` when `no_show` gained its correction edge.
 * The two had been the same set, so readers used them interchangeably, and
 * adding one edge would otherwise have put no-showed bookings back into
 * clients' upcoming lists and pulled them out of history — from a change
 * that was only ever about letting staff take a stamp back.
 */
export function isSettled(status: AppointmentStatus): boolean {
  return (
    status.kind === 'completed' ||
    status.kind === 'cancelled' ||
    status.kind === 'no_show'
  );
}

/** Whether `from.kind → to` is a legal lifecycle move. */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatusKind,
): boolean {
  return TRANSITIONS[from.kind].includes(to);
}
