import { AuditEntryId, Result } from '@core/primitives';
import { type GovernanceError, type RepositoryError } from '@core/errors';
import type { AuditEntry } from '@core/entities';
import type { AuditRowsPorts, ClockPorts, HashPorts } from '@core/ports';
import { AuditSystem, type ProfileChange } from '@core/systems';

/**
 * `auditProfileChange` — every profile write becomes ONE audit row, whatever
 * wrote it (`audit-profile-changes.ts`, blueprint §4.1): a trigger rather
 * than instrumentation in each writer, so no writer can forget to log. The
 * one writer that audits itself is `updateProfile` (owner ruling flip-2
 * §10.15, Phase 4a 4A-16): its transaction writes the owner's row and moves
 * the user's `profileEditedAtUtcMs`, and an event whose stamp moved is
 * planned as nothing here (`AuditSystem.auditedByCallable`) — a creation
 * and a deletion never are.
 *
 * The row is `AuditSystem.planProfileChange`'s — the changed field NAMES only
 * (never from what to what), credited to the WRITER the event's auth context
 * names, stamped with the event's own instant — and its id is
 * `hash(rowBasis(…, changeKey = event.id))`: written with `create()`
 * (`createAuditRows`, ALREADY_EXISTS a success), so a redelivered event
 * writes nothing new and two edits are two rows. A write that changed no
 * audited field writes nothing. A refusal (an event with no id) is
 * permanent; a failed write is answered for the edge to judge (retry).
 */

export type AuditProfileChangeCommand = ProfileChange;

/** How many rows this delivery wrote (or found already written) — `0` or `1`. */
export type AuditProfileChangeAnswer = {
  readonly rows: number;
};

export type AuditProfileChangePorts = AuditRowsPorts & HashPorts & ClockPorts;

export const auditProfileChange =
  (ports: AuditProfileChangePorts) =>
  async (
    cmd: AuditProfileChangeCommand,
  ): Promise<
    Result<
      AuditProfileChangeAnswer,
      GovernanceError.AuditEntryEmptyAction | RepositoryError
    >
  > => {
    const planned = AuditSystem.planProfileChange(cmd, ports.nowUtcMs());
    if (!planned.ok) return planned;
    if (planned.value === null) return Result.ok({ rows: 0 });
    const { row, idBasis } = planned.value;
    // A profile row's basis is keyed by the event id (its change key, RU-41);
    // the row names no operation (`auditOperationId: null` — a trigger row).
    const id = AuditEntryId.of(ports.hash(idBasis));
    const entry: AuditEntry = { id, ...row };
    const written = await ports.createAuditRows([entry]);
    return written.ok ? Result.ok({ rows: 1 }) : written;
  };
