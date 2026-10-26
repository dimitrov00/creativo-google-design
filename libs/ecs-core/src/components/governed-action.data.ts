import type { AuditAction } from './audit-context.data';

/**
 * The three verbs of a governed document write: created, updated, deleted
 * (audit-hardening WS-3). A verb subset of the {@link AuditAction}
 * dictionary, read from it member by member (the `ProfileAction`
 * precedent: its own file, it has readers outside `audit-context.data.ts`).
 */
export type GovernedAction =
  | typeof AuditAction.GovernedDocCreated
  | typeof AuditAction.GovernedDocUpdated
  | typeof AuditAction.GovernedDocDeleted;
