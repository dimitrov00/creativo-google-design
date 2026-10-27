import { AuditEntryId, Result } from '@core/primitives';
import { type GovernanceError, type RepositoryError } from '@core/errors';
import type { AuditEntry } from '@core/entities';
import type { AuditRowsPorts, ClockPorts, HashPorts } from '@core/ports';
import { type DocumentChange, GovernedChangeSystem } from '@core/systems';

/**
 * `auditDocumentChange` — the ONE handler behind every document-change
 * trigger (audit-hardening WS-3, RU-40; it replaces the profile-only handler):
 * every write of `users` and of the thirteen governed collections becomes
 * at most ONE audit row, whatever wrote it — a trigger rather than
 * instrumentation in each writer, so no writer can forget to log (L4: every
 * write, no skip). A users write plans exactly the row it planned before
 * (`AuditSystem.planProfileChange` — the changed field NAMES and the role /
 * status tags, and nothing for an edit `updateProfile` already audited in
 * its own transaction, `AuditSystem.auditedByCallable`); any other write a
 * `GOVERNED_DOC_*` row naming the collection and the changed fields — never
 * a value (R36). `GovernedChangeSystem.plan` decides which.
 *
 * Each row is credited to the WRITER the event's auth context names and
 * stamped with the event's own instant; its id is
 * `hash(rowBasis(…, changeKey = event.id))`, written with `create()`
 * (`createAuditRows`, ALREADY_EXISTS a success), so a redelivered event
 * writes nothing new and two writes are two rows. A write that changed no
 * audited field writes nothing. A refusal (an event with no id) is
 * permanent; a failed write is answered for the edge to judge (retry).
 */

export type AuditDocumentChangeCommand = DocumentChange;

/** How many rows this delivery wrote (or found already written) — `0` or `1`. */
export type AuditDocumentChangeAnswer = {
  readonly rows: number;
};

export type AuditDocumentChangePorts = AuditRowsPorts & HashPorts & ClockPorts;

export const auditDocumentChange =
  (ports: AuditDocumentChangePorts) =>
  async (
    cmd: AuditDocumentChangeCommand,
  ): Promise<
    Result<
      AuditDocumentChangeAnswer,
      GovernanceError.AuditEntryEmptyAction | RepositoryError
    >
  > => {
    const planned = GovernedChangeSystem.plan(cmd, ports.nowUtcMs());
    if (!planned.ok) return planned;
    if (planned.value === null) return Result.ok({ rows: 0 });
    const { row, idBasis } = planned.value;
    // A trigger row's basis is keyed by the event id (its change key,
    // RU-41); the row names no operation (`auditOperationId: null`).
    const id = AuditEntryId.of(ports.hash(idBasis));
    const entry: AuditEntry = { id, ...row };
    const written = await ports.createAuditRows([entry]);
    return written.ok ? Result.ok({ rows: 1 }) : written;
  };
