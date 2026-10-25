import { describe, expect, it } from 'vitest';
import { SeatId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
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

describe('StoodSeatPairs.fieldFault — the read-time check of a stored memory (edge hardening D-1)', () => {
  const pair = { seatIds: [SeatId.of('s1'), SeatId.of('s2')] };

  it('answers null for no memory and for a remembered one', () => {
    expect(StoodSeatPairs.fieldFault(StoodSeatPairs.NONE)).toBeNull();
    expect(
      StoodSeatPairs.fieldFault({
        stoodSeatPairsRevision: 3,
        stoodSeatPairs: [pair],
      }),
    ).toBeNull();
    expect(
      StoodSeatPairs.fieldFault({
        stoodSeatPairsRevision: 0,
        stoodSeatPairs: [],
      }),
    ).toBeNull();
  });

  it('names stoodSeatPairsRevision when it is neither null nor a non-negative safe integer', () => {
    for (const stoodSeatPairsRevision of [
      -1,
      1.5,
      '3',
      Number.NaN,
      undefined,
    ]) {
      expect(
        StoodSeatPairs.fieldFault({
          stoodSeatPairsRevision,
          stoodSeatPairs: [],
        }),
        String(stoodSeatPairsRevision),
      ).toBe('stoodSeatPairsRevision');
    }
  });

  it('names stoodSeatPairs when it is no array of records', () => {
    for (const stoodSeatPairs of ['x', null, {}, [1], [null], [[pair]]]) {
      expect(
        StoodSeatPairs.fieldFault({
          stoodSeatPairsRevision: null,
          stoodSeatPairs,
        }),
      ).toBe('stoodSeatPairs');
    }
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze({
      stoodSeatPairsRevision: 2,
      stoodSeatPairs: [pair],
    });
    expect(StoodSeatPairs.fieldFault(raw)).toBe(StoodSeatPairs.fieldFault(raw));
    expect(raw.stoodSeatPairs).toEqual([pair]);
  });
});
