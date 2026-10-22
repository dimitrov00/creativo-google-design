import {
  Actor,
  BookingPolicy,
  PreciseInstant,
  SystemSource,
} from '@core/components';
import {
  BarberId,
  CustomerId,
  GovernanceError,
  RepositoryError,
  Result,
  TriggerEventId,
  UserId,
} from '@core/primitives';
import {
  type Appointment,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
} from '@core/entities';
import { AttemptOutcome, TriggerAttemptSystem } from '@core/systems';
import { CapacityTrigger } from '@core/pipelines';
import {
  appointmentFixture,
  FIXTURE_TODAY,
  localDate,
  pinnedNowUtcMs,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import { retryingTrigger } from '../edge';
import {
  attemptThrowable,
  CapacitySource,
  decodeCapacityEvent,
  decodeDispatchProjectionsEvent,
  decodeMatchWaitlistEvent,
  decodePolicyRecomputeEvent,
  decodePolicyStepEvent,
  decodePolicySweepRun,
  decodeProfileChangeEvent,
  decodeRebuildBusyEvent,
  type DocumentWriteEvent,
  failOnRefusal,
  logAttempt,
  POLICY_STEP_TIMEOUT_SECONDS,
  preciseInstantOf,
  profileAuditReport,
  projectionReport,
  settleAttempt,
} from './triggers.wire';

/*
 * The flip-1 triggers' edge: each event decoded into its pipeline command
 * (the stored body IS the entity minus `id`; the shop's zone is the pipeline's to read),
 * and a retrying pipeline's answer turned into today's attempt line and
 * redelivery (`lib/trigger-attempts.ts`'s `reportAttempt`/`logAttempt`).
 */

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const side = (body: Record<string, unknown> | null) => ({
  exists: body !== null,
  data: () => body ?? undefined,
});

function writeEvent<P>(
  params: P,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  overrides: { readonly id?: string; readonly time?: string } = {},
): DocumentWriteEvent<P> {
  return {
    id: overrides.id ?? 'evt-1',
    time: overrides.time ?? '2026-09-28T06:00:00.000Z',
    params,
    data: { before: side(before), after: side(after) },
  };
}

const visit = appointmentFixture();
const params = { appointmentId: visit.id };

describe('decodeRebuildBusyEvent', () => {
  it('reads both sides of an appointment write as the stored entities — no zone, the pipeline reads the shop’s (4A-11)', () => {
    expect(
      decodeRebuildBusyEvent(writeEvent(params, null, bodyOf(visit))),
    ).toEqual({ before: null, after: visit });
    expect(
      decodeRebuildBusyEvent(writeEvent(params, bodyOf(visit), null)),
    ).toEqual({ before: visit, after: null });
  });
});

describe('decodeCapacityEvent', () => {
  it.each([CapacitySource.BusyDay, CapacitySource.Exception])(
    'reads a %s write as its (barber, day) — and an id that is no busy key as nothing',
    (source) => {
      expect(
        decodeCapacityEvent(source, { docId: `b-ivan__${FIXTURE_TODAY}` }),
      ).toEqual({
        capacityTrigger: CapacityTrigger.Day,
        barberId: BarberId.of('b-ivan'),
        localDate: FIXTURE_TODAY,
      });
      expect(decodeCapacityEvent(source, { docId: 'not-a-key' })).toBeNull();
    },
  );

  it('reads a roster write as that barber’s horizon', () => {
    expect(
      decodeCapacityEvent(CapacitySource.Roster, { barberId: 'b-ivan' }),
    ).toEqual({
      capacityTrigger: CapacityTrigger.Roster,
      barberId: BarberId.of('b-ivan'),
    });
  });

  it.each([
    CapacitySource.Location,
    CapacitySource.Settings,
    CapacitySource.Sweep,
  ])('reads a %s write as a sweep of every rostered barber', (source) => {
    expect(decodeCapacityEvent(source)).toEqual({
      capacityTrigger: CapacityTrigger.Sweep,
    });
  });
});

describe('decodeMatchWaitlistEvent', () => {
  it('reads the busy day a write touched — a deletion too — and nothing for an id that is no busy key', () => {
    expect(
      decodeMatchWaitlistEvent(
        writeEvent({ docId: `b-ivan__${FIXTURE_TODAY}` }, { blocks: [] }, null),
      ),
    ).toEqual({ localDate: FIXTURE_TODAY });
    expect(
      decodeMatchWaitlistEvent(writeEvent({ docId: 'b-ivan' }, null, null)),
    ).toBeNull();
  });
});

describe('decodeDispatchProjectionsEvent', () => {
  const ana = CustomerId.of('cus_ana');
  const bob = CustomerId.of('cus_bob');

  it('decodes nobody for a write that changed nothing a stat reads — a tip, an arrival', () => {
    const arrived: Appointment = {
      ...visit,
      arrivedAtUtcMs: utcMs('2026-09-28T10:01:00+03:00'),
    };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, bodyOf(visit), bodyOf(arrived)),
      ),
    ).toEqual({ customerIds: [] });
  });

  it('decodes everyone on the visit before AND after a write that moved stats — once, sorted', () => {
    const before = { ...visit, subjectCustomerIds: [bob] };
    const after = {
      ...visit,
      subjectCustomerIds: [ana],
      localDate: localDate('2026-09-29'),
    };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, bodyOf(before), bodyOf(after)),
      ),
    ).toEqual({ customerIds: [ana, bob] });
  });

  it('decodes the visit’s people on a create and on a delete', () => {
    expect(
      decodeDispatchProjectionsEvent(writeEvent(params, null, bodyOf(visit))),
    ).toEqual({ customerIds: visit.subjectCustomerIds });
    expect(
      decodeDispatchProjectionsEvent(writeEvent(params, bodyOf(visit), null)),
    ).toEqual({ customerIds: visit.subjectCustomerIds });
  });
});

