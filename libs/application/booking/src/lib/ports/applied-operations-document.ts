import {
  AppliedOperation as EcsAppliedOperation,
  AppointmentEditSystem,
} from '@creativo/ecs-core';
import type { PersistedDocument } from './appointment-document';

/**
 * THE APPLIED-OPERATIONS LEDGER'S PERSISTED SHAPE — the named writes a visit
 * remembers having applied, as `appointments/{id}.appliedOperations` holds
 * them. Defined HERE, beside `APPOINTMENT_DOCUMENT_FIELDS` and
 * `preservedAppointmentFields`, because its survival depends on them: it is
 * the one field on an appointment that lives by NOT being owned by the
 * appointment mapper.
 *
 * Two writers keep it, each inside its own write's transaction, so the
 * ledger can never name a write that did not land:
 * - `staffEditAppointment`, under the staff intent's `operationId`;
 * - `rescheduleAppointment` (`RescheduleBookingUseCase`), under
 *   `move:<attemptId>` for a client's named move.
 * The two kinds of id cannot collide: an `operationId` is
 * `isClientOperationId`-shaped and so never holds the colon. Only the
 * functions read it; the browser never sees it as a field. The digest of
 * an entry — the other half of the dedupe — stays with the server that
 * computes it (`operationDigest`), since hashing is not a persisted-shape
 * concern.
 */

/**
 * The document field the ledger lives in.
 *
 * NOT one of `APPOINTMENT_DOCUMENT_FIELDS`, on purpose: every `set()` of an
 * appointment carries the fields the mapper does not own forward through
 * `preservedAppointmentFields` (a client's move included), and every other
 * write is an `update()` that never touches it. So the ledger survives
 * whatever happens to the visit between an intent and its re-send — which
 * is the only window it exists for.
 *
 * Never queried, and exempt from indexing (`firestore.indexes.json`'s
 * `fieldOverrides`): up to `AppliedOperations.CAP` maps rewritten on every
 * named staff edit or move would otherwise be index entries nobody reads.
 */
export const APPLIED_OPERATIONS_FIELD = 'appliedOperations';

/** One named write the visit has already applied. */
export interface AppliedOperation {
  /**
   * The write's name: a staff intent's client-minted `operationId`
   * (`isClientOperationId`), or `move:<attemptId>` for a client's move.
   */
  readonly id: string;
  /** The revision it stamped — what a re-send of it is answered with. */
  readonly revision: number;
  /** A fingerprint of the batch it applied (the server's `operationDigest`). */
  readonly digest: string;
}

/** A stored entry, or `null` when it is not one — never a guess. */
function entryOf(raw: unknown): AppliedOperation | null {
  if (raw === null || typeof raw !== 'object') return null;
  const entry = new Map(Object.entries(raw));
  const id = entry.get('id');
  const revision = entry.get('revision');
  const digest = entry.get('digest');
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) return null;
  if (typeof digest !== 'string') return null;
  return { id, revision, digest };
}

/**
 * The named writes a visit remembers having applied — the server half of
 * "one staff intent, one change" (see `StaffEditAppointmentRequest.
 * operationId`) and of "one armed move, one move" (`RescheduleBookingRequest.
 * attemptId`).
 *
 * ### Why on the appointment, and why bounded
 * The dedupe has to be decided INSIDE the edit's transaction, from the read
 * that transaction already makes, and written by the same `set()` that
 * applies the edit — a separate document would need a read the store's plan
 * step cannot make, and a write outside the transaction is a window where
 * the edit landed and its name did not. A re-send follows its lost response
 * by seconds, so the ledger keeps only the most recent `CAP` intents: far
 * more than one sheet can send to one visit while a response is in flight,
 * and a few hundred bytes on a document that is read on every day sheet.
 *
 * Immutable: `record` returns a new ledger, oldest entries falling off.
 */
export class AppliedOperations {
  /** How many applied intents a visit remembers. */
  static readonly CAP: typeof EcsAppliedOperation.CAP = 20;

  private constructor(private readonly entries: readonly AppliedOperation[]) {}

  static empty(): AppliedOperations {
    return new AppliedOperations([]);
  }

  /**
   * The ledger as stored. Tolerant of any shape: a malformed entry costs
   * the ledger that one entry — a re-send of it is then applied as new —
   * never the edit.
   */
  static fromDocument(current: PersistedDocument): AppliedOperations {
    const raw = new Map(Object.entries(current)).get(APPLIED_OPERATIONS_FIELD);
    if (!Array.isArray(raw)) return AppliedOperations.empty();
    const entries: AppliedOperation[] = [];
    for (const item of raw) {
      const entry = entryOf(item);
      if (entry !== null) entries.push(entry);
    }
    return new AppliedOperations(entries.slice(-AppliedOperations.CAP));
  }

  /** The applied intent with this name, or `null` when it is not remembered. */
  find(id: string): AppliedOperation | null {
    return EcsAppliedOperation.find(this.entries, id);
  }

  /**
   * The ledger with `entry` as its newest intent. A name already present is
   * moved rather than kept twice (unreachable from the use case, which
   * answers a known name without writing), and the oldest fall off past
   * `CAP`.
   */
  record(entry: AppliedOperation): AppliedOperations {
    return new AppliedOperations(
      AppointmentEditSystem.record(
        this.entries,
        entry.id,
        entry.revision,
        entry.digest,
      ),
    );
  }

  /** Oldest first — the order `record` keeps. */
  toArray(): readonly AppliedOperation[] {
    return this.entries;
  }

  /** Plain maps, as Firestore stores them. */
  toDocument(): Record<string, unknown>[] {
    return this.entries.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      digest: entry.digest,
    }));
  }

  /**
   * The ledger as the FIELD a write carries —
   * `{ appliedOperations: [...] }`, ready to spread beside
   * `preservedAppointmentFields` in the same `set()`.
   */
  toFields(): PersistedDocument {
    return { [APPLIED_OPERATIONS_FIELD]: this.toDocument() };
  }
}
