import type { Actor } from '../components/actor.data';
import type {
  AuditAction,
  AuditContext,
} from '../components/audit-context.data';
import type { UserId } from './user.entity';

/**
 * An audit row's id — `hash(AuditSystem.rowBasis(action, resourceId,
 * targetUserId, changeKey))`, derived by the pipeline from the verb's change
 * key, never from the row body, so a retried attempt derives the same id and
 * `create()` writes it once (blueprint §2.6).
 */
export type AuditEntryId = string & { readonly __brand: unique symbol };

export const AuditEntryId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): AuditEntryId => raw as AuditEntryId,
} as const;

/**
 * One append-only "who did what to whom, when" row — the stored body of
 * `audit-log-document.ts:41-52` (blueprint §2.6), `at` as epoch ms. The
 * document body is this type minus `id`.
 *
 * Declared change: `context` is a `kind`-discriminated union with every
 * field present per variant (`null` for n/a) instead of an open string bag;
 * its `kind` repeats `action`. A correction is a fresh row, never an edit.
 */
export type AuditEntryEntity = {
  readonly id: AuditEntryId;
  readonly actor: Actor;
  readonly action: AuditAction;
  readonly atMs: number;
  /** The person whose record was affected — one row per person; `null` when the act touched no account. */
  readonly targetUserId: UserId | null;
  /** The path or id of the resource the act changed (`appointments` id, `users/{uid}`, …). */
  readonly resourceId: string;
  readonly context: AuditContext;
};