describe('decodePolicyRecomputeEvent', () => {
  it('reads both policies through the defaults, the event id as the generation and its time to the microsecond', () => {
    const command = decodePolicyRecomputeEvent(
      writeEvent(
        { docId: 'bookingPolicy' },
        null,
        { cancellationWindowHours: 48 },
        { id: 'evt-a', time: '2026-09-28T06:00:00.123456Z' },
      ),
    );
    expect(command).toEqual({
      settingsDocId: 'bookingPolicy',
      before: BookingPolicy.DEFAULT,
      after: { ...BookingPolicy.DEFAULT, cancellationWindowHours: 48 },
      generation: 'evt-a',
      changedAt: PreciseInstant.of(1_790_575_200, 123_456_000),
    });
  });
});

describe('preciseInstantOf — RFC 3339 at full precision (§9 D17)', () => {
  it('reads the microseconds epoch ms drops, and normalises an offset through the whole seconds', () => {
    expect(preciseInstantOf('2026-09-28T06:00:00.000001Z')).toEqual(
      PreciseInstant.of(1_790_575_200, 1_000),
    );
    expect(preciseInstantOf('2026-09-28T09:00:00.5+03:00')).toEqual(
      PreciseInstant.of(1_790_575_200, 500_000_000),
    );
    expect(preciseInstantOf('2026-09-28T06:00:00Z')).toEqual(
      PreciseInstant.of(1_790_575_200, 0),
    );
  });

  it('orders two writes inside one millisecond as their microseconds do', () => {
    const a = preciseInstantOf('2026-09-28T06:00:00.000100Z');
    const b = preciseInstantOf('2026-09-28T06:00:00.000900Z');
    expect(PreciseInstant.compare(a, b)).toBe(-1);
  });

  it('reads a time that is no instant as the latest — a delivered change never skips', () => {
    expect(preciseInstantOf('yesterday')).toEqual(
      PreciseInstant.of(Number.MAX_SAFE_INTEGER, 999_999_999),
    );
  });
});

