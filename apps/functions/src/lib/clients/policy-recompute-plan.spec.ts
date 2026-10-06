import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  POLICY_JOB_STALE_AFTER_MS,
  POLICY_RECOMPUTE_PATH,
  type PolicyRecomputeJob,
  SWEEP_GENERATION_PREFIX,
  advancePolicyJob,
  compareInstants,
  planPolicyCatchUp,
  planPolicyJobNudge,
  planPolicyJobStart,
  policyJobFromDocument,
  policyJobToDocument,
  sameStep,
  stallPolicyJob,
  timestampIso,
} from './policy-recompute-plan';

const T0 = Date.parse('2026-09-25T08:00:00.000Z');
const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const change = (eventId: string, atMs: number) => ({
  eventId,
  atIso: iso(atMs),
});

describe('the job document', () => {
  it('lives beside runBackfill’s jobs', () => {
    expect(POLICY_RECOMPUTE_PATH).toBe('backfillJobs/clientStatsPolicy');
  });

  it('round-trips, and reads a broken one as none', () => {
    const job = planPolicyJobStart(null, change('evt-a', T0), iso(T0 + 5));
    if (job === null) throw new Error('bad fixture');
    const advanced = advancePolicyJob(
      job,
      { cursor: 'ana', exhausted: false, visited: 3, recomputed: 2, failed: 1 },
      iso(T0 + 9),
    );
    expect(policyJobFromDocument(policyJobToDocument(advanced))).toEqual(
      advanced,
    );
    const stalled = stallPolicyJob(advanced, 'internal', iso(T0 + 11));
    expect(policyJobFromDocument(policyJobToDocument(stalled))).toEqual(
      stalled,
    );
    // A document written before the stall fields reads as never stalled.
    const older = Object.fromEntries(
      Object.entries(policyJobToDocument(advanced)).filter(
        ([field]) => field !== 'stalledAt' && field !== 'lastFailureCode',
      ),
    );
    expect(policyJobFromDocument(older)).toEqual(advanced);
    expect(policyJobToDocument(advanced)['job']).toBe('clientStatsPolicy');
    expect(policyJobFromDocument(undefined)).toBeNull();
    expect(policyJobFromDocument({ cursor: 'ana' })).toBeNull();
  });
});

describe('planPolicyJobStart', () => {
  const running = planPolicyJobStart(
    null,
    change('evt-b', T0),
    iso(T0),
  ) as PolicyRecomputeJob;

  it('starts from the top with nothing counted', () => {
    expect(running).toMatchObject({
      generation: 'evt-b',
      cursor: null,
      storedClients: 0,
      recomputed: 0,
      failed: 0,
      finishedAt: null,
    });
  });

  it('leaves the job to a redelivery of its own change and to an older one', () => {
    expect(
      planPolicyJobStart(running, change('evt-b', T0), iso(T0)),
    ).toBeNull();
    expect(
      planPolicyJobStart(running, change('evt-a', T0 - 1), iso(T0)),
    ).toBeNull();
  });

  it('restarts for a newer change, or one at the same instant, even mid-pass or after it', () => {
    const midway = advancePolicyJob(
      running,
      { cursor: 'm', exhausted: false, visited: 9, recomputed: 9, failed: 0 },
      iso(T0 + 1),
    );
    const done = advancePolicyJob(
      midway,
      { cursor: 'z', exhausted: true, visited: 9, recomputed: 9, failed: 0 },
      iso(T0 + 2),
    );
    for (const job of [midway, done]) {
      expect(
        planPolicyJobStart(job, change('evt-c', T0 + 3), iso(T0 + 4)),
      ).toMatchObject({ generation: 'evt-c', cursor: null, finishedAt: null });
    }
    expect(
      planPolicyJobStart(running, change('evt-x', T0), iso(T0))?.generation,
    ).toBe('evt-x');
  });

  // Firestore stamps event times in microseconds: two owner edits inside one
  // millisecond are still ordered, and the older one's late redelivery must
  // not restart the newer one's pass (work repeated for nothing).
  it('orders changes to the microsecond, not the millisecond', () => {
    const newer = planPolicyJobStart(
      null,
      { eventId: 'evt-new', atIso: '2026-09-25T08:00:00.123456Z' },
      iso(T0),
    ) as PolicyRecomputeJob;
    expect(
      planPolicyJobStart(
        newer,
        { eventId: 'evt-old', atIso: '2026-09-25T08:00:00.123400Z' },
        iso(T0),
      ),
    ).toBeNull();
    expect(
      planPolicyJobStart(
        newer,
        { eventId: 'evt-next', atIso: '2026-09-25T08:00:00.1235Z' },
        iso(T0),
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
            const atMs = T0 + (times.at(index) ?? 0);
            job =
              planPolicyJobStart(job, change(`evt-${index}`, atMs), iso(T0)) ??
              job;
          }
          const newest = times.indexOf(Math.max(...times));
          expect(job?.generation).toBe(`evt-${newest}`);
        },
      ),
    );
  });
});

