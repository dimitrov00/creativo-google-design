import type { Actor, AuditContext, AuditTargetRef } from '@core/components';
import type {
  AuditEntryId,
  AuditResourceId,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The identity slice of an audit row: its id — `hash(AuditSystem.rowBasis(…))`,
 * derived by the pipeline from the verb's change key, never from the row
 * body, so a retried attempt derives the same id and `create()` writes it
 * once (blueprint §2.6) — when it was recorded, and the resource the act
 * changed (`appointments` id, `users/{uid}`, `streakDefinitions/{id}` — the
 * {@link AuditResourceId} spellings). The verb is NOT here: `auditAction` is
 * the {@link AuditContext} slice's discriminator alone (Law 6.3).
 */
export type AuditEntryMeta = {
  readonly id: AuditEntryId;
  readonly recordedAtUtcMs: UtcEpochMs;
  readonly resourceId: AuditResourceId;
};

/**
 * One append-only "who did what to whom, when" row — `auditLog/{id}`, flat
 * (Law 6; flatten-spec §3.7): the meta, the actor (`actorRole` and its
 * prefixed fields), the context (`auditAction` and its prefixed facts) and
 * the target (`auditTarget` and its id) slices, their key sets pairwise
 * disjoint (`audit-entry.entity.type-spec.ts`). The document body is this
 * type minus `id`; until the governance flip the stored bytes were the
 * legacy ones (`actor`, `action`, `at`, `targetUserId`, `context`), which
 * the legacy shims converted.
 * A correction is a fresh row, never an edit.
 */
export type AuditEntry = AuditEntryMeta & Actor & AuditContext & AuditTargetRef;