describe('decodePolicyStepEvent / decodePolicySweepRun', () => {
  it('reads the job a write left as the step it fires — a deleted one as none', () => {
    const job = { generation: 'evt-a', cursor: null };
    expect(decodePolicyStepEvent(writeEvent({}, null, job))).toEqual({
      fired: {
        id: POLICY_RECOMPUTE_DOC,
        ...job,
      } as unknown as PolicyRecomputeJob,
    });
    expect(decodePolicyStepEvent(writeEvent({}, job, null))).toEqual({
      fired: null,
    });
  });

  it('names a scheduled tick by its job and time, as today’s attempt line does', () => {
    expect(
      decodePolicySweepRun(
        { jobName: 'job-x', scheduleTime: '2026-09-28T00:30:00Z' },
        'sweepClientStatsPolicyDaily',
      ),
    ).toEqual({
      id: 'job-x@2026-09-28T00:30:00Z',
      time: '2026-09-28T00:30:00Z',
    });
    expect(
      decodePolicySweepRun(
        { scheduleTime: '2026-09-28T00:30:00Z' },
        'sweepClientStatsPolicyDaily',
      ).id,
    ).toBe('sweepClientStatsPolicyDaily@2026-09-28T00:30:00Z');
  });
});

describe('decodeProfileChangeEvent', () => {
  it('reads the field NAMES that changed, the writer the auth context names and the event’s own instant', () => {
    const change = decodeProfileChangeEvent({
      ...writeEvent(
        { uid: 'u-maria' },
        { firstName: 'Maria', phone: '+359888000001', roles: ['client'] },
        { firstName: 'Maria', phone: '+359888000002', roles: ['staff'] },
        { id: 'evt-9', time: '2026-09-28T06:00:00.000Z' },
      ),
      authType: 'service_account',
    });
    expect(change).toEqual({
      eventId: TriggerEventId.of('evt-9'),
      eventAtUtcMs: utcMs('2026-09-28T06:00:00.000Z'),
      ownerUserId: UserId.of('u-maria'),
      writer: Actor.system(SystemSource.AdminSdk),
      beforeExists: true,
      afterExists: true,
      fields: ['phone'],
      beforeProfileEditedAtUtcMs: null,
      afterProfileEditedAtUtcMs: null,
    });
  });

  it('carries each side’s raw profileEditedAtUtcMs stamp — an absent side or key reads null (4A-16)', () => {
    const stamped = decodeProfileChangeEvent({
      ...writeEvent(
        { uid: 'u-maria' },
        { firstName: 'Maria' },
        { firstName: 'Mila', profileEditedAtUtcMs: 1_790_575_200_000 },
        { id: 'evt-10', time: '2026-09-28T06:00:00.000Z' },
      ),
      authType: 'service_account',
    });
    expect(stamped.beforeProfileEditedAtUtcMs).toBeNull();
    expect(stamped.afterProfileEditedAtUtcMs).toBe(1_790_575_200_000);
    const created = decodeProfileChangeEvent({
      ...writeEvent({ uid: 'u-maria' }, null, { firstName: 'Maria' }, {}),
      authType: 'service_account',
    });
    expect(created.beforeProfileEditedAtUtcMs).toBeNull();
    expect(created.afterProfileEditedAtUtcMs).toBeNull();
  });

  it('credits a uid-shaped writer, and leaves an unreadable time to the pipeline’s clock', () => {
    const change = decodeProfileChangeEvent({
      ...writeEvent(
        { uid: 'u-maria' },
        null,
        { firstName: 'Maria' },
        { time: 'nope' },
      ),
      authType: 'unknown',
      authId: 'u-desk',
    });
    expect(change.writer).toEqual(Actor.user(UserId.of('u-desk')));
    expect(change.beforeExists).toBe(false);
    expect(change.eventAtUtcMs).toBeNull();
  });
});