describe('compareInstants — RFC 3339 at full precision', () => {
  /** An instant as epoch microseconds, written at `offsetMinutes` with `digits` of fraction. */
  function render(micros: bigint, offsetMinutes: number, digits: number) {
    const seconds = Number(micros / 1_000_000n);
    const fraction = String(micros % 1_000_000n).padStart(6, '0');
    const wall = new Date((seconds + offsetMinutes * 60) * 1000)
      .toISOString()
      .slice(0, 19);
    const sign = offsetMinutes < 0 ? '-' : '+';
    const hh = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(
      2,
      '0',
    );
    const mm = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
    const zone = offsetMinutes === 0 ? 'Z' : `${sign}${hh}:${mm}`;
    return `${wall}.${fraction.padEnd(digits, '0')}${zone}`;
  }

  it('reads microseconds Date.parse drops, offsets, and refuses what is not an instant', () => {
    expect(
      compareInstants(
        '2026-09-25T08:00:00.123456Z',
        '2026-09-25T08:00:00.123457Z',
      ),
    ).toBeLessThan(0);
    expect(
      compareInstants(
        '2026-09-25T10:00:00.5+02:00',
        '2026-09-25T08:00:00.500000Z',
      ),
    ).toBe(0);
    expect(
      compareInstants('2026-09-25T08:00:01Z', '2026-09-25T08:00:00.999999Z'),
    ).toBeGreaterThan(0);
    expect(compareInstants('yesterday', '2026-09-25T08:00:00Z')).toBeNull();
  });

  it('orders any two instants as their microseconds do, however they are written', () => {
    const micros = fc.bigInt({
      min: 946_684_800_000_000n, // 2000-01-01
      max: 4_102_444_800_000_000n, // 2100-01-01
    });
    const written = fc.record({
      offset: fc.constantFrom(0, 120, 180, -300, 330),
      digits: fc.constantFrom(6, 9),
    });
    fc.assert(
      fc.property(micros, micros, written, written, (a, b, wa, wb) => {
        const order = compareInstants(
          render(a, wa.offset, wa.digits),
          render(b, wb.offset, wb.digits),
        );
        expect(Math.sign(order ?? Number.NaN)).toBe(a < b ? -1 : a > b ? 1 : 0);
      }),
    );
  });
});

describe('stallPolicyJob and planPolicyJobNudge — a stalled pass is findable and restartable', () => {
  const job = advancePolicyJob(
    planPolicyJobStart(
      null,
      change('evt-a', T0),
      iso(T0),
    ) as PolicyRecomputeJob,
    { cursor: 'm', exhausted: false, visited: 9, recomputed: 9, failed: 0 },
    iso(T0 + 1_000),
  );

  it('records the stall and its code, keeping the cursor and when the pass last moved', () => {
    const stalled = stallPolicyJob(job, 'internal', iso(T0 + 2_000));
    expect(stalled).toMatchObject({
      cursor: 'm',
      updatedAt: iso(T0 + 1_000),
      stalledAt: iso(T0 + 2_000),
      lastFailureCode: 'internal',
    });
    // Still the same step: a stall is no step of its own.
    expect(sameStep(stalled, job)).toBe(true);
    // The next step that moves the pass ends the stall.
    expect(
      advancePolicyJob(
        stalled,
        { cursor: 'z', exhausted: false, visited: 1, recomputed: 0, failed: 0 },
        iso(T0 + 3_000),
      ),
    ).toMatchObject({ stalledAt: null, lastFailureCode: null });
  });

  it('nudges an unfinished pass only once it has not moved for an hour', () => {
    const at = (ms: number) => planPolicyJobNudge(job, iso(ms));
    expect(POLICY_JOB_STALE_AFTER_MS).toBe(3_600_000);
    expect(at(T0 + 1_000 + POLICY_JOB_STALE_AFTER_MS - 1)).toBeNull();
    expect(at(T0 + 1_000 + POLICY_JOB_STALE_AFTER_MS)).toEqual({
      ...job,
      updatedAt: iso(T0 + 1_000 + POLICY_JOB_STALE_AFTER_MS),
    });
  });

  it('clears a stall so the fired step takes it, keeping the step and the last code', () => {
    const later = T0 + 1_000 + 2 * POLICY_JOB_STALE_AFTER_MS;
    const nudged = planPolicyJobNudge(
      stallPolicyJob(job, 'internal', iso(T0 + 2_000)),
      iso(later),
    );
    expect(nudged).toMatchObject({
      stalledAt: null,
      lastFailureCode: 'internal',
      updatedAt: iso(later),
    });
    expect(sameStep(nudged as PolicyRecomputeJob, job)).toBe(true);
  });

  it('leaves no job, a finished one, and a freshly nudged one alone — so the sweep is idempotent', () => {
    const later = iso(T0 + 1_000 + 2 * POLICY_JOB_STALE_AFTER_MS);
    expect(planPolicyJobNudge(null, later)).toBeNull();
    const done = advancePolicyJob(
      job,
      { cursor: 'z', exhausted: true, visited: 1, recomputed: 0, failed: 0 },
      iso(T0 + 2_000),
    );
    expect(planPolicyJobNudge(done, later)).toBeNull();
    const nudged = planPolicyJobNudge(job, later) as PolicyRecomputeJob;
    expect(planPolicyJobNudge(nudged, later)).toBeNull();
  });
});

