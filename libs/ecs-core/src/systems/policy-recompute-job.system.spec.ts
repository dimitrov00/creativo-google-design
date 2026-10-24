import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type PolicyPass,
  PreciseInstant,
  BookingPolicy,
} from '@core/components';
import { type PolicyRecomputeJob, RecomputeJobName } from '@core/entities';
import {
  PolicyRecomputeJobId,
  CustomerId,
  type EpochSeconds,
  type SubsecondNanos,
  UtcEpochMs,
} from '@core/primitives';
import { FIXTURE_TIME_ZONE, deepFreeze, unwrapOk, utcMs } from '@core/testing';
import {
  type PolicyChange,
  PolicyRecomputeJobSystem,
  type PolicyStep,
} from './policy-recompute-job.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of apps/functions/src/lib/clients/policy-recompute-plan.spec.ts
 * and the policy-pass cases of client-stats-projection.spec.ts, copied (the
 * legacy specs ran against their shims until a flip deleted them) and
 * re-targeted to the
 * flat job entity: every lifecycle instant a `UtcEpochMs` (`*UtcMs`), the
 * change instant the D17 halves `changedAtSeconds` + `changedAtNanos` (a
 * `PreciseInstant` value in system I/O) compared as integers, the cursor a
 * `CustomerId` (a client record, D29), the verdict the SCREAMING
 * `policyPassVerdict`. Reading an RFC 3339 string (offsets, digit counts)
 * is the edge's parse, not the
 * system's, so those cases assert the struct order they parse to; an
 * unreadable instant is the corrupt value a zero-mapper read of a broken
 * document hands over (a cast HERE, standing for the bytes). The document
 * mapper round-trips have no successor here — the document IS the entity.
 */

const {
  SWEEP_GENERATION_PREFIX,
  STALE_AFTER_MS,
  advance,
  catchUp,
  compareInstants,
  judgePolicyPass,
  nextStep,
  nudge,
  sameStep,
  stall,
} = PolicyRecomputeJobSystem;

const T0 = utcMs('2026-09-25T08:00:00.000Z');
const DAY_MS = 86_400_000;
/** `T0` moved by `ms` — an instant. */
const t = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(T0 + ms));
/** The D17 value of the instant `T0 + ms`. */
const at = (ms: number): PreciseInstant => PreciseInstant.fromEpochMs(t(ms));
/** The job's flat change-instant fields for `T0 + ms`. */
const changedAtFields = (ms: number) => ({
  changedAtSeconds: at(ms).seconds,
  changedAtNanos: at(ms).nanos,
});
const change = (
  generation: string,
  offsetMs: number,
  windowHours: number | null = null,
): PolicyChange => ({ generation, changedAt: at(offsetMs), windowHours });
/** An instant of whole second `wall` (UTC text) plus `nanos`. */
const precise = (wall: string, nanos: number): PreciseInstant => {
  const instant = PreciseInstant.of(utcMs(wall) / 1000, nanos);
  if (instant === null) throw new Error('a broken fixture instant');
  return instant;
};
/** What a zero-mapper read of a broken stored stamp hands over (corrupt bytes, not a brand). */
const NOT_A_NUMBER = Number.NaN as EpochSeconds & SubsecondNanos & UtcEpochMs;
const UNREADABLE: PreciseInstant = {
  seconds: NOT_A_NUMBER,
  nanos: NOT_A_NUMBER,
};
const step = (overrides: Partial<PolicyStep> = {}): PolicyStep => ({
  cursor: CustomerId.of('m'),
  exhausted: false,
  visited: 9,
  recomputed: 9,
  failed: 0,
  ...overrides,
});
const start = (generation: string, offsetMs: number, nowMs = offsetMs) =>
  nextStep(null, change(generation, offsetMs), t(nowMs)) as PolicyRecomputeJob;

describe('the job document', () => {
  it('lives beside runBackfill’s jobs, under its fixed id', () => {
    const job = start('evt-a', 0);
    expect(job.id).toBe(PolicyRecomputeJobId.FIXED);
    expect(job.id).toBe('clientStatsPolicy');
    expect(job.recomputeJobName).toBe(RecomputeJobName.ClientStatsPolicy);
  });

  it('is plain data through every step — what is stored is what is read', () => {
    const job = start('evt-a', 0, 5);
    const advanced = advance(
      job,
      step({
        cursor: CustomerId.of('ana'),
        visited: 3,
        recomputed: 2,
        failed: 1,
      }),
      t(9),
    );
    expect(JSON.parse(JSON.stringify(advanced))).toEqual(advanced);
    const stalled = stall(advanced, 'internal', t(11));
    expect(JSON.parse(JSON.stringify(stalled))).toEqual(stalled);
    expect(stalled.recomputeJobName).toBe('CLIENT_STATS_POLICY');
  });
});

