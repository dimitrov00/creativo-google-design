import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import {
  Actor,
  ClientIssueKind,
  Email,
  GovernedCollection,
  ParsedIdentifier,
  SystemSource,
} from '@core/components';
import {
  BookingError,
  IdentityError,
  IdentityErrorCode,
  RepositoryError,
} from '@core/errors';
import { BusyKey, CustomerId } from '@core/primitives';
import { Callables, type Log, type OtpDeliveryPorts } from '@core/ports';
import { Collections } from '@core/entities';
import {
  ClientIssueSystem,
  GovernedChangeSystem,
  LogDigestSystem,
  TriggerAttemptSystem,
} from '@core/systems';
import { appointmentFixture, FIXTURE_IDS, localDate } from '@core/testing';
import { hmacSha256Hex } from './adapters/crypto.adapter';

/**
 * The pipelines and the Firestore bundle, replaced at the module seam: each
 * pipeline factory records the ports it was built over and the arguments it
 * ran with, then answers what the case set — so a spec proves which
 * pipeline an export runs, and with what, without a database.
 */
const seam = vi.hoisted(() => {
  const PIPELINES = [
    'auditDocumentChange',
    'bookAppointment',
    'cancelAppointment',
    'cancelWaitlist',
    'completeRegistration',
    'continuePolicyRecompute',
    'editAppointment',
    'endImpersonation',
    'exportClientData',
    'markArrival',
    'matchWaitlist',
    'projectClientStats',
    'publishStreakDefinition',
    'rebuildBusy',
    'rebuildCapacity',
    'recordSeatTip',
    'redeemInvitation',
    'reportClientIssues',
    'requestOtp',
    'requestWaitlist',
    'rescheduleAppointment',
    'runBackfill',
    'sampleLeadTime',
    'startImpersonation',
    'startPolicyRecompute',
    'sweepPolicyRecompute',
    'transitionAppointment',
    'updateProfile',
    'verifyOtp',
    'withdrawStreakDefinition',
  ] as const;
  type Call = {
    readonly pipeline: string;
    readonly ports: unknown;
    readonly args: readonly unknown[];
  };
  const calls: Call[] = [];
  /** What a pipeline answers — handed the ports it was built over and its arguments. */
  const answers = new Map<
    string,
    (ports: unknown, args: readonly unknown[]) => unknown
  >();
  const DB = { sentinel: 'db' };
  /** The Firestore bundle's commit port — a case scripts it (`mockImplementationOnce`). */
  const commit = vi.fn(async (): Promise<unknown> => ({ ok: true, value: {} }));
  /** The Firestore bundle's dead-letter writer (audit-hardening WS-6) — answers success. */
  const writeTriggerFailure = vi.fn(async (): Promise<unknown> => ({
    ok: true,
    value: undefined,
  }));
  const BUNDLE = { sentinel: 'firestore ports', commit, writeTriggerFailure };
  /** Every `firestorePorts(...)` call's arguments — never cleared, the cold-start-once proof. */
  const built: (readonly unknown[])[] = [];
  const pipelines = Object.fromEntries(
    PIPELINES.map((pipeline) => [
      pipeline,
      vi.fn((ports: unknown) => async (...args: unknown[]) => {
        calls.push({ pipeline, ports, args });
        const answer = answers.get(pipeline);
        return answer === undefined
          ? { ok: true, value: {} }
          : answer(ports, args);
      }),
    ]),
  );
  /** The console OTP sender, spied over the real one — the WS-0 proof that a deployment never builds it. */
  const consoleOtpSender = vi.fn<(log: Log) => OtpDeliveryPorts>();
  return {
    PIPELINES,
    consoleOtpSender,
    calls,
    answers,
    DB,
    BUNDLE,
    commit,
    writeTriggerFailure,
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
vi.mock('./adapters/console-otp-sender.adapter', async (importOriginal) => {
  const actual = await importOriginal<{
    readonly consoleOtpSender: (log: Log) => OtpDeliveryPorts;
  }>();
  seam.consoleOtpSender.mockImplementation(actual.consoleOtpSender);
  return { ...actual, consoleOtpSender: seam.consoleOtpSender };
});
vi.mock('@core/pipelines', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...seam.pipelines,
}));

import * as main from './main';

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

/** A callable bound to no secret — the client issue sink alone (RU-24). */
const callable = { ...PLATFORM, callableTrigger: {} };

/**
 * A traced callable (audit-hardening WS-4.2, DEP-18): bound to the log
 * digest key its outcome line's `inputDigest` is keyed by — every callable
 * but the sink.
 */
const tracedCallable = {
  ...callable,
  secretEnvironmentVariables: [{ key: 'LOG_DIGEST_KEY' }],
};

/**
 * A callable bound to the walk-in key (OR-26) — the two that mint walk-in
 * records, and the admin privacy callables that recognise them (P3-RU-36)
 * — and the log digest key.
 */
const walkInCallable = {
  ...callable,
  secretEnvironmentVariables: [
    { key: 'WALKIN_ID_KEY' },
    { key: 'LOG_DIGEST_KEY' },
  ],
};

/**
 * A document-change audit trigger (audit-hardening WS-3, RU-40): the write
 * with its auth context, on one collection's `<path>/{docId}`, retrying.
 */
const audited = (document: string) => ({
  ...PLATFORM,
  eventTrigger: {
    eventType: `${WRITTEN}.withAuthContext`,
    eventFilters: DATABASE,
    eventFilterPathPatterns: { document },
    retry: true,
  },
});

const written = (document: string, retry: boolean) => ({
  ...PLATFORM,
  eventTrigger: {
    eventType: WRITTEN,
    eventFilters: DATABASE,
    eventFilterPathPatterns: { document },
    retry,
  },
});

/** A schedule on the cron's clock (`CRON_TIME_ZONE`, `onSchedule` only — 4A-11). */
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
 * handlers (2026-10-11); the OTP trio's plain `onCall` definitions are
 * pinned the same, now that flip 2 deleted their handlers, and
 * `updateProfile` (flip 2's new callable) declares no option either; the
 * streak publish's plain `onCall` stays as its Phase 3a row declared it
 * (flip 3); Phase 4a's three new callables (`startImpersonation`,
 * `endImpersonation`, `redeemInvitation`, 4A-3 (4), (5)) declare no option
 * either. Edge-hardening D-5 flipped three retry flags — the projection
 * triggers `rebuildBusyOnAppointmentChange`, `rebuildCapacityOnBusyChange`
 * and `matchWaitlistOnBusyChange` retry now (the allowlist's deployed half)
 * — and pass E (E-1, DEP-1) four more: the capacity triggers
 * `rebuildCapacityOnExceptionChange`, `rebuildCapacityOnRosterChange`,
 * `rebuildCapacityOnLocationChange` and `rebuildCapacityOnSettingsChange`.
 * Pass F's new sink, `reportClientIssues` (OR-34), declares its own: two
 * instances, 80 concurrent calls each, 256 MiB, 10 s. The two callables
 * that mint walk-in records (`commitBooking`, `staffEditAppointment`) bind
 * the `WALKIN_ID_KEY` secret their ids are keyed by (OR-26), as does
 * audit-hardening Phase 3's `exportClientData` (P3-DEP-9: the admin's
 * data-subject export, 512 MiB, recognising a walk-in's contact by that
 * key, P3-RU-36), and every
 * callable but the sink binds `LOG_DIGEST_KEY` (audit-hardening WS-4.2,
 * DEP-18: the outcome line's keyed `inputDigest`); no other export holds a
 * secret. Audit-hardening WS-3 (DEP-14, RU-40) added the
 * thirteen governed-collection audit triggers (`auditSettingsChanges` …
 * `auditAppointmentPhotosChanges`), each the write with its auth context on
 * its own `<collection>/{docId}`, retrying — the one helper behind them is
 * also `auditProfileChanges`', whose name is kept and whose path param
 * became `{docId}` (`users/{uid}` before).
 * A literal: what `firebase deploy` reads, so a changed path, retry flag,
 * timeout, memory, instance cap, secret or schedule fails here.
 */
const ENDPOINTS = {
  requestOtpChallenge: tracedCallable,
  verifyOtpChallenge: tracedCallable,
  completeRegistration: tracedCallable,
  updateProfile: tracedCallable,
  auditProfileChanges: audited('users/{docId}'),
  auditSettingsChanges: audited('settings/{docId}'),
  auditServicesChanges: audited('services/{docId}'),
  auditBarbersChanges: audited('barbers/{docId}'),
  auditLocationsChanges: audited('locations/{docId}'),
  auditBarberSchedulesChanges: audited('barberSchedules/{docId}'),
  auditScheduleExceptionsChanges: audited('scheduleExceptions/{docId}'),
  auditCouponsChanges: audited('coupons/{docId}'),
  auditPositionsChanges: audited('positions/{docId}'),
  auditCoursesChanges: audited('courses/{docId}'),
  auditEventsChanges: audited('events/{docId}'),
  auditCustomersChanges: audited('customers/{docId}'),
  auditAppointmentNotesChanges: audited('appointmentNotes/{docId}'),
  auditAppointmentPhotosChanges: audited('appointmentPhotos/{docId}'),
  commitBooking: walkInCallable,
  cancelAppointment: tracedCallable,
  rescheduleAppointment: tracedCallable,
  transitionAppointment: tracedCallable,
  markArrived: tracedCallable,
  clearArrival: tracedCallable,
  recordSeatTip: tracedCallable,
  staffEditAppointment: walkInCallable,
  rebuildBusyOnAppointmentChange: written('appointments/{appointmentId}', true),
  rebuildCapacityOnBusyChange: written('barberBusy/{docId}', true),
  rebuildCapacityOnExceptionChange: written('scheduleExceptions/{docId}', true),
  rebuildCapacityOnRosterChange: written('barberSchedules/{barberId}', true),
  rebuildCapacityOnLocationChange: written('locations/{locationId}', true),
  rebuildCapacityOnSettingsChange: written('settings/{docId}', true),
  sweepCapacityDaily: daily('every day 03:00'),
  sampleBarberLeadTimeDaily: daily('every day 04:00'),
  requestWaitlist: tracedCallable,
  cancelWaitlist: tracedCallable,
  matchWaitlistOnBusyChange: written('barberBusy/{docId}', true),
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
  runBackfill: {
    ...tracedCallable,
    availableMemoryMb: 512,
    timeoutSeconds: 540,
  },
  publishStreakDefinition: tracedCallable,
  startImpersonation: tracedCallable,
  endImpersonation: tracedCallable,
  redeemInvitation: tracedCallable,
  exportClientData: { ...walkInCallable, availableMemoryMb: 512 },
  reportClientIssues: {
    ...callable,
    availableMemoryMb: 256,
    timeoutSeconds: 10,
    maxInstances: 2,
    concurrency: 80,
  },
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
const OWNER = { uid: 'u-owner', roles: ['barber', 'admin'] } as const;
/** The shop's admin alone — the one role `Roles.PRIVACY` admits (P3-RU-13). */
const PRIVACY_ADMIN = { uid: 'u-owner', roles: ['admin'] } as const;

/** An export's answer, as the pipeline returns it and the call answers it verbatim. */
const EXPORTED = {
  clientExportVersion: 1,
  exportedCustomerId: 'cus-1',
  exportedAtUtcMs: Date.UTC(2026, 9, 11, 7),
  exportDocumentCount: 2,
  exportByteCount: 17,
  exportJson: '{"customers":[]}',
} as const;

/** The call component, as the admin page sends it — the rule's body is the pipeline's to judge. */
const STREAK_PUBLISH = {
  requestId: 'intent-000000000001',
  streakId: 'cadence',
  baseVersion: 1,
  rule: { effectiveFromLocalDate: '2026-10-05' },
  streakTransition: 'GRANDFATHER',
  previewHash: null,
} as const;

/** A Firestore write event with nothing on either side. */
const writeEvent = (params: Record<string, string>) => ({
  id: 'event-1',
  time: '2026-10-11T07:00:00.000000Z',
  params,
  data: undefined,
});

const tick = { jobName: 'job', scheduleTime: '2026-10-11T00:00:00Z' };

/** One issue as the web's reporter composes it — a batch the sink admits (OR-34). */
const ISSUES = [
  ClientIssueSystem.compose({
    clientIssueKind: ClientIssueKind.ChunkLoadFailed,
    errorName: 'ChunkLoadError',
    documentPath: null,
    fieldName: null,
    routePattern: '/staff/schedule',
    topFrame: null,
    message: 'Loading chunk 7 failed',
    release: '2026.10.26',
  }),
] as const;

const ok = (value: unknown) => () => ({ ok: true, value });

/** The streak ports' commit, run as the pipeline runs it: a read, a decision, a plan. */
const commitThrough = (ports: unknown): Promise<unknown> =>
  (
    ports as {
      readonly commit: (
        read: () => Promise<null>,
        decide: () => unknown,
      ) => Promise<unknown>;
    }
  ).commit(
    async () => null,
    () => ({ ok: true, value: { writes: [] } }),
  );

const NO_ATTEMPT = { attemptFailure: null, survivedFailure: null } as const;

/**
 * One governed-collection audit trigger's case (WS-3, DEP-14): an event on
 * `<path>/doc-1` with nothing on either side, decoded into the governed
 * change `auditDocumentChange` runs — the resource `<path>/doc-1`, the
 * client record for `customers` only — answering no row.
 */
const governedCase = (
  governedCollection: GovernedCollection,
  path: string,
): Case => ({
  pipeline: 'auditDocumentChange',
  input: { ...writeEvent({ docId: 'doc-1' }), authType: 'service_account' },
  command: {
    governedCollection,
    resourceId: `${path}/doc-1`,
    targetCustomerId:
      governedCollection === GovernedCollection.Customers ? 'doc-1' : null,
    writer: Actor.system(SystemSource.AdminSdk),
    beforeExists: false,
    afterExists: false,
    fields: [],
  },
  answer: ok({ rows: 0 }),
  expected: undefined,
});

/** One flip-1 export: what the platform hands it, the pipeline it must run, and the round trip. */
type Case = {
  readonly pipeline: PipelineName;
  readonly input: unknown;
  /** Matched against the pipeline's first argument (`undefined`: it takes none). */
  readonly command: unknown;
  readonly answer: (ports: unknown, args: readonly unknown[]) => unknown;
  /** What the export answers — `undefined` for a trigger. */
  readonly expected: unknown;
};

const FLIPPED: { readonly [name: string]: Case } = {
  // ── flip 2: identity ──
  requestOtpChallenge: {
    pipeline: 'requestOtp',
    input: request({ identifierChannel: 'EMAIL', identifier: 'a@b.com' }, null),
    command: { otpDestinationType: 'EMAIL', rawDestination: 'a@b.com' },
    answer: ok({ otpId: 'otp-1', rawCode: '123456' }),
    expected: { challengeId: 'otp-1', devCode: null },
  },
  verifyOtpChallenge: {
    pipeline: 'verifyOtp',
    input: request({ challengeId: 'otp-1', code: '123456' }, null),
    command: { otpId: 'otp-1', code: '123456' },
    answer: ok({ customToken: 'token-1', sessionKind: 'NEW' }),
    expected: { sessionKind: 'NEW', customToken: 'token-1' },
  },
  completeRegistration: {
    pipeline: 'completeRegistration',
    input: request(
      {
        identifierChannel: 'PHONE',
        identifier: '+359888123456',
        fields: { firstName: 'Ada', lastName: 'Lovelace' },
      },
      CLIENT,
    ),
    command: {
      callerUserId: 'u-client',
      identifierChannel: 'PHONE',
      rawIdentifier: '+359888123456',
    },
    answer: ok({ customToken: 'token-2' }),
    expected: { customToken: 'token-2' },
  },
  // ── flip 3: loyalty ──
  publishStreakDefinition: {
    pipeline: 'publishStreakDefinition',
    input: request(STREAK_PUBLISH, OWNER),
    command: {
      callerUserId: 'u-owner',
      callerIsAdmin: true,
      callerActor: { actorRole: 'ADMIN', actorAdminUserId: 'u-owner' },
      requestId: 'intent-000000000001',
      streakId: 'cadence',
      baseVersion: 1,
      effectiveFrom: '2026-10-05',
      streakTransition: 'GRANDFATHER',
      previewHash: null,
    },
    answer: ok({
      version: 2,
      effectiveFromLocalDate: '2026-10-05',
      streakRuleDirection: 'LOOSER',
    }),
    expected: {
      streakPublishOutcome: 'PUBLISHED',
      version: 2,
      effectiveFromLocalDate: '2026-10-05',
      streakRuleDirection: 'LOOSER',
    },
  },
  updateProfile: {
    pipeline: 'updateProfile',
    input: request({ firstName: 'Ada' }, CLIENT),
    command: {
      callerUserId: 'u-client',
      edits: { firstName: 'Ada', lastName: null, birthDate: null },
    },
    answer: ok({ changed: true }),
    expected: { changed: true },
  },
  // ── flip 1: booking core ──
  commitBooking: {
    pipeline: 'bookAppointment',
    input: request(
      {
        locationId: 'loc-1',
        localDate: '2026-10-12',
        seats: [],
        attemptId: 'attempt-0123456789abcdef',
        contact: null,
        bookedFromAppointmentId: null,
        placement: 'SELF',
        onBehalfOfUserId: null,
      },
      CLIENT,
    ),
    command: {
      locationId: 'loc-1',
      localDate: '2026-10-12',
      ownerUserId: 'u-client',
      staffPlacement: false,
    },
    answer: ok({ appointmentId: 'a-1', replayed: false }),
    expected: { appointmentId: 'a-1' },
  },
  cancelAppointment: {
    pipeline: 'cancelAppointment',
    input: request(
      {
        appointmentId: 'a-1',
        reason: 'UNSPECIFIED',
        operationId: 'operation-0123456789ab',
      },
      CLIENT,
    ),
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
      {
        appointmentId: 'a-1',
        locationId: 'loc-1',
        localDate: '2026-10-12',
        seats: [],
        attemptId: 'move-attempt-0123456789',
      },
      CLIENT,
    ),
    command: {
      appointmentId: 'a-1',
      callerUserId: 'u-client',
      locationId: 'loc-1',
      localDate: '2026-10-12',
    },
    answer: ok({ appointmentId: 'a-1', revision: 2, replayed: false }),
    expected: { appointmentId: 'a-1' },
  },
  transitionAppointment: {
    pipeline: 'transitionAppointment',
    input: request(
      {
        appointmentId: 'a-1',
        toBookingStatus: 'COMPLETED',
        cancellationReason: null,
        seatId: null,
        operationId: 'operation-0123456789ab',
      },
      STAFF,
    ),
    command: { appointmentId: 'a-1', to: 'COMPLETED', seatId: null },
    answer: ok({ appointmentId: 'a-1', to: 'COMPLETED' }),
    expected: { appointmentId: 'a-1', toBookingStatus: 'COMPLETED' },
  },
  markArrived: {
    pipeline: 'markArrival',
    input: request(
      { appointmentId: 'a-1', operationId: 'operation-0123456789ab' },
      STAFF,
    ),
    command: { markArrivalAction: 'ARRIVE', appointmentId: 'a-1' },
    answer: ok({ appointmentId: 'a-1', unchanged: false }),
    expected: { appointmentId: 'a-1', alreadyArrived: false },
  },
  clearArrival: {
    pipeline: 'markArrival',
    input: request(
      { appointmentId: 'a-1', operationId: 'operation-0123456789ab' },
      STAFF,
    ),
    command: { markArrivalAction: 'CLEAR', appointmentId: 'a-1' },
    answer: ok({ appointmentId: 'a-1', unchanged: true }),
    expected: { appointmentId: 'a-1', alreadyClear: true },
  },
  recordSeatTip: {
    pipeline: 'recordSeatTip',
    input: request(
      {
        appointmentId: 'a-1',
        seatId: 's-1',
        amountCents: 500,
        operationId: 'operation-0123456789ab',
      },
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
        commands: [
          {
            editCommand: 'MOVE',
            localDate: '2026-10-12',
            startMinutes: 600,
            seatIds: null,
          },
        ],
        acknowledgedOverlap: false,
        expectedVersion: null,
        operationId: 'operation-0123456789ab',
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
    command: { before: null, after: null },
    answer: ok({ written: 0, failures: [], attemptFailure: null }),
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
    command: { capacityTrigger: 'SWEEP' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  rebuildCapacityOnSettingsChange: {
    pipeline: 'rebuildCapacity',
    input: writeEvent({ docId: 'bookingPolicy' }),
    command: { capacityTrigger: 'SWEEP' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  sweepCapacityDaily: {
    pipeline: 'rebuildCapacity',
    input: tick,
    command: { capacityTrigger: 'SWEEP' },
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  sampleBarberLeadTimeDaily: {
    pipeline: 'sampleLeadTime',
    input: tick,
    command: undefined,
    answer: ok({ written: 0 }),
    expected: undefined,
  },
  requestWaitlist: {
    pipeline: 'requestWaitlist',
    input: request(
      {
        locationId: 'loc-1',
        days: [],
        cart: { cartSeats: [], cartNextSequence: 0 },
      },
      CLIENT,
    ),
    command: {
      ownerUserId: 'u-client',
      ask: { locationId: 'loc-1', days: [] },
    },
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
    command: { localDate: '2026-10-12' },
    answer: ok({ notified: 0, failures: [], attemptFailure: null }),
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
    input: request(
      { backfillJobName: 'CLIENT_STATS', backfillResume: false, cursor: null },
      SYSADMIN,
    ),
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
    },
  },
  auditProfileChanges: {
    pipeline: 'auditDocumentChange',
    input: { ...writeEvent({ docId: 'u-1' }), authType: 'system' },
    command: {
      governedCollection: GovernedCollection.Users,
      ownerUserId: 'u-1',
      beforeExists: false,
      afterExists: false,
    },
    answer: ok({ rows: 0 }),
    expected: undefined,
  },
  // ── audit-hardening WS-3: the thirteen governed collections (DEP-14) ──
  auditSettingsChanges: governedCase(GovernedCollection.Settings, 'settings'),
  auditServicesChanges: governedCase(GovernedCollection.Services, 'services'),
  auditBarbersChanges: governedCase(GovernedCollection.Barbers, 'barbers'),
  auditLocationsChanges: governedCase(
    GovernedCollection.Locations,
    'locations',
  ),
  auditBarberSchedulesChanges: governedCase(
    GovernedCollection.BarberSchedules,
    'barberSchedules',
  ),
  auditScheduleExceptionsChanges: governedCase(
    GovernedCollection.ScheduleExceptions,
    'scheduleExceptions',
  ),
  auditCouponsChanges: governedCase(GovernedCollection.Coupons, 'coupons'),
  auditPositionsChanges: governedCase(
    GovernedCollection.Positions,
    'positions',
  ),
  auditCoursesChanges: governedCase(GovernedCollection.Courses, 'courses'),
  auditEventsChanges: governedCase(GovernedCollection.Events, 'events'),
  auditCustomersChanges: governedCase(
    GovernedCollection.Customers,
    'customers',
  ),
  auditAppointmentNotesChanges: governedCase(
    GovernedCollection.AppointmentNotes,
    'appointmentNotes',
  ),
  auditAppointmentPhotosChanges: governedCase(
    GovernedCollection.AppointmentPhotos,
    'appointmentPhotos',
  ),
  // ── Phase 4a: the new callables (4A-3 (4), (5)) ──
  startImpersonation: {
    pipeline: 'startImpersonation',
    input: request(
      {
        targetUserId: 'u-client',
        impersonationScope: 'READ',
        reason: 'support ticket 42',
        expiresAtUtcMs: Date.UTC(2026, 9, 11, 8),
      },
      OWNER,
    ),
    command: {
      adminUserId: 'u-owner',
      adminRoles: ['barber', 'admin'],
      targetUserId: 'u-client',
      impersonationScope: 'READ',
      reason: 'support ticket 42',
      expiresAtUtcMs: Date.UTC(2026, 9, 11, 8),
    },
    answer: ok({ sessionId: 'imp-1' }),
    expected: { sessionId: 'imp-1' },
  },
  endImpersonation: {
    pipeline: 'endImpersonation',
    input: request({ sessionId: 'imp-1' }, OWNER),
    command: { sessionId: 'imp-1', adminUserId: 'u-owner' },
    answer: ok({ sessionId: 'imp-1', impersonationEndReason: 'ADMIN_ENDED' }),
    expected: { sessionId: 'imp-1', impersonationEndReason: 'ADMIN_ENDED' },
  },
  redeemInvitation: {
    pipeline: 'redeemInvitation',
    input: request({ invitationId: 'inv-1' }, CLIENT),
    command: { invitationId: 'inv-1', refereeUserId: 'u-client' },
    answer: ok({ invitationId: 'inv-1', redemptionCount: 3 }),
    expected: { invitationId: 'inv-1', redemptionCount: 3 },
  },
  // ── audit-hardening Phase 3: the admin's data-subject export (P3-DEP-9) ──
  exportClientData: {
    pipeline: 'exportClientData',
    input: request(
      { customerId: 'cus-1', operationId: 'operation-0123456789ab' },
      PRIVACY_ADMIN,
    ),
    command: {
      callerUserId: 'u-owner',
      callerRoles: ['admin'],
      customerId: 'cus-1',
      operationId: 'operation-0123456789ab',
    },
    answer: ok(EXPORTED),
    expected: EXPORTED,
  },
  // ── pass F: the client issue sink (OR-34) ──
  reportClientIssues: {
    pipeline: 'reportClientIssues',
    input: request(ISSUES, STAFF),
    command: {
      reporterRoles: ['barber'],
      reporterAuthed: true,
      issues: ISSUES,
    },
    // The pipeline answers its count as it is — it refuses nothing.
    answer: () => ({ loggedCount: 1 }),
    expected: { loggedCount: 1 },
  },
};

/** The exports that run over the telemetry alone — never the server ports (OR-34's sink). */
const TELEMETRY_EXPORTS: ReadonlySet<string> = new Set(['reportClientIssues']);

const FLIPPED_EXPORTS = Object.keys(FLIPPED).sort();
/** The identity flip's callables — the ones that build the identity ports. */
const IDENTITY_EXPORTS = [
  'completeRegistration',
  'requestOtpChallenge',
  'verifyOtpChallenge',
] as const;
const CALLABLE_NAMES: ReadonlySet<string> = new Set(Object.values(Callables));

function caseOf(name: string): Case {
  const found = new Map(Object.entries(FLIPPED)).get(name);
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

/** The log digest key the spec runs under — a fixed, public test value. */
const SPEC_LOG_DIGEST_KEY = 'spec-log-digest-key';
const LOG_DIGEST_KEY_BEFORE = process.env['LOG_DIGEST_KEY'];

beforeAll(() => {
  process.env['LOG_DIGEST_KEY'] = SPEC_LOG_DIGEST_KEY;
});

afterAll(() => {
  if (LOG_DIGEST_KEY_BEFORE === undefined) delete process.env['LOG_DIGEST_KEY'];
  else process.env['LOG_DIGEST_KEY'] = LOG_DIGEST_KEY_BEFORE;
});

beforeEach(() => {
  seam.calls.length = 0;
  seam.answers.clear();
  for (const factory of Object.values(seam.pipelines)) factory.mockClear();
  seam.commit.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('main.ts — the composition root', () => {
  it('loads without building a port: the Admin SDK and the Firestore bundle wait for the first invocation', () => {
    expect(seam.adminFirestore).not.toHaveBeenCalled();
    expect(seam.adminAuth).not.toHaveBeenCalled();
    expect(seam.firestorePorts).not.toHaveBeenCalled();
    for (const name of seam.PIPELINES) {
      expect(seam.pipelines[name], name).not.toHaveBeenCalled();
    }
  });

  it('exports exactly the 48 functions — today’s 30, Phase 4a’s three callables, pass F’s issue sink, WS-3’s thirteen governed-collection audit triggers and Phase 3’s client export', () => {
    expect([...exported.keys()].sort()).toEqual([...EXPORTS]);
  });

  it('audits every governed collection — USERS included — through exactly one export on its Collections path, and nothing else through the auth-context event (RU-40)', () => {
    const members = Object.values(GovernedCollection);
    expect(members).toHaveLength(14);
    const paths: readonly string[] = Object.values(Collections);
    const wanted = members.map((member) => {
      const path = GovernedChangeSystem.pathOf(member);
      expect(paths, member).toContain(path);
      return `${path}/{docId}`;
    });
    expect(new Set(wanted).size).toBe(members.length);
    // Read off the deployed endpoints themselves: every auth-context write
    // trigger, by the document it listens on.
    const deployed = [...exported.keys()].flatMap((name) => {
      const endpoint = endpointOf(exported.get(name)) as {
        readonly eventTrigger?: {
          readonly eventType: string;
          readonly eventFilterPathPatterns: { readonly document?: string };
        };
      };
      return endpoint.eventTrigger?.eventType === `${WRITTEN}.withAuthContext`
        ? [endpoint.eventTrigger.eventFilterPathPatterns.document]
        : [];
    });
    expect([...deployed].sort()).toEqual([...wanted].sort());
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

  it('covers every export with a pipeline case — no export runs a Phase 3a handler', () => {
    expect(FLIPPED_EXPORTS).toEqual([...EXPORTS]);
    expect(FLIPPED_EXPORTS).toHaveLength(48);
  });

  describe('flips 1–3, Phase 4a and pass F — every export runs exactly its own pipeline', () => {
    it.each(FLIPPED_EXPORTS)(
      '%s decodes its call component, runs its own pipeline over its ports — and no other — and answers the call component’s answer',
      async (name) => {
        const own = caseOf(name);
        seam.answers.set(own.pipeline, own.answer);
        const answer = await run(name, own.input);
        expect(answer).toEqual(own.expected);
        expect(seam.calls.map((call) => call.pipeline)).toEqual([own.pipeline]);
        const call = seam.calls[0];
        if (TELEMETRY_EXPORTS.has(name)) {
          // The sink reads and writes no document: the telemetry, nothing else.
          expect(Object.keys(call?.ports as object).sort()).toEqual([
            'log',
            'trackError',
          ]);
        } else {
          // The shop's zone is the location's: the ports carry the default
          // location a boundary with none in scope reads (4A-11), no zone.
          expect(call?.ports).toMatchObject({
            sentinel: seam.BUNDLE.sentinel,
            defaultLocationId: 'loc-center',
          });
        }
        expect(call?.ports).not.toHaveProperty('tenantTimeZone');
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

    it('hands the keyed walk-in digest to the two callables that mint walk-ins, and to no other export (OR-26)', async () => {
      await run('commitBooking', caseOf('commitBooking').input);
      await run('staffEditAppointment', caseOf('staffEditAppointment').input);
      await run('cancelAppointment', caseOf('cancelAppointment').input);
      const [booking, edit, cancel] = seam.calls.map(
        (call) => call.ports as Record<string, unknown>,
      );
      expect(booking).toHaveProperty('walkInHash');
      expect(edit).toHaveProperty('walkInHash');
      expect(cancel).not.toHaveProperty('walkInHash');
      // The server ports underneath, built once.
      expect(booking).toMatchObject({ sentinel: seam.BUNDLE.sentinel });
      expect(seam.built).toHaveLength(1);
    });

    it('keys the walk-in digest by the WALKIN_ID_KEY secret, read per call — and an empty key is a defect, never an unkeyed id', async () => {
      await run('commitBooking', caseOf('commitBooking').input);
      const { walkInHash } = seam.calls[0]?.ports as {
        walkInHash: (input: string) => string;
      };
      const before = process.env['WALKIN_ID_KEY'];
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      try {
        process.env['WALKIN_ID_KEY'] = 'spec-walkin-key';
        expect(walkInHash('walkin/v1:+359888123456')).toBe(
          hmacSha256Hex('spec-walkin-key', 'walkin/v1:+359888123456'),
        );
        process.env['WALKIN_ID_KEY'] = '';
        expect(() => walkInHash('walkin/v1:+359888123456')).toThrow(
          'WALKIN_ID_KEY',
        );
      } finally {
        if (before === undefined) delete process.env['WALKIN_ID_KEY'];
        else process.env['WALKIN_ID_KEY'] = before;
        warn.mockRestore();
      }
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
      expect(notFound.message).toBe('BOOKING_CANCEL_NOT_FOUND');
      expect(notFound.details).toEqual({
        errorCode: 'BOOKING_CANCEL_NOT_FOUND',
      });

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
        errorCode: 'BOOKING_COMMIT_STORE_FAILED',
      });
      seam.answers.set('cancelAppointment', down);
      const bare = await rejection(
        run('cancelAppointment', caseOf('cancelAppointment').input),
      );
      expect(bare.code).toBe('internal');
      expect(bare.message).toBe('INTERNAL');
      expect(bare.details).toBeUndefined();
    });

    it('answers a decoder’s refusals before any pipeline runs', async () => {
      const cancel = await rejection(
        run('cancelWaitlist', request({ requestId: 'r1' }, null)),
      );
      expect(cancel.code).toBe('unauthenticated');
      expect(cancel.message).toBe('BOOKING_WAITLIST_UNAUTHENTICATED');
      expect(cancel.details).toEqual({
        errorCode: 'BOOKING_WAITLIST_UNAUTHENTICATED',
      });
      const tip = await rejection(run('recordSeatTip', request({}, null)));
      expect(tip.code).toBe('unauthenticated');
      expect(tip.details).toEqual({ errorCode: 'BOOKING_TIP_UNAUTHENTICATED' });
      const forbidden = await rejection(
        run('transitionAppointment', request({}, CLIENT)),
      );
      expect(forbidden.code).toBe('permission-denied');
      expect(forbidden.details).toEqual({
        errorCode: 'BOOKING_TRANSITION_FORBIDDEN',
      });
      expect(seam.calls).toEqual([]);
    });

    it('gates the impersonation callables on the verified caller before the payload is read, and the invitation on a session', async () => {
      for (const name of ['startImpersonation', 'endImpersonation']) {
        const nobody = await rejection(run(name, request({}, null)));
        expect(nobody.code).toBe('unauthenticated');
        expect(nobody.details).toEqual({
          errorCode: 'GOVERNANCE_IMPERSONATION_UNAUTHENTICATED',
        });
        const staff = await rejection(run(name, request({}, STAFF)));
        expect(staff.code).toBe('permission-denied');
        expect(staff.details).toEqual({
          errorCode: 'GOVERNANCE_IMPERSONATION_FORBIDDEN',
        });
      }
      const anonymous = await rejection(
        run('redeemInvitation', request({ invitationId: 'inv-1' }, null)),
      );
      expect(anonymous.code).toBe('unauthenticated');
      expect(anonymous.details).toEqual({
        errorCode: 'ENGAGEMENT_INVITATION_UNAUTHENTICATED',
      });
      expect(seam.calls).toEqual([]);
    });

    it('gates exportClientData on the verified admin before any pipeline runs — the sysadmin is not enough (P3-RU-13)', async () => {
      const call = {
        customerId: 'cus-1',
        operationId: 'operation-0123456789ab',
      };
      const nobody = await rejection(
        run('exportClientData', request(call, null)),
      );
      expect(nobody.code).toBe('unauthenticated');
      expect(nobody.details).toEqual({ errorCode: 'PRIVACY_UNAUTHENTICATED' });
      for (const auth of [SYSADMIN, STAFF, { uid: 'u-client', roles: [] }]) {
        const refused = await rejection(
          run('exportClientData', request(call, auth)),
        );
        expect(refused.code).toBe('permission-denied');
        expect(refused.details).toEqual({ errorCode: 'PRIVACY_FORBIDDEN' });
      }
      const missing = await rejection(
        run(
          'exportClientData',
          request({ customerId: 'cus-1' }, PRIVACY_ADMIN),
        ),
      );
      expect(missing.code).toBe('invalid-argument');
      expect(missing.details).toEqual({
        errorCode: 'PRIVACY_INVALID_INPUT',
        field: 'operationId',
      });
      expect(seam.calls).toEqual([]);
    });

    it('hands exportClientData the server ports, the keyed walk-in digest, the footprint reads, the audit timelines and the flags — and never one operation’s rows', async () => {
      const own = caseOf('exportClientData');
      seam.answers.set(own.pipeline, own.answer);
      await run('exportClientData', own.input);
      const ports = seam.calls[0]?.ports as Record<string, unknown>;
      for (const member of [
        'walkInHash',
        'flagOn',
        'loadClientRecord',
        'loadProfile',
        'listClientVisits',
        'listPhotosOfClient',
        'listClientJournal',
        'loadLoyaltyAccount',
        'loadClientMoney',
        'pageAuditByTargetCustomer',
        'pageAuditByTargetUser',
      ]) {
        expect(typeof Reflect.get(ports, member), member).toBe('function');
      }
      expect(ports).not.toHaveProperty('auditRowsForOperation');
      expect(ports).toMatchObject({ sentinel: seam.BUNDLE.sentinel });
      expect(seam.built).toHaveLength(1);
    });

    it('fails a non-retrying trigger on a store failure, and lets a retrying one log its one attempt line and rethrow a transient', async () => {
      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const down = () => ({
        ok: false,
        error: RepositoryError.readFailed('barberSchedules', 'unavailable'),
      });
      seam.answers.set('rebuildCapacity', down);
      await expect(
        run('sweepCapacityDaily', caseOf('sweepCapacityDaily').input),
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

  describe('edge-hardening D-5 — the projection triggers retry a transient failure and drop a decisive one', () => {
    /**
     * Each retrying projection trigger and the pipeline it runs — D-5's
     * three, and pass E's four other capacity triggers (E-1, DEP-1).
     */
    const RETRIED = [
      ['rebuildBusyOnAppointmentChange', 'rebuildBusy'],
      ['rebuildCapacityOnBusyChange', 'rebuildCapacity'],
      ['rebuildCapacityOnExceptionChange', 'rebuildCapacity'],
      ['rebuildCapacityOnRosterChange', 'rebuildCapacity'],
      ['rebuildCapacityOnLocationChange', 'rebuildCapacity'],
      ['rebuildCapacityOnSettingsChange', 'rebuildCapacity'],
      ['matchWaitlistOnBusyChange', 'matchWaitlist'],
    ] as const;

    /** The `'trigger attempt failed'` lines the edge logged. */
    const attemptLines = (): readonly unknown[] =>
      vi
        .mocked(logger.error)
        .mock.calls.filter(([msg]) => msg === 'trigger attempt failed')
        .map(([, fields]) => fields);

    /** The `'malformed document refused'` lines a decoder's refusal logged. */
    const refusalLines = (): readonly unknown[] =>
      vi
        .mocked(logger.error)
        .mock.calls.filter(([msg]) => msg === 'malformed document refused')
        .map(([, fields]) => fields);

    beforeEach(() => {
      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    });

    it.each(RETRIED)(
      '%s rejects a transient refusal — its one attempt line TRANSIENT — so the platform redelivers',
      async (name, pipeline) => {
        seam.answers.set(pipeline, () => ({
          ok: false,
          error: RepositoryError.readFailed(
            'locations/loc-center',
            'unavailable',
          ),
        }));
        await expect(run(name, caseOf(name).input)).rejects.toBeDefined();
        expect(attemptLines()).toEqual([
          expect.objectContaining({
            fn: name,
            eventId: 'event-1',
            outcome: 'TRANSIENT',
            errorCode: 'unavailable',
          }),
        ]);
      },
    );

    it.each(RETRIED)(
      '%s resolves a malformed-document refusal — logged PERMANENT as data-loss, never redelivered',
      async (name, pipeline) => {
        seam.answers.set(pipeline, () => ({
          ok: false,
          error: RepositoryError.malformed(
            'barberBusy/b-1__2026-10-12',
            'blocks[0].startMinutes',
          ),
        }));
        await expect(run(name, caseOf(name).input)).resolves.toBeUndefined();
        expect(attemptLines()).toEqual([
          expect.objectContaining({
            fn: name,
            outcome: 'PERMANENT',
            errorCode: 'data-loss',
          }),
        ]);
      },
    );

    it.each(RETRIED)(
      '%s records a dropped delivery once as a dead letter, through the server ports built on first use (WS-6, DEP-23)',
      async (name, pipeline) => {
        seam.writeTriggerFailure.mockClear();
        seam.answers.set(pipeline, () => ({
          ok: false,
          error: RepositoryError.malformed(
            'barberBusy/b-1__2026-10-12',
            'blocks[0].startMinutes',
          ),
        }));
        await expect(run(name, caseOf(name).input)).resolves.toBeUndefined();
        expect(seam.writeTriggerFailure).toHaveBeenCalledTimes(1);
        expect(seam.writeTriggerFailure).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'event-1',
            fn: name,
            attemptOutcome: 'PERMANENT',
            failureCode: 'data-loss',
          }),
        );
        expect(seam.firestorePorts).toHaveBeenCalled();
        expect(
          vi
            .mocked(logger.error)
            .mock.calls.filter(
              ([msg]) => msg === 'trigger.failure_not_recorded',
            ),
        ).toEqual([]);
      },
    );

    it.each([
      ['rebuildBusyOnAppointmentChange', 'rebuildBusy'],
      ['matchWaitlistOnBusyChange', 'matchWaitlist'],
    ] as const)(
      '%s reads its answer’s verdict: a transient item failure rejects, a permanent one resolves',
      async (name, pipeline) => {
        const transient = TriggerAttemptSystem.attemptFailure(
          Object.assign(new Error('10 ABORTED'), { code: 10 }),
        );
        seam.answers.set(
          pipeline,
          ok({ failures: [transient.error], attemptFailure: transient }),
        );
        await expect(run(name, caseOf(name).input)).rejects.toBe(
          transient.error,
        );
        const permanent = TriggerAttemptSystem.repositoryFailure(
          RepositoryError.writeFailed('barberBusy/b-1__2026-10-12', 'internal'),
        );
        seam.answers.set(
          pipeline,
          ok({ failures: [permanent.error], attemptFailure: permanent }),
        );
        await expect(run(name, caseOf(name).input)).resolves.toBeUndefined();
        expect(attemptLines()).toEqual([
          expect.objectContaining({ fn: name, outcome: 'TRANSIENT' }),
          expect.objectContaining({
            fn: name,
            outcome: 'PERMANENT',
            errorCode: 'internal',
          }),
        ]);
      },
    );

    describe('a malformed appointment side (edge-hardening D-3, D-4)', () => {
      const visit = appointmentFixture();
      const TOMORROW = localDate('2026-09-29');
      const ana = CustomerId.of('cus_ana');
      const bob = CustomerId.of('cus_bob');

      /** A stored document's body — the entity minus its id (Law 5). */
      const bodyOf = (entity: {
        readonly id: string;
      }): Record<string, unknown> =>
        Object.fromEntries(
          Object.entries(entity).filter(([key]) => key !== 'id'),
        );

      const side = (body: Record<string, unknown> | null) => ({
        exists: body !== null,
        data: () => body ?? undefined,
      });

      const appointmentWrite = (
        before: Record<string, unknown> | null,
        after: Record<string, unknown> | null,
      ) => ({
        id: 'event-2',
        time: '2026-10-11T07:00:00.000000Z',
        params: { appointmentId: visit.id },
        data: { before: side(before), after: side(after) },
      });

      /** The visit, its first seat's start no minute — refused, its mirrors intact. */
      const brokenSeat = (entity: typeof visit) => ({
        ...bodyOf(entity),
        seats: [{ ...entity.seats[0], startMinutes: 'ten' }],
      });

      const moved = {
        ...visit,
        localDate: TOMORROW,
        busyKeys: [BusyKey.of(FIXTURE_IDS.barber, TOMORROW)],
      };

      it('rebuildBusyOnAppointmentChange: a refused side naming no day is forwarded with its refusal; the pipeline’s refusal resolves — ONE refusal line with its path and field, the PERMANENT attempt line', async () => {
        const refused = RepositoryError.malformed(
          `appointments/${visit.id}`,
          'busyKeys',
        );
        // The pipeline's own rule (its spec): no day left → the refusal.
        seam.answers.set('rebuildBusy', () => ({ ok: false, error: refused }));
        const event = appointmentWrite(null, {
          ...bodyOf(visit),
          busyKeys: 'garbage',
        });
        await expect(
          run('rebuildBusyOnAppointmentChange', event),
        ).resolves.toBeUndefined();
        expect(seam.calls.map((call) => call.pipeline)).toEqual([
          'rebuildBusy',
        ]);
        expect(seam.calls[0]?.args[0]).toEqual({
          before: null,
          after: null,
          salvagedKeys: [],
          salvagedLocationId: visit.locationId,
          refusal: refused,
        });
        expect(refusalLines()).toEqual([
          { path: `appointments/${visit.id}`, field: 'busyKeys' },
        ]);
        expect(attemptLines()).toEqual([
          expect.objectContaining({
            fn: 'rebuildBusyOnAppointmentChange',
            eventId: 'event-2',
            outcome: 'PERMANENT',
            errorCode: 'data-loss',
          }),
        ]);
      });

      it('rebuildBusyOnAppointmentChange: a refused before beside a good after rebuilds the after’s day AND the before’s salvaged one, and logs the refusal', async () => {
        seam.answers.set(
          'rebuildBusy',
          ok({ rebuiltKeys: [], failures: [], attemptFailure: null }),
        );
        await expect(
          run(
            'rebuildBusyOnAppointmentChange',
            appointmentWrite(brokenSeat(visit), bodyOf(moved)),
          ),
        ).resolves.toBeUndefined();
        expect(seam.calls.map((call) => call.pipeline)).toEqual([
          'rebuildBusy',
        ]);
        expect(seam.calls[0]?.args[0]).toEqual({
          before: null,
          after: moved,
          salvagedKeys: visit.busyKeys,
          salvagedLocationId: visit.locationId,
          refusal: RepositoryError.malformed(
            `appointments/${visit.id}`,
            'seats[0].startMinutes',
          ),
        });
        expect(refusalLines()).toEqual([
          { path: `appointments/${visit.id}`, field: 'seats[0].startMinutes' },
        ]);
        expect(attemptLines()).toEqual([]);
      });

      it('dispatchClientProjections: a refused side naming nobody resolves — the refusal line and the PERMANENT attempt line, no projection', async () => {
        await expect(
          run(
            'dispatchClientProjections',
            appointmentWrite(null, {
              ...bodyOf(visit),
              subjectCustomerIds: 'nope',
            }),
          ),
        ).resolves.toBeUndefined();
        expect(refusalLines()).toEqual([
          { path: `appointments/${visit.id}`, field: 'subjectCustomerIds' },
        ]);
        expect(attemptLines()).toEqual([
          expect.objectContaining({
            fn: 'dispatchClientProjections',
            outcome: 'PERMANENT',
            errorCode: 'data-loss',
          }),
        ]);
        expect(seam.calls).toEqual([]);
      });

      it('dispatchClientProjections: a refused before beside a good after re-projects both sides’ people — no change test — and logs the refusal', async () => {
        seam.answers.set(
          'projectClientStats',
          ok({ written: 0, failures: [], attemptFailure: null }),
        );
        const bobsVisit: typeof visit = { ...visit, subjectCustomerIds: [bob] };
        const anasVisit: typeof visit = { ...visit, subjectCustomerIds: [ana] };
        await expect(
          run(
            'dispatchClientProjections',
            appointmentWrite(brokenSeat(bobsVisit), bodyOf(anasVisit)),
          ),
        ).resolves.toBeUndefined();
        expect(seam.calls.map((call) => call.pipeline)).toEqual([
          'projectClientStats',
        ]);
        expect(seam.calls[0]?.args[0]).toEqual({ customerIds: [ana, bob] });
        expect(refusalLines()).toEqual([
          { path: `appointments/${visit.id}`, field: 'seats[0].startMinutes' },
        ]);
      });
    });
  });

  describe('flip 2 — the identity ports', () => {
    it('builds the identity ports once, for the identity callables only — a booking or profile callable never sees Admin Auth', async () => {
      for (const name of [...IDENTITY_EXPORTS, ...IDENTITY_EXPORTS]) {
        await run(name, caseOf(name).input);
      }
      await run('cancelAppointment', caseOf('cancelAppointment').input);
      await run('updateProfile', caseOf('updateProfile').input);
      const portsOf = (pipeline: string): readonly unknown[] =>
        seam.calls
          .filter((call) => call.pipeline === pipeline)
          .map((call) => call.ports);
      const identity = [
        ...portsOf('completeRegistration'),
        ...portsOf('requestOtp'),
        ...portsOf('verifyOtp'),
      ];
      expect(identity).toHaveLength(6);
      for (const ports of identity) {
        expect(ports).toBe(identity[0]);
        expect(ports).toHaveProperty('provisionAuthUser');
      }
      for (const ports of [
        ...portsOf('cancelAppointment'),
        ...portsOf('updateProfile'),
      ]) {
        expect(ports).not.toHaveProperty('provisionAuthUser');
        expect(ports).toMatchObject({ ...seam.BUNDLE });
      }
      expect(seam.adminAuth.mock.calls.length).toBeLessThanOrEqual(1);
      expect(seam.built).toHaveLength(1);
    });

    it('hands each identity pipeline the server ports, Admin Auth, the login-OTP sender, the OTP crypto, the tenant and the deployment', async () => {
      await run('requestOtpChallenge', caseOf('requestOtpChallenge').input);
      const ports = seam.calls[0]?.ports as Record<string, unknown>;
      for (const member of [
        'provisionAuthUser',
        'mintCustomToken',
        'setDisplayName',
        'findAuthUserByDestination',
        'sendOtp',
        'otpCrypto',
        'loadTenant',
        'authDeployment',
      ]) {
        expect(ports, member).toHaveProperty(member);
      }
      const loadTenant = ports['loadTenant'] as () => Promise<unknown>;
      expect(await loadTenant()).toEqual({ ok: true, value: 'creativo' });
    });

    it('hands requestOtp and verifyOtp the commit and the hash their audit rows ride on (Phase 3 P3-DEP-6, P3-DEP-7)', async () => {
      await run('requestOtpChallenge', caseOf('requestOtpChallenge').input);
      await run('verifyOtpChallenge', caseOf('verifyOtpChallenge').input);
      for (const pipeline of ['requestOtp', 'verifyOtp']) {
        const ports = seam.calls.find((call) => call.pipeline === pipeline)
          ?.ports as Record<string, unknown>;
        expect(ports, pipeline).toHaveProperty('commit', seam.commit);
      }
      // The hash is the server bundle's own member: `firestorePorts` spreads
      // the primitives it is handed (`firestore-ports.spec.ts`), and here
      // the bundle is the seam's — so the proof is what the root hands it.
      const primitives = seam.built[0]?.[1] as Record<string, unknown>;
      expect(typeof primitives['hash']).toBe('function');
    });

    it('answers devCode only under the emulator — `null` everywhere else', async () => {
      const own = caseOf('requestOtpChallenge');
      seam.answers.set(own.pipeline, own.answer);
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
      try {
        expect(await run('requestOtpChallenge', own.input)).toEqual({
          challengeId: 'otp-1',
          devCode: '123456',
        });
      } finally {
        vi.unstubAllEnvs();
      }
      expect(await run('requestOtpChallenge', own.input)).toEqual({
        challengeId: 'otp-1',
        devCode: null,
      });
    });

    it('answers the refusals: a decoder’s before any pipeline runs, a pipeline’s as its struct, a store failure as IDENTITY_REPOSITORY_FAILURE', async () => {
      const code = await rejection(
        run('verifyOtpChallenge', request({ challengeId: 'otp-1' }, null)),
      );
      expect(code.code).toBe('invalid-argument');
      expect(code.details).toEqual({
        errorCode: 'IDENTITY_INVALID_INPUT',
        reason: 'code must be a 6-digit string',
      });
      const signedOut = await rejection(
        run('completeRegistration', request({}, null)),
      );
      expect(signedOut.code).toBe('unauthenticated');
      expect(signedOut.details).toEqual({
        errorCode: 'IDENTITY_REGISTRATION_UNAUTHENTICATED',
      });
      expect(seam.calls).toEqual([]);

      seam.answers.set('requestOtp', () => ({
        ok: false,
        error: IdentityError.otpRateLimited(42),
      }));
      const limited = await rejection(
        run('requestOtpChallenge', caseOf('requestOtpChallenge').input),
      );
      expect(limited.code).toBe('resource-exhausted');
      // The seconds left on the resend window ride along (OR-9): the code
      // step restarts its countdown from them.
      expect(limited.details).toEqual({
        errorCode: 'IDENTITY_OTP_RATE_LIMITED',
        retryAfterSeconds: 42,
      });

      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      seam.answers.set('verifyOtp', () => ({
        ok: false,
        error: RepositoryError.readFailed('otps/otp-1', 'unavailable'),
      }));
      const down = await rejection(
        run('verifyOtpChallenge', caseOf('verifyOtpChallenge').input),
      );
      expect(down.code).toBe('internal');
      expect(down.details).toEqual({
        errorCode: 'IDENTITY_REPOSITORY_FAILURE',
      });
      // The store failure tracked once, and its ONE outcome line (DEP-18).
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenLastCalledWith(
        'callable.failed',
        expect.objectContaining({
          callable: 'verifyOtpChallenge',
          errorCode: 'IDENTITY_REPOSITORY_FAILURE',
          wireStatus: 'internal',
        }),
      );
    });
  });

  describe('flip 3 — the streak publish', () => {
    it('runs a withdrawal through its own pipeline — and no publish', async () => {
      seam.answers.set('withdrawStreakDefinition', ok({ version: 2 }));
      const answer = await run(
        'publishStreakDefinition',
        request(
          {
            requestId: 'intent-000000000002',
            streakId: 'cadence',
            version: 2,
          },
          OWNER,
        ),
      );
      expect(answer).toEqual({
        streakPublishOutcome: 'WITHDRAWN',
        version: 2,
      });
      expect(seam.calls.map((call) => call.pipeline)).toEqual([
        'withdrawStreakDefinition',
      ]);
      expect(seam.calls[0]?.args[0]).toEqual({
        callerUserId: 'u-owner',
        callerIsAdmin: true,
        callerActor: { actorRole: 'ADMIN', actorAdminUserId: 'u-owner' },
        requestId: 'intent-000000000002',
        streakId: 'cadence',
        version: 2,
      });
      expect(seam.pipelines['publishStreakDefinition']).not.toHaveBeenCalled();
    });

    it('hands both acts the server ports, the build-time flags and a settled commit', async () => {
      await run(
        'publishStreakDefinition',
        caseOf('publishStreakDefinition').input,
      );
      const ports = seam.calls[0]?.ports as Record<string, unknown>;
      expect(ports).toMatchObject({
        sentinel: 'firestore ports',
        defaultLocationId: 'loc-center',
      });
      expect(typeof ports['flagOn']).toBe('function');
      expect(ports['commit']).not.toBe(seam.commit);
      expect(await commitThrough(ports)).toEqual({ ok: true, value: {} });
      expect(seam.commit).toHaveBeenCalledTimes(1);
    });

    it('answers the refusals before any pipeline runs — the caller judged before the request is read', async () => {
      const nobody = await rejection(
        run('publishStreakDefinition', request(STREAK_PUBLISH, null)),
      );
      expect(nobody.code).toBe('unauthenticated');
      expect(nobody.details).toEqual({
        errorCode: 'LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED',
      });
      expect(
        await run(
          'publishStreakDefinition',
          request({ nonsense: true }, STAFF),
        ),
      ).toEqual({
        streakPublishOutcome: 'REFUSED',
        errorCode: 'LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN',
        fields: [],
        earliest: null,
        effectiveFromLocalDate: null,
      });
      const envelope = await rejection(
        run(
          'publishStreakDefinition',
          request({ ...STREAK_PUBLISH, baseVersion: '1' }, OWNER),
        ),
      );
      expect(envelope.code).toBe('invalid-argument');
      expect(envelope.details).toEqual({
        errorCode: 'LOYALTY_STREAK_PUBLISH_INVALID_INPUT',
        field: 'baseVersion',
      });
      expect(seam.calls).toEqual([]);
    });

    it('throws internal when the write falls over, and says why where alerting can find it', async () => {
      const logged = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined);
      seam.commit.mockImplementationOnce(async () => {
        throw new Error('deadline exceeded');
      });
      seam.answers.set('publishStreakDefinition', commitThrough);
      const refusal = await rejection(
        run('publishStreakDefinition', caseOf('publishStreakDefinition').input),
      );
      expect(refusal.code).toBe('internal');
      expect(refusal.details).toEqual({
        errorCode: 'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
      });
      // The cause stays on the server.
      expect(JSON.stringify(refusal.details)).not.toContain('deadline');
      // The cause line and the call's outcome line (DEP-18) — the cause line
      // carries the invocation's scope (callable, operation id, uid, roles,
      // input digest) under its own field.
      expect(logged).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalledWith(
        'rhythm rule write failed',
        expect.objectContaining({
          callable: 'publishStreakDefinition',
          operationId: STREAK_PUBLISH.requestId,
          uid: OWNER.uid,
          error: 'Error: deadline exceeded',
        }),
      );
      expect(logged).toHaveBeenLastCalledWith(
        'callable.failed',
        expect.objectContaining({
          errorCode: 'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
          wireStatus: 'internal',
        }),
      );
    });

    it('logs a version number a concurrent writer took by its code and path (F3-1 (c)), and throws internal', async () => {
      const logged = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined);
      seam.commit.mockImplementationOnce(async () => ({
        ok: false,
        error: RepositoryError.alreadyExists(
          'streakDefinitions/cadence/versions/000002',
        ),
      }));
      seam.answers.set('publishStreakDefinition', commitThrough);
      const refusal = await rejection(
        run('publishStreakDefinition', caseOf('publishStreakDefinition').input),
      );
      expect(refusal.code).toBe('internal');
      expect(refusal.details).toEqual({
        errorCode: 'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
      });
      expect(logged).toHaveBeenCalledWith(
        'rhythm rule write failed',
        expect.objectContaining({
          callable: 'publishStreakDefinition',
          error:
            'REPOSITORY_ALREADY_EXISTS streakDefinitions/cadence/versions/000002',
        }),
      );
    });
  });

  describe('pass F — the client issue sink (OR-34)', () => {
    const sink = caseOf('reportClientIssues');

    it('runs over the telemetry alone — it never builds the server ports or touches the Admin SDK', async () => {
      const before = {
        firestore: seam.adminFirestore.mock.calls.length,
        auth: seam.adminAuth.mock.calls.length,
        built: seam.built.length,
      };
      seam.answers.set(sink.pipeline, sink.answer);
      await run('reportClientIssues', sink.input);
      expect(Object.keys(seam.calls[0]?.ports as object).sort()).toEqual([
        'log',
        'trackError',
      ]);
      expect({
        firestore: seam.adminFirestore.mock.calls.length,
        auth: seam.adminAuth.mock.calls.length,
        built: seam.built.length,
      }).toEqual(before);
    });

    it('refuses what is no batch before the pipeline runs — `invalid-argument`, its code alone, ONE warn line naming why and who (never the uid)', async () => {
      const warned = vi
        .spyOn(logger, 'warn')
        .mockImplementation(() => undefined);
      const refused = await rejection(
        run('reportClientIssues', request({ issues: ISSUES }, STAFF)),
      );
      expect(refused.code).toBe('invalid-argument');
      expect(refused.details).toEqual({
        errorCode: 'CLIENT_ISSUE_BATCH_REFUSED',
      });
      expect(seam.calls).toEqual([]);
      expect(warned).toHaveBeenCalledTimes(1);
      expect(warned).toHaveBeenCalledWith('client issue batch refused', {
        errorCode: 'CLIENT_ISSUE_BATCH_REFUSED',
        clientIssueBatchRefusedReason: 'SHAPE',
        issueIndex: null,
        issueField: null,
        reporterRoles: ['barber'],
        reporterAuthed: true,
      });
    });

    it('answers past twenty calls a second on one instance `resource-exhausted` — before the batch is read or the pipeline runs', async () => {
      seam.answers.set(sink.pipeline, sink.answer);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // A minute behind the host clock: the instance's bucket, anchored on
        // the real clock by the cases before, re-anchors here on the first
        // call (a clock that steps back refills nothing), and a second
        // later it is full — whatever those cases took. Back on the real
        // clock, a minute has passed for it: full again for the cases after.
        vi.setSystemTime(Date.now() - 60_000);
        await run('reportClientIssues', sink.input).catch(() => undefined);
        vi.setSystemTime(Date.now() + 1_000);
        seam.calls.length = 0;
        for (let i = 0; i < 20; i++) {
          await expect(run('reportClientIssues', sink.input)).resolves.toEqual(
            sink.expected,
          );
        }
        const throttled = await rejection(
          run('reportClientIssues', sink.input),
        );
        expect(throttled.code).toBe('resource-exhausted');
        expect(throttled.details).toBeUndefined();
        expect(seam.calls).toHaveLength(20);
        // Fifty milliseconds refill one call at twenty a second.
        vi.setSystemTime(Date.now() + 50);
        await expect(run('reportClientIssues', sink.input)).resolves.toEqual(
          sink.expected,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it.each(EXPORTS.filter((name) => CALLABLE_NAMES.has(name)))(
    '%s reports an unexpected throw under its own callable name',
    async (name) => {
      const trackError = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined);
      const thrown = new Error(`boom in ${name}`);
      const own = caseOf(name);
      seam.answers.set(own.pipeline, () => {
        throw thrown;
      });
      const answer = await rejection(run(name, own.input));
      expect(answer.code).toBe('internal');
      // Tracked ONCE, under its own name — inside a traced call the
      // invocation's scope rides under the context (DEP-18) — and, but for
      // the untraced sink, ONE `callable.failed` outcome line beside it.
      const calls = trackError.mock.calls;
      expect(calls.filter(([first]) => first === thrown)).toHaveLength(1);
      expect(trackError).toHaveBeenCalledWith(
        thrown,
        expect.objectContaining({ callable: name }),
      );
      const outcomes = calls.filter(([first]) => first === 'callable.failed');
      if (TELEMETRY_EXPORTS.has(name)) {
        expect(trackError).toHaveBeenCalledWith(thrown, { callable: name });
        expect(calls).toHaveLength(1);
      } else {
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]?.[1]).toMatchObject({
          callable: name,
          wireStatus: 'internal',
        });
        expect(calls).toHaveLength(2);
      }
    },
  );

  describe('WS-4.2 — every callable but the sink is traced (DEP-18)', () => {
    /** Every logger line of the spied levels, as `[msg, fields]`. */
    function spyLines() {
      const lines: (readonly unknown[])[] = [];
      for (const level of ['info', 'warn', 'error'] as const) {
        vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
          lines.push(args);
        });
      }
      return lines;
    }

    it('binds LOG_DIGEST_KEY on every callable export but the sink, and on nothing else', () => {
      for (const name of EXPORTS) {
        const endpoint = endpointOf(exported.get(name)) as {
          readonly secretEnvironmentVariables?: readonly {
            readonly key: string;
          }[];
        };
        const keys = (endpoint.secretEnvironmentVariables ?? []).map(
          (secret) => secret.key,
        );
        const traced = CALLABLE_NAMES.has(name) && !TELEMETRY_EXPORTS.has(name);
        expect(keys.includes('LOG_DIGEST_KEY'), name).toBe(traced);
      }
    });

    it('writes ONE callable.completed line: the operation id, the verified uid and roles, the keyed digest of the decoded command', async () => {
      const lines = spyLines();
      const own = caseOf('cancelAppointment');
      seam.answers.set(own.pipeline, own.answer);
      await expect(run('cancelAppointment', own.input)).resolves.toEqual(
        own.expected,
      );
      const command = seam.calls[0]?.args[0];
      const outcomes = lines.filter(([msg]) => msg === 'callable.completed');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.[1]).toEqual({
        callable: 'cancelAppointment',
        operationId: 'operation-0123456789ab',
        uid: CLIENT.uid,
        roles: [],
        errorCode: null,
        wireStatus: 'ok',
        durationMs: expect.any(Number),
        inputDigest: LogDigestSystem.digestOf(command, (input) =>
          hmacSha256Hex(SPEC_LOG_DIGEST_KEY, input),
        ),
      });
      expect(
        (outcomes[0]?.[1] as { readonly inputDigest: string }).inputDigest,
      ).toMatch(/^[0-9a-f]{16}$/);
    });

    it('an empty key prints no digest — inputDigest null — and the call still answers', async () => {
      const lines = spyLines();
      process.env['LOG_DIGEST_KEY'] = '';
      try {
        const own = caseOf('cancelAppointment');
        seam.answers.set(own.pipeline, own.answer);
        await expect(run('cancelAppointment', own.input)).resolves.toEqual(
          own.expected,
        );
      } finally {
        process.env['LOG_DIGEST_KEY'] = SPEC_LOG_DIGEST_KEY;
      }
      const outcome = lines.find(([msg]) => msg === 'callable.completed');
      expect(outcome?.[1]).toMatchObject({ inputDigest: null });
    });

    it('the publish notes its digest after its own decode', async () => {
      const lines = spyLines();
      const own = caseOf('publishStreakDefinition');
      seam.answers.set(own.pipeline, own.answer);
      await run('publishStreakDefinition', own.input);
      const outcome = lines.find(([msg]) => msg === 'callable.completed');
      expect(outcome?.[1]).toMatchObject({
        callable: 'publishStreakDefinition',
        operationId: STREAK_PUBLISH.requestId,
        uid: OWNER.uid,
        inputDigest: expect.stringMatching(/^[0-9a-f]{16}$/),
      });
    });

    it('the sink logs no outcome line and no uid — untraced (RU-24)', async () => {
      const lines = spyLines();
      const sink = caseOf('reportClientIssues');
      seam.answers.set(sink.pipeline, sink.answer);
      await expect(run('reportClientIssues', sink.input)).resolves.toEqual(
        sink.expected,
      );
      expect(
        lines.filter(([msg]) => String(msg).startsWith('callable.')),
      ).toEqual([]);
      expect(JSON.stringify(lines)).not.toContain(STAFF.uid);
    });
  });

  // Last in the file: each case loads a FRESH composition root (the identity
  // ports are built once per module), so no earlier case's cold start is
  // disturbed.
  describe('WS-0 — the console OTP sender runs under the emulator alone', () => {
    const DESTINATION = ParsedIdentifier.email(Email.of('ana@example.com'));

    /** A fresh composition root under `emulator` (unset when `undefined`) — the ports its `requestOtp` was built over. */
    async function identityPortsUnder(
      emulator: string | undefined,
    ): Promise<OtpDeliveryPorts> {
      vi.stubEnv('FUNCTIONS_EMULATOR', emulator);
      vi.resetModules();
      seam.consoleOtpSender.mockClear();
      const fresh = new Map<string, unknown>(
        Object.entries(await import('./main')),
      );
      await runnable(fresh.get('requestOtpChallenge')).run(
        caseOf('requestOtpChallenge').input,
      );
      const call = seam.calls.find(({ pipeline }) => pipeline === 'requestOtp');
      return call?.ports as OtpDeliveryPorts;
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('a deployment (FUNCTIONS_EMULATOR unset) refuses every delivery IDENTITY_OTP_SEND_UNAVAILABLE and never constructs the console sender', async () => {
      const ports = await identityPortsUnder(undefined);
      expect(process.env['FUNCTIONS_EMULATOR']).toBeUndefined();
      await expect(ports.sendOtp(DESTINATION, '123456')).resolves.toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpSendUnavailable },
      });
      expect(seam.consoleOtpSender).not.toHaveBeenCalled();
    });

    it('the emulator (FUNCTIONS_EMULATOR=true) keeps the console sender — the code goes to the log', async () => {
      const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
      const ports = await identityPortsUnder('true');
      expect(seam.consoleOtpSender).toHaveBeenCalledTimes(1);
      await expect(ports.sendOtp(DESTINATION, '123456')).resolves.toEqual({
        ok: true,
        value: undefined,
      });
      expect(info).toHaveBeenCalledWith(
        '[otp] would send email OTP to ana@example.com: 123456',
      );
    });
  });
});
