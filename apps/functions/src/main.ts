import { type CallableRequest, onCall } from 'firebase-functions/v2/https';
import {
  onDocumentWritten,
  onDocumentWrittenWithAuthContext,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Result, TenantId, UtcEpochMs, defect } from '@core/primitives';
import {
  BookingErrorCode,
  IdentityErrorCode,
  RepositoryError,
  StreakPublishErrorCode,
} from '@core/errors';
import { AuthDeployment, TenantConfig } from '@core/components';
import { Collections, POLICY_RECOMPUTE_DOC } from '@core/entities';
import {
  type CallableName,
  Callables,
  type ClockPorts,
  type CommitPlan,
  type HashPorts,
  type IdPorts,
  type NowUtcMs,
} from '@core/ports';
import {
  auditProfileChange,
  bookAppointment,
  cancelAppointment as cancelAppointmentPipeline,
  cancelWaitlist as cancelWaitlistPipeline,
  completeRegistration as completeRegistrationPipeline,
  continuePolicyRecompute,
  editAppointment,
  endImpersonation as endImpersonationPipeline,
  markArrival,
  matchWaitlist,
  projectClientStats,
  rebuildBusy,
  rebuildCapacity,
  recordSeatTip as recordSeatTipPipeline,
  redeemInvitation as redeemInvitationPipeline,
  requestOtp,
  requestWaitlist as requestWaitlistPipeline,
  rescheduleAppointment as rescheduleAppointmentPipeline,
  runBackfill as runBackfillPipeline,
  sampleLeadTime,
  startImpersonation as startImpersonationPipeline,
  startPolicyRecompute,
  sweepPolicyRecompute,
  transitionAppointment as transitionAppointmentPipeline,
  updateProfile as updateProfilePipeline,
  verifyOtp,
} from '@core/pipelines';
import { authClaimsPorts } from './adapters/auth-claims.adapter';
import { consoleOtpSender } from './adapters/console-otp-sender.adapter';
import { consoleTelemetry } from './adapters/console-telemetry.adapter';
import { cryptoPorts } from './adapters/crypto.adapter';
import { firestorePorts } from './adapters/firestore-ports';
import { paramFlagsPorts } from './adapters/flags.adapter';
import {
  fixedCodeOtpCryptoPorts,
  nodeOtpCryptoPorts,
} from './adapters/otp-crypto.adapter';
import { singleTenantPorts } from './adapters/tenant.adapter';
import {
  callableEdge,
  type EdgeCode,
  type EdgeError,
  type EdgePorts,
  retryingTrigger,
  type WorkBudget,
} from './edge';
import { CRON_TIME_ZONE } from './lib/cron-zone';
import { adminAuth, adminFirestore } from './lib/firebase-admin';
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
  staffEditAppointmentRefusal,
  transitionAppointmentRefusal,
} from './wire/booking.wire';
import {
  decodeEndImpersonation,
  decodeStartImpersonation,
  encodeEndImpersonationAnswer,
  encodeStartImpersonationAnswer,
  endImpersonationRefusal,
  startImpersonationRefusal,
} from './wire/governance.wire';
import {
  completeRegistrationRefusal,
  decodeCompleteRegistration,
  decodeRequestOtp,
  decodeUpdateProfile,
  decodeVerifyOtp,
  encodeCompleteRegistrationAnswer,
  encodeRequestOtpAnswer,
  encodeUpdateProfileAnswer,
  encodeVerifyOtpAnswer,
  requestOtpRefusal,
  updateProfileRefusal,
  verifyOtpRefusal,
} from './wire/identity.wire';
import {
  decodeRedeemInvitation,
  encodeRedeemInvitationAnswer,
  redeemInvitationRefusal,
} from './wire/invitation.wire';
import {
  answerStreakPublish,
  type StreakPublishAnswer,
} from './wire/loyalty.wire';
import {
  decodeRunBackfill,
  encodeRunBackfillAnswer,
  RUN_BACKFILL_TIMEOUT_SECONDS,
  runBackfillRefusal,
} from './wire/ops.wire';
import {
  CapacitySource,
  decodeCapacityEvent,
  decodeDispatchProjectionsEvent,
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
  cancelWaitlistRefusal,
  decodeCancelWaitlist,
  decodeRequestWaitlist,
  encodeCancelWaitlistAnswer,
  encodeRequestWaitlistAnswer,
  requestWaitlistRefusal,
} from './wire/waitlist.wire';
import { settle, type WireRequest } from './wire/wire-read';

