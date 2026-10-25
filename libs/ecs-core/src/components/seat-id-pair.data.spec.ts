import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SeatIdPair } from './seat-id-pair.data';
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
