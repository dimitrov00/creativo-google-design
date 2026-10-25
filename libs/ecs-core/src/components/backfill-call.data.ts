import { CustomerId, Result, UtcEpochMs } from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import { BackfillJobName } from './backfill-job-name.data';

/**
 * THE OPS WIRE (Phase 4a 4A-4) — `runBackfill`, one page of an operator's
 * backfill job. `backfillResume` continues wherever the job's progress
 * document says (today's request with no `cursor`); otherwise `cursor` is
 * the page to start after, `null` = from the top. The server reads it with
 * `BackfillPlanSystem.requestOf`.
 */
export type BackfillCall = {
  readonly backfillJobName: BackfillJobName;
  readonly backfillResume: boolean;
  readonly cursor: string | null;
};

export const BackfillCall = {
  decodePage(raw: unknown): Result<BackfillCall.Page, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const backfillJobName = CallAnswer.tag(
      answer,
      'backfillJobName',
      BackfillJobName,
    );
    const cursor = CallAnswer.field(answer, 'cursor');
    const startedFrom = CallAnswer.field(answer, 'startedFrom');
    const done = CallAnswer.flag(answer, 'done');
    const budgetSpent = CallAnswer.flag(answer, 'budgetSpent');
    const processed = CallAnswer.whole(answer, 'processed', 0);
    const storedClients = CallAnswer.whole(answer, 'storedClients', 0);
    const stamped = CallAnswer.whole(answer, 'stamped', 0);
    const recomputed = CallAnswer.whole(answer, 'recomputed', 0);
    const total = CallAnswer.whole(answer, 'total', 0);
    const startedAt = CallAnswer.field(answer, 'runStartedAtUtcMs');
    const runStartedAtUtcMs =
      typeof startedAt === 'number' ? UtcEpochMs.of(startedAt) : null;
    const sampleChecked = CallAnswer.field(answer, 'sampleChecked');
    const mismatched = CallAnswer.field(answer, 'sampleMismatched');
    if (
      backfillJobName === null ||
      (cursor !== null && typeof cursor !== 'string') ||
      (startedFrom !== null && typeof startedFrom !== 'string') ||
      done === null ||
      budgetSpent === null ||
      processed === null ||
      storedClients === null ||
      stamped === null ||
      recomputed === null ||
      total === null ||
      runStartedAtUtcMs === null ||
      !runStartedAtUtcMs.ok ||
      (sampleChecked !== null && typeof sampleChecked !== 'number') ||
      !Array.isArray(mismatched)
    ) {
      return CallAnswer.unusable();
    }
    const sampleMismatched: CustomerId[] = [];
    for (const id of mismatched as readonly unknown[]) {
      if (typeof id !== 'string') return CallAnswer.unusable();
      const parsed = CustomerId.parse(id);
      if (!parsed.ok) return CallAnswer.unusable();
      sampleMismatched.push(parsed.value);
    }
    return Result.ok({
      backfillJobName,
      cursor,
      done,
      processed,
      storedClients,
      stamped,
      recomputed,
      total,
      runStartedAtUtcMs: runStartedAtUtcMs.value,
      startedFrom,
      sampleChecked,
      sampleMismatched,
      budgetSpent,
    });
  },
} as const;

export namespace BackfillCall {
  /** One page's answer (was the pipeline's `BackfillPageResult`, re-homed). */
  export type Page = {
    readonly backfillJobName: BackfillJobName;
    /** Pass back to continue (opaque); `null` once the job is done. */
    readonly cursor: string | null;
    readonly done: boolean;
    /** This call's page: appointments walked. */
    readonly processed: number;
    /** This call's page: stored `clientStats` documents walked. */
    readonly storedClients: number;
    readonly stamped: number;
    readonly recomputed: number;
    /** Appointments walked by the whole run so far. */
    readonly total: number;
    /** When the run this page belongs to started. */
    readonly runStartedAtUtcMs: UtcEpochMs;
    /** The cursor this page started after, as resolved. */
    readonly startedFrom: string | null;
    /** Stored clients the closing sample recomputed; `null` when none was taken. */
    readonly sampleChecked: number | null;
    readonly sampleMismatched: readonly CustomerId[];
    /** The call stopped taking work because its budget ran out. */
    readonly budgetSpent: boolean;
  };
}
