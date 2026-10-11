import type { OperationId } from '../primitives/ids.primitive';

/**
 * One staff edit the visit has already applied — an element of the stored
 * `appointments.appliedOperations[]` array (a true 1-to-N list; its
 * single-field indexes are off, `firestore.indexes.json`). A replayed
 * operation id finds its own entry and is a no-op when its digest matches;
 * the ledger keeps only the most recent {@link AppliedOperation.CAP}.
 */
export type AppliedOperation = {
  /** The client-minted operation id (was `id`, N10). */
  readonly operationId: OperationId;
  /** The revision the operation stamped. */
  readonly revision: number;
  /** The canonical digest of its command batch (`hash(digestBasis)`). */
  readonly digest: string;
};

export const AppliedOperation = {
  /** The ledger's length cap — the oldest entries fall off first. */
  CAP: 20,

  /** The entry for `operationId`, or `null`. */
  find(
    ledger: readonly AppliedOperation[],
    operationId: OperationId,
  ): AppliedOperation | null {
    for (let i = 0; i < ledger.length; i++) {
      const entry = ledger[i] as AppliedOperation;
      if (entry.operationId === operationId) return entry;
    }
    return null;
  },

  /**
   * The ledger with `entry` recorded last: an older entry under the same id
   * is replaced (moved to the end), and the result keeps only the newest
   * {@link CAP} entries. A new array; the input is untouched.
   */
  append(
    ledger: readonly AppliedOperation[],
    entry: AppliedOperation,
  ): readonly AppliedOperation[] {
    const kept: AppliedOperation[] = [];
    for (let i = 0; i < ledger.length; i++) {
      const known = ledger[i] as AppliedOperation;
      if (known.operationId !== entry.operationId) kept.push(known);
    }
    kept.push(entry);
    return kept.length > AppliedOperation.CAP
      ? kept.slice(kept.length - AppliedOperation.CAP)
      : kept;
  },
} as const;
