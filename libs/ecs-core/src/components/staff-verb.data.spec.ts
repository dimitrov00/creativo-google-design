import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { ArrivalVerb } from './arrival-verb.data';
import { StaffVerb } from './staff-verb.data';

type Expect<T extends true> = T;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time only: a staff verb is a lifecycle move or an arrival stamp. */
export type StaffVerbTypes = [
  Expect<Equals<StaffVerb, BookingStatus | ArrivalVerb>>,
];

/** Every verb a staff row can act with, lifecycle moves first. */
const EVERY_VERB: readonly StaffVerb[] = [
  ...Object.values(BookingStatus),
  ...Object.values(ArrivalVerb),
];

describe('StaffVerb.didNotHappen — the acts that settle a visit as one that did not happen', () => {
  it('is true for a cancel and a no-show, false for every other verb (each pinned)', () => {
    expect(StaffVerb.didNotHappen(BookingStatus.Cancelled)).toBe(true);
    expect(StaffVerb.didNotHappen(BookingStatus.NoShow)).toBe(true);
    expect(StaffVerb.didNotHappen(BookingStatus.Pending)).toBe(false);
    expect(StaffVerb.didNotHappen(BookingStatus.Confirmed)).toBe(false);
    expect(StaffVerb.didNotHappen(BookingStatus.Completed)).toBe(false);
    expect(StaffVerb.didNotHappen(ArrivalVerb.Arrived)).toBe(false);
    expect(StaffVerb.didNotHappen(ArrivalVerb.Unarrived)).toBe(false);
  });

  it('answers as the dashboard’s dismissal set did — `to === CANCELLED || to === NO_SHOW` — on every verb', () => {
    for (const verb of EVERY_VERB) {
      expect(StaffVerb.didNotHappen(verb)).toBe(
        verb === BookingStatus.Cancelled || verb === BookingStatus.NoShow,
      );
    }
  });

  it('is pure: same input → same output, the verbs untouched', () => {
    const verbs = deepFreeze([...EVERY_VERB]);
    const once = verbs.map((verb) => StaffVerb.didNotHappen(verb));
    expect(verbs.map((verb) => StaffVerb.didNotHappen(verb))).toEqual(once);
  });
});