describe('nextStep (planPolicyJobStart)', () => {
  const running = start('evt-b', 0);

  it('starts from the top with nothing counted', () => {
    expect(running).toMatchObject({
      generation: 'evt-b',
      ...changedAtFields(0),
      cursor: null,
      storedClients: 0,
      recomputed: 0,
      failed: 0,
      finishedAtUtcMs: null,
      startedAtUtcMs: T0,
      updatedAtUtcMs: T0,
    });
  });

  it('leaves the job to a redelivery of its own change and to an older one', () => {
    expect(nextStep(running, change('evt-b', 0), T0)).toBeNull();
    expect(nextStep(running, change('evt-a', -1), T0)).toBeNull();
  });

  it('restarts for a newer change, or one at the same instant, even mid-pass or after it', () => {
    const midway = advance(running, step(), t(1));
    const done = advance(
      midway,
      step({ cursor: CustomerId.of('z'), exhausted: true }),
      t(2),
    );
    for (const job of [midway, done]) {
      expect(nextStep(job, change('evt-c', 3), t(4))).toMatchObject({
        generation: 'evt-c',
        cursor: null,
        finishedAtUtcMs: null,
      });
    }
    expect(nextStep(running, change('evt-x', 0), T0)?.generation).toBe('evt-x');
  });

  // Firestore stamps event times in microseconds: two owner edits inside one
  // millisecond are still ordered, and the older one's late redelivery must
  // not restart the newer one's pass (work repeated for nothing).
  it('orders changes to the microsecond, not the millisecond', () => {
    const wall = '2026-09-25T08:00:00Z';
    const newer = nextStep(
      null,
      {
        generation: 'evt-new',
        changedAt: precise(wall, 123_456_000),
        windowHours: null,
      },
      T0,
    ) as PolicyRecomputeJob;
    expect(
      nextStep(
        newer,
        {
          generation: 'evt-old',
          changedAt: precise(wall, 123_400_000),
          windowHours: null,
        },
        T0,
      ),
    ).toBeNull();
    expect(
      nextStep(
        newer,
        {
          generation: 'evt-next',
          changedAt: precise(wall, 123_500_000),
          windowHours: null,
        },
        T0,
      )?.generation,
    ).toBe('evt-next');
  });

  // The supersession rule as an invariant: whatever order the platform
  // delivers the changes in, and however often, the newest one ends up
  // owning the pass — so the last pass reads the owner's last word.
  it('hands the job to the newest change, whatever the delivery order', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), {
            minLength: 1,
            maxLength: 8,
          })
          .chain((times) => {
            // Every change at least once, some again, in any order.
            const indices = [...times.keys()];
            return fc
              .array(fc.constantFrom(...indices), {
                maxLength: 2 * times.length,
              })
              .chain((again) => {
                const all = [...indices, ...again];
                return fc.tuple(
                  fc.constant(times),
                  fc.shuffledSubarray(all, {
                    minLength: all.length,
                    maxLength: all.length,
                  }),
                );
              });
          }),
        ([times, order]) => {
          let job: PolicyRecomputeJob | null = null;
          for (const index of order) {
            const offsetMs = times.at(index) ?? 0;
            job = nextStep(job, change(`evt-${index}`, offsetMs), T0) ?? job;
          }
          const newest = times.indexOf(Math.max(...times));
          expect(job?.generation).toBe(`evt-${newest}`);
        },
      ),
    );
  });

  it('restarts over a stamp it cannot read — never skips on an unreadable instant', () => {
    const garbled = {
      ...running,
      changedAtSeconds: UNREADABLE.seconds,
      changedAtNanos: UNREADABLE.nanos,
    };
    expect(nextStep(garbled, change('evt-z', -DAY_MS), T0)).toMatchObject({
      generation: 'evt-z',
    });
  });
});

