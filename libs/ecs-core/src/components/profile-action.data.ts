import type { AuditAction } from './audit-context.data';

/**
 * The three verbs of a `users/{uid}` write: created, updated, deleted. A
 * verb subset of the {@link AuditAction} dictionary, read from it member by
 * member (pass D, D-7.2: its own file, it has readers outside `audit-
 * context.data.ts`).
 */
export type ProfileAction =
  | typeof AuditAction.ProfileCreated
  | typeof AuditAction.ProfileUpdated
  | typeof AuditAction.ProfileDeleted;