describe('sameStep and advancePolicyJob — one continuation per step', () => {
  const job = planPolicyJobStart(
    null,
    change('evt-a', T0),
    iso(T0),
  ) as PolicyRecomputeJob;

  it('moves the step key on every advance, so a stale delivery fails the compare-and-set', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.boolean(),
        fc.nat(50),
        (from, to, exhausted, visited) => {
          const at = { ...job, cursor: from };
          // A step that is not the last finished a page, so its cursor moved.
          const cursor = exhausted ? from : `${from ?? ''}${to}`;
          const next = advancePolicyJob(
            at,
            { cursor, exhausted, visited, recomputed: 0, failed: 0 },
            iso(T0 + 1),
          );
          expect(sameStep(next, at)).toBe(false);
          expect(sameStep(at, at)).toBe(true);
        },
      ),
    );
  });

  it('adds the step’s counts and stamps the end', () => {
    const next = advancePolicyJob(
      { ...job, storedClients: 5, recomputed: 2, failed: 1 },
      { cursor: 'z', exhausted: true, visited: 3, recomputed: 1, failed: 0 },
      iso(T0 + 7),
    );
    expect(next).toMatchObject({
      cursor: 'z',
      storedClients: 8,
      recomputed: 3,
      failed: 1,
      updatedAt: iso(T0 + 7),
      finishedAt: iso(T0 + 7),
    });
  });
});

describe('the line a pass draws (windowHours)', () => {
  it('is recorded from the change, round-trips, and reads as unknown on an older job', () => {
    const job = planPolicyJobStart(
      null,
      { ...change('evt-a', T0), windowHours: 48 },
      iso(T0),
    );
    if (job === null) throw new Error('bad fixture');
    expect(job.windowHours).toBe(48);
    expect(policyJobFromDocument(policyJobToDocument(job))).toEqual(job);
    const older = Object.fromEntries(
      Object.entries(policyJobToDocument(job)).filter(
        ([field]) => field !== 'windowHours',
      ),
    );
    expect(policyJobFromDocument(older)?.windowHours).toBeNull();
    // A step keeps it: the pass draws one line from its start to its end.
    const advanced = advancePolicyJob(
      job,
      { cursor: 'ana', exhausted: false, visited: 1, recomputed: 1, failed: 0 },
      iso(T0 + 1),
    );
    expect(advanced.windowHours).toBe(48);
  });
});

describe('timestampIso', () => {
  it('keeps a document update time at its full precision, in the order the store kept it', () => {
    expect(timestampIso({ seconds: 1_790_000_000, nanoseconds: 1_000 })).toBe(
      '2026-09-21T14:13:20.000001000Z',
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }),
        fc.integer({ min: 0, max: 999_999_999 }),
        fc.integer({ min: 0, max: 999_999_999 }),
        (seconds, a, b) => {
          const order = compareInstants(
            timestampIso({ seconds, nanoseconds: a }),
            timestampIso({ seconds, nanoseconds: b }),
          );
          expect(Math.sign(order ?? NaN)).toBe(Math.sign(a - b));
        },
      ),
    );
  });
});

