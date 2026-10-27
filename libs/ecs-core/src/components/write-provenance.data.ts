import { OperationId, type StoredFields } from '@core/primitives';

/**
 * WHICH CALL LAST WROTE THIS DOCUMENT (audit-hardening WS-4.3, RU-29) — a
 * flat slice (Law 6) intersected into the entities a callable pipeline
 * writes: appointments and customers (L5: not `barberBusy`, a trigger's
 * projection). `writeOperationId` is the operation id of the last
 * booking-verb or registration callable that wrote the document — the join
 * key to its `callable.*` outcome line, its audit rows (`auditOperationId`)
 * and the attempt lines of the triggers it fanned out to. No uid: an
 * appointment is client-readable, and the writer's uid lives on the audit
 * row. `null` when the call sent none (or the write predates WS-4.3 as an
 * explicit null); never queried (its single-field index is off).
 */
export type WriteProvenance = {
  readonly writeOperationId: OperationId | null;
};

/** No provenance — a seed, a fixture, a write no callable operation made. */
const NO_PROVENANCE: WriteProvenance = { writeOperationId: null };

export const WriteProvenance = {
  /** No provenance — what seeds and fixtures spread (`...WriteProvenance.NONE`). */
  NONE: NO_PROVENANCE,

  /** The slice a callable write stamps: its operation id, or `null` when it carried none. */
  of(writeOperationId: OperationId | null): WriteProvenance {
    return writeOperationId === null ? NO_PROVENANCE : { writeOperationId };
  },

  /**
   * The read-time check of a stored slice (edge hardening D-1): the NAME
   * `writeOperationId` when its value is present and neither `null` nor an
   * `OperationId` (`OperationId.is` — not blank, no `/`, not reserved),
   * else `null`. ABSENT is valid: a document written before WS-4.3 carries
   * no such field (Law 5 — no backfill invents one). No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    if (!Object.hasOwn(raw, 'writeOperationId')) return null;
    const value = raw['writeOperationId'];
    return value === null || OperationId.is(value) ? null : 'writeOperationId';
  },
} as const;
