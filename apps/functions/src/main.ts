import { onCall } from 'firebase-functions/v2/https';
import {
  onDocumentWritten,
  onDocumentWrittenWithAuthContext,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { type Result, UtcEpochMs } from '@core/primitives';
import { Collections, POLICY_RECOMPUTE_DOC } from '@core/entities';
import { type CallableName, Callables, type NowUtcMs } from '@core/ports';
import {
  auditProfileChange,
  bookAppointment,
  cancelAppointment as cancelAppointmentPipeline,
  cancelWaitlist as cancelWaitlistPipeline,
  continuePolicyRecompute,
  editAppointment,
  markArrival,
  matchWaitlist,
  projectClientStats,
  rebuildBusy,
  rebuildCapacity,
  recordSeatTip as recordSeatTipPipeline,
  requestWaitlist as requestWaitlistPipeline,
  rescheduleAppointment as rescheduleAppointmentPipeline,
  runBackfill as runBackfillPipeline,
  sampleLeadTime,
  startPolicyRecompute,
  sweepPolicyRecompute,
  transitionAppointment as transitionAppointmentPipeline,
} from '@core/pipelines';
import { authClaimsPorts } from './adapters/auth-claims.adapter';
import { consoleOtpSender } from './adapters/console-otp-sender.adapter';
import { consoleTelemetry } from './adapters/console-telemetry.adapter';
import { cryptoPorts } from './adapters/crypto.adapter';
import { firestorePorts } from './adapters/firestore-ports';
import {
  fixedCodeOtpCrypto,
  nodeOtpCrypto,
} from './adapters/otp-crypto.adapter';
import {
  callableEdge,
  type EdgeCode,
  type EdgeError,
  type EdgePorts,
  LegacyWireCode,
  legacyCallable,
  retryingTrigger,
  WIRE_ZONE,
} from './edge';
import { adminAuth, adminFirestore } from './lib/firebase-admin';
// Every schedule runs on the tenant's wall clock (flatten-spec F-4: the zone
// left TenantConfig; the functions say it in one place).
import { TENANT_ZONE } from './lib/booking/tenant-zone';
import {
  arrivalRefusal,
  cancelAppointmentRefusal,
  commitBookingRefusal,
  decodeCancelAppointment,
  decodeClearArrival,
  decodeCommitBooking,
  decodeMarkArrived,
  decodeRecordSeatTip,
  decodeRescheduleAppointment,
  decodeStaffEditAppointment,
  decodeTransitionAppointment,
  encodeCancelAppointmentAnswer,
  encodeClearArrivalAnswer,
  encodeCommitBookingAnswer,
  encodeMarkArrivedAnswer,
  encodeRecordSeatTipAnswer,
  encodeRescheduleAppointmentAnswer,
  encodeStaffEditAppointmentAnswer,
  encodeTransitionAppointmentAnswer,
  recordSeatTipRefusal,
  rescheduleAppointmentRefusal,
  settle,
  staffEditAppointmentRefusal,
  transitionAppointmentRefusal,
  type WireRequest,
} from './wire/booking.wire';
import {
  decodeRunBackfill,
  encodeRunBackfillAnswer,
  RUN_BACKFILL_TIMEOUT_SECONDS,
} from './wire/ops.wire';
import {
  CapacitySource,
  decodeCapacityEvent,
  decodeDispatchProjectionsEvent,
  decodeLeadTimeRun,
  decodeMatchWaitlistEvent,
  decodePolicyRecomputeEvent,
  decodePolicyStepEvent,
  decodePolicySweepRun,
  decodeProfileChangeEvent,
  decodeRebuildBusyEvent,
  failOnRefusal,
  POLICY_STEP_TIMEOUT_SECONDS,
  profileAuditReport,
  projectionReport,
  settleAttempt,
} from './wire/triggers.wire';
import {
  decodeCancelWaitlist,
  decodeRequestWaitlist,
  encodeCancelWaitlistAnswer,
  encodeRequestWaitlistAnswer,
} from './wire/waitlist.wire';
// The handlers no flip has reached yet — identity's OTP trio (flip 4) and
// the streak publish (flip 5) — still run today's `lib/**` code.
import * as requestOtp from './lib/otp/request-otp';
import * as verifyOtp from './lib/otp/verify-otp';
import * as completeRegistrationHandler from './lib/otp/complete-registration';
import * as publishStreak from './lib/loyalty/publish-streak-definition';

/**
 * THE COMPOSITION ROOT (blueprint §4.3, D1(a)) — the only place in the
 * backend that constructs ports. It builds the adapters once per cold start,
 * assembles the port bundles, and wraps each pipeline in `onCall` /
 * `onDocument*` / `onSchedule` through the edge (`edge.ts`) and the frozen
 * wire (`wire/*.wire.ts`): a decoder turns today's JSON or event into the
 * pipeline's command, an encoder turns its answer into today's JSON, and a
 * `Result.err` becomes an `HttpsError` (callables) or an attempt line
 * (triggers). A handler here holds no logic.
 *
 * The 29 exports keep their names, trigger paths and options exactly — the
 * names are what `firebase.json` deploys, the web dials (`Callables`) and
 * `verify:p0` exercises; the options (retry, memory, timeouts, schedules)
 * are the ones the legacy definitions declared, which no export sets a
 * region, secret or App Check on. `main.spec.ts` pins every endpoint as a
 * literal table, proves each flip-1 export runs exactly its own pipeline
 * (and no other), and that each callable reports an unexpected throw under
 * its own name.
 *
 * Flip 1 (booking core) moved the 25 booking, capacity, waitlist,
 * projection, audit and backfill exports onto their pipelines; the four
 * handlers above are the remaining Phase 3a rows.
 */

/** Build on first use, then keep — the cold-start-once rule for anything behind an SDK client. */
function once<T>(build: () => T): () => T {
  let built: { readonly value: T } | null = null;
  return () => {
    built ??= { value: build() };
    return built.value;
  };
}

/** Logging and error tracking: `firebase-functions/logger` (§9 D11(a)). */
const telemetry = consoleTelemetry();

/**
 * The clock, as an absolute instant (`NowUtcMs`, flatten-spec §2.3 T4): the
 * boundary turns it into the shop's `ShopNow` with the location's zone. The
 * runtime clock is always inside `UtcEpochMs`'s window, so a refusal here is
 * a broken host, not an expected outcome.
 */
const nowUtcMs: NowUtcMs = () => {
  const now = UtcEpochMs.of(Date.now());
  if (!now.ok)
    throw new Error(`the host clock is unreadable: ${now.error.raw}`);
  return now.value;
};

/** The clock and the two digests every pipeline hands its systems. */
const primitives = { nowUtcMs, ...cryptoPorts() };

/** What the edge itself reads: telemetry and the clock. */
const edge: EdgePorts = { ...telemetry, nowUtcMs };

/**
 * The server's ports, in one bundle: every Firestore-backed port, the
 * telemetry, and the tenant's zone (`WIRE_ZONE`, the one place the
 * functions say it). Built on first use, as today's handlers reached
 * `adminFirestore()` only when invoked — loading this module (a deploy's
 * discovery, a spec) never initialises the Admin SDK.
 */
const serverPorts = once(() => ({
  ...firestorePorts(adminFirestore(), primitives, telemetry),
  ...telemetry,
  tenantTimeZone: WIRE_ZONE,
}));

type ServerPorts = ReturnType<typeof serverPorts>;

/**
 * The port bundles. The Auth and OTP bundles wait for the identity flip;
 * they are built on first use for the same reason as the server ports.
 */
const root = {
  telemetry,
  primitives,
  edge,
  ports: serverPorts,
  auth: once(() => authClaimsPorts(adminAuth())),
  otp: once(() => ({
    // The login-OTP sender identity — never a campaign sender.
    sendOtp: consoleOtpSender(telemetry.log),
    // Under the emulator every code is the fixed one (manual QA never fishes
    // logs); a deployed environment can only construct the real generator.
    otpCrypto:
      process.env['FUNCTIONS_EMULATOR'] === 'true'
        ? fixedCodeOtpCrypto()
        : nodeOtpCrypto(),
  })),
} as const;

/**
 * One booking callable: today's JSON decoded into the command (or refused
 * as today), the pipeline run over the server ports, its answer encoded
 * and its refusal spelt in the callable's own words. `failureCode` is what
 * an infrastructure failure answers with — today's coded
 * `booking.commit.store_failed` where the legacy handler coded it, else the
 * platform's bare INTERNAL.
 */
function bookingCallable<C, A, E, Out>(
  callable: CallableName,
  failureCode: EdgeCode | null,
  decode: (request: WireRequest) => Result<C, EdgeError>,
  run: (ports: ServerPorts, cmd: C) => Promise<Result<A, E>>,
  encode: (answer: A) => Out,
  refuse: (error: E, cmd: C) => EdgeError,
) {
  return onCall(
    callableEdge<unknown, Out>(
      { callable, failureCode, timeoutSeconds: null, answer: null },
      root.edge,
      async (request) => {
        const cmd = decode(request);
        if (!cmd.ok) return cmd;
        return settle(await run(root.ports(), cmd.value), encode, (error) =>
          refuse(error, cmd.value),
        );
      },
    ),
  );
}

// ── Trigger paths, spelled through the collection registry ────────────────

const APPOINTMENT_DOC = `${Collections.Appointments}/{appointmentId}` as const;
const USER_DOC = `${Collections.Users}/{uid}` as const;
const BUSY_DOC = `${Collections.BarberBusy}/{docId}` as const;
const EXCEPTION_DOC = `${Collections.ScheduleExceptions}/{docId}` as const;
const SCHEDULE_DOC = `${Collections.BarberSchedules}/{barberId}` as const;
const LOCATION_DOC = `${Collections.Locations}/{locationId}` as const;
const SETTINGS_DOC = `${Collections.Settings}/{docId}` as const;
const POLICY_RECOMPUTE_JOB_DOC =
  `${Collections.BackfillJobs}/${POLICY_RECOMPUTE_DOC}` as const;

/**
 * The two handlers whose input is the size of the book take a long timeout
 * and the larger instance, as today — the timeouts read from the wire that
 * budgets their work by them, so the two can never disagree.
 */
const LARGE_MEMORY = '512MiB';

// ── Identity (Phase 3a rows) ──────────────────────────────────────────────

export const requestOtpChallenge = onCall(
  legacyCallable(Callables.RequestOtpChallenge, root.telemetry, (request) =>
    requestOtp.requestOtpChallenge.run(request),
  ),
);

export const verifyOtpChallenge = onCall(
  legacyCallable(Callables.VerifyOtpChallenge, root.telemetry, (request) =>
    verifyOtp.verifyOtpChallenge.run(request),
  ),
);

export const completeRegistration = onCall(
  legacyCallable(Callables.CompleteRegistration, root.telemetry, (request) =>
    completeRegistrationHandler.completeRegistration.run(request),
  ),
);

const AUDIT_PROFILE_FN = 'auditProfileChanges';

/** Every profile change becomes an audit row — whatever wrote it, named by the auth context. */
export const auditProfileChanges = onDocumentWrittenWithAuthContext(
  { document: USER_DOC, retry: true },
  retryingTrigger(
    { fn: AUDIT_PROFILE_FN, timeoutSeconds: null },
    root.edge,
    async (event: Parameters<typeof decodeProfileChangeEvent>[0]) => {
      const answer = await auditProfileChange(root.ports())(
        decodeProfileChangeEvent(event),
      );
      settleAttempt(
        AUDIT_PROFILE_FN,
        event,
        profileAuditReport(answer),
        root.edge,
      );
    },
  ),
);

// ── Booking ───────────────────────────────────────────────────────────────

export const commitBooking = bookingCallable(
  Callables.CommitBooking,
  LegacyWireCode.CommitStoreFailed,
  decodeCommitBooking,
  (ports, cmd) => bookAppointment(ports)(cmd),
  encodeCommitBookingAnswer,
  commitBookingRefusal,
);

export const cancelAppointment = bookingCallable(
  Callables.CancelAppointment,
  null,
  decodeCancelAppointment,
  (ports, cmd) => cancelAppointmentPipeline(ports)(cmd),
  encodeCancelAppointmentAnswer,
  cancelAppointmentRefusal,
);

export const rescheduleAppointment = bookingCallable(
  Callables.RescheduleAppointment,
  LegacyWireCode.CommitStoreFailed,
  decodeRescheduleAppointment,
  (ports, cmd) => rescheduleAppointmentPipeline(ports)(cmd),
  encodeRescheduleAppointmentAnswer,
  rescheduleAppointmentRefusal,
);

export const transitionAppointment = bookingCallable(
  Callables.TransitionAppointment,
  null,
  decodeTransitionAppointment,
  (ports, cmd) => transitionAppointmentPipeline(ports)(cmd),
  encodeTransitionAppointmentAnswer,
  transitionAppointmentRefusal,
);

export const markArrived = bookingCallable(
  Callables.MarkArrived,
  null,
  decodeMarkArrived,
  (ports, cmd) => markArrival(ports)(cmd),
  encodeMarkArrivedAnswer,
  (error) => arrivalRefusal(error, 'arrived'),
);

export const clearArrival = bookingCallable(
  Callables.ClearArrival,
  null,
  decodeClearArrival,
  (ports, cmd) => markArrival(ports)(cmd),
  encodeClearArrivalAnswer,
  (error) => arrivalRefusal(error, 'unarrived'),
);

export const recordSeatTip = bookingCallable(
  Callables.RecordSeatTip,
  null,
  decodeRecordSeatTip,
  (ports, cmd) => recordSeatTipPipeline(ports)(cmd),
  encodeRecordSeatTipAnswer,
  recordSeatTipRefusal,
);

export const staffEditAppointment = bookingCallable(
  Callables.StaffEditAppointment,
  LegacyWireCode.CommitStoreFailed,
  decodeStaffEditAppointment,
  (ports, cmd) => editAppointment(ports)(cmd),
  encodeStaffEditAppointmentAnswer,
  staffEditAppointmentRefusal,
);

/** Both sides of an appointment write re-derive the busy days they touch (a reschedule frees one, fills another). */
export const rebuildBusyOnAppointmentChange = onDocumentWritten(
  APPOINTMENT_DOC,
  async (event) => {
    failOnRefusal(
      await rebuildBusy(root.ports())(decodeRebuildBusyEvent(event)),
    );
  },
);

// ── Capacity (one projection, five triggers and a sweep) ──────────────────

/** One capacity entry point: its write decoded to the rebuild's scope (none: nothing to do). */
async function rebuildCapacityFrom(
  source: CapacitySource,
  params?: { readonly docId?: string; readonly barberId?: string },
): Promise<void> {
  const cmd = decodeCapacityEvent(source, params);
  if (cmd === null) return;
  failOnRefusal(await rebuildCapacity(root.ports())(cmd));
}

export const rebuildCapacityOnBusyChange = onDocumentWritten(
  BUSY_DOC,
  (event) => rebuildCapacityFrom(CapacitySource.BusyDay, event.params),
);

export const rebuildCapacityOnExceptionChange = onDocumentWritten(
  EXCEPTION_DOC,
  (event) => rebuildCapacityFrom(CapacitySource.Exception, event.params),
);

export const rebuildCapacityOnRosterChange = onDocumentWritten(
  SCHEDULE_DOC,
  (event) => rebuildCapacityFrom(CapacitySource.Roster, event.params),
);

/** Hours clamp every window: a shop's edit re-sweeps rather than wait for 03:00. */
export const rebuildCapacityOnLocationChange = onDocumentWritten(
  LOCATION_DOC,
  () => rebuildCapacityFrom(CapacitySource.Location),
);

/** The policy IS the horizon: its edit re-sweeps too. */
export const rebuildCapacityOnSettingsChange = onDocumentWritten(
  SETTINGS_DOC,
  () => rebuildCapacityFrom(CapacitySource.Settings),
);

/** 03:00 on the tenant's clock — after the shop's day, before anyone books breakfast. */
export const sweepCapacityDaily = onSchedule(
  { schedule: 'every day 03:00', timeZone: TENANT_ZONE, retryCount: 3 },
  () => rebuildCapacityFrom(CapacitySource.Sweep),
);

/** 04:00 — an hour after the capacity sweep, so it samples a repaired rollup. */
export const sampleBarberLeadTimeDaily = onSchedule(
  { schedule: 'every day 04:00', timeZone: TENANT_ZONE, retryCount: 3 },
  async () => {
    failOnRefusal(await sampleLeadTime(root.ports())(decodeLeadTimeRun()));
  },
);

// ── Waitlist ──────────────────────────────────────────────────────────────

export const requestWaitlist = onCall(
  callableEdge(
    {
      callable: Callables.RequestWaitlist,
      failureCode: null,
      timeoutSeconds: null,
      answer: null,
    },
    root.edge,
    async (request) =>
      encodeRequestWaitlistAnswer(
        await requestWaitlistPipeline(root.ports())(
          decodeRequestWaitlist(request),
        ),
      ),
  ),
);

export const cancelWaitlist = onCall(
  callableEdge(
    {
      callable: Callables.CancelWaitlist,
      failureCode: null,
      timeoutSeconds: null,
      answer: null,
    },
    root.edge,
    async (request) =>
      encodeCancelWaitlistAnswer(
        await cancelWaitlistPipeline(root.ports())(
          decodeCancelWaitlist(request),
        ),
      ),
  ),
);

/** A busy day freed (or deleted — the strongest freeing) wakes the people watching it. */
export const matchWaitlistOnBusyChange = onDocumentWritten(
  BUSY_DOC,
  async (event) => {
    const cmd = decodeMatchWaitlistEvent(event);
    if (cmd === null) return;
    failOnRefusal(await matchWaitlist(root.ports())(cmd));
  },
);

// ── Client projections ────────────────────────────────────────────────────

const DISPATCH_FN = 'dispatchClientProjections';
const POLICY_START_FN = 'recomputeClientStatsOnPolicyChange';
const POLICY_STEP_FN = 'continueClientStatsPolicyRecompute';
const POLICY_SWEEP_FN = 'sweepClientStatsPolicyDaily';

/** The client records follow the appointments: everybody a write moved, re-projected. */
export const dispatchClientProjections = onDocumentWritten(
  { document: APPOINTMENT_DOC, retry: true },
  retryingTrigger(
    { fn: DISPATCH_FN, timeoutSeconds: null },
    root.edge,
    async (event: Parameters<typeof decodeDispatchProjectionsEvent>[0]) => {
      const answer = await projectClientStats(root.ports())(
        decodeDispatchProjectionsEvent(event),
      );
      settleAttempt(DISPATCH_FN, event, projectionReport(answer), root.edge);
    },
  ),
);

/** A settings write that moved the late line (re)starts the policy pass — one transaction. */
export const recomputeClientStatsOnPolicyChange = onDocumentWritten(
  { document: SETTINGS_DOC, retry: true },
  retryingTrigger(
    { fn: POLICY_START_FN, timeoutSeconds: null },
    root.edge,
    async (event: Parameters<typeof decodePolicyRecomputeEvent>[0]) => {
      failOnRefusal(
        await startPolicyRecompute(root.ports())(
          decodePolicyRecomputeEvent(event),
        ),
      );
    },
  ),
);

/** The pass itself, a budgeted step per write of its job document. */
export const continueClientStatsPolicyRecompute = onDocumentWritten(
  {
    document: POLICY_RECOMPUTE_JOB_DOC,
    retry: true,
    timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS,
    memory: LARGE_MEMORY,
  },
  retryingTrigger(
    { fn: POLICY_STEP_FN, timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS },
    root.edge,
    async (event: Parameters<typeof decodePolicyStepEvent>[0], budget) => {
      const step = await continuePolicyRecompute(root.ports())(
        decodePolicyStepEvent(event),
        budget,
      );
      if (step.ok) settleAttempt(POLICY_STEP_FN, event, step.value, root.edge);
    },
  ),
);

/** 03:30 — between the capacity sweep and the lead-time sample: a dropped start started, a stalled pass nudged. */
export const sweepClientStatsPolicyDaily = onSchedule(
  { schedule: 'every day 03:30', timeZone: TENANT_ZONE, retryCount: 3 },
  (tick) =>
    retryingTrigger(
      { fn: POLICY_SWEEP_FN, timeoutSeconds: null },
      root.edge,
      async (run) => {
        const swept = await sweepPolicyRecompute(root.ports())();
        if (swept.ok)
          settleAttempt(POLICY_SWEEP_FN, run, swept.value, root.edge);
      },
    )(decodePolicySweepRun(tick, POLICY_SWEEP_FN)),
);

// ── Operations and loyalty ────────────────────────────────────────────────

export const runBackfill = onCall(
  { timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS, memory: LARGE_MEMORY },
  callableEdge(
    {
      callable: Callables.RunBackfill,
      failureCode: null,
      timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS,
      answer: null,
    },
    root.edge,
    async (request, budget) =>
      encodeRunBackfillAnswer(
        await runBackfillPipeline(root.ports())(
          decodeRunBackfill(request),
          budget,
        ),
      ),
  ),
);

export const publishStreakDefinition = onCall(
  legacyCallable(Callables.PublishStreakDefinition, root.telemetry, (request) =>
    publishStreak.publishStreakDefinition.run(request),
  ),
);