/**
 * THE COMPOSITION ROOT (blueprint §4.3, D1(a)) — the only place in the
 * backend that constructs ports. It builds the adapters once per cold start,
 * assembles the port bundles, and wraps each pipeline in `onCall` /
 * `onDocument*` / `onSchedule` through the edge (`edge.ts`) and the wire
 * (`wire/*.wire.ts`): a decoder turns the call component or event into the
 * pipeline's command, an encoder turns its answer into the call
 * component's answer, and a `Result.err` becomes an `HttpsError`
 * (callables) or an attempt line (triggers). A handler here holds no logic.
 *
 * The exports keep their names, trigger paths and options exactly — the
 * names are what `firebase.json` deploys, the web dials (`Callables`) and
 * `verify:p0` exercises; the options (retry, memory, timeouts, schedules)
 * are the ones the legacy definitions declared, which no export sets a
 * region, secret or App Check on. `main.spec.ts` pins every endpoint as a
 * literal table, proves each export runs exactly its own pipeline (and no
 * other), and that each callable reports an unexpected throw under its own
 * name.
 *
 * Flips 1–3 moved every legacy export onto its pipeline; Phase 4a flipped
 * the wire (4A-4) and added `startImpersonation`, `endImpersonation` and
 * `redeemInvitation` with their rules tightenings (4A-3 (4), (5)).
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
  return now.ok
    ? now.value
    : defect(`the host clock is unreadable: ${now.error.raw}`);
};

/** The clock and the two digests every pipeline hands its systems. */
const primitives: ClockPorts & HashPorts & IdPorts = {
  nowUtcMs,
  ...cryptoPorts(),
};

/**
 * The single deployment's tenant — the challenge's `tenantId` and every
 * minted token's claim. A real multi-tenant deployment resolves it from the
 * request's origin instead (`singleTenantPorts` is the seam). The literal
 * is a known-good id, so a refusal is a defect, as the unreadable clock is.
 */
const DEFAULT_TENANT: TenantId = ((): TenantId => {
  const tenant = TenantId.parse('creativo');
  return tenant.ok ? tenant.value : defect('the default tenant is no id');
})();

/** Under the emulator every OTP code is the fixed one and `devCode` is answered; a deployment never is. */
const onEmulator = (): boolean => process.env['FUNCTIONS_EMULATOR'] === 'true';

/** What the edge itself reads: telemetry and the clock. */
const edge: EdgePorts = { ...telemetry, nowUtcMs };

/**
 * The server's ports, in one bundle: every Firestore-backed port (the
 * locations among them — where every pipeline reads its wall clock's
 * zone), the telemetry, and the deployment's default location
 * (`TenantConfig.DEFAULT`, F-4: the shop a boundary with no location in
 * scope reads its zone from). Built on first use — loading this module (a
 * deploy's discovery, a spec) never initialises the Admin SDK.
 */
const serverPorts = once(() => ({
  ...firestorePorts(adminFirestore(), primitives, telemetry),
  ...telemetry,
  defaultLocationId: TenantConfig.DEFAULT.defaultLocationId,
}));

/**
 * The identity callables' ports: the server ports, Admin Auth, the
 * login-OTP sender, the OTP crypto, the tenant and the deployment's auth
 * configuration — each callable's pipeline names the bundles it reads
 * (`RequestOtpPorts`, …), and that intersection is what type-checks it.
 * Built on first use, separately from the server ports, so a booking callable
 * never initialises Admin Auth.
 */
