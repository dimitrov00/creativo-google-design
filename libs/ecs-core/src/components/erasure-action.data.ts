import type { AuditAction } from './audit-context.data';

/**
 * The four verbs of a data-subject erasure (audit-hardening Phase 3 WS-D,
 * P3-RU-15, P3-RU-22): swept (the pre-stamp contact sweep's first commit —
 * the census BEFORE, P3-DEP-33), started (the stamp commit — the census
 * BEFORE), erased (the completion — the residue AFTER) and re-swept (an
 * erased record's sweep found residue — the census BEFORE it, P3-L-19). A verb
 * subset of the {@link AuditAction} dictionary, read from it member by
 * member (the `GovernedAction` precedent: its own file, it has readers
 * outside `audit-context.data.ts`).
 */
export type ErasureAction =
  | typeof AuditAction.PrivacyClientErasureSwept
  | typeof AuditAction.PrivacyClientErasureStarted
  | typeof AuditAction.PrivacyClientErased
  | typeof AuditAction.PrivacyClientErasureReswept;
