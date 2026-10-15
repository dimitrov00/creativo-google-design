import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { BookingError, RepositoryError } from '@core/primitives';
import { Callables } from '@core/ports';

/**
 * The pipelines and the Firestore bundle, replaced at the module seam: each
 * pipeline factory records the ports it was built over and the arguments it
 * ran with, then answers what the case set — so a spec proves which
 * pipeline an export runs, and with what, without a database.
 */
const seam = vi.hoisted(() => {
  const PIPELINES = [
    'auditProfileChange',
    'bookAppointment',
    'cancelAppointment',
    'cancelWaitlist',
    'continuePolicyRecompute',
    'editAppointment',
    'markArrival',
    'matchWaitlist',
    'projectClientStats',
    'rebuildBusy',
    'rebuildCapacity',
    'recordSeatTip',
    'requestWaitlist',
    'rescheduleAppointment',
    'runBackfill',
    'sampleLeadTime',
    'startPolicyRecompute',
    'sweepPolicyRecompute',
    'transitionAppointment',
  ] as const;
  type Call = {
    readonly pipeline: string;
    readonly ports: unknown;
    readonly args: readonly unknown[];
  };
  const calls: Call[] = [];
  const answers = new Map<string, () => unknown>();
  const DB = { sentinel: 'db' };
  const BUNDLE = { sentinel: 'firestore ports' };
  /** Every `firestorePorts(...)` call's arguments — never cleared, the cold-start-once proof. */
  const built: (readonly unknown[])[] = [];
  const pipelines = Object.fromEntries(
    PIPELINES.map((pipeline) => [
      pipeline,
      vi.fn((ports: unknown) => async (...args: unknown[]) => {
        calls.push({ pipeline, ports, args });
        const answer = answers.get(pipeline);
        return answer === undefined ? { ok: true, value: {} } : answer();
      }),
    ]),
  );
  return {
    PIPELINES,
    calls,
    answers,
    DB,
    BUNDLE,
    built,
    pipelines,
    adminFirestore: vi.fn(() => DB),
    adminAuth: vi.fn(() => ({})),
    firestorePorts: vi.fn((...args: unknown[]) => {
      built.push(args);
      return BUNDLE;
    }),
  };
});

vi.mock('./lib/firebase-admin', () => ({
  adminFirestore: seam.adminFirestore,
  adminAuth: seam.adminAuth,
}));
vi.mock('./adapters/firestore-ports', () => ({
  firestorePorts: seam.firestorePorts,
}));
vi.mock('@core/pipelines', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...seam.pipelines,
}));

import * as main from './main';
import * as requestOtp from './lib/otp/request-otp';
import * as verifyOtp from './lib/otp/verify-otp';
import * as completeRegistration from './lib/otp/complete-registration';
import * as publishStreak from './lib/loyalty/publish-streak-definition';

type PipelineName = (typeof seam.PIPELINES)[number];

/** Every option a deployed endpoint declares that no export of ours sets. */
const PLATFORM = {
  availableMemoryMb: null,
  timeoutSeconds: null,
  minInstances: null,
  maxInstances: null,
  ingressSettings: null,
  concurrency: null,
  serviceAccountEmail: null,
  vpc: null,
  platform: 'gcfv2',
  labels: {},
} as const;

const DATABASE = { database: '(default)', namespace: '(default)' } as const;
const WRITTEN = 'google.cloud.firestore.document.v1.written';

const callable = { ...PLATFORM, callableTrigger: {} };

const written = (document: string, retry: boolean) => ({
  ...PLATFORM,
  eventTrigger: {
    eventType: WRITTEN,
    eventFilters: DATABASE,
    eventFilterPathPatterns: { document },
    retry,
  },
});

const daily = (schedule: string) => ({
  ...PLATFORM,
  scheduleTrigger: {
    schedule,
    retryConfig: { retryCount: 3 },
    timeZone: 'Europe/Sofia',
  },
});

/**
 * THE DEPLOYED ENDPOINTS, as the Phase 3a definitions declared them —
 * captured from each export's `__endpoint` before flip 1 deleted the
 * handlers (2026-10-11). A literal: what `firebase deploy` reads, so a
 * changed path, retry flag, timeout, memory or schedule fails here.
 */