const identityPorts = once(() => ({
  ...serverPorts(),
  ...authClaimsPorts(adminAuth()),
  // The login-OTP sender identity — never a campaign sender.
  ...consoleOtpSender(telemetry.log),
  // Under the emulator every code is the fixed one (manual QA never fishes
  // logs); a deployed environment can only construct the real generator.
  ...(onEmulator() ? fixedCodeOtpCryptoPorts() : nodeOtpCryptoPorts()),
  ...singleTenantPorts(DEFAULT_TENANT),
  // The SAME deployment const the web app provides through `AUTH_DEPLOYMENT_PORTS`.
  authDeployment: AuthDeployment.DEFAULT,
}));

/**
 * The commit port as the streak publish has always failed: a commit that
 * REJECTS — contention retries exhausted, a deadline or network fault, a
 * defect thrown inside the decision — answers
 * `RepositoryError.writeFailed(null, String(cause))`, the value the
 * callable logs (`'rhythm rule write failed'`, the cause's text) and
 * answers as its store failure (flip-3 plan §3.3).
 */
function settledCommit(commit: CommitPlan): CommitPlan {
  return (read, decide) =>
    commit(read, decide).catch((cause: unknown) =>
      Result.err(RepositoryError.writeFailed(null, String(cause))),
    );
}

/**
 * The streak publish's ports: the server ports, the build-time flags
 * (`loyalty.selfView` decides the notice a stricter rule owes) and the
 * commit settled as above. Built on first use.
 */
const streakPorts = once(() => {
  const server = serverPorts();
  return {
    ...server,
    ...paramFlagsPorts(),
    commit: settledCommit(server.commit),
  };
});

/** The port bundles. */
const root = {
  telemetry,
  primitives,
  edge,
  ports: serverPorts,
  identity: identityPorts,
  streak: streakPorts,
} as const;

/** How one callable is wired: its name, its coded failure, its timeout. */
type Wiring = {
  readonly callable: CallableName;
  /**
   * What an infrastructure failure answers with — the callable's coded
   * `internal` (`BOOKING_COMMIT_STORE_FAILED`) — or `null` for the
   * platform's bare INTERNAL.
   */
  readonly failureCode: EdgeCode | null;
  readonly timeoutSeconds: number | null;
};

/**
 * One callable: the call component decoded into the command (or refused),
 * the pipeline run over its ports, its answer encoded and its refusal in
 * the callable's own words.
 */
function wiredCallable<P, C, A, E, Out>(
  wiring: Wiring,
  ports: () => P,
  decode: (request: WireRequest) => Result<C, EdgeError>,
  run: (ports: P, cmd: C, budget: WorkBudget) => Promise<Result<A, E>>,
  encode: (answer: A) => Out,
  refuse: (error: E, cmd: C) => EdgeError,
) {
  return callableEdge<unknown, Out>(
    {
      callable: wiring.callable,
      failureCode: wiring.failureCode,
      timeoutSeconds: wiring.timeoutSeconds,
      answer: null,
    },
    root.edge,
    async (request: CallableRequest<unknown>, budget) => {
      const cmd = decode(request);
      if (!cmd.ok) return cmd;
      return settle(await run(ports(), cmd.value, budget), encode, (error) =>
        refuse(error, cmd.value),
      );
    },
  );
}

/** A callable with the platform's options and timeout. */
const plain = (
  callable: CallableName,
  failureCode: EdgeCode | null,
): Wiring => ({ callable, failureCode, timeoutSeconds: null });

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

// ── Identity ──────────────────────────────────────────────────────────────

export const requestOtpChallenge = onCall(
  wiredCallable(
    plain(Callables.RequestOtpChallenge, IdentityErrorCode.RepositoryFailure),
    root.identity,
    decodeRequestOtp,
    (ports, cmd) => requestOtp(ports)(cmd),
    // `devCode` only ever leaves the emulator: E2E has no inbox to read from.
    (answer) => encodeRequestOtpAnswer(answer, onEmulator()),
    requestOtpRefusal,
  ),
);

export const verifyOtpChallenge = onCall(
  wiredCallable(
    plain(Callables.VerifyOtpChallenge, IdentityErrorCode.RepositoryFailure),
    root.identity,
    decodeVerifyOtp,
    (ports, cmd) => verifyOtp(ports)(cmd),
    encodeVerifyOtpAnswer,
    verifyOtpRefusal,
  ),
);

