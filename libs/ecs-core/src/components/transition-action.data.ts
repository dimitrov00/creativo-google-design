import type { AuditAction } from './audit-context.data';

/**
 * The staff lifecycle verbs of the transition callable. A verb subset of the
 * {@link AuditAction} dictionary, read from it member by member (pass D,
 * D-7.2: its own file, it has readers outside `audit-context.data.ts`).
 */
export type TransitionAction =
  | typeof AuditAction.BookingStaffConfirmed
  | typeof AuditAction.BookingStaffCompleted
  | typeof AuditAction.BookingStaffNoShow
  | typeof AuditAction.BookingStaffCancelled
  | typeof AuditAction.BookingStaffReopenNoShow
  | typeof AuditAction.BookingStaffReopenCompleted
  | typeof AuditAction.BookingStaffReinstate;