describe('compareInstants — full precision, { seconds, nanos } (§9 D17)', () => {
  it('reads microseconds epoch ms drops, and refuses what is not an instant', () => {
    const wall = '2026-09-25T08:00:00Z';
    expect(
      compareInstants(precise(wall, 123_456_000), precise(wall, 123_457_000)),
    ).toBeLessThan(0);
    // 10:00:00.5+02:00 and 08:00:00.500000Z parse to the same struct.
    expect(
      compareInstants(precise(wall, 500_000_000), precise(wall, 500_000_000)),
    ).toBe(0);
    expect(
      compareInstants(
        precise('2026-09-25T08:00:01Z', 0),
        precise(wall, 999_999_000),
      ),
    ).toBeGreaterThan(0);
    expect(compareInstants(UNREADABLE, precise(wall, 0))).toBeNull();
    expect(
      compareInstants(precise(wall, 0), {
        seconds: precise(wall, 0).seconds,
        nanos: 1e9 as SubsecondNanos,
      }),
    ).toBeNull();
  });

  it('orders any two instants as their microseconds do', () => {
    const micros = fc.bigInt({
      min: 946_684_800_000_000n, // 2000-01-01
      max: 4_102_444_800_000_000n, // 2100-01-01
    });
    const struct = (m: bigint): PreciseInstant => {
      const instant = PreciseInstant.of(
        Number(m / 1_000_000n),
        Number(m % 1_000_000n) * 1000,
      );
      if (instant === null) throw new Error('a broken fixture instant');
      return instant;
    };
    fc.assert(
      fc.property(micros, micros, (a, b) => {
        const order = compareInstants(struct(a), struct(b));
        expect(Math.sign(order ?? Number.NaN)).toBe(a < b ? -1 : a > b ? 1 : 0);
      }),
    );
  });
});

describe('stall and nudge — a stalled pass is findable and restartable', () => {
  const job = advance(start('evt-a', 0), step(), t(1_000));

  it('records the stall and its code, keeping the cursor and when the pass last moved', () => {
    const stalled = stall(job, 'internal', t(2_000));
    expect(stalled).toMatchObject({
      cursor: 'm',
      updatedAtUtcMs: t(1_000),
      stalledAtUtcMs: t(2_000),
      lastFailureCode: 'internal',
    });
    // Still the same step: a stall is no step of its own.
    expect(sameStep(stalled, job)).toBe(true);
    expect(stalled.stepKey).toBe(job.stepKey);
    // The next step that moves the pass ends the stall.
    expect(
      advance(
        stalled,
        step({ cursor: CustomerId.of('z'), visited: 1, recomputed: 0 }),
        t(3_000),
      ),
    ).toMatchObject({ stalledAtUtcMs: null, lastFailureCode: null });
  });

  it('nudges an unfinished pass only once it has not moved for an hour', () => {
    const nudgeAt = (ms: number) => nudge(job, t(ms));
    expect(STALE_AFTER_MS).toBe(3_600_000);
    expect(nudgeAt(1_000 + STALE_AFTER_MS - 1)).toBeNull();
    expect(nudgeAt(1_000 + STALE_AFTER_MS)).toEqual({
      ...job,
      updatedAtUtcMs: t(1_000 + STALE_AFTER_MS),
    });
  });

  it('clears a stall so the fired step takes it, keeping the step and the last code', () => {
    const later = t(1_000 + 2 * STALE_AFTER_MS);
    const nudged = nudge(stall(job, 'internal', t(2_000)), later);
    expect(nudged).toMatchObject({
      stalledAtUtcMs: null,
      lastFailureCode: 'internal',
      updatedAtUtcMs: later,
    });
    expect(sameStep(nudged as PolicyRecomputeJob, job)).toBe(true);
  });

  it('leaves no job, a finished one, and a freshly nudged one alone — so the sweep is idempotent', () => {
    const later = t(1_000 + 2 * STALE_AFTER_MS);
    expect(nudge(null, later)).toBeNull();
    const done = advance(
      job,
      step({
        cursor: CustomerId.of('z'),
        exhausted: true,
        visited: 1,
        recomputed: 0,
      }),
      t(2_000),
    );
    expect(nudge(done, later)).toBeNull();
    const nudged = nudge(job, later) as PolicyRecomputeJob;
    expect(nudge(nudged, later)).toBeNull();
  });

  it('nudges a pass whose last move it cannot read', () => {
    const unknown = { ...job, updatedAtUtcMs: NOT_A_NUMBER };
    expect(nudge(unknown, T0)).toMatchObject({ updatedAtUtcMs: T0 });
  });
});

