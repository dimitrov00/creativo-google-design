import { describe, expect, it } from 'vitest';
import { SeatId } from '@core/primitives';
import { StoodSeatPairs } from './stood-seat-pairs.data';

/* Moved with the name from seat-id-pair.data.spec.ts (pass D, L-1 split). */

const A = SeatId.of('seat-a');
const B = SeatId.of('seat-b');

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
