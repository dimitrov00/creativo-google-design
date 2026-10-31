import { describe, expect, it } from 'vitest';
import {
  AttemptOutcome,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  ClientStatsPolicy,
  PolicyPassStamp,
  PolicyStepOutcome,
  PreciseInstant,
  SeatOccupant,
  SeatOutcome,
  SubjectRelationship,
} from '@core/components';
import {
  AppointmentId,
  BusyKey,
  CustomerId,
  Result,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type Appointment,
  Collections,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import {
  bodyOf,
  appointmentFixture,
  customerOf,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  hourCount,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  memoryTxPorts,
  minute,
  recordingTelemetry,
  seatFixture,
  utcMs,
} from '@core/testing';
import {
  continuePolicyRecompute,
  type StepBudget,
} from './continue-policy-recompute.pipeline';
import {
  projectClientStats,
  recomputeClients,
} from './project-client-stats.pipeline';
import { startPolicyRecompute } from './start-policy-recompute.pipeline';

/*
 * One step of the policy pass (`recompute-on-policy-change.ts`): the stored
 * clients after the job's cursor, a page at a time while the budget lasts,
 * each recomputed under the pass's stamp against the LIVE policy, the job
 * re-read before every page, then the cursor moved under a compare-and-set
 * on the fired step. The story is told on the stats themselves: two clients
 * who cancelled 30 h ahead, before the window was stamped on cancellations,
 * are late exactly when the live window is wider than 30 h. The attempt line
 * an answer becomes is the edge's (`triggers.wire.spec.ts`).
 */

const ANA = UserId.of('u-ana');
const BOB = UserId.of('u-bob');
const CAROL = UserId.of('u-carol');
const DAN = UserId.of('u-dan');
const DAY = localDate('2026-09-18');
const START = utcMs('2026-09-18T09:00:00.000+03:00');
const HOUR = 3_600_000;
const JOB_PATH = `${Collections.BackfillJobs}/${POLICY_RECOMPUTE_DOC}`;

/** A visit `who` called off `leadHours` before it, under a stamped window or none. */
function cancelledAhead(
  who: UserId,
  leadHours: number,
  windowHours: number | null = null,
): Appointment {
  const customer = customerOf(who);
  const cancelledAt = UtcEpochMs.plusMs(START, -leadHours * HOUR);
  return appointmentFixture({
    id: AppointmentId.of(`appt-${who}`),
    localDate: DAY,
    startMinutes: minute(540),
    endMinutes: endMinute(570),
    utcEpochMs: START,
    ownerUserId: who,
    subjectUserIds: [who],
    ownerCustomerId: customer,
    subjectCustomerIds: [customer],
    busyKeys: [BusyKey.of(FIXTURE_IDS.barber, DAY)],
    bookedAtUtcMs: UtcEpochMs.plusMs(START, -5 * 24 * HOUR),
    seats: [
      seatFixture({
        seatId: SeatId.of(`seat-${who}`),
        startMinutes: minute(540),
        occupant: SeatOccupant.account(who, customer, SubjectRelationship.Self),
        outcome: SeatOutcome.cancelled(
          cancelledAt,
          CancelledBy.Client,
          CancellationReason.Unspecified,
          windowHours === null ? null : hourCount(windowHours),
        ),
      }),
    ],
    lifecycle: BookingLifecycle.cancel(
      cancelledAt,
      CancellationReasonSet.of([CancellationReason.Unspecified]),
    ),
  });
}

const policyAt = (windowHours: number): BookingPolicy => ({
  ...BookingPolicy.DEFAULT,
  cancellationWindowHours: hourCount(windowHours),
});

const instant = (seconds: number) => {
  const at = PreciseInstant.of(seconds, 0);
  if (at === null) throw new Error('a broken fixture');
  return at;
};

/** A budget that never runs out, and one spent after the first page. */
const unbounded: StepBudget = { spent: () => false };
const spentAtOnce: StepBudget = { spent: () => true };

type Hooks = {
  beforeJobRead: ((read: number) => Promise<void>) | null;
  beforeCommit: ((commit: number) => Promise<void>) | null;
  failCommit: ((commit: number) => unknown) | null;
  policy: (() => Promise<Result<BookingPolicy, RepositoryError>>) | null;
};

/** The clients' book at a 24 h window, stats stored, and the ports a step runs on. */
async function bookAt24(
  appointments: readonly Appointment[] = [
    cancelledAhead(ANA, 30),
    cancelledAhead(BOB, 30),
  ],
) {
  const store = memoryStore(
    appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
  );
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const live = { windowHours: 24 };
  const hooks: Hooks = {
    beforeJobRead: null,
    beforeCommit: null,
    failCommit: null,
    policy: null,
  };
  let commits = 0;
  let jobReads = 0;
  const commit: CommitPlan = async (read, decide) => {
    commits += 1;
    const at = commits;
    if (hooks.beforeCommit !== null) await hooks.beforeCommit(at);
    const failure = hooks.failCommit?.(at);
    if (failure !== undefined) throw failure;
    return tx.commit(read, decide);
  };
  const jobOf = (): PolicyRecomputeJob | null => {
    const body = store.get(JOB_PATH);
    return body === undefined
      ? null
      : ({ id: POLICY_RECOMPUTE_DOC, ...body } as PolicyRecomputeJob);
  };
  const ports = {
    ...tx,
    commit,
    ...telemetry,
    // The shop's clock: the default location's (F-4), the fixture shop.
    ...memoryLocationLoadPorts(
      memoryProgramsWorld({ locations: [locationFixture()] }),
    ),
    ...memoryDefaultLocationPorts(),
    loadPolicy: async () =>
      hooks.policy === null
        ? Result.ok(policyAt(live.windowHours))
        : hooks.policy(),
    pageClients: async (after: CustomerId | null, limit: number) => {
      const ids = [...store.keys()]
        .filter((key) => key.split('/').length === 2)
        .filter((key) => key.startsWith(`${Collections.ClientStats}/`))
        .map((key) => CustomerId.of(key.split('/')[1] ?? ''))
        .sort()
        .filter((id) => after === null || id > after);
      return Result.ok(ids.slice(0, limit));
    },
    loadPolicyRecomputeJob: async () => {
      jobReads += 1;
      if (hooks.beforeJobRead !== null) await hooks.beforeJobRead(jobReads);
      return Result.ok(jobOf());
    },
  };
  const customers = appointments.map((a) => a.subjectCustomerIds[0]);
  await recomputeClients(
    ports,
    ClientStatsPolicy.forBooking(policyAt(24)),
    customers.filter((id): id is CustomerId => id !== undefined),
    null,
    1,
    FIXTURE_TIME_ZONE,
  );
  commits = 0;
  const lateOf = (who: UserId) =>
    store.get(`${Collections.ClientStats}/${customerOf(who)}`)?.[
      'lifetimeLateCancels'
    ];
  /** A settings write moving the line from `before` to `after` hours. */
  const start = (
    generation: string,
    seconds: number,
    before: number,
    after: number,
  ) =>
    startPolicyRecompute(ports)({
      settingsDocId: 'bookingPolicy',
      before: policyAt(before),
      after: policyAt(after),
      generation,
      changedAt: instant(seconds),
    });
  const step = (pageSize?: number) =>
    pageSize === undefined
      ? continuePolicyRecompute(ports)
      : continuePolicyRecompute(ports, pageSize);
  /** Steps fired by the job's own writes, until one rests. */
  const drain = async (budget: StepBudget = unbounded, pageSize?: number) => {
    const outcomes: PolicyStepOutcome[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const report = await step(pageSize)({ fired: jobOf() }, budget);
      const outcome = report.ok ? report.value.policyStepOutcome : null;
      if (outcome === null) break;
      outcomes.push(outcome);
      if (outcome !== PolicyStepOutcome.Advanced) break;
    }
    return outcomes;
  };
  return {
    store,
    tx,
    telemetry,
    live,
    hooks,
    ports,
    jobOf,
    lateOf,
    start,
    step,
    drain,
  };
}

/** A hook failing the `n`-th transaction from now with `failure`. */
function failNth(n: number, failure: unknown): (commit: number) => unknown {
  let seen = 0;
  return () => {
    seen += 1;
    return seen === n ? failure : undefined;
  };
}

/** The clients' ids in walk order — `pageClients` is document-id order. */
const inWalkOrder = (...who: readonly UserId[]) =>
  who.map((user) => customerOf(user)).sort();

describe('continuePolicyRecompute — the live window judges what was stored before the stamp', () => {
  it('re-judges EVERY stored client, not only the next one written, and rests once finished', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    expect(await book.drain(unbounded, 1)).toEqual([
      PolicyStepOutcome.Finished,
    ]);
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([1, 1]);
    expect(book.jobOf()).toMatchObject({
      cursor: inWalkOrder(ANA, BOB)[1],
      storedClients: 2,
      recomputed: 2,
      failed: 0,
      finishedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(await book.step()({ fired: book.jobOf() }, unbounded)).toEqual({
      ok: true,
      value: {
        policyStepOutcome: PolicyStepOutcome.Idle,
        attemptFailure: null,
        survivedFailure: null,
      },
    });
  });

  it('re-judges only what was stored before the stamp: a stamped cancel keeps its verdict', async () => {
    const book = await bookAt24([
      cancelledAhead(ANA, 30),
      cancelledAhead(BOB, 30),
      cancelledAhead(CAROL, 30, 24),
      cancelledAhead(DAN, 3, 24),
    ]);
    const lates = () => [ANA, BOB, CAROL, DAN].map(book.lateOf);
    expect(lates()).toEqual([0, 0, 0, 1]);
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    expect(await book.drain()).toEqual([PolicyStepOutcome.Finished]);
    expect(lates()).toEqual([1, 1, 0, 1]);
    book.live.windowHours = 2;
    await book.start('evt-b', 1_800_000_100, 48, 2);
    expect(await book.drain()).toEqual([PolicyStepOutcome.Finished]);
    expect(lates()).toEqual([0, 0, 0, 1]);
  });

  it('stops taking pages once a slow step spends its budget, and resumes from the cursor', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const [first, second] = inWalkOrder(ANA, BOB);
    const report = await book.step(1)({ fired: book.jobOf() }, spentAtOnce);
    expect(report.ok && report.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Advanced,
    );
    expect(book.jobOf()).toMatchObject({
      cursor: first,
      storedClients: 1,
      finishedAtUtcMs: null,
    });
    expect(
      book.store.get(`${Collections.ClientStats}/${first}`)?.[
        'lifetimeLateCancels'
      ],
    ).toBe(1);
    expect(
      book.store.get(`${Collections.ClientStats}/${second}`)?.[
        'lifetimeLateCancels'
      ],
    ).toBe(0);
    expect(await book.drain(spentAtOnce, 1)).toEqual([
      PolicyStepOutcome.Advanced,
      PolicyStepOutcome.Finished,
    ]);
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([1, 1]);
  });

  it('advances once however often the same step is delivered', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const fired = book.jobOf();
    const once = await book.step(1)({ fired }, spentAtOnce);
    const twice = await book.step(1)({ fired }, spentAtOnce);
    expect(once.ok && once.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Advanced,
    );
    expect(twice.ok && twice.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Superseded,
    );
    expect(book.jobOf()).toMatchObject({
      cursor: inWalkOrder(ANA, BOB)[0],
      storedClients: 1,
    });
  });
});

