import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SeatIdPair, StoodSeatPairs } from './seat-id-pair.data';
import { SeatId } from '@core/primitives';

const A = SeatId.of('seat-a');
const B = SeatId.of('seat-b');
const C = SeatId.of('seat-c');

describe('SeatIdPair', () => {
  it('spells an unordered pair one way — in id order', () => {
    expect(SeatIdPair.ordered(B, A)).toEqual({ seatId: A, otherSeatId: B });
    expect(SeatIdPair.ordered(A, B)).toEqual({ seatId: A, otherSeatId: B });
  });

  it('knows a pair named in either order', () => {
    expect(
      SeatIdPair.equals(
        { seatId: A, otherSeatId: B },
        { seatId: B, otherSeatId: A },
      ),
    ).toBe(true);
    expect(
      SeatIdPair.equals(
        { seatId: A, otherSeatId: B },
        { seatId: A, otherSeatId: C },
      ),
    ).toBe(false);
  });

  it('normalizes a remembered set: ordered, self-pairs dropped, deduplicated, sorted', () => {
    expect(
      SeatIdPair.normalize([
        { seatId: C, otherSeatId: A },
        { seatId: B, otherSeatId: B },
        { seatId: B, otherSeatId: A },
        { seatId: A, otherSeatId: B },
      ]),
    ).toEqual([
      { seatId: A, otherSeatId: B },
      { seatId: A, otherSeatId: C },
    ]);
  });

  it('normalize is idempotent and order-blind (property)', () => {
    const ids = fc.constantFrom(A, B, C, SeatId.of('seat-d'));
    const pairs = fc.array(fc.record({ seatId: ids, otherSeatId: ids }), {
      maxLength: 8,
    });
    fc.assert(
      fc.property(pairs, (raw) => {
        const once = SeatIdPair.normalize(raw);
        expect(SeatIdPair.normalize(once)).toEqual(once);
        expect(SeatIdPair.normalize([...raw].reverse())).toEqual(once);
        for (const pair of once)
          expect(pair.seatId < pair.otherSeatId).toBe(true);
      }),
    );
  });
});

describe('StoodSeatPairs — the undo window', () => {
  it('remembers nothing when a save broke nothing — no revision, no pairs', () => {
    expect(StoodSeatPairs.remember(3, [])).toEqual({
      stoodSeatPairsRevision: null,
      stoodSeatPairs: [],
    });
    expect(StoodSeatPairs.remember(3, [{ seatId: A, otherSeatId: A }])).toBe(
      StoodSeatPairs.NONE,
    );
  });

  it('remembers the canonical pairs under the revision the save stamped', () => {
    expect(StoodSeatPairs.remember(3, [{ seatId: B, otherSeatId: A }])).toEqual(
      {
        stoodSeatPairsRevision: 3,
        stoodSeatPairs: [{ seatId: A, otherSeatId: B }],
      },
    );
  });

  it('stands by its pairs only while the visit is still at that revision', () => {
    const memory = StoodSeatPairs.remember(3, [{ seatId: A, otherSeatId: B }]);
    expect(StoodSeatPairs.liveAt(memory, 3)).toEqual([
      { seatId: A, otherSeatId: B },
    ]);
    // The next revision-stamping write (a staff edit, a client move) closes it.
    expect(StoodSeatPairs.liveAt(memory, 4)).toEqual([]);
    expect(StoodSeatPairs.liveAt(StoodSeatPairs.NONE, 3)).toEqual([]);
  });
});