const ENDPOINTS = {
  requestOtpChallenge: callable,
  verifyOtpChallenge: callable,
  completeRegistration: callable,
  auditProfileChanges: {
    ...PLATFORM,
    eventTrigger: {
      eventType: `${WRITTEN}.withAuthContext`,
      eventFilters: DATABASE,
      eventFilterPathPatterns: { document: 'users/{uid}' },
      retry: true,
    },
  },
  commitBooking: callable,
  cancelAppointment: callable,
  rescheduleAppointment: callable,
  transitionAppointment: callable,
  markArrived: callable,
  clearArrival: callable,
  recordSeatTip: callable,
  staffEditAppointment: callable,
  rebuildBusyOnAppointmentChange: written(
    'appointments/{appointmentId}',
    false,
  ),
  rebuildCapacityOnBusyChange: written('barberBusy/{docId}', false),
  rebuildCapacityOnExceptionChange: written(
    'scheduleExceptions/{docId}',
    false,
  ),
  rebuildCapacityOnRosterChange: written('barberSchedules/{barberId}', false),
  rebuildCapacityOnLocationChange: written('locations/{locationId}', false),
  rebuildCapacityOnSettingsChange: written('settings/{docId}', false),
  sweepCapacityDaily: daily('every day 03:00'),
  sampleBarberLeadTimeDaily: daily('every day 04:00'),
  requestWaitlist: callable,
  cancelWaitlist: callable,
  matchWaitlistOnBusyChange: written('barberBusy/{docId}', false),
  dispatchClientProjections: written('appointments/{appointmentId}', true),
  recomputeClientStatsOnPolicyChange: written('settings/{docId}', true),
  continueClientStatsPolicyRecompute: {
    ...PLATFORM,
    availableMemoryMb: 512,
    timeoutSeconds: 540,
    eventTrigger: {
      eventType: WRITTEN,
      eventFilters: { ...DATABASE, document: 'backfillJobs/clientStatsPolicy' },
      eventFilterPathPatterns: {},
      retry: true,
    },
  },
  sweepClientStatsPolicyDaily: daily('every day 03:30'),
  runBackfill: { ...callable, availableMemoryMb: 512, timeoutSeconds: 540 },
  publishStreakDefinition: callable,
} as const;

type ExportName = keyof typeof ENDPOINTS;
const EXPORTS = Object.keys(ENDPOINTS).sort() as readonly ExportName[];

const exported = new Map<string, unknown>(Object.entries(main));

/**
 * An export's `__endpoint` as the capture read it — through JSON, which
 * drops the SDK's `undefined`-valued keys (no deploy reads those).
 */
const endpointOf = (fn: unknown): unknown =>
  fn === null || typeof fn !== 'function'
    ? undefined
    : JSON.parse(JSON.stringify(Reflect.get(fn, '__endpoint') ?? null));

/** A deployed function's `run` — what the platform (and a spec) invokes. */
type Runnable = { run: (input: unknown) => Promise<unknown> };
const runnable = (fn: unknown): Runnable => fn as Runnable;
const run = (name: string, input: unknown): Promise<unknown> =>
  runnable(exported.get(name)).run(input);

const request = (
  data: unknown,
  auth: { readonly uid: string; readonly roles?: readonly string[] } | null,
): CallableRequest<unknown> =>
  ({
    data,
    ...(auth === null
      ? {}
      : { auth: { uid: auth.uid, token: { roles: auth.roles ?? [] } } }),
    rawRequest: {},
    acceptsStreaming: false,
  }) as unknown as CallableRequest<unknown>;

const CLIENT = { uid: 'u-client' } as const;
const STAFF = { uid: 'u-staff', roles: ['barber'] } as const;
const SYSADMIN = { uid: 'u-admin', roles: ['sysadmin'] } as const;

/** A Firestore write event with nothing on either side. */
const writeEvent = (params: Record<string, string>) => ({
  id: 'event-1',
  time: '2026-10-11T07:00:00.000000Z',
  params,
  data: undefined,
});

const tick = { jobName: 'job', scheduleTime: '2026-10-11T00:00:00Z' };

const ok = (value: unknown) => () => ({ ok: true, value });

const NO_ATTEMPT = { attemptFailure: null, survivedFailure: null } as const;

/** One flip-1 export: what the platform hands it, the pipeline it must run, and the round trip. */
type Case = {
  readonly pipeline: PipelineName;
  readonly input: unknown;
  /** Matched against the pipeline's first argument (`undefined`: it takes none). */
  readonly command: unknown;
  readonly answer: () => unknown;
  /** What the export answers — `undefined` for a trigger. */
  readonly expected: unknown;
};

