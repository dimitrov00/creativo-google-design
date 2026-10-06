import { Interval } from './interval';

/**
 * A SOLD slot and the person who sits in it — the unit of the rule "one
 * person, one chair at a time" (owner decision, 2026-09-25).
 *
 * `personKey` is whatever the caller counts people by, opaque here: the
 * availability engine uses the cart's seat key (`AvailabilityLine.personKey`),
 * the server's decision its own `personKey` of a requested subject. The rule
 * only ever compares two keys for equality, so the two sides never have to
 * agree on a spelling — only on who is the same person.
 *
 * The slot is the SERVICE, never the chair time around it. A barber's setup
 * and cleanup are the barber's minutes, not the client's: a cut that ends at
 * 10:45 frees its person at 10:45 for a beard in the next chair, whatever the
 * first barber still has to sweep up.
 */
export interface PersonSlot {
  readonly personKey: string;
  readonly slot: Interval;
}

/**
 * Would `candidate` put its person in a second chair while they are still in
 * one of `seated`? THE rule, in one place: the availability engine asks it of
 * every placement it tries, and the server's decision asks it of every seat a
 * request names, so a grid can never offer an arrangement the server refuses
 * for this reason, nor the other way round.
 *
 * Half-open, like every interval here: back to back is not overlapping, so
 * "a cut, then a beard" in two chairs is one person walking across the room.
 */
export function sitsTwiceAt(
  seated: readonly PersonSlot[],
  candidate: PersonSlot,
): boolean {
  return seated.some(
    (taken) =>
      taken.personKey === candidate.personKey &&
      Interval.overlaps(taken.slot, candidate.slot),
  );
}

/** A sold slot, its person, and WHICH SEAT it is — a visit's unit of people. */
export interface SeatSlot extends PersonSlot {
  readonly seatId: string;
}

/**
 * THE DOUBLE SEATINGS A VISIT ALREADY HOLDS, by seat identity (owner
 * decision, round 5, 2026-09-26: the rule refuses only a NEW overlap).
 *
 * A visit booked on the old person-blind grid, or entered by hand before the
 * rule, can hold one person in two chairs at once: two unlabelled walk-ins
 * in parallel chairs used to share the default label «Случаен клиент», and
 * the server counts a guest by label. Refusing every write to such a visit
 * froze it: no tip, no discount, no drag, and «pick another time» when no
 * time would do. So a pair of seats (by id) that already overlapped for one
 * person before an edit may keep overlapping after any edit that KEEPS
 * both seats' identities: a staff drag, a resize, a chair change, and — on
 * a client's move — the seats the move carries (a companion, a `self` seat
 * bound to another account). Staff can always save a visit they did not
 * make worse.
 *
 * And never make one worse: a pair that did not overlap before, or a seat
 * the edit adds, answers to `sitsTwiceAt` in full. A standing pair also
 * earns nothing towards a third seat: moving one of its seats onto yet
 * another of the person's seats is a new overlap. On a client's move the
 * client's OWN seats (theirs and their anonymous guests') are re-picked on
 * a person-aware grid and placed anew with fresh ids, so a pair among them
 * obeys the rule: two guests under one label are renamed or separated
 * (BA ruling, round 6, narrowing the owner's round-5 decision for the move).
 *
 * Identity, not position, because a position is exactly what an edit
 * changes. Matching on "the same chair, start and minutes" let a pair stand
 * only while nobody touched it, and refused the whole-visit drag that moves
 * both seats together and leaves the visit no worse (the round-3 regression).
 *
 * A pair can also be REMEMBERED (`ofPairs`, round 6): the pairs a save
 * broke — one seat removed, or the two moved apart — stand for the one
 * write that follows it, so «Отмени» can restore exactly what the save
 * changed. The memory is the caller's to keep and to expire; this class
 * only unites it with what the visit holds.
 */
export class StandingDoubleSeatings {
  private constructor(
    /** Each pair by its key (`pairKey`), in id order. */
    private readonly pairs: ReadonlyMap<string, SeatIdPair>,
  ) {}

  /** A new booking: nothing stands, and every seat is judged. */
  static none(): StandingDoubleSeatings {
    return new StandingDoubleSeatings(new Map());
  }

  /** Every pair of `visit`'s seats whose one person sits in both at once. */
  static of(visit: readonly SeatSlot[]): StandingDoubleSeatings {
    const pairs = new Map<string, SeatIdPair>();
    visit.forEach((seat, index) => {
      for (const other of visit.slice(index + 1)) {
        if (sitsTwiceAt([other], seat)) {
          const pair = ordered(seat.seatId, other.seatId);
          pairs.set(pairKey(pair), pair);
        }
      }
    });
    return new StandingDoubleSeatings(pairs);
  }

  /**
   * Pairs named by seat id, as a caller REMEMBERS them — the pairs a save
   * broke, for its undo. A seat paired with itself is no pair and is
   * dropped: it could only ever exempt a seat from nothing.
   */
  static ofPairs(pairs: readonly SeatIdPair[]): StandingDoubleSeatings {
    const known = new Map<string, SeatIdPair>();
    for (const [seatId, otherSeatId] of pairs) {
      if (seatId === otherSeatId) continue;
      const pair = ordered(seatId, otherSeatId);
      known.set(pairKey(pair), pair);
    }
    return new StandingDoubleSeatings(known);
  }

  /** Did these two seats already seat one person twice? In either order. */
  stands(seatId: string, otherSeatId: string): boolean {
    return this.pairs.has(pairKey(ordered(seatId, otherSeatId)));
  }

  /** Every pair that stands here or in `other`. */
  union(other: StandingDoubleSeatings): StandingDoubleSeatings {
    return new StandingDoubleSeatings(new Map([...this.pairs, ...other.pairs]));
  }

  /**
   * The pairs standing here that `after` no longer holds — what an edit
   * BROKE: a seat of the pair removed, or the two moved apart. Exactly the
   * pairs an undo of that edit would put back.
   */
  brokenBy(after: StandingDoubleSeatings): StandingDoubleSeatings {
    return new StandingDoubleSeatings(
      new Map([...this.pairs].filter(([key]) => !after.pairs.has(key))),
    );
  }

  /** The pairs, each in id order, sorted — a stable shape to persist. */
  toPairs(): readonly SeatIdPair[] {
    return [...this.pairs.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, pair]) => pair);
  }

  /**
   * Would `candidate` put its person in a second chair in a way the visit
   * did not ALREADY? `sitsTwiceAt`, THE rule, asked of every seat seated so
   * far except the ones `candidate` already stood beside.
   */
  seatsTwiceAnew(seated: readonly SeatSlot[], candidate: SeatSlot): boolean {
    return sitsTwiceAt(
      seated.filter((taken) => !this.stands(taken.seatId, candidate.seatId)),
      candidate,
    );
  }
}

/** Two seats, by id, that seat one person twice at once. Unordered. */
export type SeatIdPair = readonly [seatId: string, otherSeatId: string];

/** The pair in id order — one spelling per unordered pair. */
function ordered(a: string, b: string): SeatIdPair {
  return a < b ? [a, b] : [b, a];
}

/** One key per unordered pair — JSON, so no seat id can forge a separator. */
function pairKey(pair: SeatIdPair): string {
  return JSON.stringify(pair);
}
