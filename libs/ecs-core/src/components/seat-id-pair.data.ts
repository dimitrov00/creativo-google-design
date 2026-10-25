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
