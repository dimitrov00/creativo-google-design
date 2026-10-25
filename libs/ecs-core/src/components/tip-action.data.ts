import type { AuditAction } from './audit-context.data';

/**
 * The two verbs of the tip callable: a tip recorded, a tip cleared. A verb
 * subset of the {@link AuditAction} dictionary, read from it member by
 * member (pass D, D-7.2: its own file, it has readers outside `audit-
 * context.data.ts`).
 */
export type TipAction =
  typeof AuditAction.BookingTipRecorded | typeof AuditAction.BookingTipCleared;