describe('continuePolicyRecompute — the last word wins', () => {
  it('lets a newer policy change supersede a running pass', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const stepOfA = book.jobOf();
    // Mid-step, the owner changes their mind back to 24 h.
    book.hooks.policy = async () => {
      book.hooks.policy = null;
      const read = policyAt(book.live.windowHours);
      book.live.windowHours = 24;
      await book.start('evt-b', 1_800_000_100, 48, 24);
      return Result.ok(read);
    };
    const report = await book.step()({ fired: stepOfA }, unbounded);
    expect(report.ok && report.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Superseded,
    );
    expect(book.jobOf()).toMatchObject({ generation: 'evt-b', cursor: null });
    const redelivered = await book.step()({ fired: stepOfA }, unbounded);
    expect(redelivered.ok && redelivered.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Superseded,
    );
    expect(await book.drain()).toEqual([PolicyStepOutcome.Finished]);
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([0, 0]);
  });

  it('stops a superseded step before its next page: at most the page in hand is judged by the old line', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const stepOfA = book.jobOf();
    book.hooks.beforeJobRead = async (read) => {
      if (read !== 2) return;
      book.live.windowHours = 24;
      await book.start('evt-b', 1_800_000_100, 48, 24);
    };
    const report = await book.step(1)({ fired: stepOfA }, unbounded);
    expect(report.ok && report.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Superseded,
    );
    const [first, second] = inWalkOrder(ANA, BOB);
    expect(
      book.store.get(`${Collections.ClientStats}/${first}`)?.[
        'lifetimeLateCancels'
      ],
    ).toBe(1);
    expect(
      book.store.get(`${Collections.ClientStats}/${second}`)?.[
        'lifetimeLateCancels'
      ],
    ).toBe(0);
    book.hooks.beforeJobRead = null;
    expect(await book.drain()).toEqual([PolicyStepOutcome.Finished]);
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([0, 0]);
  });

  it('keeps the last word when the newer pass overtakes a running step between its pages', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const stepOfA = book.jobOf();
    const newer: PolicyStepOutcome[] = [];
    book.hooks.beforeJobRead = async (read) => {
      if (read !== 2) return;
      book.hooks.beforeJobRead = null;
      book.live.windowHours = 24;
      await book.start('evt-b', 1_800_000_100, 48, 24);
      newer.push(...(await book.drain()));
    };
    const report = await book.step(1)({ fired: stepOfA }, unbounded);
    expect(report.ok && report.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Superseded,
    );
    expect(newer).toEqual([PolicyStepOutcome.Finished]);
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([0, 0]);
    expect(book.jobOf()?.generation).toBe('evt-b');
    expect(book.jobOf()?.finishedAtUtcMs).not.toBeNull();
  });

  it('keeps the last word when the newer pass judges the page the old step has in hand', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const stepOfA = book.jobOf();
    const newer: PolicyStepOutcome[] = [];
    let commits = 0;
    book.hooks.beforeCommit = async () => {
      commits += 1;
      if (commits !== 1) return;
      book.hooks.beforeCommit = null;
      book.live.windowHours = 24;
      await book.start('evt-b', 1_800_000_100, 48, 24);
      newer.push(...(await book.drain()));
    };
    const report = await book.step()({ fired: stepOfA }, unbounded);
    expect(report.ok && report.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Superseded,
    );
    expect(newer).toEqual([PolicyStepOutcome.Finished]);
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([0, 0]);
    for (const who of [ANA, BOB]) {
      const stored = book.store.get(
        `${Collections.ClientStats}/${customerOf(who)}`,
      );
      expect(
        PolicyPassStamp.read(stored as unknown as PolicyPassStamp)?.generation,
      ).toBe('evt-b');
    }
  });

  it('stamps every client a pass judges — an unchanged answer too — and the appointment trigger carries the stamp forward', async () => {
    const book = await bookAt24();
    book.live.windowHours = 24;
    await book.start('evt-a', 1_800_000_000, 12, 24);
    expect(await book.drain()).toEqual([PolicyStepOutcome.Finished]);
    expect(book.jobOf()?.recomputed).toBe(0);
    const anaPath = `${Collections.ClientStats}/${customerOf(ANA)}`;
    expect(book.store.get(anaPath)).toMatchObject({
      policyPassGeneration: 'evt-a',
      policyPassChangedAtSeconds: 1_800_000_000,
      policyPassChangedAtNanos: 0,
    });
    // A writer that is not a pass keeps it: a new late cancel re-judges Ana.
    const another = {
      ...cancelledAhead(ANA, 2),
      id: AppointmentId.of('appt-ana-2'),
    };
    book.store.set(`${Collections.Appointments}/appt-ana-2`, bodyOf(another));
    const written = await projectClientStats(book.ports)({
      customerIds: [customerOf(ANA)],
    });
    expect(written.ok && written.value.written).toBe(1);
    expect(book.store.get(anaPath)?.['policyPassGeneration']).toBe('evt-a');
  });
});