describe('sameStep and advance — one continuation per step', () => {
  const job = start('evt-a', 0);

  it('moves the step key on every advance, so a stale delivery fails the compare-and-set', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.boolean(),
        fc.nat(50),
        (fromRaw, to, exhausted, visited) => {
          const from = fromRaw === null ? null : CustomerId.of(fromRaw);
          const here = {
            ...job,
            cursor: from,
            stepKey: PolicyRecomputeJobSystem.stepKeyOf(
              job.generation,
              from,
              null,
            ),
          };
          // A step that is not the last finished a page, so its cursor moved.
          const cursor = exhausted ? from : CustomerId.of(`${from ?? ''}${to}`);
          const next = advance(
            here,
            { cursor, exhausted, visited, recomputed: 0, failed: 0 },
            t(1),
          );
          expect(sameStep(next, here)).toBe(false);
          expect(next.stepKey).not.toBe(here.stepKey);
          expect(sameStep(here, here)).toBe(true);
        },
      ),
    );
  });

  it('adds the step’s counts and stamps the end', () => {
    const next = advance(
      { ...job, storedClients: 5, recomputed: 2, failed: 1 },
      {
        cursor: CustomerId.of('z'),
        exhausted: true,
        visited: 3,
        recomputed: 1,
        failed: 0,
      },
      t(7),
    );
    expect(next).toMatchObject({
      cursor: 'z',
      storedClients: 8,
      recomputed: 3,
      failed: 1,
      updatedAtUtcMs: t(7),
      finishedAtUtcMs: t(7),
      stepKey: PolicyRecomputeJobSystem.stepKeyOf(
        'evt-a',
        CustomerId.of('z'),
        t(7),
      ),
    });
  });
});

describe('the line a pass draws (windowHours)', () => {
  it('is recorded from the change, kept by every step, and unknown when the change did not say', () => {
    const job = nextStep(
      null,
      change('evt-a', 0, 48),
      T0,
    ) as PolicyRecomputeJob;
    expect(job.windowHours).toBe(48);
    expect(start('evt-b', 0).windowHours).toBeNull();
    // A step keeps it: the pass draws one line from its start to its end.
    const advanced = advance(
      job,
      step({ cursor: CustomerId.of('ana'), visited: 1, recomputed: 1 }),
      t(1),
    );
    expect(advanced.windowHours).toBe(48);
  });
});

describe('a document update time, at full precision (timestampIso)', () => {
  it('keeps a document update time at its full precision, in the order the store kept it', () => {
    expect(PreciseInstant.of(1_790_000_000, 1_000)).toEqual({
      seconds: 1_790_000_000,
      nanos: 1_000,
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }),
        fc.integer({ min: 0, max: 999_999_999 }),
        fc.integer({ min: 0, max: 999_999_999 }),
        (seconds, a, b) => {
          const order = compareInstants(
            PreciseInstant.of(seconds, a) as PreciseInstant,
            PreciseInstant.of(seconds, b) as PreciseInstant,
          );
          expect(Math.sign(order ?? NaN)).toBe(Math.sign(a - b));
        },
      ),
    );
  });
});

