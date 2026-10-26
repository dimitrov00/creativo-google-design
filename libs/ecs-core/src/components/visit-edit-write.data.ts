import type { PipelineError } from '@core/errors';
import { VisitEditWriteOutcome } from './visit-edit-write-outcome.data';

/**
 * WHAT ONE WRITE OF THE STAFF VISIT SHEET CAME TO — a save, or a save's
 * undo (OR-4: moved from the staff dashboard's `EditorWrite`; the answer of
 * `saveVisitEdit`). The outcome (`visitEditWriteOutcome`, the dictionary of
 * `visit-edit-write-outcome.data.ts`) and, beside it, whether the side
 * documents the write was due — the team note, the tip — landed too
 * (`sidesWritten`: `true` when none was due). Only a write whose batch
 * landed writes a side document, so a refused one says `false`.
 */
export type VisitEditWrite =
  VisitEditWrite.Stale | VisitEditWrite.BatchRefused | VisitEditWrite.Written;

export const VisitEditWrite = {
  /** Refused before anything went out: a side field it carries moved under the draft. */
  stale(): VisitEditWrite.Stale {
    return {
      visitEditWriteOutcome: VisitEditWriteOutcome.Stale,
      sidesWritten: false,
    };
  },

  /**
   * The batch was refused — by the server (`null`: the store has filed the
   * server's answer on the row already), or before it went out, as the
   * server would have refused it (the refusal, for the store to file).
   */
  batchRefused(
    batchRefusal: PipelineError | null,
  ): VisitEditWrite.BatchRefused {
    return {
      visitEditWriteOutcome: VisitEditWriteOutcome.BatchRefused,
      sidesWritten: false,
      batchRefusal,
    };
  },

  /** The batch landed (or there was none to send); `sidesWritten` says whether the side documents followed. */
  written(sidesWritten: boolean): VisitEditWrite.Written {
    return {
      visitEditWriteOutcome: VisitEditWriteOutcome.Written,
      sidesWritten,
    };
  },

  /** Did the batch land (or was there none to send)? */
  batchLanded(write: VisitEditWrite): boolean {
    return write.visitEditWriteOutcome === VisitEditWriteOutcome.Written;
  },

  /** Did the whole write land — the batch and every side document it was due? */
  landed(write: VisitEditWrite): boolean {
    return VisitEditWrite.batchLanded(write) && write.sidesWritten;
  },
} as const;

export namespace VisitEditWrite {
  export type Stale = {
    readonly visitEditWriteOutcome: typeof VisitEditWriteOutcome.Stale;
    readonly sidesWritten: false;
  };
  export type BatchRefused = {
    readonly visitEditWriteOutcome: typeof VisitEditWriteOutcome.BatchRefused;
    readonly sidesWritten: false;
    /**
     * The refusal the batch earned before it was sent — a placement the
     * call cannot carry (`StaffEditPlanSystem.commandsFor`); `null` when the
     * server refused it.
     */
    readonly batchRefusal: PipelineError | null;
  };
  export type Written = {
    readonly visitEditWriteOutcome: typeof VisitEditWriteOutcome.Written;
    readonly sidesWritten: boolean;
  };
}
