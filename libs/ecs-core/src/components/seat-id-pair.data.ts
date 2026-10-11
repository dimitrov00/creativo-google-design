import type { SeatId } from '@core/primitives';

/**
 * Two seats of one visit, by id, that seat one person twice at once —
 * unordered in meaning, stored in id order (`seatId < otherSeatId`). A
 * STRUCT, not the legacy `[seatId, otherSeatId]` tuple (`person-slot.ts:117`):
 * it is the element of `appointments.stoodSeatPairs[]`.
 *
 * Identity, not position: a pair the visit already held may keep overlapping
 * through any edit that keeps both seats' ids (round 5), because a position
 * is exactly what an edit changes.
 */
export type SeatIdPair = {
  readonly seatId: SeatId;
  readonly otherSeatId: SeatId;
};

export const SeatIdPair = {
  /** The pair in id order — one spelling per unordered pair. */
  ordered(a: SeatId, b: SeatId): SeatIdPair {
    return a < b
      ? { seatId: a, otherSeatId: b }
      : { seatId: b, otherSeatId: a };
  },

  /** The same two seats, in either order. */
  equals(a: SeatIdPair, b: SeatIdPair): boolean {
    return (
      (a.seatId === b.seatId && a.otherSeatId === b.otherSeatId) ||
      (a.seatId === b.otherSeatId && a.otherSeatId === b.seatId)
    );
  },

  /** Sort order of ordered pairs: by `seatId`, then `otherSeatId`. */
  compare(a: SeatIdPair, b: SeatIdPair): number {
    if (a.seatId !== b.seatId) return a.seatId < b.seatId ? -1 : 1;
    if (a.otherSeatId !== b.otherSeatId) {
      return a.otherSeatId < b.otherSeatId ? -1 : 1;
    }
    return 0;
  },

  /**
   * Pairs as a caller remembers them → the canonical set: each in id order,
   * a seat paired with itself dropped (it could only ever exempt a seat from
   * nothing), duplicates dropped, sorted — a stable shape to persist.
   */
  normalize(pairs: readonly SeatIdPair[]): readonly SeatIdPair[] {
    const out: SeatIdPair[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i] as SeatIdPair;
      if (pair.seatId === pair.otherSeatId) continue;
      const ordered = SeatIdPair.ordered(pair.seatId, pair.otherSeatId);
      let known = false;
      for (let k = 0; k < out.length; k++) {
        if (SeatIdPair.compare(out[k] as SeatIdPair, ordered) === 0) {
          known = true;
          break;
        }
      }
      if (!known) out.push(ordered);
    }
    out.sort(SeatIdPair.compare);
    return out;
  },
} as const;

/**
 * THE PAIRS A STAFF SAVE BROKE, REMEMBERED FOR ITS UNDO (round 6) — a flat
 * SLICE of the appointment (Law 6; was the nested, nullable
 * `stoodSeatPairs: { revision, pairs } | null` of
 * `appointment-document.ts:517-523`): the pairs, and the revision the
 * breaking save STAMPED. The revision is load-bearing: the memory is honoured
 * only while the visit is still at that revision, which closes the undo
 * window at the next revision-stamping write (a staff edit or a client move).
 * No memory is `stoodSeatPairsRevision: null` with `stoodSeatPairs: []`
 * (today's `null`); a memory is never empty.
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