describe('attempts — today’s line and redelivery', () => {
  const event = { id: 'evt-job', time: '2026-09-28T05:59:59.000Z' };
  const transient = TriggerAttemptSystem.attemptFailure(
    Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
  );
  const permanent = TriggerAttemptSystem.attemptFailure(
    RepositoryError.readFailed('settings/bookingPolicy', 'internal'),
    'internal',
  );
  const ports = () => ({ ...recordingTelemetry(), nowUtcMs: pinnedNowUtcMs() });

  it('keeps one step’s platform timeout', () => {
    expect(POLICY_STEP_TIMEOUT_SECONDS).toBe(540);
  });

  it('logs a survived failure as ONE line — ids, the SCREAMING outcome and the failure’s code as `errorCode`, and how deep into the retry window (4A-2 (c))', () => {
    const telemetry = ports();
    logAttempt(
      'continueClientStatsPolicyRecompute',
      event,
      permanent,
      telemetry,
    );
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'trigger attempt failed',
        fields: {
          fn: 'continueClientStatsPolicyRecompute',
          eventId: 'evt-job',
          outcome: 'PERMANENT',
          errorCode: 'internal',
          ageMs: 1_000,
        },
      },
    ]);
  });

  it('throws a failure as a value the edge judges the same way — a port refusal by the code in its reason', () => {
    expect(attemptThrowable(transient)).toBe(transient.error);
    const thrown = attemptThrowable(permanent);
    expect(TriggerAttemptSystem.failureCode(thrown)).toBe('internal');
  });

  it('redelivers a transient answer and drops a permanent one, after its line, through `retryingTrigger`', async () => {
    const run = (failure: typeof transient) => {
      const telemetry = ports();
      const handler = retryingTrigger(
        { fn: 'dispatchClientProjections', timeoutSeconds: null },
        telemetry,
        async (delivered: typeof event) =>
          settleAttempt(
            'dispatchClientProjections',
            delivered,
            { attemptFailure: failure, survivedFailure: null },
            telemetry,
          ),
      );
      return { telemetry, done: handler(event) };
    };
    const redelivered = run(transient);
    await expect(redelivered.done).rejects.toBe(transient.error);
    expect(redelivered.telemetry.lines[0]?.fields).toMatchObject({
      outcome: 'TRANSIENT',
      errorCode: 'unavailable',
    });
    const dropped = run(permanent);
    await expect(dropped.done).resolves.toBeUndefined();
    expect(dropped.telemetry.lines[0]?.fields).toMatchObject({
      outcome: 'PERMANENT',
      errorCode: 'internal',
    });
  });

  it('logs the survived failure and settles quietly when nothing answers', () => {
    const telemetry = ports();
    settleAttempt(
      'continueClientStatsPolicyRecompute',
      event,
      { attemptFailure: null, survivedFailure: permanent },
      telemetry,
    );
    expect(telemetry.lines).toHaveLength(1);
  });

  it('reads the projection’s answer — the policy read is every client’s failure', () => {
    expect(
      projectionReport(
        Result.err(
          RepositoryError.readFailed('settings/bookingPolicy', 'unavailable'),
        ),
      ).attemptFailure,
    ).toMatchObject({ attemptOutcome: AttemptOutcome.Transient });
    expect(
      projectionReport(
        Result.ok({ written: 1, failures: [], attemptFailure: null }),
      ),
    ).toEqual({ attemptFailure: null, survivedFailure: null });
  });

  it('reads the profile audit’s refusal as permanent, a failed write by its reason', () => {
    expect(
      profileAuditReport(Result.err(GovernanceError.auditEntryEmptyAction()))
        .attemptFailure,
    ).toMatchObject({ attemptOutcome: AttemptOutcome.Permanent });
    expect(
      profileAuditReport(
        Result.err(RepositoryError.writeFailed('auditLog/x', 'aborted')),
      ).attemptFailure,
    ).toMatchObject({ attemptOutcome: AttemptOutcome.Transient });
    expect(profileAuditReport(Result.ok({ rows: 1 }))).toEqual({
      attemptFailure: null,
      survivedFailure: null,
    });
  });

  it('fails a non-retrying trigger on a refusal, as today’s throw did', () => {
    expect(failOnRefusal(Result.ok(3))).toBe(3);
    expect(() =>
      failOnRefusal(Result.err(RepositoryError.readFailed('x', 'unavailable'))),
    ).toThrow('unavailable');
  });
});
