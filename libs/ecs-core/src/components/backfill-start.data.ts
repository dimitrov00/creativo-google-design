/*
 * Where a `runBackfill` call asks to start — its tag and the request it
 * types (`BackfillPlanSystem.requestOf`). Moved out of
 * `backfill-plan.system.ts` (pass D, S-21; D-7.4: a tag dictionary and the
 * union it types are components), values unchanged.
 */

/** Where a call asks to start — the ONLY source of these strings, the field `backfillStart`. */
export const BackfillStart = {
  /** No cursor sent: continue wherever the job's progress document says. */
  Resume: 'RESUME',
  /** `cursor: null` sent: start over from the top. */
  Top: 'TOP',
  /** A wire cursor a previous call returned. */
  After: 'AFTER',
} as const;
export type BackfillStart = (typeof BackfillStart)[keyof typeof BackfillStart];

/** Where a call starts, discriminated by `backfillStart`. */
export type BackfillStartRequest =
  | BackfillStartRequest.Resume
  | BackfillStartRequest.Top
  | BackfillStartRequest.After;

export const BackfillStartRequest = {
  resume(): BackfillStartRequest.Resume {
    return { backfillStart: BackfillStart.Resume };
  },

  top(): BackfillStartRequest.Top {
    return { backfillStart: BackfillStart.Top };
  },

  after(cursor: string): BackfillStartRequest.After {
    return { backfillStart: BackfillStart.After, cursor };
  },
} as const;

export namespace BackfillStartRequest {
  export type Resume = {
    readonly backfillStart: typeof BackfillStart.Resume;
  };
  export type Top = {
    readonly backfillStart: typeof BackfillStart.Top;
  };
  export type After = {
    readonly backfillStart: typeof BackfillStart.After;
    /** The wire cursor a previous call returned. */
    readonly cursor: string;
  };
}
