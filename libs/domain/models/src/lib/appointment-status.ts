/**
 * A discriminated union, not a status string + a separate optional
 * `cancellationReason` field — `cancelled` structurally *carries* its
 * reason, so there is no reachable state where a non-cancelled appointment
 * has a dangling cancellation reason.
 */
export type AppointmentStatus =
  | { readonly kind: 'pending_deposit' }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'cancelled'; readonly reason: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'no_show' };

export const PENDING_DEPOSIT: AppointmentStatus = { kind: 'pending_deposit' };
export const CONFIRMED: AppointmentStatus = { kind: 'confirmed' };
export const COMPLETED: AppointmentStatus = { kind: 'completed' };
export const NO_SHOW: AppointmentStatus = { kind: 'no_show' };
export const cancelled = (reason: string): AppointmentStatus => ({
  kind: 'cancelled',
  reason,
});