export const completeRegistration = onCall(
  wiredCallable(
    plain(Callables.CompleteRegistration, IdentityErrorCode.RepositoryFailure),
    root.identity,
    decodeCompleteRegistration,
    (ports, cmd) => completeRegistrationPipeline(ports)(cmd),
    encodeCompleteRegistrationAnswer,
    completeRegistrationRefusal,
  ),
);

/**
 * The owner's own profile edit — over the server ports: it never needs
 * Admin Auth. Since Phase 4a the only owner write (`users/{uid}` refuses
 * every client update) and its own auditor (4A-16).
 */
export const updateProfile = onCall(
  wiredCallable(
    plain(Callables.UpdateProfile, null),
    root.ports,
    decodeUpdateProfile,
    (ports, cmd) => updateProfilePipeline(ports)(cmd),
    encodeUpdateProfileAnswer,
    updateProfileRefusal,
  ),
);

const AUDIT_PROFILE_FN = 'auditProfileChanges';

/**
 * Every profile change becomes an audit row — whatever wrote it, named by
 * the auth context — but an owner's edit `updateProfile` already audited.
 */
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

export const commitBooking = onCall(
  wiredCallable(
    plain(Callables.CommitBooking, BookingErrorCode.CommitStoreFailed),
    root.ports,
    decodeCommitBooking,
    (ports, cmd) => bookAppointment(ports)(cmd),
    encodeCommitBookingAnswer,
    commitBookingRefusal,
  ),
);

export const cancelAppointment = onCall(
  wiredCallable(
    plain(Callables.CancelAppointment, null),
    root.ports,
    decodeCancelAppointment,
    (ports, cmd) => cancelAppointmentPipeline(ports)(cmd),
    encodeCancelAppointmentAnswer,
    cancelAppointmentRefusal,
  ),
);

export const rescheduleAppointment = onCall(
  wiredCallable(
    plain(Callables.RescheduleAppointment, BookingErrorCode.CommitStoreFailed),
    root.ports,
    decodeRescheduleAppointment,
    (ports, cmd) => rescheduleAppointmentPipeline(ports)(cmd),
    encodeRescheduleAppointmentAnswer,
    rescheduleAppointmentRefusal,
  ),
);

export const transitionAppointment = onCall(
  wiredCallable(
    plain(Callables.TransitionAppointment, null),
    root.ports,
    decodeTransitionAppointment,
    (ports, cmd) => transitionAppointmentPipeline(ports)(cmd),
    encodeTransitionAppointmentAnswer,
    transitionAppointmentRefusal,
  ),
);

export const markArrived = onCall(
  wiredCallable(
    plain(Callables.MarkArrived, null),
    root.ports,
    decodeMarkArrived,
    (ports, cmd) => markArrival(ports)(cmd),
    encodeMarkArrivedAnswer,
    arrivalRefusal,
  ),
);

export const clearArrival = onCall(
  wiredCallable(
    plain(Callables.ClearArrival, null),
    root.ports,
    decodeClearArrival,
    (ports, cmd) => markArrival(ports)(cmd),
    encodeClearArrivalAnswer,
    arrivalRefusal,
  ),
);

export const recordSeatTip = onCall(
  wiredCallable(
    plain(Callables.RecordSeatTip, null),
    root.ports,
    decodeRecordSeatTip,
    (ports, cmd) => recordSeatTipPipeline(ports)(cmd),
    encodeRecordSeatTipAnswer,
    recordSeatTipRefusal,
  ),
);

