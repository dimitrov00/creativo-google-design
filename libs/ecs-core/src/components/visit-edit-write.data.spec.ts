import { describe, expect, it } from 'vitest';
import {
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import { deepFreeze } from '@core/testing';
import { VisitEditWrite } from './visit-edit-write.data';
import { VisitEditWriteOutcome } from './visit-edit-write-outcome.data';

/*
 * OR-4: the staff dashboard's `EditorWrite` and its two guards
 * (`batchLanded`, `writeLanded`), moved into a data file as the answer of
 * `saveVisitEdit`. The shapes are the dashboard's — the outcome and
 * `sidesWritten` — plus the refusal a batch earned before it went out,
 * which the dashboard filed on the store itself.
 */

type Expect<T extends true> = T;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time only: each variant narrows on its outcome, and a refusal never says its sides landed. */
export type VisitEditWriteTypes = [
  Expect<
    Equals<
      Extract<
        VisitEditWrite,
        { readonly visitEditWriteOutcome: typeof VisitEditWriteOutcome.Stale }
      >,
      VisitEditWrite.Stale
    >
  >,
  Expect<Equals<VisitEditWrite.Stale['sidesWritten'], false>>,
  Expect<Equals<VisitEditWrite.BatchRefused['sidesWritten'], false>>,
  Expect<
    Equals<VisitEditWrite['visitEditWriteOutcome'], VisitEditWriteOutcome>
  >,
];

const OFF_THE_CLOCK = PipelineError.of(
  PipelineErrorCode.InvalidRequest,
  StaffEditErrorCode.InvalidCommand,
  null,
  'startMinutes',
);

describe('VisitEditWrite — what one write of the visit sheet came to', () => {
  it('builds the three outcomes flat, the refusal only on a refused batch', () => {
    expect(VisitEditWrite.stale()).toEqual({
      visitEditWriteOutcome: 'STALE',
      sidesWritten: false,
    });
    expect(VisitEditWrite.batchRefused(OFF_THE_CLOCK)).toEqual({
      visitEditWriteOutcome: 'BATCH_REFUSED',
      sidesWritten: false,
      batchRefusal: OFF_THE_CLOCK,
    });
    expect(VisitEditWrite.batchRefused(null)).toEqual({
      visitEditWriteOutcome: 'BATCH_REFUSED',
      sidesWritten: false,
      batchRefusal: null,
    });
    expect(VisitEditWrite.written(true)).toEqual({
      visitEditWriteOutcome: 'WRITTEN',
      sidesWritten: true,
    });
    expect(VisitEditWrite.written(false).sidesWritten).toBe(false);
  });

  it('says the batch landed only on WRITTEN, and the whole write only with its sides', () => {
    const cases: readonly [VisitEditWrite, boolean, boolean][] = [
      [VisitEditWrite.stale(), false, false],
      [VisitEditWrite.batchRefused(OFF_THE_CLOCK), false, false],
      [VisitEditWrite.batchRefused(null), false, false],
      [VisitEditWrite.written(false), true, false],
      [VisitEditWrite.written(true), true, true],
    ];
    for (const [write, batch, whole] of cases) {
      expect(VisitEditWrite.batchLanded(write)).toBe(batch);
      expect(VisitEditWrite.landed(write)).toBe(whole);
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const written = deepFreeze(VisitEditWrite.written(false));
    expect(VisitEditWrite.landed(written)).toBe(VisitEditWrite.landed(written));
    expect(VisitEditWrite.batchRefused(OFF_THE_CLOCK)).toEqual(
      VisitEditWrite.batchRefused(OFF_THE_CLOCK),
    );
    expect(written).toEqual({
      visitEditWriteOutcome: VisitEditWriteOutcome.Written,
      sidesWritten: false,
    });
  });
});
