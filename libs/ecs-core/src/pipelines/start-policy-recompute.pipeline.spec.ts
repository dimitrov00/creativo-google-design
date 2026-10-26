import { describe, expect, it } from 'vitest';
import {
  BookingPolicy,
  type DocBody,
  PolicyStartOutcome,
  PreciseInstant,
  WriteOp,
} from '@core/components';
import { PolicyRecomputeJobId } from '@core/primitives';
import {
  Collections,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
  RecomputeJobName,
} from '@core/entities';
import { PolicyRecomputeJobSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  hourCount,
  memoryStore,
  memoryTxPorts,
} from '@core/testing';
import {
  POLICY_RECOMPUTE_JOB_PATH,
  policyJobWrite,
  startPolicyRecompute,
} from './start-policy-recompute.pipeline';

/*
 * A settings write that moved the late-cancel line starts (or restarts) the
 * policy pass (`recompute-on-policy-change.ts`): ONE transaction on the
 * job, recomputing nobody itself. When a change restarts a pass is
 * `PolicyRecomputeJobSystem.nextStep`'s spec; this one asserts which writes
 * wake it, the plan that reached the commit, and what a failure does.
 */

const instant = (seconds: number) => {
  const at = PreciseInstant.of(seconds, 0);
  if (at === null) throw new Error('a broken fixture');
  return at;
};

const at = (windowHours: number): BookingPolicy => ({
  ...BookingPolicy.DEFAULT,
  cancellationWindowHours: hourCount(windowHours),
});

const change = (
  generation: string,
  seconds: number,
  before: number,
  after: number,
  settingsDocId = 'bookingPolicy',
) => ({
  settingsDocId,
  before: at(before),
  after: at(after),
  generation,
  changedAt: instant(seconds),
});

/** A stored document's body — the entity minus its id (Law 5). */
function bodyOf(entity: { readonly id: string }): DocBody {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

function rig(job: PolicyRecomputeJob | null = null) {
  const store = memoryStore(
    job === null
      ? []
      : [{ path: POLICY_RECOMPUTE_JOB_PATH, body: bodyOf(job) }],
  );
  const tx = memoryTxPorts(store);
  return { store, tx, run: startPolicyRecompute(tx) };
}

/** The pass a change starts from the top, as `nextStep` builds it. */
function passOf(
  generation: string,
  seconds: number,
  windowHours: number,
): PolicyRecomputeJob {
  return {
    id: PolicyRecomputeJobId.FIXED,
    recomputeJobName: RecomputeJobName.ClientStatsPolicy,
    generation,
    changedAtSeconds: instant(seconds).seconds,
    changedAtNanos: instant(seconds).nanos,
    cursor: null,
    storedClients: 0,
    recomputed: 0,
    failed: 0,
    startedAtUtcMs: FIXTURE_NOW_UTC_MS,
    updatedAtUtcMs: FIXTURE_NOW_UTC_MS,
    finishedAtUtcMs: null,
    stepKey: PolicyRecomputeJobSystem.stepKeyOf(generation, null, null),
    stalledAtUtcMs: null,
    lastFailureCode: null,
    windowHours: hourCount(windowHours),
  };
}

describe('startPolicyRecompute', () => {
  it('wakes on the booking policy’s cancellation window and nothing else', async () => {
    const { tx, run } = rig();
    const unmoved = {
      ok: true,
      value: { policyStartOutcome: PolicyStartOutcome.Unmoved },
    };
    // The same window — a horizon, a lead-time or a party-size edit.
    expect(await run(change('evt-1', 1_800_000_000, 24, 24))).toEqual(unmoved);
    // Another settings document.
    expect(
      await run(change('evt-2', 1_800_000_000, 24, 48, 'somethingElse')),
    ).toEqual(unmoved);
    expect(tx.transactions).toEqual([]);
  });

  it('starts a pass from the top and recomputes nobody itself — ONE Set of the job', async () => {
    const { tx, run } = rig();
    expect(await run(change('evt-a', 1_800_000_000, 24, 48))).toEqual({
      ok: true,
      value: { policyStartOutcome: PolicyStartOutcome.Started },
    });
    expect(tx.plans).toEqual([
      [policyJobWrite(passOf('evt-a', 1_800_000_000, 48))],
    ]);
    expect(policyJobWrite(passOf('evt-a', 1_800_000_000, 48))).toEqual(
      WriteOp.set(
        [Collections.BackfillJobs, POLICY_RECOMPUTE_DOC],
        bodyOf(passOf('evt-a', 1_800_000_000, 48)),
      ),
    );
    expect(tx.transactions[0]?.reads).toEqual([POLICY_RECOMPUTE_JOB_PATH]);
    expect(tx.transactions[0]?.queries).toEqual([]);
  });

  it('keeps its place on a redelivery, and against an older change delivered late', async () => {
    const running = passOf('evt-a', 1_800_000_000, 48);
    const { tx, run } = rig(running);
    const unchanged = {
      ok: true,
      value: { policyStartOutcome: PolicyStartOutcome.Unchanged },
    };
    expect(await run(change('evt-a', 1_800_000_000, 24, 48))).toEqual(
      unchanged,
    );
    expect(await run(change('evt-old', 1_700_000_000, 12, 24))).toEqual(
      unchanged,
    );
    expect(tx.plans).toEqual([[], []]);
  });

  it('restarts for a newer change, mid-pass or after it', async () => {
    const midPass = {
      ...passOf('evt-a', 1_800_000_000, 48),
      cursor: null,
      storedClients: 40,
    };
    const { tx, run } = rig(midPass);
    expect(await run(change('evt-b', 1_800_000_100, 48, 24))).toEqual({
      ok: true,
      value: { policyStartOutcome: PolicyStartOutcome.Started },
    });
    expect(tx.plans).toEqual([
      [policyJobWrite(passOf('evt-b', 1_800_000_100, 24))],
    ]);
  });

  it('lets a failed transaction go on to the edge — a transient one is redelivered, a permanent one left to the sweep', async () => {
    const outage = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const run = startPolicyRecompute({
      ...memoryTxPorts(memoryStore()),
      commit: async () => {
        throw outage;
      },
    });
    await expect(run(change('evt-a', 1_800_000_000, 24, 48))).rejects.toBe(
      outage,
    );
  });
});
