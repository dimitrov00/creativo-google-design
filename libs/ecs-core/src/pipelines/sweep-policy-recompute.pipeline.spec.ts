import { describe, expect, it } from 'vitest';
import {
  AttemptOutcome,
  BookingPolicy,
  type LivePolicyLine,
  PolicySweepOutcome,
  PreciseInstant,
} from '@core/components';
import {
  CustomerId,
  PolicyRecomputeJobId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type PolicyRecomputeJob, RecomputeJobName } from '@core/entities';
import { PolicyRecomputeJobSystem } from '@core/systems';
import {
  bodyOf,
  FIXTURE_NOW_UTC_MS,
  hourCount,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
} from '@core/testing';
import {
  POLICY_RECOMPUTE_JOB_PATH,
  policyJobWrite,
} from './start-policy-recompute.pipeline';
import { sweepPolicyRecompute } from './sweep-policy-recompute.pipeline';

/*
 * The policy pass's daily sweep (`recompute-on-policy-change.ts`): first the
 * pass a DROPPED start owed (the policy document newer than the job's change
 * and drawing another line), else a nudge for an unfinished pass that has
 * not moved for an hour. When each is owed is `PolicyRecomputeJobSystem`'s
 * spec (`catchUp`, `nudge`); this one asserts the plan that reached the
 * commit, the lines logged and what a failure answers.
 */

const HOUR = 3_600_000;
const TWO_HOURS_AGO = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -2 * HOUR);
const MINUTES_AGO = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -10 * 60_000);

const instant = (seconds: number) => {
  const at = PreciseInstant.of(seconds, 0);
  if (at === null) throw new Error('a broken fixture');
  return at;
};

function jobOf(
  overrides: Partial<PolicyRecomputeJob> = {},
): PolicyRecomputeJob {
  const generation = overrides.generation ?? 'evt-a';
  const cursor = overrides.cursor ?? CustomerId.of('cus_ana');
  const finishedAtUtcMs = overrides.finishedAtUtcMs ?? null;
  return {
    id: PolicyRecomputeJobId.FIXED,
    recomputeJobName: RecomputeJobName.ClientStatsPolicy,
    generation,
    changedAtSeconds: instant(1_800_000_000).seconds,
    changedAtNanos: instant(1_800_000_000).nanos,
    cursor,
    storedClients: 1,
    recomputed: 1,
    failed: 0,
    startedAtUtcMs: TWO_HOURS_AGO,
    updatedAtUtcMs: TWO_HOURS_AGO,
    finishedAtUtcMs,
    stepKey: PolicyRecomputeJobSystem.stepKeyOf(
      generation,
      cursor,
      finishedAtUtcMs,
    ),
    stalledAtUtcMs: null,
    lastFailureCode: null,
    windowHours: hourCount(48),
    ...overrides,
  };
}

/** The live policy as the sweep reads it: its line and when it last changed. */
const lineAt = (
  windowHours: number,
  seconds: number | null,
): LivePolicyLine => ({
  updatedAt: seconds === null ? null : instant(seconds),
  windowHours: hourCount(windowHours),
});

function rig(job: PolicyRecomputeJob | null, line: LivePolicyLine) {
  const store = memoryStore(
    job === null
      ? []
      : [{ path: POLICY_RECOMPUTE_JOB_PATH, body: bodyOf(job) }],
  );
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const run = sweepPolicyRecompute({
    ...tx,
    ...telemetry,
    loadPolicyLine: async () => Result.ok(line),
  });
  return { store, tx, telemetry, run };
}

/** The policy as written before the job's change — nothing owed by it. */
const answered = lineAt(48, 1_799_999_000);

