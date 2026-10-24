import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import type { MarkArrivalCommand } from '@core/pipelines';
import {
  ArrivalVerb,
  MarkArrivalAction,
  type StaffVerb,
} from './staff-verb.data';

type Expect<T extends true> = T;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time only: each dictionary's type is exactly its values; the field is named after it. */
export type StaffVerbTypes = [
  Expect<Equals<ArrivalVerb, 'ARRIVED' | 'UNARRIVED'>>,
  Expect<Equals<MarkArrivalAction, 'ARRIVE' | 'CLEAR'>>,
  Expect<Equals<StaffVerb, BookingStatus | ArrivalVerb>>,
  Expect<Equals<MarkArrivalCommand['markArrivalAction'], MarkArrivalAction>>,
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

describe('MarkArrivalAction', () => {
  it('holds the arrival callable’s two verbs — values unchanged from the pipeline', () => {
    expect(MarkArrivalAction).toEqual({ Arrive: 'ARRIVE', Clear: 'CLEAR' });
  });
});
