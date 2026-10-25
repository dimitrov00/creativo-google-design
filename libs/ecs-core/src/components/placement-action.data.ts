import type { AuditAction } from './audit-context.data';

/**
 * The two verbs that put an appointment in the book. A verb subset of the
 * {@link AuditAction} dictionary, read from it member by member (pass D,
 * D-7.2: its own file, it has readers outside `audit-context.data.ts`).
 */
export type PlacementAction =
  typeof AuditAction.BookingCommitted | typeof AuditAction.BookingStaffCreated;
