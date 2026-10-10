/**
 * One staff edit the visit has already applied — the stored
 * `appointments.appliedOperations[]` triple (`applied-operations-document.ts`;
 * the field's single-field indexes are off, `firestore.indexes.json`). A
 * replayed operation id finds its own entry and is a no-op when its digest
 * matches; the ledger keeps only the most recent {@link AppliedOperation.CAP}.
 */
export type AppliedOperation = {
  /** The client-minted operation id. */
  readonly id: string;
  /** The revision the operation stamped. */
  readonly revision: number;
  /** The canonical digest of its command batch (`hash(digestBasis)`). */
  readonly digest: string;
};

export const AppliedOperation = {
  /** The ledger's length cap — the oldest entries fall off first. */
  CAP: 20,

  /** The entry for `id`, or `null`. */
  find(
    ledger: readonly AppliedOperation[],
    id: string,
  ): AppliedOperation | null {
    for (let i = 0; i < ledger.length; i++) {
      const entry = ledger[i] as AppliedOperation;
      if (entry.id === id) return entry;
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
      if (known.id !== entry.id) kept.push(known);
    }
    kept.push(entry);
    return kept.length > AppliedOperation.CAP
      ? kept.slice(kept.length - AppliedOperation.CAP)
      : kept;
  },
} as const;