describe('continuePolicyRecompute — failures', () => {
  it('records a permanent stall on the job — stalled, not slow — and rests on that write', async () => {
    const book = await bookAt24();
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const started = book.jobOf();
    book.hooks.policy = async () =>
      Result.err(
        RepositoryError.readFailed('settings/bookingPolicy', 'internal'),
      );
    const report = await book.step()({ fired: started }, unbounded);
    expect(report.ok && report.value).toMatchObject({
      policyStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: {
        failureCode: 'internal',
        attemptOutcome: AttemptOutcome.Permanent,
      },
      survivedFailure: null,
    });
    expect(book.jobOf()).toEqual({
      ...started,
      stalledAtUtcMs: FIXTURE_NOW_UTC_MS,
      lastFailureCode: 'internal',
    });
    // The record's own write fires a delivery, which rests…
    const recorded = book.store.get(JOB_PATH);
    const rests = await book.step()({ fired: book.jobOf() }, unbounded);
    expect(rests.ok && rests.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Idle,
    );
    // …and a stale delivery of the stalled step, failing the same way, does
    // not rewrite the record.
    const stale = await book.step()({ fired: started }, unbounded);
    expect(stale.ok && stale.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Stalled,
    );
    expect(book.store.get(JOB_PATH)).toBe(recorded);
  });

  it('stalls on a default location that is not stored — the zone’s refusal is a permanent store failure (4A-2 (e))', async () => {
    const book = await bookAt24();
    await book.start('evt-a', 1_800_000_000, 24, 48);
    const started = book.jobOf();
    const step = continuePolicyRecompute({
      ...book.ports,
      ...memoryLocationLoadPorts(memoryProgramsWorld({ locations: [] })),
    });
    const report = await step({ fired: started }, unbounded);
    expect(report.ok && report.value).toMatchObject({
      policyStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: {
        failureCode: 'catalog-location-zone-unknown',
        attemptOutcome: AttemptOutcome.Permanent,
      },
    });
  });

  it('records a stall when the advance itself fails permanently, and answers a transient one for redelivery', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    // Commits 1 and 2 recompute the clients; the 3rd is the advance.
    book.hooks.failCommit = failNth(
      3,
      Object.assign(new Error('10 ABORTED'), { code: 10 }),
    );
    const transient = await book.step()({ fired: book.jobOf() }, unbounded);
    expect(transient.ok && transient.value).toMatchObject({
      policyStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: { attemptOutcome: AttemptOutcome.Transient },
    });
    expect(book.jobOf()).toMatchObject({ cursor: null, stalledAtUtcMs: null });

    book.hooks.failCommit = failNth(
      3,
      Object.assign(new Error('13 INTERNAL'), { code: 13 }),
    );
    const permanent = await book.step()({ fired: book.jobOf() }, unbounded);
    expect(permanent.ok && permanent.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Stalled,
    );
    expect([book.lateOf(ANA), book.lateOf(BOB)]).toEqual([1, 1]);
    expect(book.jobOf()).toMatchObject({
      cursor: null,
      finishedAtUtcMs: null,
      stalledAtUtcMs: FIXTURE_NOW_UTC_MS,
      lastFailureCode: 'internal',
    });
  });

  it('answers a transient failure with no page finished, and keeps the cursor — the page is retried whole', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    book.hooks.failCommit = failNth(
      1,
      Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
    );
    const report = await book.step()({ fired: book.jobOf() }, unbounded);
    expect(report.ok && report.value).toMatchObject({
      policyStepOutcome: PolicyStepOutcome.Stalled,
      attemptFailure: {
        failureCode: 'unavailable',
        attemptOutcome: AttemptOutcome.Transient,
      },
    });
    // The other client's recompute stood on its own.
    const second = inWalkOrder(ANA, BOB)[1];
    expect(
      book.store.get(`${Collections.ClientStats}/${second}`)?.[
        'lifetimeLateCancels'
      ],
    ).toBe(1);
    expect(book.jobOf()).toMatchObject({
      cursor: null,
      finishedAtUtcMs: null,
      stalledAtUtcMs: null,
    });
  });

  it('counts a permanent failure and walks on, leaving it to the backfill — the line survives, never rethrown', async () => {
    const book = await bookAt24();
    book.live.windowHours = 48;
    await book.start('evt-a', 1_800_000_000, 24, 48);
    book.hooks.failCommit = failNth(
      1,
      Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 }),
    );
    const report = await book.step()({ fired: book.jobOf() }, unbounded);
    expect(report.ok && report.value).toMatchObject({
      policyStepOutcome: PolicyStepOutcome.Finished,
      attemptFailure: null,
      survivedFailure: {
        failureCode: 'permission-denied',
        attemptOutcome: AttemptOutcome.Permanent,
      },
    });
    expect(book.jobOf()).toMatchObject({ failed: 1, storedClients: 2 });
  });

  it('does nothing for a deleted job', async () => {
    const book = await bookAt24();
    const idle = {
      ok: true,
      value: {
        policyStepOutcome: PolicyStepOutcome.Idle,
        attemptFailure: null,
        survivedFailure: null,
      },
    };
    expect(await book.step()({ fired: null }, unbounded)).toEqual(idle);
    expect(book.tx.transactions).toHaveLength(2);
  });
});
