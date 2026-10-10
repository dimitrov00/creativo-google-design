/**
 * The ops backfill jobs — the stored `job` strings of `backfill-plan.ts:20`,
 * unchanged, and each one's document id under `backfillJobs/`. The ONLY
 * source of these strings.
 */
export const BackfillJobKind = {
  /** Mirrors the seat subjects onto the appointment's query keys. */
  SubjectMirror: 'subjectMirror',
  /** Recomputes every stored client's stats. */
  ClientStats: 'clientStats',
} as const;
export type BackfillJobKind =
  (typeof BackfillJobKind)[keyof typeof BackfillJobKind];

/** `backfillJobs/{job}` — the document id is the job's kind. */
export type BackfillJobId = string & { readonly __brand: unique symbol };

export const BackfillJobId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): BackfillJobId => raw as BackfillJobId,
} as const;

/**
 * The closing check of a stats run: a sample of stored clients recomputed
 * from scratch (`run-backfill.ts:64-68`) — `mismatched` must be empty.
 */
export type SampleDiff = {
  readonly checked: number;
  /** Clients whose stored answer differs from a fresh one. */
  readonly mismatched: readonly string[];
};

/**
 * A backfill's progress cursor — the stored body of `run-backfill.ts:561-572`
 * (blueprint §2.6), ISO stamps as epoch ms. Each call resumes from `cursor`
 * and adds its page to the counts; `finishedAtMs` is set when the walk ran
 * off the end. The document body is this type minus `id`.
 */
export type BackfillJobEntity = {
  readonly id: BackfillJobId;
  readonly job: BackfillJobKind;
  /** Opaque resume point; `null` at the top. */
  readonly cursor: string | null;
  /** Appointments walked by the whole run. */
  readonly processed: number;
  /** Stored `clientStats` documents walked. */
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
  readonly startedAtMs: number;
  readonly finishedAtMs: number | null;
  readonly updatedAtMs: number;
  readonly sample: SampleDiff | null;
};
