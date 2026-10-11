import { SeatIdPair } from '../components/seat-id-pair.data';
import type { SeatId } from '../primitives/ids.primitive';
import { StandingSeatPair } from '../components/standing-seat.data';

/**
 * A SOLD span, its person, and WHICH SEAT it is — a visit's unit of people
 * (`person-slot.ts:46-48`, the legacy `SeatSlot`). A `StandingSeatPair` with
 * the seat's identity beside it, because the standing rule below remembers
 * pairs by seat id, never by position.
 */
export type SeatedSpan = StandingSeatPair & { readonly seatId: SeatId };

/** Is `id` one of the ordered pair's two seats, paired with `other`? */
function pairIs(pair: SeatIdPair, a: SeatId, b: SeatId): boolean {
  return (
    (pair.seatId === a && pair.otherSeatId === b) ||
    (pair.seatId === b && pair.otherSeatId === a)
  );
}

/**
 * SeatingRuleSystem — "one person, one chair at a time" (owner decision
 * 2026-09-25; `person-slot.ts:85`, `availability.ts:583`,
 * `decide-booking.ts:827-829`), and the double seatings a visit already
 * HOLDS, by seat identity (owner decision round 5; the remembered pairs of
 * round 6).
 *
 * THE rule lives in one place: the availability engine asks it of every
 * placement it tries and the booking decision of every seat a request
 * names, so a grid can never offer an arrangement the server refuses for
 * this reason, nor the other way round. Spans are the SOLD minutes — a
 * barber's setup and cleanup are the barber's, not the client's — and
 * half-open, so back to back is one person walking across the room.
 *
 * The standing pairs are plain data: a normalized `readonly SeatIdPair[]`
 * (each pair in id order, sorted, no duplicates, no seat paired with
 * itself — `SeatIdPair.normalize`), exactly what
 * `appointments.stoodSeatPairs.pairs[]` stores. Every function returns a new
 * array; none writes its arguments.
 */
export const SeatingRuleSystem = {
  /**
   * Would `candidate` put its person in a second chair while they are still
   * in one of `seated`? Same key AND overlapping spans. A linear scan; any
   * order of `seated` gives the same answer (it stops at the first hit).
   */
  sitsTwiceAt(
    seated: readonly StandingSeatPair[],
    candidate: StandingSeatPair,
  ): boolean {
    for (let i = 0; i < seated.length; i++) {
      if (StandingSeatPair.sitsTwice(seated[i] as StandingSeatPair, candidate))
        return true;
    }
    return false;
  },

  /** A new booking: nothing stands, and every seat is judged. */
  none(): readonly SeatIdPair[] {
    return [];
  },

  /**
   * Every pair of `visit`'s seats whose one person sits in both at once —
   * the double seatings the visit already holds, normalized.
   */
  standingOf(visit: readonly SeatedSpan[]): readonly SeatIdPair[] {
    const pairs: SeatIdPair[] = [];
    for (let i = 0; i < visit.length; i++) {
      const seat = visit[i] as SeatedSpan;
      for (let k = i + 1; k < visit.length; k++) {
        const other = visit[k] as SeatedSpan;
        if (StandingSeatPair.sitsTwice(other, seat)) {
          pairs.push(SeatIdPair.ordered(seat.seatId, other.seatId));
        }
      }
    }
    return SeatIdPair.normalize(pairs);
  },

  /**
   * Pairs as a caller REMEMBERS them (the pairs a save broke, for its undo)
   * → the canonical set: a seat paired with itself is dropped — it could
   * only ever exempt a seat from nothing.
   */
  ofPairs(pairs: readonly SeatIdPair[]): readonly SeatIdPair[] {
    return SeatIdPair.normalize(pairs);
  },

  /** Did these two seats already seat one person twice? In either order. */
  stands(
    standing: readonly SeatIdPair[],
    seatId: SeatId,
    otherSeatId: SeatId,
  ): boolean {
    for (let i = 0; i < standing.length; i++) {
      if (pairIs(standing[i] as SeatIdPair, seatId, otherSeatId)) return true;
    }
    return false;
  },

  /** Every pair that stands in `a` or in `b`, normalized. */
  union(
    a: readonly SeatIdPair[],
    b: readonly SeatIdPair[],
  ): readonly SeatIdPair[] {
    return SeatIdPair.normalize([...a, ...b]);
  },

  /**
   * The pairs standing in `before` that `after` no longer holds — what an
   * edit BROKE: a seat of the pair removed, or the two moved apart. Exactly
   * the pairs an undo of that edit would put back.
   */
  brokenBy(
    before: readonly SeatIdPair[],
    after: readonly SeatIdPair[],
  ): readonly SeatIdPair[] {
    const broken: SeatIdPair[] = [];
    for (let i = 0; i < before.length; i++) {
      const pair = before[i] as SeatIdPair;
      if (!SeatingRuleSystem.stands(after, pair.seatId, pair.otherSeatId)) {
        broken.push(pair);
      }
    }
    return SeatIdPair.normalize(broken);
  },

  /**
   * Would `candidate` put its person in a second chair in a way the visit
   * did not ALREADY? {@link sitsTwiceAt}, THE rule, asked of every seat
   * seated so far except the ones `candidate` already stood beside. A
   * standing pair earns nothing towards a third seat: moving one of its
   * seats onto yet another of the person's seats is a new overlap.
   */
  seatsTwiceAnew(
    standing: readonly SeatIdPair[],
    seated: readonly SeatedSpan[],
    candidate: SeatedSpan,
  ): boolean {
    for (let i = 0; i < seated.length; i++) {
      const taken = seated[i] as SeatedSpan;
      if (SeatingRuleSystem.stands(standing, taken.seatId, candidate.seatId))
        continue;
      if (StandingSeatPair.sitsTwice(taken, candidate)) return true;
    }
    return false;
  },
} as const;