describe('planPolicyCatchUp — the pass a dropped start owed', () => {
  const at = (ms: number) => iso(ms);
  const pass = (windowHours: number | null, changedMs = T0) =>
    planPolicyJobStart(
      null,
      { eventId: 'evt-a', atIso: at(changedMs), windowHours },
      at(changedMs),
    ) as PolicyRecomputeJob;
  const done = (job: PolicyRecomputeJob) =>
    advancePolicyJob(
      job,
      { cursor: 'z', exhausted: true, visited: 2, recomputed: 2, failed: 0 },
      at(T0 + 10),
    );

  it('starts one from the top when the policy is newer and draws another line', () => {
    const owed = planPolicyCatchUp(
      done(pass(48)),
      { updatedAt: at(T0 + 5_000), windowHours: 24 },
      at(T0 + 9_000),
    );
    expect(owed).toMatchObject({
      generation: `${SWEEP_GENERATION_PREFIX}${at(T0 + 5_000)}`,
      changedAt: at(T0 + 5_000),
      windowHours: 24,
      cursor: null,
      finishedAt: null,
      startedAt: at(T0 + 9_000),
    });
    // It supersedes a running pass too: that one draws the older line.
    expect(
      planPolicyCatchUp(
        pass(48),
        { updatedAt: at(T0 + 5_000), windowHours: 24 },
        at(T0 + 9_000),
      )?.cursor,
    ).toBeNull();
  });

  it('owes nothing when the job already answers the document, or the document moved no line', () => {
    const job = done(pass(48));
    // The same write (the trigger's event time is the document's update time).
    expect(
      planPolicyCatchUp(job, { updatedAt: at(T0), windowHours: 48 }, at(T0)),
    ).toBeNull();
    // An older document than the job's change.
    expect(
      planPolicyCatchUp(
        job,
        { updatedAt: at(T0 - 1), windowHours: 24 },
        at(T0),
      ),
    ).toBeNull();
    // A newer edit — the horizon, the lead time — at the job's own window.
    expect(
      planPolicyCatchUp(
        job,
        { updatedAt: at(T0 + 5_000), windowHours: 48 },
        at(T0),
      ),
    ).toBeNull();
  });

  // The refinement's known residual, pinned so dropping the window check is
  // a decision the spec makes visible (see `planPolicyCatchUp`'s ⚠ note).
  it('does not see a line moved and moved back with both starts dropped — the manual backfill repairs it', () => {
    const job = done(pass(48));
    // 48 → 24 at T0 + 5 s (dropped), 24 → 48 at T0 + 9 s (dropped): the live
    // document is newer than the job, and draws the job's own line.
    expect(
      planPolicyCatchUp(
        job,
        { updatedAt: at(T0 + 9_000), windowHours: 48 },
        at(T0 + DAY_MS),
      ),
    ).toBeNull();
  });

  it('owes a job that cannot say its line one pass, once', () => {
    const legacy = done(pass(null));
    const line = { updatedAt: at(T0 + 5_000), windowHours: 48 };
    const owed = planPolicyCatchUp(legacy, line, at(T0 + 9_000));
    expect(owed?.windowHours).toBe(48);
    if (owed === null) throw new Error('nothing owed');
    expect(planPolicyCatchUp(done(owed), line, at(T0 + DAY_MS))).toBeNull();
  });

  it('with no job at all, owes a pass only when the window left the default', () => {
    expect(
      planPolicyCatchUp(
        null,
        { updatedAt: at(T0), windowHours: 24 },
        at(T0 + 1),
      ),
    ).toBeNull();
    expect(
      planPolicyCatchUp(null, { updatedAt: null, windowHours: 24 }, at(T0)),
    ).toBeNull();
    expect(
      planPolicyCatchUp(null, { updatedAt: at(T0), windowHours: 48 }, at(T0)),
    ).toMatchObject({ changedAt: at(T0), windowHours: 48 });
  });

  it('reads a deleted policy document as the defaults, owed when the job drew another line', () => {
    expect(
      planPolicyCatchUp(
        done(pass(48)),
        { updatedAt: null, windowHours: 24 },
        at(T0 + 9_000),
      ),
    ).toMatchObject({
      generation: `${SWEEP_GENERATION_PREFIX}${at(T0 + 9_000)}`,
      windowHours: 24,
    });
    expect(
      planPolicyCatchUp(
        done(pass(24)),
        { updatedAt: null, windowHours: 24 },
        at(T0 + 9_000),
      ),
    ).toBeNull();
  });
});
