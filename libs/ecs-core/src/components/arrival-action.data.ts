import type { AuditAction } from './audit-context.data';

/**
 * The two verbs of the arrival callables: an arrival stamped, an arrival
 * taken back. A verb subset of the {@link AuditAction} dictionary, read from
 * it member by member (pass D, D-7.2: its own file, it has readers outside
 * `audit-context.data.ts`).
 */
export type ArrivalAction =
  | typeof AuditAction.BookingStaffArrived
  | typeof AuditAction.BookingStaffUnarrived;
