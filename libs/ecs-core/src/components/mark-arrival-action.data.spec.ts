import { describe, expect, it } from 'vitest';
import type { MarkArrivalCommand } from '@core/pipelines';
import { MarkArrivalAction } from './mark-arrival-action.data';

/* Moved with the name from staff-verb.data.spec.ts (pass D, L-1 split). */

type Expect<T extends true> = T;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time only: the dictionary's type is exactly its values; the field is named after it. */
export type MarkArrivalActionTypes = [
  Expect<Equals<MarkArrivalAction, 'ARRIVE' | 'CLEAR'>>,
  Expect<Equals<MarkArrivalCommand['markArrivalAction'], MarkArrivalAction>>,
];

describe('MarkArrivalAction', () => {
  it('holds the arrival callable’s two verbs — values unchanged from the pipeline', () => {
    expect(MarkArrivalAction).toEqual({ Arrive: 'ARRIVE', Clear: 'CLEAR' });
  });
});
