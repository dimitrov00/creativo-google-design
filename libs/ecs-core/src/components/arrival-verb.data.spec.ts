import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { ArrivalVerb } from './arrival-verb.data';

/* Moved with the name from staff-verb.data.spec.ts (pass D, L-1 split). */

type Expect<T extends true> = T;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time only: the dictionary's type is exactly its values. */
export type ArrivalVerbTypes = [
  Expect<Equals<ArrivalVerb, 'ARRIVED' | 'UNARRIVED'>>,
];

describe('ArrivalVerb', () => {
  it('holds the two arrival stamps — values unchanged from the feature’s `row-verb.ts`', () => {
    expect(ArrivalVerb).toEqual({ Arrived: 'ARRIVED', Unarrived: 'UNARRIVED' });
  });

  it('never shares a value with a lifecycle status — a StaffVerb is one or the other', () => {
    const statuses: readonly string[] = Object.values(BookingStatus);
    for (const verb of Object.values(ArrivalVerb)) {
      expect(statuses.includes(verb)).toBe(false);
    }
  });
});
