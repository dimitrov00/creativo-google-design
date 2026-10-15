import {
  AuditEntryId,
  type GovernanceError,
  type RepositoryError,
  Result,
} from '@core/primitives';
import type { AuditEntry } from '@core/entities';
import type { GovernancePorts, TxPorts } from '@core/ports';
import { AuditSystem, type ProfileChange } from '@core/systems';

/**
 * `auditProfileChange` — every profile write becomes ONE audit row, whatever
 * wrote it (`audit-profile-changes.ts`, blueprint §4.1): the only profile
 * auditor, a trigger rather than instrumentation in each writer, because one
 * of the writers is the browser and a client cannot be trusted to log its
 * own acts.
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

export type AuditProfileChangePorts = Pick<GovernancePorts, 'createAuditRows'> &
  Pick<TxPorts, 'nowUtcMs' | 'hash'>;

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
    // A profile row always has its basis: the event id is its change key.
    const id = AuditEntryId.of(ports.hash(idBasis ?? cmd.eventId));
    const entry: AuditEntry = { id, ...row };
    const written = await ports.createAuditRows([entry]);
    return written.ok ? Result.ok({ rows: 1 }) : written;
  };