export const staffEditAppointment = onCall(
  wiredCallable(
    plain(Callables.StaffEditAppointment, BookingErrorCode.CommitStoreFailed),
    root.ports,
    decodeStaffEditAppointment,
    (ports, cmd) => editAppointment(ports)(cmd),
    encodeStaffEditAppointmentAnswer,
    staffEditAppointmentRefusal,
  ),
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

/** 03:00 on the schedules' clock (`CRON_TIME_ZONE`) — after the shop's day, before anyone books breakfast. */
export const sweepCapacityDaily = onSchedule(
  { schedule: 'every day 03:00', timeZone: CRON_TIME_ZONE, retryCount: 3 },
  () => rebuildCapacityFrom(CapacitySource.Sweep),
);

/** 04:00 — an hour after the capacity sweep, so it samples a repaired rollup. */
export const sampleBarberLeadTimeDaily = onSchedule(
  { schedule: 'every day 04:00', timeZone: CRON_TIME_ZONE, retryCount: 3 },
  async () => {
    failOnRefusal(await sampleLeadTime(root.ports())());
  },
);

// ── Waitlist ──────────────────────────────────────────────────────────────

export const requestWaitlist = onCall(
  wiredCallable(
    plain(Callables.RequestWaitlist, null),
    root.ports,
    decodeRequestWaitlist,
    (ports, cmd) => requestWaitlistPipeline(ports)(cmd),
    encodeRequestWaitlistAnswer,
    requestWaitlistRefusal,
  ),
);

export const cancelWaitlist = onCall(
  wiredCallable(
    plain(Callables.CancelWaitlist, null),
    root.ports,
    decodeCancelWaitlist,
    (ports, cmd) => cancelWaitlistPipeline(ports)(cmd),
    encodeCancelWaitlistAnswer,
    cancelWaitlistRefusal,
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
  { schedule: 'every day 03:30', timeZone: CRON_TIME_ZONE, retryCount: 3 },
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

// ── Operations, loyalty, governance and referrals ─────────────────────────

export const runBackfill = onCall(
  { timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS, memory: LARGE_MEMORY },
  wiredCallable(
    {
      callable: Callables.RunBackfill,
      failureCode: null,
      timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS,
    },
    root.ports,
    decodeRunBackfill,
    (ports, cmd, budget) => runBackfillPipeline(ports)(cmd, budget),
    encodeRunBackfillAnswer,
    runBackfillRefusal,
  ),
);

/**
 * The rhythm's rule, published or called off: the request read in order
 * (the caller, then the envelope), the act's pipeline
 * (`publishStreakDefinition` / `withdrawStreakDefinition`) run over the
 * streak ports, its answer or refusal on the wire — `loyalty.wire.ts`.
 * Behind no feature flag of its own.
 */
export const publishStreakDefinition = onCall(
  callableEdge<unknown, StreakPublishAnswer>(
    {
      callable: Callables.PublishStreakDefinition,
      failureCode: StreakPublishErrorCode.StoreFailed,
      timeoutSeconds: null,
      answer: null,
    },
    root.edge,
    (request) => answerStreakPublish(request, root.streak, root.telemetry),
  ),
);

/**
 * An admin opens an impersonation (4A-3 (4)) — the only writer of
 * `impersonationSessions` since the rules refused the direct write.
 */
export const startImpersonation = onCall(
  wiredCallable(
    plain(Callables.StartImpersonation, null),
    root.ports,
    decodeStartImpersonation,
    (ports, cmd) => startImpersonationPipeline(ports)(cmd),
    encodeStartImpersonationAnswer,
    startImpersonationRefusal,
  ),
);

/** An admin ends an impersonation — the same caller gate, ONE `Set` of the ended body (4A-3 (4)). */
export const endImpersonation = onCall(
  wiredCallable(
    plain(Callables.EndImpersonation, null),
    root.ports,
    decodeEndImpersonation,
    (ports, cmd) => endImpersonationPipeline(ports)(cmd),
    encodeEndImpersonationAnswer,
    endImpersonationRefusal,
  ),
);

/** A signed-in user redeems an invitation (4A-3 (5)) — the only writer of its count and redemptions. */
export const redeemInvitation = onCall(
  wiredCallable(
    plain(Callables.RedeemInvitation, null),
    root.ports,
    decodeRedeemInvitation,
    (ports, cmd) => redeemInvitationPipeline(ports)(cmd),
    encodeRedeemInvitationAnswer,
    redeemInvitationRefusal,
  ),
);