describe('sweepPolicyRecompute — the daily nudge for a pass that stopped moving', () => {
  it('nudges an unfinished pass that has not moved for an hour — the write that fires its step again', async () => {
    const job = jobOf();
    const { tx, telemetry, run } = rig(job, answered);
    expect(await run()).toEqual({
      ok: true,
      value: {
        policySweepOutcome: PolicySweepOutcome.Nudged,
        attemptFailure: null,
        survivedFailure: null,
      },
    });
    expect(tx.plans).toEqual([
      [
        policyJobWrite({
          ...job,
          updatedAtUtcMs: FIXTURE_NOW_UTC_MS,
          stalledAtUtcMs: null,
        }),
      ],
    ]);
    expect(telemetry.lines).toEqual([
      {
        level: 'info',
        msg: 'policy recompute nudged',
        fields: {
          generation: 'evt-a',
          cursor: job.cursor,
          lastFailureCode: null,
        },
      },
    ]);
  });

  it('retries a stalled pass once a day, clearing the stall so the fired step takes it', async () => {
    const job = jobOf({
      stalledAtUtcMs: TWO_HOURS_AGO,
      lastFailureCode: 'internal',
    });
    const { tx, run } = rig(job, answered);
    await run();
    expect(tx.plans).toEqual([
      [
        policyJobWrite({
          ...job,
          updatedAtUtcMs: FIXTURE_NOW_UTC_MS,
          stalledAtUtcMs: null,
        }),
      ],
    ]);
  });

  it.each([
    ['no job, the window at its default', null],
    ['a finished pass', jobOf({ finishedAtUtcMs: TWO_HOURS_AGO })],
    [
      'a pass that moved within the hour',
      jobOf({ updatedAtUtcMs: MINUTES_AGO }),
    ],
  ])('leaves %s alone', async (_what, job) => {
    const { tx, run } = rig(
      job,
      job === null
        ? lineAt(BookingPolicy.DEFAULT.cancellationWindowHours, null)
        : answered,
    );
    expect(await run()).toEqual({
      ok: true,
      value: {
        policySweepOutcome: PolicySweepOutcome.Idle,
        attemptFailure: null,
        survivedFailure: null,
      },
    });
    expect(tx.plans).toEqual([[]]);
  });

  it('starts the pass a dropped start owed: the policy is newer than the job and draws another line', async () => {
    const job = jobOf({ finishedAtUtcMs: TWO_HOURS_AGO });
    const { tx, telemetry, run } = rig(job, lineAt(24, 1_800_000_500));
    const answer = await run();
    expect(answer.ok && answer.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Started,
    );
    const started = PolicyRecomputeJobSystem.nextStep(
      job,
      {
        generation: `${PolicyRecomputeJobSystem.SWEEP_GENERATION_PREFIX}1800000500.000000000`,
        changedAt: instant(1_800_000_500),
        windowHours: hourCount(24),
      },
      FIXTURE_NOW_UTC_MS,
    );
    if (started === null) throw new Error('a broken fixture');
    expect(tx.plans).toEqual([[policyJobWrite(started)]]);
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: 'policy recompute started by the sweep: a dropped start',
        fields: {
          generation: started.generation,
          changedAtSeconds: started.changedAtSeconds,
          changedAtNanos: started.changedAtNanos,
          windowHours: 24,
        },
      },
    ]);
  });

  it('owes nothing for a newer policy that moved no line — a horizon edit is not a walk over the book', async () => {
    const job = jobOf({ finishedAtUtcMs: TWO_HOURS_AGO });
    const { tx, run } = rig(job, lineAt(48, 1_800_000_500));
    const answer = await run();
    expect(answer.ok && answer.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Idle,
    );
    expect(tx.plans).toEqual([[]]);
  });

  it('owes the first change a pass when there is no job and the window left the default', async () => {
    const { tx, run } = rig(null, lineAt(48, 1_800_000_500));
    const answer = await run();
    expect(answer.ok && answer.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Started,
    );
    expect(tx.plans[0]?.[0]).toMatchObject({
      body: {
        generation: 'sweep:1800000500.000000000',
        cursor: null,
        windowHours: 48,
      },
    });
  });

  it('answers a policy it cannot read through the attempt verdict, reading the job not at all', async () => {
    const tx = memoryTxPorts(memoryStore());
    const run = sweepPolicyRecompute({
      ...tx,
      ...recordingTelemetry(),
      loadPolicyLine: async () =>
        Result.err(
          RepositoryError.readFailed('settings/bookingPolicy', 'unavailable'),
        ),
    });
    const answer = await run();
    expect(answer.ok && answer.value).toMatchObject({
      policySweepOutcome: PolicySweepOutcome.Failed,
      attemptFailure: {
        failureCode: 'unavailable',
        attemptOutcome: AttemptOutcome.Transient,
      },
    });
    expect(tx.transactions).toEqual([]);
  });

  it('lets a failed transaction go on to the edge, for the scheduler’s retry', async () => {
    const outage = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const run = sweepPolicyRecompute({
      ...memoryTxPorts(memoryStore()),
      ...recordingTelemetry(),
      commit: async () => {
        throw outage;
      },
      loadPolicyLine: async () => Result.ok(answered),
    });
    await expect(run()).rejects.toBe(outage);
  });
});
