import {
  EndMinute,
  MinuteOfDay,
  SeatId as EcsSeatId,
  SeatKeyText,
  defect,
} from '@core/primitives';
import {
  type SeatIdPair as EcsSeatIdPair,
  StandingSeatPair,
} from '@core/components';
import { type SeatedSpan, SeatingRuleSystem } from '@core/systems';
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
 *
 * Phase 2 shim: the rule is `SeatingRuleSystem` in `@core/systems`; this
 * file keeps the legacy shapes for its callers and converts at the edge.
 */
export interface PersonSlot {
  readonly personKey: string;
  readonly slot: Interval;
}

/**
 * Would `candidate` put its person in a second chair while they are still in
 * one of `seated`? THE rule, in one place — `SeatingRuleSystem.sitsTwiceAt`.
 */
export function sitsTwiceAt(
  seated: readonly PersonSlot[],
  candidate: PersonSlot,
): boolean {
  const frame = frameOf([...seated, candidate]);
  return SeatingRuleSystem.sitsTwiceAt(
    seated.map((slot) => toStandingPair(slot, frame)),
    toStandingPair(candidate, frame),
  );
}

/** A sold slot, its person, and WHICH SEAT it is — a visit's unit of people. */
export interface SeatSlot extends PersonSlot {
  readonly seatId: string;
}

/**
 * THE DOUBLE SEATINGS A VISIT ALREADY HOLDS, by seat identity (owner
 * decision, round 5: the rule refuses only a NEW overlap; round 6: the pairs
 * a save broke are remembered for its undo). The rule is
 * `SeatingRuleSystem`; this class only carries the normalized pairs for the
 * callers that still hold one.
 */
export class StandingDoubleSeatings {
  private constructor(
    /** Normalized: each pair in id order, sorted, no duplicates. */
    private readonly pairs: readonly EcsSeatIdPair[],
  ) {}

  /** A new booking: nothing stands, and every seat is judged. */
  static none(): StandingDoubleSeatings {
    return new StandingDoubleSeatings(SeatingRuleSystem.none());
  }

  /** Every pair of `visit`'s seats whose one person sits in both at once. */
  static of(visit: readonly SeatSlot[]): StandingDoubleSeatings {
    const frame = frameOf(visit);
    return new StandingDoubleSeatings(
      SeatingRuleSystem.standingOf(
        visit.map((slot) => toSeatedSpan(slot, frame)),
      ),
    );
  }

  /**
   * Pairs named by seat id, as a caller REMEMBERS them — the pairs a save
   * broke, for its undo. A seat paired with itself is no pair and is dropped.
   */
  static ofPairs(pairs: readonly SeatIdPair[]): StandingDoubleSeatings {
    return new StandingDoubleSeatings(
      SeatingRuleSystem.ofPairs(pairs.map(fromTuple)),
    );
  }

  /** Did these two seats already seat one person twice? In either order. */
  stands(seatId: string, otherSeatId: string): boolean {
    return SeatingRuleSystem.stands(
      this.pairs,
      EcsSeatId.of(seatId),
      EcsSeatId.of(otherSeatId),
    );
  }

  /** Every pair that stands here or in `other`. */
  union(other: StandingDoubleSeatings): StandingDoubleSeatings {
    return new StandingDoubleSeatings(
      SeatingRuleSystem.union(this.pairs, other.pairs),
    );
  }

  /** The pairs standing here that `after` no longer holds — what an edit BROKE. */
  brokenBy(after: StandingDoubleSeatings): StandingDoubleSeatings {
    return new StandingDoubleSeatings(
      SeatingRuleSystem.brokenBy(this.pairs, after.pairs),
    );
  }

  /** The pairs, each in id order, sorted — a stable shape to persist. */
  toPairs(): readonly SeatIdPair[] {
    return this.pairs
      .map(toTuple)
      .sort((a, b) => compareKeys(pairKey(a), pairKey(b)));
  }

  /** Would `candidate` put its person in a second chair in a way the visit did not ALREADY? */
  seatsTwiceAnew(seated: readonly SeatSlot[], candidate: SeatSlot): boolean {
    const frame = frameOf([...seated, candidate]);
    return SeatingRuleSystem.seatsTwiceAnew(
      this.pairs,
      seated.map((slot) => toSeatedSpan(slot, frame)),
      toSeatedSpan(candidate, frame),
    );
  }
}

/** Two seats, by id, that seat one person twice at once. Unordered. */
export type SeatIdPair = readonly [seatId: string, otherSeatId: string];

/* ── Converters between the legacy shapes and the ecs-core structs ──────── */

/**
 * The legacy slots are instants, the rule's spans are wall-clock minutes of
 * one shop day — and the rule only ever ORDERS their ends (`a.start <
 * b.end && b.start < a.end`). So the instants one call compares are ranked
 * (1-based, distinct values in order) and each rank is the minute: any
 * strictly increasing map answers every comparison exactly as the instants
 * would, and a call compares a handful of seats, far inside one day's 1440
 * minutes.
 */
type Frame = ReadonlyMap<number, number>;

function frameOf(slots: readonly PersonSlot[]): Frame {
  const instants = new Set<number>();
  for (const { slot } of slots) {
    instants.add(slot.startMs);
    instants.add(slot.endMs);
  }
  const frame = new Map<number, number>();
  [...instants]
    .sort((a, b) => a - b)
    .forEach((instant, index) => frame.set(instant, index + 1));
  return frame;
}

function rankOf(frame: Frame, instant: number): number {
  const rank = frame.get(instant);
  // Unreachable: the frame is built from these very slots.
  if (rank === undefined) defect('unreachable: an unranked instant');
  return rank;
}

function toStandingPair(slot: PersonSlot, frame: Frame): StandingSeatPair {
  const start = MinuteOfDay.of(rankOf(frame, slot.slot.startMs));
  const end = EndMinute.of(rankOf(frame, slot.slot.endMs));
  // Unreachable below 720 seats in one call: a rank is a minute of the day.
  if (!start.ok || !end.ok) defect('unreachable: a frame past 24:00');
  return StandingSeatPair.of(
    SeatKeyText.of(slot.personKey),
    start.value,
    end.value,
  );
}

function toSeatedSpan(slot: SeatSlot, frame: Frame): SeatedSpan {
  return {
    seatId: EcsSeatId.of(slot.seatId),
    ...toStandingPair(slot, frame),
  };
}

function fromTuple([seatId, otherSeatId]: SeatIdPair): EcsSeatIdPair {
  return {
    seatId: EcsSeatId.of(seatId),
    otherSeatId: EcsSeatId.of(otherSeatId),
  };
}

function toTuple(pair: EcsSeatIdPair): SeatIdPair {
  return [pair.seatId, pair.otherSeatId];
}

/** The legacy persisted order: by the pair's JSON key. */
function pairKey(pair: SeatIdPair): string {
  return JSON.stringify(pair);
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