describe('catchUp (planPolicyCatchUp) — the pass a dropped start owed', () => {
  const pass = (windowHours: number | null, changedMs = 0) =>
    nextStep(
      null,
      change('evt-a', changedMs, windowHours),
      t(changedMs),
    ) as PolicyRecomputeJob;
  const done = (job: PolicyRecomputeJob) =>
    advance(
      job,
      {
        cursor: CustomerId.of('z'),
        exhausted: true,
        visited: 2,
        recomputed: 2,
        failed: 0,
      },
      t(10),
    );
  const line = (updatedMs: number | null, windowHours: number) => ({
    updatedAt: updatedMs === null ? null : at(updatedMs),
    windowHours,
  });
  /** The sweep's label for a change: the edge renders the instant. */
  const label = (ms: number) => ZonedTimeSystem.toIso(t(ms), FIXTURE_TIME_ZONE);

  it('starts one from the top when the policy is newer and draws another line', () => {
    const owed = catchUp(
      done(pass(48)),
      line(5_000, 24),
      t(9_000),
      label(5_000),
    );
    expect(owed).toMatchObject({
      generation: `${SWEEP_GENERATION_PREFIX}${label(5_000)}`,
      ...changedAtFields(5_000),
      windowHours: 24,
      cursor: null,
      finishedAtUtcMs: null,
      startedAtUtcMs: t(9_000),
    });
    // It supersedes a running pass too: that one draws the older line.
    expect(
      catchUp(pass(48), line(5_000, 24), t(9_000), label(5_000))?.cursor,
    ).toBeNull();
  });

  it('owes nothing when the job already answers the document, or the document moved no line', () => {
    const job = done(pass(48));
    // The same write (the trigger's event time is the document's update time).
    expect(catchUp(job, line(0, 48), T0, label(0))).toBeNull();
    // An older document than the job's change.
    expect(catchUp(job, line(-1, 24), T0, label(-1))).toBeNull();
    // A newer edit — the horizon, the lead time — at the job's own window.
    expect(catchUp(job, line(5_000, 48), T0, label(5_000))).toBeNull();
  });

  // The refinement's known residual, pinned so dropping the window check is
  // a decision the spec makes visible (see `owesCatchUp`).
  it('does not see a line moved and moved back with both starts dropped — the manual backfill repairs it', () => {
    const job = done(pass(48));
    // 48 → 24 at T0 + 5 s (dropped), 24 → 48 at T0 + 9 s (dropped): the live
    // document is newer than the job, and draws the job's own line.
    expect(catchUp(job, line(9_000, 48), t(DAY_MS), label(9_000))).toBeNull();
  });

  it('owes a job that cannot say its line one pass, once', () => {
    const legacy = done(pass(null));
    const live = line(5_000, 48);
    const owed = catchUp(legacy, live, t(9_000), label(5_000));
    expect(owed?.windowHours).toBe(48);
    if (owed === null) throw new Error('nothing owed');
    expect(catchUp(done(owed), live, t(DAY_MS), label(5_000))).toBeNull();
  });

  it('with no job at all, owes a pass only when the window left the default', () => {
    expect(BookingPolicy.DEFAULT.cancellationWindowHours).toBe(24);
    expect(catchUp(null, line(0, 24), t(1), label(0))).toBeNull();
    expect(catchUp(null, line(null, 24), T0, label(0))).toBeNull();
    expect(catchUp(null, line(0, 48), T0, label(0))).toMatchObject({
      ...changedAtFields(0),
      windowHours: 48,
    });
  });

  it('reads a deleted policy document as the defaults, owed when the job drew another line', () => {
    expect(
      catchUp(done(pass(48)), line(null, 24), t(9_000), label(9_000)),
    ).toMatchObject({
      generation: `${SWEEP_GENERATION_PREFIX}${label(9_000)}`,
      ...changedAtFields(9_000),
      windowHours: 24,
    });
    expect(
      catchUp(done(pass(24)), line(null, 24), t(9_000), label(9_000)),
    ).toBeNull();
  });
});

describe('judgePolicyPass — a newer pass has the last word', () => {
  const passAt = (generation: string, offsetMs: number): PolicyPass => ({
    generation,
    changedAt: at(offsetMs),
  });

  it('refuses a pass older than the stamp, and only that', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -60_000, max: 60_000 }),
        fc.constantFrom('evt-a', 'evt-b'),
        (offsetMs, generation) => {
          const stored = passAt('evt-b', 0);
          const mine = passAt(generation, offsetMs);
          const verdict = judgePolicyPass(mine, stored);
          if (generation === 'evt-b') {
            // A re-run of the same pass: judged, the stamp left as it is.
            expect(verdict).toEqual({
              policyPassVerdict: 'JUDGE',
              stamp: stored,
              restamp: false,
            });
          } else if (offsetMs < 0) {
            expect(verdict).toEqual({ policyPassVerdict: 'SUPERSEDED' });
          } else {
            expect(verdict).toEqual({
              policyPassVerdict: 'JUDGE',
              stamp: mine,
              restamp: true,
            });
          }
        },
      ),
    );
  });

  it('orders passes to the microsecond', () => {
    const wall = '2026-09-25T08:00:00Z';
    const newer: PolicyPass = {
      generation: 'evt-new',
      changedAt: precise(wall, 123_456_000),
    };
    const older: PolicyPass = {
      generation: 'evt-old',
      changedAt: precise(wall, 123_400_000),
    };
    expect(judgePolicyPass(older, newer)).toEqual({
      policyPassVerdict: 'SUPERSEDED',
    });
    expect(judgePolicyPass(newer, older).policyPassVerdict).toBe('JUDGE');
  });

  it('stamps a first judgement, carries the stamp for a writer that is not a pass, and never skips on an unreadable instant', () => {
    const stored = passAt('evt-a', 0);
    expect(judgePolicyPass(stored, null)).toEqual({
      policyPassVerdict: 'JUDGE',
      stamp: stored,
      restamp: true,
    });
    expect(judgePolicyPass(null, stored)).toEqual({
      policyPassVerdict: 'JUDGE',
      stamp: stored,
      restamp: false,
    });
    expect(judgePolicyPass(null, null)).toEqual({
      policyPassVerdict: 'JUDGE',
      stamp: null,
      restamp: false,
    });
    const garbled = { generation: 'evt-z', changedAt: UNREADABLE };
    expect(judgePolicyPass(garbled, stored).policyPassVerdict).toBe('JUDGE');
  });

  it('hands back the stamp by reference — one of its two inputs', () => {
    const mine = passAt('evt-b', 1);
    const verdict = judgePolicyPass(mine, passAt('evt-a', 0));
    expect(verdict.policyPassVerdict === 'JUDGE' && verdict.stamp).toBe(mine);
  });
});

