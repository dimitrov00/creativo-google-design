import { StoredFields } from '@core/primitives';
import { SeatIdPair } from './seat-id-pair.data';

/**
 * THE PAIRS A STAFF SAVE BROKE, REMEMBERED FOR ITS UNDO (round 6) — a flat
 * SLICE of the appointment (Law 6; was the nested, nullable
 * `stoodSeatPairs: { revision, pairs } | null` of
 * `appointment-document.ts:517-523`): the pairs, and the revision the
 * breaking save STAMPED. The revision is load-bearing: the memory is honoured
 * only while the visit is still at that revision, which closes the undo
 * window at the next revision-stamping write (a staff edit or a client move).
 * No memory is `stoodSeatPairsRevision: null` with `stoodSeatPairs: []`
 * (today's `null`); a memory is never empty. (Split out of
 * `seat-id-pair.data.ts`, pass D, L-1.)
 */
export type StoodSeatPairs = {
  readonly stoodSeatPairsRevision: number | null;
  readonly stoodSeatPairs: readonly SeatIdPair[];
};

const NO_MEMORY: StoodSeatPairs = {
  stoodSeatPairsRevision: null,
  stoodSeatPairs: [],
};

export const StoodSeatPairs = {
  /** No remembered pairs — what a visit holds until a save breaks one. */
  NONE: NO_MEMORY,

  /**
   * The read-time check of a stored memory (edge hardening D-1): the NAME of
   * the first field that is not well-formed — `stoodSeatPairsRevision` (a
   * non-negative safe integer, or `null` for no memory), then
   * `stoodSeatPairs` (an array whose every element is a record: what
   * {@link liveAt} hands an edit) — or `null`. The pairs' own fields are not
   * re-checked. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    const revision = raw['stoodSeatPairsRevision'];
    if (revision !== null && !StoredFields.isCount(revision)) {
      return 'stoodSeatPairsRevision';
    }
    return StoredFields.isRecordArray(raw['stoodSeatPairs'])
      ? null
      : 'stoodSeatPairs';
  },

  /** A save's memory: the canonical pairs under its revision, or {@link NONE} when it broke none. */
  remember(revision: number, pairs: readonly SeatIdPair[]): StoodSeatPairs {
    const normalized = SeatIdPair.normalize(pairs);
    return normalized.length === 0
      ? NO_MEMORY
      : { stoodSeatPairsRevision: revision, stoodSeatPairs: normalized };
  },

  /**
   * The remembered pairs an edit at `revision` may stand by: the memory's,
   * while the visit is still at the revision the breaking save stamped;
   * otherwise none. In-place writes that stamp no revision (arrival, a tip,
   * an outcome) leave the window open, by design (BA ruling 2026-09-26).
   */
  liveAt(memory: StoodSeatPairs, revision: number): readonly SeatIdPair[] {
    return memory.stoodSeatPairsRevision !== null &&
      memory.stoodSeatPairsRevision === revision
      ? memory.stoodSeatPairs
      : [];
  },
} as const;
