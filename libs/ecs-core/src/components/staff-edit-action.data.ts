import type { AuditAction } from './audit-context.data';

/**
 * The staff edit verbs — one per edit command, plus `EDIT` and `SAVE`. A
 * verb subset of the {@link AuditAction} dictionary, read from it member by
 * member (pass D, D-7.2: its own file, it has readers outside `audit-
 * context.data.ts`).
 */
export type StaffEditAction =
  | typeof AuditAction.BookingStaffMove
  | typeof AuditAction.BookingStaffResize
  | typeof AuditAction.BookingStaffReprice
  | typeof AuditAction.BookingStaffRedurate
  | typeof AuditAction.BookingStaffRestaff
  | typeof AuditAction.BookingStaffRelocate
  | typeof AuditAction.BookingStaffAddSeat
  | typeof AuditAction.BookingStaffRemoveSeat
  | typeof AuditAction.BookingStaffDiscounts
  | typeof AuditAction.BookingStaffVouchers
  | typeof AuditAction.BookingStaffEdit
  | typeof AuditAction.BookingStaffSave;