describe('isIdle and shouldRecordStall — a delivery that leaves the pass alone (pass C, P-23)', () => {
  const { isIdle, shouldRecordStall } = PolicyRecomputeJobSystem;
  const running = advance(start('evt-a', 0), step(), t(1_000));

  it('rests on a deleted job, a finished pass and the write that recorded a stall', () => {
    expect(isIdle(null)).toBe(true);
    expect(isIdle(advance(running, step({ exhausted: true }), t(2_000)))).toBe(
      true,
    );
    expect(isIdle(stall(running, 'internal', t(2_000)))).toBe(true);
    // A running pass, and one the sweep nudged out of its stall, step on.
    expect(isIdle(running)).toBe(false);
    expect(
      isIdle(
        nudge(stall(running, 'internal', t(2_000)), t(1_000 + STALE_AFTER_MS)),
      ),
    ).toBe(false);
  });

  it('records a stall only on the step it was fired for', () => {
    expect(shouldRecordStall(running, running, 'internal')).toBe(true);
    // A deleted job, a pass that moved on, a newer pass: never marked.
    expect(shouldRecordStall(null, running, 'internal')).toBe(false);
    const movedOn = advance(
      running,
      step({ cursor: CustomerId.of('z') }),
      t(2_000),
    );
    expect(shouldRecordStall(movedOn, running, 'internal')).toBe(false);
    const superseded = nextStep(running, change('evt-b', 5), t(5));
    expect(
      shouldRecordStall(superseded as PolicyRecomputeJob, running, 'internal'),
    ).toBe(false);
  });

  it('does not rewrite a stall already recorded with the same code — a stale delivery failing the same way', () => {
    const recorded = stall(running, 'internal', t(2_000));
    expect(shouldRecordStall(recorded, running, 'internal')).toBe(false);
    // Another code is news: it is recorded over the old one.
    expect(shouldRecordStall(recorded, running, 'unavailable')).toBe(true);
    // A cleared stall still remembers its code, but records it again.
    const nudged = nudge(recorded, t(1_000 + 2 * STALE_AFTER_MS));
    expect(
      shouldRecordStall(nudged as PolicyRecomputeJob, running, 'internal'),
    ).toBe(true);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const live = deepFreeze(stall(running, 'internal', t(2_000)));
    const fired = deepFreeze(running);
    expect(isIdle(live)).toBe(isIdle(live));
    expect(shouldRecordStall(live, fired, 'unavailable')).toBe(
      shouldRecordStall(live, fired, 'unavailable'),
    );
    expect(live.lastFailureCode).toBe('internal');
  });
});

describe('purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const job = deepFreeze(advance(start('evt-a', 0), step(), t(1)));
    const live = deepFreeze({ updatedAt: at(5), windowHours: 48 });
    const run = () => [
      nextStep(job, deepFreeze(change('evt-b', 2)), t(3)),
      advance(job, deepFreeze(step({ cursor: CustomerId.of('q') })), t(4)),
      stall(job, 'internal', t(5)),
      nudge(job, t(2 * STALE_AFTER_MS)),
      catchUp(job, live, t(6), 'label'),
    ];
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(job.cursor).toBe('m');
  });
});
