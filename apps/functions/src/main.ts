import { onCall } from 'firebase-functions/v2/https';
import {
  onDocumentWritten,
  onDocumentWrittenWithAuthContext,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { UtcEpochMs } from '@core/primitives';
import { Collections, POLICY_RECOMPUTE_DOC } from '@core/entities';
import { Callables, type NowUtcMs } from '@core/ports';
import { authClaimsPorts } from './adapters/auth-claims.adapter';
import { consoleOtpSender } from './adapters/console-otp-sender.adapter';
import { consoleTelemetry } from './adapters/console-telemetry.adapter';
import { cryptoPorts } from './adapters/crypto.adapter';
import { firestorePorts } from './adapters/firestore-ports';
import {
  fixedCodeOtpCrypto,
  nodeOtpCrypto,
} from './adapters/otp-crypto.adapter';
import { legacyCallable } from './edge';
import { adminAuth, adminFirestore } from './lib/firebase-admin';
// Every schedule runs on the tenant's wall clock (flatten-spec F-4: the zone
// left TenantConfig; the functions say it in one place).
import { TENANT_ZONE } from './lib/booking/tenant-zone';
// Today's handlers. Phase 3a: every export below still runs one of these;
// each 3b flip replaces its rows with an edge over its pipelines and
// deletes the handler (blueprint §6 Phase 3, deletion rule).
import * as requestOtp from './lib/otp/request-otp';
import * as verifyOtp from './lib/otp/verify-otp';
import * as completeRegistrationHandler from './lib/otp/complete-registration';
import * as commitBookingHandler from './lib/booking/commit-booking';
import * as cancelAppointmentHandler from './lib/booking/cancel-appointment';
import * as rescheduleAppointmentHandler from './lib/booking/reschedule-appointment';
import * as auditProfile from './lib/booking/audit-profile-changes';
import * as transitionAppointmentHandler from './lib/booking/transition-appointment';
import * as markArrivedHandler from './lib/booking/mark-arrived';
import * as clearArrivalHandler from './lib/booking/clear-arrival';
import * as recordSeatTipHandler from './lib/booking/record-seat-tip';
import * as staffEditAppointmentHandler from './lib/booking/staff-edit-appointment';
import * as rebuildBusy from './lib/booking/rebuild-busy';
import * as rebuildCapacity from './lib/booking/rebuild-capacity';
import * as sampleLeadTime from './lib/booking/sample-lead-time';
import * as requestWaitlistHandler from './lib/booking/request-waitlist';
import * as cancelWaitlistHandler from './lib/booking/cancel-waitlist';
import * as matchWaitlist from './lib/booking/match-waitlist';
import * as dispatchProjections from './lib/clients/dispatch-client-projections';
import * as policyRecompute from './lib/clients/recompute-on-policy-change';
import * as runBackfillHandler from './lib/ops/run-backfill';
import * as publishStreak from './lib/loyalty/publish-streak-definition';

/**
 * THE COMPOSITION ROOT (blueprint §4.3, D1(a)) — the only place in the
 * backend that constructs ports. It builds the adapters once per cold start,
 * assembles the port bundles, and wraps each use case in `onCall` /
 * `onDocument*` / `onSchedule` through the edge (`edge.ts`), where a
 * `Result.err` becomes an `HttpsError`. A handler here holds no logic.
 *
 * The 29 exports keep their names, trigger paths and options exactly — the
 * names are what `firebase.json` deploys, the web dials (`Callables`) and
 * `verify:p0` exercises; the options (retry, memory, timeouts, schedules)
 * are copied from today's `lib/**` definitions, which no export sets a
 * region, secret or App Check on. `main.spec.ts` proves every endpoint
 * equals the one its legacy definition declares, that each export runs
 * exactly its own handler (and no other), and that each callable reports
 * an unexpected throw under its own name.
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

/**
 * The port bundles. Body-free ones need no SDK client and are built now;
 * the Firestore, Auth and OTP bundles are built on their first use, as
 * today's handlers reach `adminFirestore()`, `adminAuth()` and the emulator
 * gate only when invoked — so loading this module (a deploy's discovery, a
 * spec) never initialises the Admin SDK. Phase 3a reads only `telemetry`:
 * every export still delegates to today's handler, and each 3b flip wires
 * its pipelines to these bundles.
 */
const root = {
  telemetry,
  primitives,
  firestore: once(() => firestorePorts(adminFirestore(), primitives)),
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
 * and the larger instance, as today — the timeouts read from the handlers
 * that budget their own work by them, so the two can never disagree.
 */
const RUN_BACKFILL_TIMEOUT_SECONDS =
  runBackfillHandler.RUN_BACKFILL_TIMEOUT_SECONDS;
const POLICY_STEP_TIMEOUT_SECONDS = policyRecompute.POLICY_STEP_TIMEOUT_SECONDS;
const LARGE_MEMORY = '512MiB';

// ── Identity ──────────────────────────────────────────────────────────────

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

export const auditProfileChanges = onDocumentWrittenWithAuthContext(
  { document: USER_DOC, retry: true },
  (event) => auditProfile.auditProfileChanges.run(event),
);

// ── Booking ───────────────────────────────────────────────────────────────

export const commitBooking = onCall(
  legacyCallable(Callables.CommitBooking, root.telemetry, (request) =>
    commitBookingHandler.commitBooking.run(request),
  ),
);

export const cancelAppointment = onCall(
  legacyCallable(Callables.CancelAppointment, root.telemetry, (request) =>
    cancelAppointmentHandler.cancelAppointment.run(request),
  ),
);

export const rescheduleAppointment = onCall(
  legacyCallable(Callables.RescheduleAppointment, root.telemetry, (request) =>
    rescheduleAppointmentHandler.rescheduleAppointment.run(request),
  ),
);

export const transitionAppointment = onCall(
  legacyCallable(Callables.TransitionAppointment, root.telemetry, (request) =>
    transitionAppointmentHandler.transitionAppointment.run(request),
  ),
);

export const markArrived = onCall(
  legacyCallable(Callables.MarkArrived, root.telemetry, (request) =>
    markArrivedHandler.markArrived.run(request),
  ),
);

export const clearArrival = onCall(
  legacyCallable(Callables.ClearArrival, root.telemetry, (request) =>
    clearArrivalHandler.clearArrival.run(request),
  ),
);

export const recordSeatTip = onCall(
  legacyCallable(Callables.RecordSeatTip, root.telemetry, (request) =>
    recordSeatTipHandler.recordSeatTip.run(request),
  ),
);

export const staffEditAppointment = onCall(
  legacyCallable(Callables.StaffEditAppointment, root.telemetry, (request) =>
    staffEditAppointmentHandler.staffEditAppointment.run(request),
  ),
);

export const rebuildBusyOnAppointmentChange = onDocumentWritten(
  APPOINTMENT_DOC,
  (event) => rebuildBusy.rebuildBusyOnAppointmentChange.run(event),
);

// ── Capacity (one projection, five triggers and a sweep) ──────────────────

export const rebuildCapacityOnBusyChange = onDocumentWritten(
  BUSY_DOC,
  (event) => rebuildCapacity.rebuildCapacityOnBusyChange.run(event),
);

export const rebuildCapacityOnExceptionChange = onDocumentWritten(
  EXCEPTION_DOC,
  (event) => rebuildCapacity.rebuildCapacityOnExceptionChange.run(event),
);

export const rebuildCapacityOnRosterChange = onDocumentWritten(
  SCHEDULE_DOC,
  (event) => rebuildCapacity.rebuildCapacityOnRosterChange.run(event),
);

export const rebuildCapacityOnLocationChange = onDocumentWritten(
  LOCATION_DOC,
  (event) => rebuildCapacity.rebuildCapacityOnLocationChange.run(event),
);

export const rebuildCapacityOnSettingsChange = onDocumentWritten(
  SETTINGS_DOC,
  (event) => rebuildCapacity.rebuildCapacityOnSettingsChange.run(event),
);

/** 03:00 on the tenant's clock — after the shop's day, before anyone books breakfast. */
export const sweepCapacityDaily = onSchedule(
  { schedule: 'every day 03:00', timeZone: TENANT_ZONE, retryCount: 3 },
  (event) => rebuildCapacity.sweepCapacityDaily.run(event),
);

/** 04:00 — an hour after the capacity sweep, so it samples a repaired rollup. */
export const sampleBarberLeadTimeDaily = onSchedule(
  { schedule: 'every day 04:00', timeZone: TENANT_ZONE, retryCount: 3 },
  (event) => sampleLeadTime.sampleBarberLeadTimeDaily.run(event),
);

// ── Waitlist ──────────────────────────────────────────────────────────────

export const requestWaitlist = onCall(
  legacyCallable(Callables.RequestWaitlist, root.telemetry, (request) =>
    requestWaitlistHandler.requestWaitlist.run(request),
  ),
);

export const cancelWaitlist = onCall(
  legacyCallable(Callables.CancelWaitlist, root.telemetry, (request) =>
    cancelWaitlistHandler.cancelWaitlist.run(request),
  ),
);

export const matchWaitlistOnBusyChange = onDocumentWritten(BUSY_DOC, (event) =>
  matchWaitlist.matchWaitlistOnBusyChange.run(event),
);

// ── Client projections ────────────────────────────────────────────────────

export const dispatchClientProjections = onDocumentWritten(
  { document: APPOINTMENT_DOC, retry: true },
  (event) => dispatchProjections.dispatchClientProjections.run(event),
);

export const recomputeClientStatsOnPolicyChange = onDocumentWritten(
  { document: SETTINGS_DOC, retry: true },
  (event) => policyRecompute.recomputeClientStatsOnPolicyChange.run(event),
);

export const continueClientStatsPolicyRecompute = onDocumentWritten(
  {
    document: POLICY_RECOMPUTE_JOB_DOC,
    retry: true,
    timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS,
    memory: LARGE_MEMORY,
  },
  (event) => policyRecompute.continueClientStatsPolicyRecompute.run(event),
);

/** 03:30 — between the capacity sweep and the lead-time sample. */
export const sweepClientStatsPolicyDaily = onSchedule(
  { schedule: 'every day 03:30', timeZone: TENANT_ZONE, retryCount: 3 },
  (event) => policyRecompute.sweepClientStatsPolicyDaily.run(event),
);

// ── Operations and loyalty ────────────────────────────────────────────────

export const runBackfill = onCall(
  { timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS, memory: LARGE_MEMORY },
  legacyCallable(Callables.RunBackfill, root.telemetry, (request) =>
    runBackfillHandler.runBackfill.run(request),
  ),
);

export const publishStreakDefinition = onCall(
  legacyCallable(Callables.PublishStreakDefinition, root.telemetry, (request) =>
    publishStreak.publishStreakDefinition.run(request),
  ),
);