const FLIP_1: { readonly [name: string]: Case } = {
  commitBooking: {
    pipeline: 'bookAppointment',
    input: request({ locationId: 'loc-1', seats: [] }, CLIENT),
    command: {
      locationId: 'loc-1',
      ownerUserId: 'u-client',
      staffPlacement: false,
    },
    answer: ok({ appointmentId: 'a-1', replayed: false }),
    expected: { appointmentId: 'a-1' },
  },
  cancelAppointment: {
    pipeline: 'cancelAppointment',
    input: request({ appointmentId: 'a-1' }, CLIENT),
    command: {
      appointmentId: 'a-1',
      callerUserId: 'u-client',
      reason: 'UNSPECIFIED',
    },
    answer: ok({ appointmentId: 'a-1' }),
    expected: { appointmentId: 'a-1' },
  },
  rescheduleAppointment: {
    pipeline: 'rescheduleAppointment',
    input: request(
      { appointmentId: 'a-1', locationId: 'loc-1', seats: [] },
      CLIENT,
    ),
    command: {
      appointmentId: 'a-1',
      callerUserId: 'u-client',
      locationId: 'loc-1',
    },
    answer: ok({ appointmentId: 'a-1', revision: 2, replayed: false }),
    expected: { appointmentId: 'a-1' },
  },
  transitionAppointment: {
    pipeline: 'transitionAppointment',
    input: request({ appointmentId: 'a-1', to: 'completed' }, STAFF),
    command: { appointmentId: 'a-1', to: 'COMPLETED', seatId: null },
    answer: ok({ appointmentId: 'a-1', to: 'COMPLETED' }),
    expected: { appointmentId: 'a-1', to: 'completed' },
  },
  markArrived: {
    pipeline: 'markArrival',
    input: request({ appointmentId: 'a-1' }, STAFF),
    command: { markArrivalAction: 'ARRIVE', appointmentId: 'a-1' },
    answer: ok({ appointmentId: 'a-1', unchanged: false }),
    expected: { appointmentId: 'a-1', alreadyArrived: false },
  },
  clearArrival: {
    pipeline: 'markArrival',
    input: request({ appointmentId: 'a-1' }, STAFF),
    command: { markArrivalAction: 'CLEAR', appointmentId: 'a-1' },
    answer: ok({ appointmentId: 'a-1', unchanged: true }),
    expected: { appointmentId: 'a-1', alreadyClear: true },
  },
  recordSeatTip: {
    pipeline: 'recordSeatTip',
    input: request(
      { appointmentId: 'a-1', seatId: 's-1', amountMinorUnits: 500 },
      STAFF,
    ),
    command: { appointmentId: 'a-1', seatId: 's-1', tipCents: 500 },
    answer: ok({ appointmentId: 'a-1', seatId: 's-1', unchanged: false }),
    expected: { appointmentId: 'a-1', seatId: 's-1', unchanged: false },
  },
  staffEditAppointment: {
    pipeline: 'editAppointment',
    input: request(
      {
        appointmentId: 'a-1',
        command: { kind: 'move', startIso: '2026-10-12T10:00:00.000+03:00' },
      },
      STAFF,
    ),
    command: {
      appointmentId: 'a-1',
      actorRoles: ['barber'],
      acknowledgedOverlap: false,
    },
    answer: ok({ appointmentId: 'a-1', revision: 3, replayed: false }),
    expected: { appointmentId: 'a-1', revision: 3 },
  },
  rebuildBusyOnAppointmentChange: {
    pipeline: 'rebuildBusy',
    input: writeEvent({ appointmentId: 'a-1' }),
    command: { before: null, after: null, timeZone: 'Europe/Sofia' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  rebuildCapacityOnBusyChange: {
    pipeline: 'rebuildCapacity',
    input: writeEvent({ docId: 'b-1__2026-10-12' }),
    command: {
      capacityTrigger: 'DAY',
      barberId: 'b-1',
      localDate: '2026-10-12',
    },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  rebuildCapacityOnExceptionChange: {
    pipeline: 'rebuildCapacity',
    input: writeEvent({ docId: 'b-1__2026-10-13' }),
    command: {
      capacityTrigger: 'DAY',
      barberId: 'b-1',
      localDate: '2026-10-13',
    },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  rebuildCapacityOnRosterChange: {
    pipeline: 'rebuildCapacity',
    input: writeEvent({ barberId: 'b-1' }),
    command: { capacityTrigger: 'ROSTER', barberId: 'b-1' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  rebuildCapacityOnLocationChange: {
    pipeline: 'rebuildCapacity',
    input: writeEvent({ locationId: 'loc-1' }),
    command: { capacityTrigger: 'SWEEP', timeZone: 'Europe/Sofia' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  rebuildCapacityOnSettingsChange: {
    pipeline: 'rebuildCapacity',
    input: writeEvent({ docId: 'bookingPolicy' }),
    command: { capacityTrigger: 'SWEEP', timeZone: 'Europe/Sofia' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  sweepCapacityDaily: {
    pipeline: 'rebuildCapacity',
    input: tick,
    command: { capacityTrigger: 'SWEEP', timeZone: 'Europe/Sofia' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  sampleBarberLeadTimeDaily: {
    pipeline: 'sampleLeadTime',
    input: tick,
    command: { timeZone: 'Europe/Sofia' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  requestWaitlist: {
    pipeline: 'requestWaitlist',
    input: request(
      { locationId: 'loc-1', when: { days: [] }, cart: {} },
      CLIENT,
    ),
    command: { ownerUserId: 'u-client', timeZone: 'Europe/Sofia' },
    answer: ok({ requestId: 'wl-1' }),
    expected: { requestId: 'wl-1' },
  },
  cancelWaitlist: {
    pipeline: 'cancelWaitlist',
    input: request({ requestId: 'wl-1' }, CLIENT),
    command: { ownerUserId: 'u-client', requestId: 'wl-1' },
    answer: ok({ requestId: 'wl-1' }),
    expected: { requestId: 'wl-1' },
  },
  matchWaitlistOnBusyChange: {
    pipeline: 'matchWaitlist',
    input: writeEvent({ docId: 'b-1__2026-10-12' }),
    command: { localDate: '2026-10-12', timeZone: 'Europe/Sofia' },
    answer: ok({ notified: 0 }),
    expected: undefined,
  },
  dispatchClientProjections: {
    pipeline: 'projectClientStats',
    input: writeEvent({ appointmentId: 'a-1' }),
    command: { customerIds: [] },
    answer: ok({ written: 0, failures: [], attemptFailure: null }),
    expected: undefined,
  },
  recomputeClientStatsOnPolicyChange: {
    pipeline: 'startPolicyRecompute',
    input: writeEvent({ docId: 'bookingPolicy' }),
    command: { settingsDocId: 'bookingPolicy', generation: 'event-1' },
    answer: ok({ policyStartOutcome: 'UNMOVED' }),
    expected: undefined,
  },
  continueClientStatsPolicyRecompute: {
    pipeline: 'continuePolicyRecompute',
    input: writeEvent({}),
    command: { fired: null },
    answer: ok({ policyStepOutcome: 'IDLE', ...NO_ATTEMPT }),
    expected: undefined,
  },
  sweepClientStatsPolicyDaily: {
    pipeline: 'sweepPolicyRecompute',
    input: tick,
    command: undefined,
    answer: ok({ policySweepOutcome: 'IDLE', ...NO_ATTEMPT }),
    expected: undefined,
  },
  runBackfill: {
    pipeline: 'runBackfill',
    input: request({ job: 'clientStats', cursor: null }, SYSADMIN),
    command: { callerUserId: 'u-admin' },
    answer: ok({
      backfillJobName: 'CLIENT_STATS',
      cursor: null,
      done: true,
      processed: 0,
      storedClients: 0,
      stamped: 0,
      recomputed: 0,
      total: 0,
      runStartedAtUtcMs: Date.UTC(2026, 9, 11, 7),
      startedFrom: null,
      sampleChecked: null,
      sampleMismatched: [],
      budgetSpent: false,
    }),
    expected: {
      job: 'clientStats',
      cursor: null,
      done: true,
      processed: 0,
      storedClients: 0,
      stamped: 0,
      recomputed: 0,
      total: 0,
      runStartedAt: '2026-10-11T07:00:00.000Z',
      startedFrom: null,
      sample: null,
      budgetSpent: false,
    },
  },
  auditProfileChanges: {
    pipeline: 'auditProfileChange',
    input: { ...writeEvent({ uid: 'u-1' }), authType: 'system' },
    command: { ownerUserId: 'u-1', beforeExists: false, afterExists: false },
    answer: ok({ rows: 0 }),
    expected: undefined,
  },
};

const FLIP_1_EXPORTS = Object.keys(FLIP_1).sort();
/** Today's handlers of the four, as the platform runs them. */
const LEGACY: { readonly [name: string]: Runnable } = {
  requestOtpChallenge: runnable(requestOtp.requestOtpChallenge),
  verifyOtpChallenge: runnable(verifyOtp.verifyOtpChallenge),
  completeRegistration: runnable(completeRegistration.completeRegistration),
  publishStreakDefinition: runnable(publishStreak.publishStreakDefinition),
};
const CALLABLE_NAMES: ReadonlySet<string> = new Set(Object.values(Callables));

function caseOf(name: string): Case {
  const found = new Map(Object.entries(FLIP_1)).get(name);
  if (found === undefined) throw new Error(`no case for ${name}`);
  return found;
}

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  seam.calls.length = 0;
  seam.answers.clear();
  for (const factory of Object.values(seam.pipelines)) factory.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('main.ts — the composition root', () => {
  it('loads without building a port: the Admin SDK and the Firestore bundle wait for the first invocation', () => {
    expect(seam.adminFirestore).not.toHaveBeenCalled();
    expect(seam.firestorePorts).not.toHaveBeenCalled();
    for (const name of seam.PIPELINES) {
      expect(seam.pipelines[name], name).not.toHaveBeenCalled();
    }
  });

  it('exports exactly the 29 functions, by today’s names', () => {
    expect([...exported.keys()].sort()).toEqual([...EXPORTS]);
  });

  it.each(EXPORTS)(
    'deploys %s as exactly the endpoint its legacy definition declared',
    (name) => {
      expect(endpointOf(exported.get(name))).toEqual(ENDPOINTS[name]);
    },
  );

  it('exports every callable the web dials through the Callables registry, and no other callable', () => {
    const callables = EXPORTS.filter(
      (name) => 'callableTrigger' in ENDPOINTS[name],
    );
    expect([...callables].sort()).toEqual(Object.values(Callables).sort());
  });

  it('covers every flip-1 export with a pipeline case and leaves the other four on their handlers', () => {
    expect([...FLIP_1_EXPORTS, ...Object.keys(LEGACY)].sort()).toEqual([
      ...EXPORTS,
    ]);
    expect(FLIP_1_EXPORTS).toHaveLength(25);
  });

  describe('flip 1 — every export runs exactly its own pipeline', () => {
    it.each(FLIP_1_EXPORTS)(
      '%s decodes its input, runs its own pipeline over the server ports — and no other — and answers today’s JSON',
      async (name) => {
        const own = caseOf(name);
        seam.answers.set(own.pipeline, own.answer);
        const answer = await run(name, own.input);
        expect(answer).toEqual(own.expected);
        expect(seam.calls.map((call) => call.pipeline)).toEqual([own.pipeline]);
        const call = seam.calls[0];
        expect(call?.ports).toMatchObject({
          ...seam.BUNDLE,
          tenantTimeZone: 'Europe/Sofia',
        });
        if (own.command === undefined) expect(call?.args).toEqual([]);
        else expect(call?.args[0]).toMatchObject(own.command as object);
        for (const other of seam.PIPELINES) {
          if (other !== own.pipeline) {
            expect(
              seam.pipelines[other],
              `${name} built ${other}`,
            ).not.toHaveBeenCalled();
          }
        }
      },
    );

    it('builds the server ports once, over the Admin SDK’s Firestore, the primitives and the telemetry', async () => {
      await run('cancelAppointment', caseOf('cancelAppointment').input);
      await run('commitBooking', caseOf('commitBooking').input);
      expect(seam.built).toHaveLength(1);
      const [db, primitives, telemetry] = seam.built[0] as [
        unknown,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(db).toBe(seam.DB);
      expect(Object.keys(primitives).sort()).toEqual([
        'hash',
        'nextId',
        'nowUtcMs',
      ]);
      expect(Object.keys(telemetry).sort()).toEqual(['log', 'trackError']);
    });

    it('hands the step its work budget, a share of its 540 s timeout', async () => {
      const step = caseOf('continueClientStatsPolicyRecompute');
      seam.answers.set(step.pipeline, step.answer);
      await run('continueClientStatsPolicyRecompute', step.input);
      const budget = seam.calls[0]?.args[1] as {
        spent: () => boolean;
        limitMs: number;
      };
      expect(budget.spent()).toBe(false);
      expect(budget.limitMs).toBeGreaterThan(60_000);
      expect(budget.limitMs).toBeLessThan(540_000);
    });

    it('answers a refusal in the callable’s own words, and a store failure as the callable’s failure', async () => {
      seam.answers.set('cancelAppointment', () => ({
        ok: false,
        error: BookingError.invalidInput('appointmentId'),
      }));
      const notFound = await rejection(
        run('cancelAppointment', caseOf('cancelAppointment').input),
      );
      expect(notFound.code).toBe('not-found');
      expect(notFound.details).toEqual({ code: 'booking.cancel.not_found' });

      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const down = () => ({
        ok: false,
        error: RepositoryError.writeFailed('appointments/a-1', 'aborted'),
      });
      seam.answers.set('bookAppointment', down);
      const coded = await rejection(
        run('commitBooking', caseOf('commitBooking').input),
      );
      expect(coded.code).toBe('internal');
      expect(coded.details).toEqual({
        code: 'booking.commit.store_failed',
        params: {},
      });
      seam.answers.set('cancelAppointment', down);
      const bare = await rejection(
        run('cancelAppointment', caseOf('cancelAppointment').input),
      );
      expect(bare.code).toBe('internal');
      expect(bare.message).toBe('INTERNAL');
      expect(bare.details).toBeUndefined();
    });

    it('answers today’s refusals before any pipeline runs', async () => {
      const cancel = await rejection(
        run('cancelWaitlist', request({ requestId: 'r1' }, null)),
      );
      expect(cancel.code).toBe('unauthenticated');
      expect(cancel.message).toBe('Sign in to manage the waitlist');
      expect(cancel.details).toEqual({
        code: 'booking.waitlist.unauthenticated',
      });
      const tip = await rejection(run('recordSeatTip', request({}, null)));
      expect(tip.code).toBe('unauthenticated');
      expect(tip.details).toEqual({ code: 'booking.tip.unauthenticated' });
      const forbidden = await rejection(
        run('transitionAppointment', request({}, CLIENT)),
      );
      expect(forbidden.code).toBe('permission-denied');
      expect(forbidden.details).toEqual({
        code: 'booking.transition.forbidden',
      });
      expect(seam.calls).toEqual([]);
    });

    it('fails a non-retrying trigger on a store failure, and lets a retrying one log its one attempt line and rethrow a transient', async () => {
      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const down = () => ({
        ok: false,
        error: RepositoryError.readFailed('barberBusy', 'unavailable'),
      });
      seam.answers.set('rebuildBusy', down);
      await expect(
        run(
          'rebuildBusyOnAppointmentChange',
          caseOf('rebuildBusyOnAppointmentChange').input,
        ),
      ).rejects.toThrow();
      seam.answers.set('startPolicyRecompute', down);
      const settled = run(
        'recomputeClientStatsOnPolicyChange',
        caseOf('recomputeClientStatsOnPolicyChange').input,
      );
      await settled.catch(() => undefined);
      expect(logger.error).toHaveBeenCalledWith(
        'trigger attempt failed',
        expect.objectContaining({
          fn: 'recomputeClientStatsOnPolicyChange',
          eventId: 'event-1',
        }),
      );
    });
  });

  describe('the four exports no flip has reached — still today’s handlers', () => {
    it.each(Object.keys(LEGACY))(
      '%s hands its input to its own handler — and to no other — and answers what it answers',
      async (name) => {
        const spies = new Map(
          Object.entries(LEGACY).map(([other, handler]) => [
            other,
            vi.spyOn(handler, 'run').mockResolvedValue({ answeredBy: other }),
          ]),
        );
        const input = request({ probe: name }, CLIENT);
        expect(await run(name, input)).toEqual({ answeredBy: name });
        for (const [other, spy] of spies) {
          if (other === name) {
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0]?.[0]).toBe(input);
          } else expect(spy, `${name} ran ${other}`).not.toHaveBeenCalled();
        }
        expect(seam.calls).toEqual([]);
      },
    );
  });

  it.each(EXPORTS.filter((name) => CALLABLE_NAMES.has(name)))(
    '%s reports an unexpected throw under its own callable name',
    async (name) => {
      const trackError = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined);
      const thrown = new Error(`boom in ${name}`);
      const legacy = new Map(Object.entries(LEGACY)).get(name);
      let input: unknown = request({}, CLIENT);
      if (legacy === undefined) {
        const own = caseOf(name);
        seam.answers.set(own.pipeline, () => {
          throw thrown;
        });
        input = own.input;
      } else vi.spyOn(legacy, 'run').mockRejectedValue(thrown);
      const answer = await rejection(run(name, input));
      expect(answer.code).toBe('internal');
      expect(trackError).toHaveBeenCalledTimes(1);
      expect(trackError).toHaveBeenCalledWith(thrown, { callable: name });
    },
  );
});
