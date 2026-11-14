import { type CallableRequest, onCall } from 'firebase-functions/v2/https';
import {
  onDocumentWritten,
  onDocumentWrittenWithAuthContext,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { Result, TenantId, UtcEpochMs, defect } from '@core/primitives';
import {
  BookingErrorCode,
  IdentityErrorCode,
  RepositoryError,
  StreakPublishErrorCode,
} from '@core/errors';
import {
  AuthDeployment,
  GovernedCollection,
  type StreakPublishCall,
  TenantConfig,
} from '@core/components';
import {
  ANALYTICS_RECOMPUTE_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
} from '@core/entities';
import {
  type CallableName,
  Callables,
  type ClockPorts,
  type CommitPlan,
  type HashPorts,
  type IdPorts,
  type NowUtcMs,
  type TriggerFailurePorts,
} from '@core/ports';
import {
  FailureCodeSystem,
  GovernedChangeSystem,
  LogDigestSystem,
  StoredDocumentSystem,
} from '@core/systems';
import {
  activateBarber as activateBarberPipeline,
  addBarber as addBarberPipeline,
  amendRosterBreaks as amendRosterBreaksPipeline,
  AnalyticsDaySource,
  auditDocumentChange,
  bookAppointment,
  cancelAppointment as cancelAppointmentPipeline,
  cancelWaitlist as cancelWaitlistPipeline,
  completeRegistration as completeRegistrationPipeline,
  continueAnalyticsRecompute,
  continuePolicyRecompute,
  deleteDraftBarber as deleteDraftBarberPipeline,
  editAppointment,
  editBarber as editBarberPipeline,
  endImpersonation as endImpersonationPipeline,
  eraseClient as eraseClientPipeline,
  listTeam as listTeamPipeline,
  exportClientData as exportClientDataPipeline,
  markArrival,
  matchWaitlist,
  previewClientErasure as previewClientErasurePipeline,
  projectClientStats,
  rebuildBusy,
  rebuildCapacity,
  recordSeatTip as recordSeatTipPipeline,
  redeemInvitation as redeemInvitationPipeline,
  reportClientIssues as reportClientIssuesPipeline,
  requestOtp,
  requestWaitlist as requestWaitlistPipeline,
  rescheduleAppointment as rescheduleAppointmentPipeline,
  runBackfill as runBackfillPipeline,
  sampleLeadTime,
  setAnalyticsGoal as setAnalyticsGoalPipeline,
  setBarberOfferings as setBarberOfferingsPipeline,
  setDayExceptions as setDayExceptionsPipeline,
  setRoles as setRolesPipeline,
  setRosterWeek as setRosterWeekPipeline,
  staffAnalytics as staffAnalyticsPipeline,
  startImpersonation as startImpersonationPipeline,
  startAnalyticsRecompute,
  startPolicyRecompute,
  sweepPolicyRecompute,
  transitionAppointment as transitionAppointmentPipeline,
  updateProfile as updateProfilePipeline,
  verifyOtp,
  writeAnalyticsDay,
} from '@core/pipelines';
import {
  authClaimsPorts,
  authSessionRevokePorts,
} from './adapters/auth-claims.adapter';
import { paramAppCheckModePorts } from './adapters/app-check.adapter';
import { consoleOtpSender } from './adapters/console-otp-sender.adapter';
import { authEraserPorts } from './adapters/firebase-auth-eraser.adapter';
import {
  consoleLogContext,
  consoleTelemetry,
} from './adapters/console-telemetry.adapter';
import {
  cryptoPorts,
  logDigestPorts,
  walkInKeyPorts,
} from './adapters/crypto.adapter';
import { firestoreAuditReadPorts } from './adapters/firestore-audit-read.adapter';
import { firestorePorts } from './adapters/firestore-ports';
import { firestorePrivacyPorts } from './adapters/firestore-privacy.adapter';
import { logRefusal } from './adapters/firestore-tx.adapter';
import { paramFlagsPorts } from './adapters/flags.adapter';
import {
  fixedCodeOtpCryptoPorts,
  nodeOtpCryptoPorts,
} from './adapters/otp-crypto.adapter';
import { refusingOtpSender } from './adapters/refusing-otp-sender.adapter';
import { storageObjectPorts } from './adapters/storage-objects.adapter';
import { singleTenantPorts } from './adapters/tenant.adapter';
import {
  type CallableEdgePorts,
  callableEdge,
  type CallableSpec,
  type CallTrace,
  type EdgeCode,
  type EdgeError,
  retryingTrigger,
  throttledCallable,
  tokenBucket,
  type WorkBudget,
} from './edge';
import { replayProtectedOptions } from './lib/app-check';
import { CRON_TIME_ZONE } from './lib/cron-zone';
import { adminAuth, adminBucket, adminFirestore } from './lib/firebase-admin';
import {
  arrivalRefusal,
  arrivedOf,
  cancelAppointmentRefusal,
  clearedOf,
  committedOf,
  decodeCancelAppointment,
  decodeClearArrival,
  decodeCommitBooking,
  decodeMarkArrived,
  decodeRecordSeatTip,
  decodeRescheduleAppointment,
  decodeStaffEditAppointment,
  decodeTransitionAppointment,
  recordSeatTipRefusal,
  rescheduledOf,
  staffEditedOf,
  transitionAppointmentRefusal,
} from './wire/booking.wire';
import {
  CLIENT_ISSUE_RATE,
  decodeReportClientIssues,
  REPORT_CLIENT_ISSUES_TIMEOUT_SECONDS,
} from './wire/client-issue.wire';
import {
  decodeEndImpersonation,
  decodeSetRoles,
  decodeStartImpersonation,
} from './wire/governance.wire';
import {
  completeRegistrationRefusal,
  decodeCompleteRegistration,
  decodeRequestOtp,
  decodeUpdateProfile,
  decodeVerifyOtp,
  otpChallengeOf,
  requestOtpRefusal,
  verifyOtpRefusal,
} from './wire/identity.wire';
import { decodeRedeemInvitation } from './wire/invitation.wire';
import { answerStreakPublish } from './wire/loyalty.wire';
import {
  decodeRunBackfill,
  RUN_BACKFILL_TIMEOUT_SECONDS,
} from './wire/ops.wire';
import {
  decodeClientPrivacyCall,
  ERASE_CLIENT_TIMEOUT_SECONDS,
} from './wire/privacy.wire';
import {
  CapacitySource,
  combinedReport,
  decodeAnalyticsDayEvent,
  decodeAnalyticsStepEvent,
  decodeCapacityEvent,
  decodeDispatchProjectionsEvent,
  decodeMatchWaitlistEvent,
  decodePolicyRecomputeEvent,
  decodePolicyStepEvent,
  decodeDocumentChangeEvent,
  decodePolicySweepRun,
  decodeRebuildBusyEvent,
  type DocumentWriteEvent,
  documentAuditReport,
  failOnRefusal,
  POLICY_STEP_TIMEOUT_SECONDS,
  projectionReport,
  settleAttempt,
} from './wire/triggers.wire';
import {
  decodeAmendRosterBreaks,
  decodeSetDayExceptions,
  decodeSetRosterWeek,
} from './wire/roster.wire';
import {
  decodeSetAnalyticsGoal,
  decodeStaffAnalytics,
} from './wire/analytics.wire';
import {
  decodeActivateBarber,
  decodeAddBarber,
  decodeDeleteDraftBarber,
  decodeEditBarber,
  decodeListTeam,
  decodeSetBarberOfferings,
} from './wire/team.wire';
import {
  decodeCancelWaitlist,
  decodeRequestWaitlist,
} from './wire/waitlist.wire';
import type { AnswerIsTheWire, WireAnswer } from './wire/wire-answer';
import { refusalOf, type WireRequest } from './wire/wire-read';

/**
 * THE COMPOSITION ROOT (blueprint §4.3, D1(a)) — the only place in the
 * backend that constructs ports. It builds the adapters once per cold start,
 * assembles the port bundles, and wraps each pipeline in `onCall` /
 * `onDocument*` / `onSchedule` through the edge (`edge.ts`) and the wire
 * (`wire/*.wire.ts`): a decoder turns the call component or event into the
 * pipeline's command, a pipeline answers the call component's answer
 * itself — a callable whose pipeline keeps server-only fields maps them
 * away by name (`committedOf`), and `wiredCallable` proves the answer IS
 * the wire's (`AnswerIsTheWire`) — and a `Result.err` becomes an
 * `HttpsError` (callables) or an attempt line (triggers). A handler here
 * holds no logic.
 *
 * The exports keep their names, trigger paths and options exactly — the
 * names are what `firebase.json` deploys, the web dials (`Callables`) and
 * `verify:p0` exercises; the options (retry, memory, timeouts, schedules)
 * are the ones the legacy definitions declared (pass F's new sink aside,
 * below), which no export sets a region, secret or App Check option on —
 * except the walk-in key the two callables that mint walk-in records bind
 * (`commitBooking`, `staffEditAppointment`: the `WALKIN_ID_KEY` secret
 * their ids are keyed by, OR-26) and the admin privacy callables that
 * recognise them (`exportClientData`, `previewClientErasure`,
 * `eraseClient`, P3-RU-36), the log digest key every callable but
 * the sink binds (`LOG_DIGEST_KEY`, audit-hardening WS-4.2: the outcome
 * line's keyed `inputDigest`), the replay protection the five limited-use
 * callables carry (App Check, below), and seven retry flags: edge-hardening D-5 flipped
 * `rebuildBusyOnAppointmentChange`,
 * `rebuildCapacityOnBusyChange` and `matchWaitlistOnBusyChange`, and pass E
 * (E-1) the four other capacity triggers `rebuildCapacityOnExceptionChange`,
 * `rebuildCapacityOnRosterChange`, `rebuildCapacityOnLocationChange` and
 * `rebuildCapacityOnSettingsChange`. Each deploys with the retry flag on and
 * runs through `retryingTrigger` (each recomputes its projection from its
 * source, so a redelivery is idempotent; only an allowlisted transient
 * failure is rethrown). `main.spec.ts` pins every
 * endpoint as a literal table, proves each export runs exactly its own
 * pipeline (and no other), and that each callable reports an unexpected
 * throw under its own name.
 *
 * Flips 1–3 moved every legacy export onto its pipeline; Phase 4a flipped
 * the wire (4A-4) and added `startImpersonation`, `endImpersonation` and
 * `redeemInvitation` with their rules tightenings (4A-3 (4), (5)); pass F
 * added `reportClientIssues`, the web's first-party issue sink (OR-34) —
 * new, so its options are its own (two instances, 80 concurrent calls
 * each, 256 MiB, 10 s), and the one callable behind a per-instance token
 * bucket. Audit-hardening WS-3 (DEP-14, RU-40) added thirteen
 * governed-collection audit triggers — new, each on its own
 * `<collection>/{docId}` with the retry flag on — built, with
 * `auditProfileChanges` (its name kept, its path param now `{docId}`), by
 * the ONE `documentAuditTrigger` helper: 47 exports. Audit-hardening
 * Phase 3 (WS-C, P3-DEP-9) added `exportClientData`, the admin's
 * data-subject export — bound to the walk-in key it recognises a walk-in's
 * contact by (P3-RU-36) and the log digest key: 48 exports. WS-D
 * (P3-DEP-15, P3-DEP-19) added the admin's data-subject erasure — the
 * read-only `previewClientErasure` and the resumable `eraseClient` (540 s,
 * 512 MiB, the `runBackfill` idiom: its work budgeted by its timeout) —
 * both bound to the same two keys: 50 exports. Security hardening (S-WS-E,
 * S-DEP-6) added `setRoles`, the admin's audited roles change — bound to
 * the log digest key: 51 exports. The break pass added `amendRosterBreaks`
 * and `setRosterWeek`, and staff analytics `staffAnalytics`, the read-only
 * report — bound to the log digest key, on the larger instance (its read is
 * the size of a shop-month): 54 exports. Staff analytics v2 (PR 4a) added
 * the day writer's departure trigger `writeAnalyticsDayOnExceptionChange`,
 * the analytics recompute's step `continueAnalyticsRecomputeOnJobWrite`
 * (the policy step's timeout and memory) and its 04:30 sweep
 * `sweepAnalyticsDaysDaily`, and made `rebuildBusyOnAppointmentChange`
 * run the day writer beside the busy rebuild: 57 exports; PR 6 added
 * `setAnalyticsGoal`: 58. Team onboarding (stage 1a) added the barber
 * record's four callables — `addBarber`, `editBarber`, `activateBarber`,
 * `deleteDraftBarber` — over the server ports, bound to the log digest
 * key: 62 exports; then `setBarberOfferings`, a barber's services and
 * prices, on the same ports: 63; then `setDayExceptions`, the one door to
 * a barber's days off, blocks and one-day breaks: 64; then `listTeam`, the
 * Team page's read: 65.
 *
 * App Check (security hardening S-WS-A) reads ONE switch, the string param
 * `APP_CHECK_MODE` (`config/app-check.json` → `lib/app-check.ts`): the edge
 * reads it per call and decides every callable's App Check outcome itself
 * (OFF / MONITOR / ENFORCE, S-RU-17) — no export sets the platform's
 * enforcement option. The one App Check option an export carries is replay
 * protection: the five limited-use callables (`eraseClient`,
 * `previewClientErasure`, `exportClientData`, `startImpersonation`,
 * `setRoles` — `CALLABLE_APP_CHECK_TOKEN`) spread
 * `replayProtectedOptions(…)`, which consumes their token while the switch
 * is MONITOR or ENFORCE (S-RU-21, S-DEP-11); it is not part of the
 * deployed endpoint (`__endpoint`).
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

/**
 * The key a callable's outcome line digests its decoded command under
 * (audit-hardening WS-4.2, RU-23 — `LogDigestPorts`): a Secret Manager
 * secret bound to every callable but the client issue sink
 * (`LOG_DIGEST_SECRETS`, `WALK_IN_SECRETS`). A deployment holds its own
 * (`firebase functions:secrets:set LOG_DIGEST_KEY`, the runbook's step 4);
 * the emulator reads the fixed test key `tools/flags/write-functions-env.mjs`
 * writes beside the build. Unlike the walk-in key, an empty one is no
 * defect: the line prints no digest (`null`) and the call still answers.
 */
const LOG_DIGEST_KEY = defineSecret('LOG_DIGEST_KEY');

/** The options of every traced callable that mints no walk-in: the log digest key, bound. */
const LOG_DIGEST_SECRETS = { secrets: [LOG_DIGEST_KEY] };

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
 * What the edge itself reads: telemetry, the clock, the per-invocation log
 * scope (`consoleLogContext`, WS-4.2), the keyed input digest and the App
 * Check switch (S-RU-17) — both read per call (a secret and a param are
 * runtime values). The triggers' edge reads the first
 * two, and the dead-letter writer (audit-hardening WS-6, RU-32): LAZY — it
 * reaches the server ports, so the Admin SDK is built only when a retrying
 * trigger first gives up on a delivery, never at load.
 */
const edge: CallableEdgePorts & TriggerFailurePorts = {
  ...telemetry,
  ...consoleLogContext(),
  ...logDigestPorts(() => LOG_DIGEST_KEY.value()),
  ...paramAppCheckModePorts(telemetry.log),
  nowUtcMs,
  writeTriggerFailure: (failure) => serverPorts().writeTriggerFailure(failure),
};

/**
 * Admin Auth, built on first use and SHARED — the identity callables', the
 * erasure pair's and the roles change's (an instance builds its Auth client
 * once).
 */
const auth = once(() => adminAuth());

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
  ...authClaimsPorts(auth()),
  // The login-OTP sender identity — never a campaign sender. Under the
  // emulator the code goes to the log (manual QA reads `devCode` anyway); a
  // deployed environment can only construct the refusing sender, which
  // answers IDENTITY_OTP_SEND_UNAVAILABLE until a real one lands (WS-0).
  ...(onEmulator() ? consoleOtpSender(telemetry.log) : refusingOtpSender()),
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
 * `RepositoryError.writeFailed(null, FailureCodeSystem.codeOf(cause))`, the
 * value the callable logs (`'rhythm rule write failed'`, the cause's
 * canonical code — never its message, Phase 4 S-RU-2) and answers as its
 * store failure (flip-3 plan §3.3).
 */
function settledCommit(commit: CommitPlan): CommitPlan {
  return (read, decide) =>
    commit(read, decide).catch((cause: unknown) =>
      Result.err(
        RepositoryError.writeFailed(null, FailureCodeSystem.codeOf(cause)),
      ),
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

/**
 * The key a walk-in's record id is keyed by (OR-26, `WalkInKeyPorts`): a
 * Secret Manager secret, bound to the two callables that mint walk-in
 * records and the admin privacy callables that recognise them (P3-RU-36),
 * and to no other export (`WALK_IN_SECRETS`). A deployment holds its
 * own (`firebase functions:secrets:set WALKIN_ID_KEY`, the runbook's step
 * 4); the emulator reads the fixed test key `tools/flags/write-functions-env.mjs`
 * writes beside the build (`.secret.local`, never deployed).
 */
const WALKIN_ID_KEY = defineSecret('WALKIN_ID_KEY');

/**
 * The options of the two callables that mint walk-in records and the admin
 * privacy callables that recognise them: the walk-in key and the log
 * digest key, bound.
 */
const WALK_IN_SECRETS = { secrets: [WALKIN_ID_KEY, LOG_DIGEST_KEY] };

/**
 * The walk-in key as the digest reads it — at each call (a secret is a
 * runtime value). An empty one is a broken deployment, never a reason to
 * fall back to an unkeyed id a phone number could be read back out of.
 */
const walkInKey = (): string => {
  const key = WALKIN_ID_KEY.value();
  return key !== '' ? key : defect('the WALKIN_ID_KEY secret holds no value');
};

/**
 * The walk-in callables' ports (`commitBooking`, `staffEditAppointment`):
 * the server ports and the keyed walk-in digest (`WalkInKeyPorts`) —
 * built on first use, and handed to no other export, which holds no key.
 */
const walkInPorts = once(() => ({
  ...serverPorts(),
  ...walkInKeyPorts(walkInKey),
}));

/**
 * The admin privacy callables' ports (`exportClientData`, audit-hardening
 * Phase 3 WS-C; the erasure's below build on them): the server ports (the
 * commit, the clock, the digests, the
 * caller's stored roles, the telemetry), the keyed walk-in digest a visit's
 * contact is recognised by (P3-RU-36), the person's footprint reads — the
 * guarded ones over the stored-document guard and the telemetry log
 * (OR-33) — the audit timelines and the build-time flags (`client.privacy`
 * gates them, P3-RU-14). Built on first use; handed to no other export.
 */
const privacyPorts = once(() => ({
  ...serverPorts(),
  ...walkInKeyPorts(walkInKey),
  ...firestorePrivacyPorts(
    adminFirestore(),
    StoredDocumentSystem.guardOf,
    telemetry.log,
  ),
  ...firestoreAuditReadPorts(adminFirestore()),
  ...paramFlagsPorts(),
}));

/**
 * The erasure preview's ports (`previewClientErasure`, WS-D): the privacy
 * ports and the Admin-Auth eraser bundle — the preview's port type reads
 * only its claim roles (`loadAuthRoles`: the staff-account refusal,
 * P3-L-16). Built on first use; handed to no other export.
 */
const previewPorts = once(() => ({
  ...privacyPorts(),
  ...authEraserPorts(auth()),
}));

/**
 * The erasure's ports (`eraseClient`, WS-D): the privacy ports, the Auth
 * user's claim roles and its deletion, and the default bucket's object
 * deletions (P3-L-9, P3-L-10, P3-DEP-23 — the only export that reaches
 * Storage or deletes an Auth user). Built on first use; handed to no other
 * export.
 */
const erasurePorts = once(() => ({
  ...privacyPorts(),
  ...authEraserPorts(auth()),
  ...storageObjectPorts(adminBucket()),
}));

/** The admin roles change's ports: the server ports and Admin Auth's session revocation. Built on first use. */
const rolesPorts = once(() => ({
  ...serverPorts(),
  ...authSessionRevokePorts(auth()),
}));

/**
 * The staff analytics report's ports (`staffAnalytics`, staff analytics v2
 * PR 4b): the server ports — the analytics reads, the stored days
 * (`AnalyticsDayReadPorts`), the rosters, the policy, the clock, the
 * telemetry — and the build-time flags (`analytics.storedDays` decides
 * whether the past days are read as documents or computed live). Built on
 * first use, on the `streakPorts` precedent.
 */
const analyticsPorts = once(() => ({
  ...serverPorts(),
  ...paramFlagsPorts(),
}));

/** The port bundles. */
const root = {
  telemetry,
  primitives,
  edge,
  ports: serverPorts,
  walkIns: walkInPorts,
  identity: identityPorts,
  streak: streakPorts,
  privacy: privacyPorts,
  erasurePreview: previewPorts,
  erasure: erasurePorts,
  roles: rolesPorts,
  analytics: analyticsPorts,
} as const;

/** A decoded command's keyed digest, noted on the trace (WS-4.2, RU-23). */
const noteDigest =
  (trace: CallTrace) =>
  (command: unknown): void =>
    trace.noteInputDigest(
      LogDigestSystem.digestOf(command, root.edge.logDigest),
    );

/**
 * One callable: the call component decoded into the command (or refused),
 * the pipeline run over its ports, its answer answered AS IT IS and its
 * refusal in the callable's own words (`refusalOf` when every refusal
 * leaves as itself; a store failure thrown on the way). The answer must be
 * exactly callable `N`'s wire answer — the spec's `AnswerIsTheWire` half
 * does not compile otherwise; a pipeline that keeps server-only
 * fields is projected by name inside `run` (`committedOf`). A traced
 * callable notes its decoded command's digest (the sink reads no key: it
 * digests nothing).
 */
function wiredCallable<
  N extends CallableName,
  P,
  C,
  A extends WireAnswer<N>,
  E,
>(
  spec: CallableSpec<N> & AnswerIsTheWire<A, N>,
  ports: () => P,
  decode: (request: WireRequest) => Result<C, EdgeError>,
  run: (ports: P, cmd: C, budget: WorkBudget) => Promise<Result<A, E>>,
  refuse: (error: E, cmd: C) => EdgeError,
) {
  return callableEdge<unknown, WireAnswer<N>>(
    spec,
    root.edge,
    async (request: CallableRequest<unknown>, budget, trace) => {
      const cmd = decode(request);
      if (!cmd.ok) return cmd;
      if (spec.traced) noteDigest(trace)(cmd.value);
      return Result.mapError(await run(ports(), cmd.value, budget), (error) =>
        refuse(error, cmd.value),
      );
    },
  );
}

/** A traced callable with the platform's timeout. */
const plain = <N extends CallableName>(
  callable: N,
  failureCode: EdgeCode | null,
): CallableSpec<N> => ({
  callable,
  failureCode,
  timeoutSeconds: null,
  traced: true,
});

// ── Trigger paths, spelled through the collection registry ────────────────

const APPOINTMENT_DOC = `${Collections.Appointments}/{appointmentId}` as const;
const BUSY_DOC = `${Collections.BarberBusy}/{docId}` as const;
const EXCEPTION_DOC = `${Collections.ScheduleExceptions}/{docId}` as const;
const SCHEDULE_DOC = `${Collections.BarberSchedules}/{barberId}` as const;
const LOCATION_DOC = `${Collections.Locations}/{locationId}` as const;
const SETTINGS_DOC = `${Collections.Settings}/{docId}` as const;
const POLICY_RECOMPUTE_JOB_DOC =
  `${Collections.BackfillJobs}/${POLICY_RECOMPUTE_DOC}` as const;
const ANALYTICS_RECOMPUTE_JOB_DOC =
  `${Collections.BackfillJobs}/${ANALYTICS_RECOMPUTE_DOC}` as const;

/**
 * The handlers whose input is the size of the book — or of one person's
 * footprint (the export's bundle, the erasure) — take the larger instance,
 * and those that budget their work a long timeout read from the wire that
 * budgets it, so the two can never disagree.
 */
const LARGE_MEMORY = '512MiB';

// ── Identity ──────────────────────────────────────────────────────────────

export const requestOtpChallenge = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.RequestOtpChallenge, IdentityErrorCode.RepositoryFailure),
    root.identity,
    decodeRequestOtp,
    // `devCode` only ever leaves the emulator: E2E has no inbox to read from.
    async (ports, cmd) =>
      Result.map(await requestOtp(ports)(cmd), (answer) =>
        otpChallengeOf(answer, onEmulator()),
      ),
    requestOtpRefusal,
  ),
);

export const verifyOtpChallenge = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.VerifyOtpChallenge, IdentityErrorCode.RepositoryFailure),
    root.identity,
    decodeVerifyOtp,
    (ports, cmd) => verifyOtp(ports)(cmd),
    verifyOtpRefusal,
  ),
);

export const completeRegistration = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.CompleteRegistration, IdentityErrorCode.RepositoryFailure),
    root.identity,
    decodeCompleteRegistration,
    (ports, cmd) => completeRegistrationPipeline(ports)(cmd),
    completeRegistrationRefusal,
  ),
);

/**
 * The owner's own profile edit — over the server ports: it never needs
 * Admin Auth. Since Phase 4a the only owner write (`users/{uid}` refuses
 * every client update) and its own auditor (4A-16).
 */
export const updateProfile = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.UpdateProfile, null),
    root.ports,
    decodeUpdateProfile,
    (ports, cmd) => updateProfilePipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * THE ONE audit trigger (audit-hardening WS-3, RU-40), behind all fourteen
 * `audit…Changes` exports: every write of a governed collection's
 * `<path>/{docId}` — `users` and the thirteen of `GovernedCollection` —
 * becomes at most one audit row, whatever wrote it, named by the auth
 * context (`decodeDocumentChangeEvent` → `auditDocumentChange`); an owner's
 * edit `updateProfile` already audited writes none. Each deploys with the
 * retry flag on and runs through `retryingTrigger`: the row's id is keyed by
 * the event id, so a redelivery writes nothing new, and only a transient
 * failure is rethrown. One export per collection, on its own path — never
 * a `{collection}/{docId}` wildcard.
 */
function documentAuditTrigger(
  fn: string,
  governedCollection: GovernedCollection,
) {
  const document =
    `${GovernedChangeSystem.pathOf(governedCollection)}/{docId}` as const;
  return onDocumentWrittenWithAuthContext(
    { document, retry: true },
    retryingTrigger(
      { fn, timeoutSeconds: null },
      root.edge,
      async (event: Parameters<typeof decodeDocumentChangeEvent>[1]) => {
        const answer = await auditDocumentChange(root.ports())(
          decodeDocumentChangeEvent(governedCollection, event),
        );
        settleAttempt(fn, event, documentAuditReport(answer), root.edge);
      },
    ),
  );
}

/**
 * Every profile change becomes an audit row — whatever wrote it, named by
 * the auth context — but an owner's edit `updateProfile` already audited.
 * The name is a deployed function's, kept; its path param is `{docId}`.
 */
export const auditProfileChanges = documentAuditTrigger(
  'auditProfileChanges',
  GovernedCollection.Users,
);

// ── Governed collections: one row per write, named by field (WS-3, DEP-14) ──

export const auditSettingsChanges = documentAuditTrigger(
  'auditSettingsChanges',
  GovernedCollection.Settings,
);

export const auditServicesChanges = documentAuditTrigger(
  'auditServicesChanges',
  GovernedCollection.Services,
);

export const auditBarbersChanges = documentAuditTrigger(
  'auditBarbersChanges',
  GovernedCollection.Barbers,
);

export const auditLocationsChanges = documentAuditTrigger(
  'auditLocationsChanges',
  GovernedCollection.Locations,
);

export const auditBarberSchedulesChanges = documentAuditTrigger(
  'auditBarberSchedulesChanges',
  GovernedCollection.BarberSchedules,
);

export const auditScheduleExceptionsChanges = documentAuditTrigger(
  'auditScheduleExceptionsChanges',
  GovernedCollection.ScheduleExceptions,
);

export const auditCouponsChanges = documentAuditTrigger(
  'auditCouponsChanges',
  GovernedCollection.Coupons,
);

export const auditPositionsChanges = documentAuditTrigger(
  'auditPositionsChanges',
  GovernedCollection.Positions,
);

export const auditCoursesChanges = documentAuditTrigger(
  'auditCoursesChanges',
  GovernedCollection.Courses,
);

export const auditEventsChanges = documentAuditTrigger(
  'auditEventsChanges',
  GovernedCollection.Events,
);

export const auditCustomersChanges = documentAuditTrigger(
  'auditCustomersChanges',
  GovernedCollection.Customers,
);

export const auditAppointmentNotesChanges = documentAuditTrigger(
  'auditAppointmentNotesChanges',
  GovernedCollection.AppointmentNotes,
);

export const auditAppointmentPhotosChanges = documentAuditTrigger(
  'auditAppointmentPhotosChanges',
  GovernedCollection.AppointmentPhotos,
);

// ── Booking ───────────────────────────────────────────────────────────────

export const commitBooking = onCall(
  WALK_IN_SECRETS,
  wiredCallable(
    plain(Callables.CommitBooking, BookingErrorCode.CommitStoreFailed),
    root.walkIns,
    decodeCommitBooking,
    async (ports, cmd) =>
      Result.map(await bookAppointment(ports)(cmd), committedOf),
    refusalOf,
  ),
);

export const cancelAppointment = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.CancelAppointment, null),
    root.ports,
    decodeCancelAppointment,
    (ports, cmd) => cancelAppointmentPipeline(ports)(cmd),
    cancelAppointmentRefusal,
  ),
);

export const rescheduleAppointment = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.RescheduleAppointment, BookingErrorCode.CommitStoreFailed),
    root.ports,
    decodeRescheduleAppointment,
    async (ports, cmd) =>
      Result.map(
        await rescheduleAppointmentPipeline(ports)(cmd),
        rescheduledOf,
      ),
    refusalOf,
  ),
);

export const transitionAppointment = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.TransitionAppointment, null),
    root.ports,
    decodeTransitionAppointment,
    (ports, cmd) => transitionAppointmentPipeline(ports)(cmd),
    transitionAppointmentRefusal,
  ),
);

export const markArrived = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.MarkArrived, null),
    root.ports,
    decodeMarkArrived,
    async (ports, cmd) => Result.map(await markArrival(ports)(cmd), arrivedOf),
    arrivalRefusal,
  ),
);

/**
 * A chair's standing breaks changed «from this day on» (owner, 2026-11-06):
 * one roster write, the roster's one door from the desk. Its capacity
 * rebuild and its audit row ride the roster's own triggers.
 */
export const amendRosterBreaks = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.AmendRosterBreaks, null),
    root.ports,
    decodeAmendRosterBreaks,
    (ports, cmd) => amendRosterBreaksPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * A chair's whole week from a day on — the hours editor's save (owner,
 * 2026-11-06): one roster write, its capacity rebuild and audit row on the
 * roster's own triggers.
 */
export const setRosterWeek = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.SetRosterWeek, null),
    root.ports,
    decodeSetRosterWeek,
    (ports, cmd) => setRosterWeekPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * A barber's days off, blocks and one-day breaks, changed as one act — the
 * staff schedule's four pens (team onboarding O4). `scheduleExceptions`
 * has no client writer: the callable judges whose days the caller may
 * change on their stored account, writes the changed days and one
 * `TEAM_DAY_EXCEPTIONS_CHANGED` row per barber in one commit. The capacity
 * rebuild of each day rides the document's own trigger.
 */
export const setDayExceptions = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.SetDayExceptions, null),
    root.ports,
    decodeSetDayExceptions,
    (ports, cmd) => setDayExceptionsPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * A staff analytics report (`docs/designs/staff-analytics-v2.md`) —
 * read-only: the caller's stored record, the shop's rosters, departures,
 * the period's stored day documents (with `analytics.storedDays` on) and
 * the live days' visits read and computed into one report; nothing is
 * written. On the larger instance: a shop-year reads ~5,000 documents. Its
 * store failure leaves as the platform's bare INTERNAL (`failureCode:
 * null`): the analytics codes name no repository failure, and the screen
 * words every unexpected failure alike.
 */
export const staffAnalytics = onCall(
  { ...LOG_DIGEST_SECRETS, memory: LARGE_MEMORY },
  wiredCallable(
    plain(Callables.StaffAnalytics, null),
    root.analytics,
    decodeStaffAnalytics,
    (ports, cmd) => staffAnalyticsPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * A scope's takings goal for a month (staff analytics v2 PR 6, CUJ 6): the
 * barber's own, or the admin's shop goal — `analyticsGoals/{key}` and its
 * `ANALYTICS_GOAL_SET` row in one commit, on the report's ports (the same
 * bundle: the caller, the records and shops for the scope and the clock,
 * and the commit).
 */
export const setAnalyticsGoal = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.SetAnalyticsGoal, null),
    root.analytics,
    decodeSetAnalyticsGoal,
    (ports, cmd) => setAnalyticsGoalPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * The Team page's one read (team onboarding D8): every barber record,
 * whatever its lifecycle, and every staff account, as the page's rows —
 * each with its status, the account linked to it, its one note and its
 * setup progress. Read-only, in one transaction; the team manager's.
 */
export const listTeam = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.ListTeam, null),
    root.ports,
    decodeListTeam,
    (ports, cmd) => listTeamPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * «Добави» — a new barber record as a `DRAFT` (team onboarding D5,
 * `docs/designs/team-onboarding.md`): the record and its
 * `TEAM_BARBER_ADDED` row in one commit. The act's operation id is the new
 * record's id, so a retried call writes nothing twice.
 */
export const addBarber = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.AddBarber, null),
    root.ports,
    decodeAddBarber,
    (ports, cmd) => addBarberPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * One part of a barber record replaced whole — the profile, the shops, the
 * working period, the «Който и да е» flag or who may book them: the record
 * and its `TEAM_BARBER_*` row in one commit. A profile is any admitted
 * editor's (the content editor, the admin, the barber's own account); the
 * rest are the team manager's.
 */
export const editBarber = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.EditBarber, null),
    root.ports,
    decodeEditBarber,
    (ports, cmd) => editBarberPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * A barber's services and prices, saved as one act (team onboarding D5,
 * D6): the editor's complete list, or a colleague's terms copied. Only the
 * services whose list changes are written, stamped with the act, beside
 * one `TEAM_BARBER_OFFERINGS_CHANGED` row on the barber, in one commit.
 */
export const setBarberOfferings = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.SetBarberOfferings, null),
    root.ports,
    decodeSetBarberOfferings,
    (ports, cmd) => setBarberOfferingsPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * The idempotent go-live step (team onboarding D9): a `DRAFT` whose needed
 * items are done goes live at the status its admin set, with its
 * `TEAM_BARBER_STATUS_CHANGED` row; anything else answers what is missing,
 * or that nothing changed, and writes nothing.
 */
export const activateBarber = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.ActivateBarber, null),
    root.ports,
    decodeActivateBarber,
    (ports, cmd) => activateBarberPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * «Изтрий» — a record that never went live, removed with its roster, its
 * account lock and link and its offerings, beside its
 * `TEAM_BARBER_DELETED` row, in one commit (team onboarding D10).
 */
export const deleteDraftBarber = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.DeleteDraftBarber, null),
    root.ports,
    decodeDeleteDraftBarber,
    (ports, cmd) => deleteDraftBarberPipeline(ports)(cmd),
    refusalOf,
  ),
);

export const clearArrival = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.ClearArrival, null),
    root.ports,
    decodeClearArrival,
    async (ports, cmd) => Result.map(await markArrival(ports)(cmd), clearedOf),
    arrivalRefusal,
  ),
);

export const recordSeatTip = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.RecordSeatTip, null),
    root.ports,
    decodeRecordSeatTip,
    (ports, cmd) => recordSeatTipPipeline(ports)(cmd),
    recordSeatTipRefusal,
  ),
);

export const staffEditAppointment = onCall(
  WALK_IN_SECRETS,
  wiredCallable(
    plain(Callables.StaffEditAppointment, BookingErrorCode.CommitStoreFailed),
    root.walkIns,
    decodeStaffEditAppointment,
    async (ports, cmd) =>
      Result.map(await editAppointment(ports)(cmd), staffEditedOf),
    refusalOf,
  ),
);

// ── The projection triggers' retry (edge-hardening D-5, pass E E-1) ───────

const REBUILD_BUSY_FN = 'rebuildBusyOnAppointmentChange';
const REBUILD_CAPACITY_ON_BUSY_FN = 'rebuildCapacityOnBusyChange';
const REBUILD_CAPACITY_ON_EXCEPTION_FN = 'rebuildCapacityOnExceptionChange';
const REBUILD_CAPACITY_ON_ROSTER_FN = 'rebuildCapacityOnRosterChange';
const REBUILD_CAPACITY_ON_LOCATION_FN = 'rebuildCapacityOnLocationChange';
const REBUILD_CAPACITY_ON_SETTINGS_FN = 'rebuildCapacityOnSettingsChange';
const MATCH_WAITLIST_FN = 'matchWaitlistOnBusyChange';

/**
 * A trigger side the read-time guard refused, logged where it was refused
 * (edge-hardening D-4) under the one phrase every functions read site uses
 * (`logRefusal`, `'malformed document refused'`): its path and the
 * offending field — what the attempt line, which carries codes only, never
 * names.
 */
const logRefusedSide = (error: RepositoryError): void =>
  logRefusal(root.edge.log, error);

/**
 * Both sides of an appointment write re-derive the busy days they touch (a
 * reschedule frees one, fills another) — and, since staff analytics v2,
 * the stored figures of every PAST day they touch (`writeAnalyticsDay`,
 * the same decoded sides as its `'APPOINTMENT'` command; the writer runs
 * whatever the busy rebuild answered). The two answers settle as one
 * attempt (`combinedReport`): transient when either is, both idempotent.
 */
export const rebuildBusyOnAppointmentChange = onDocumentWritten(
  { document: APPOINTMENT_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_BUSY_FN, timeoutSeconds: null },
    root.edge,
    async (event: Parameters<typeof decodeRebuildBusyEvent>[0]) => {
      const cmd = decodeRebuildBusyEvent(event, logRefusedSide);
      const busy = await rebuildBusy(root.ports())(cmd);
      const day = await writeAnalyticsDay(root.ports())({
        analyticsDaySource: AnalyticsDaySource.Appointment,
        ...cmd,
      });
      settleAttempt(
        REBUILD_BUSY_FN,
        event,
        combinedReport(busy, day),
        root.edge,
      );
    },
  ),
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

/** A busy day's change re-derives that (barber, day)'s capacity — retried: the month is replaced, never merged. */
export const rebuildCapacityOnBusyChange = onDocumentWritten(
  { document: BUSY_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_CAPACITY_ON_BUSY_FN, timeoutSeconds: null },
    root.edge,
    (event: DocumentWriteEvent<{ readonly docId: string }>) =>
      rebuildCapacityFrom(CapacitySource.BusyDay, event.params),
  ),
);

/** An exception's change re-derives that (barber, day)'s capacity — retried, as the busy day's (pass E E-1). */
export const rebuildCapacityOnExceptionChange = onDocumentWritten(
  { document: EXCEPTION_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_CAPACITY_ON_EXCEPTION_FN, timeoutSeconds: null },
    root.edge,
    (event: DocumentWriteEvent<{ readonly docId: string }>) =>
      rebuildCapacityFrom(CapacitySource.Exception, event.params),
  ),
);

/** A roster's change re-derives that barber's horizon — retried: each month is replaced, never merged. */
export const rebuildCapacityOnRosterChange = onDocumentWritten(
  { document: SCHEDULE_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_CAPACITY_ON_ROSTER_FN, timeoutSeconds: null },
    root.edge,
    (event: DocumentWriteEvent<{ readonly barberId: string }>) =>
      rebuildCapacityFrom(CapacitySource.Roster, event.params),
  ),
);

/**
 * Hours clamp every window: a shop's edit re-sweeps rather than wait for
 * 03:00. Retried for the sweep's own reads (zone, policy, roster list); a
 * barber's failed commit inside the sweep is logged and left to the 03:00
 * sweep, as before (pass E R-1).
 */
export const rebuildCapacityOnLocationChange = onDocumentWritten(
  { document: LOCATION_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_CAPACITY_ON_LOCATION_FN, timeoutSeconds: null },
    root.edge,
    () => rebuildCapacityFrom(CapacitySource.Location),
  ),
);

/** The policy IS the horizon: its edit re-sweeps too — retried the same way (pass E R-1). */
export const rebuildCapacityOnSettingsChange = onDocumentWritten(
  { document: SETTINGS_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_CAPACITY_ON_SETTINGS_FN, timeoutSeconds: null },
    root.edge,
    () => rebuildCapacityFrom(CapacitySource.Settings),
  ),
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
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.RequestWaitlist, null),
    root.ports,
    decodeRequestWaitlist,
    (ports, cmd) => requestWaitlistPipeline(ports)(cmd),
    refusalOf,
  ),
);

export const cancelWaitlist = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.CancelWaitlist, null),
    root.ports,
    decodeCancelWaitlist,
    (ports, cmd) => cancelWaitlistPipeline(ports)(cmd),
    refusalOf,
  ),
);

/** A busy day freed (or deleted — the strongest freeing) wakes the people watching it. */
export const matchWaitlistOnBusyChange = onDocumentWritten(
  { document: BUSY_DOC, retry: true },
  retryingTrigger(
    { fn: MATCH_WAITLIST_FN, timeoutSeconds: null },
    root.edge,
    async (event: Parameters<typeof decodeMatchWaitlistEvent>[0]) => {
      const cmd = decodeMatchWaitlistEvent(event);
      if (cmd === null) return;
      settleAttempt(
        MATCH_WAITLIST_FN,
        event,
        projectionReport(await matchWaitlist(root.ports())(cmd)),
        root.edge,
      );
    },
  ),
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
      const cmd = decodeDispatchProjectionsEvent(event, logRefusedSide);
      const answer = cmd.ok
        ? await projectClientStats(root.ports())(cmd.value)
        : cmd;
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

// ── Staff analytics v2: the stored days (`docs/designs/staff-analytics-v2.md`) ──

const WRITE_DAY_ON_EXCEPTION_FN = 'writeAnalyticsDayOnExceptionChange';
const ANALYTICS_STEP_FN = 'continueAnalyticsRecomputeOnJobWrite';
const ANALYTICS_SWEEP_FN = 'sweepAnalyticsDaysDaily';

/** A departure's write rewrites its past day's stored figures — retried: the day is recomputed from its source, so a redelivery writes the same document. */
export const writeAnalyticsDayOnExceptionChange = onDocumentWritten(
  { document: EXCEPTION_DOC, retry: true },
  retryingTrigger(
    { fn: WRITE_DAY_ON_EXCEPTION_FN, timeoutSeconds: null },
    root.edge,
    async (event: Parameters<typeof decodeAnalyticsDayEvent>[0]) => {
      const cmd = decodeAnalyticsDayEvent(event);
      if (cmd === null) return;
      settleAttempt(
        WRITE_DAY_ON_EXCEPTION_FN,
        event,
        projectionReport(await writeAnalyticsDay(root.ports())(cmd)),
        root.edge,
      );
    },
  ),
);

/** The recompute itself, one page of busy keys per write of its job document — the policy step's timeout and memory. */
export const continueAnalyticsRecomputeOnJobWrite = onDocumentWritten(
  {
    document: ANALYTICS_RECOMPUTE_JOB_DOC,
    retry: true,
    timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS,
    memory: LARGE_MEMORY,
  },
  retryingTrigger(
    { fn: ANALYTICS_STEP_FN, timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS },
    root.edge,
    async (event: Parameters<typeof decodeAnalyticsStepEvent>[0]) => {
      const step = await continueAnalyticsRecompute(root.ports())(
        decodeAnalyticsStepEvent(event),
      );
      if (step.ok) {
        settleAttempt(ANALYTICS_STEP_FN, event, step.value, root.edge);
      }
    },
  ),
);

/** 04:30 — after the lead-time sample: the night's pass over the eligible stored days started, a stalled one nudged. */
export const sweepAnalyticsDaysDaily = onSchedule(
  { schedule: 'every day 04:30', timeZone: CRON_TIME_ZONE, retryCount: 3 },
  (tick) =>
    retryingTrigger(
      { fn: ANALYTICS_SWEEP_FN, timeoutSeconds: null },
      root.edge,
      async (run) => {
        const swept = await startAnalyticsRecompute(root.ports())();
        if (swept.ok) {
          settleAttempt(ANALYTICS_SWEEP_FN, run, swept.value, root.edge);
        }
      },
    )(decodePolicySweepRun(tick, ANALYTICS_SWEEP_FN)),
);

// ── Operations, loyalty, governance and referrals ─────────────────────────

export const runBackfill = onCall(
  {
    timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS,
    memory: LARGE_MEMORY,
    ...LOG_DIGEST_SECRETS,
  },
  wiredCallable(
    {
      callable: Callables.RunBackfill,
      failureCode: null,
      timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS,
      traced: true,
    },
    root.ports,
    decodeRunBackfill,
    (ports, cmd, budget) => runBackfillPipeline(ports)(cmd, budget),
    refusalOf,
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
  LOG_DIGEST_SECRETS,
  callableEdge<unknown, StreakPublishCall.Answer>(
    {
      callable: Callables.PublishStreakDefinition,
      failureCode: StreakPublishErrorCode.StoreFailed,
      timeoutSeconds: null,
      traced: true,
    },
    root.edge,
    // Calls `callableEdge` directly: it notes its digest after its own decode.
    (request, _budget, trace) =>
      answerStreakPublish(
        request,
        root.streak,
        root.telemetry,
        noteDigest(trace),
      ),
  ),
);

/**
 * An admin opens an impersonation (4A-3 (4)) — the only writer of
 * `impersonationSessions` since the rules refused the direct write.
 */
export const startImpersonation = onCall(
  {
    ...LOG_DIGEST_SECRETS,
    ...replayProtectedOptions(Callables.StartImpersonation),
  },
  wiredCallable(
    plain(Callables.StartImpersonation, null),
    root.ports,
    decodeStartImpersonation,
    (ports, cmd) => startImpersonationPipeline(ports)(cmd),
    refusalOf,
  ),
);

/** An admin ends an impersonation — the same caller gate, ONE `Set` of the ended body (4A-3 (4)). */
export const endImpersonation = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.EndImpersonation, null),
    root.ports,
    decodeEndImpersonation,
    (ports, cmd) => endImpersonationPipeline(ports)(cmd),
    refusalOf,
  ),
);

/** A signed-in user redeems an invitation (4A-3 (5)) — the only writer of its count and redemptions. */
export const redeemInvitation = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.RedeemInvitation, null),
    root.ports,
    decodeRedeemInvitation,
    (ports, cmd) => redeemInvitationPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * An admin changes one account's roles (security hardening S-WS-E) —
 * `users.roles` and its `PROFILE_ROLES_CHANGED` row in one commit, then the
 * target's sessions revoked so their next token is minted from the written
 * roles (S-RU-10). The only callable that writes `users.roles`.
 */
export const setRoles = onCall(
  { ...LOG_DIGEST_SECRETS, ...replayProtectedOptions(Callables.SetRoles) },
  wiredCallable(
    plain(Callables.SetRoles, null),
    root.roles,
    decodeSetRoles,
    (ports, cmd) => setRolesPipeline(ports)(cmd),
    refusalOf,
  ),
);

// ── The admin's data-subject requests (audit-hardening Phase 3) ───────────

/**
 * An admin exports one client's data (WS-C, GDPR Art. 15 / 20): ONE
 * canonical JSON bundle of every document holding the person's data, and
 * one `PRIVACY_CLIENT_EXPORTED` row. The larger instance: the bundle may
 * reach its 4 MiB cap.
 */
export const exportClientData = onCall(
  {
    memory: LARGE_MEMORY,
    ...WALK_IN_SECRETS,
    ...replayProtectedOptions(Callables.ExportClientData),
  },
  wiredCallable(
    plain(Callables.ExportClientData, null),
    root.privacy,
    decodeClientPrivacyCall,
    (ports, cmd) => exportClientDataPipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * An admin previews an erasure (WS-D, P3-L-17): read-only — the record's
 * tag, the census of the person's footprint and the sibling walk-in records
 * the card's ONE alert words in figures; it refuses as the erasure would.
 * No row, no write.
 */
export const previewClientErasure = onCall(
  {
    ...WALK_IN_SECRETS,
    ...replayProtectedOptions(Callables.PreviewClientErasure),
  },
  wiredCallable(
    plain(Callables.PreviewClientErasure, null),
    root.erasurePreview,
    decodeClientPrivacyCall,
    (ports, cmd) => previewClientErasurePipeline(ports)(cmd),
    refusalOf,
  ),
);

/**
 * An admin erases one client (WS-D, GDPR Art. 17 — "pseudonymize, keep
 * records"): ONE resumable call — the stamp, the paged units, the avatar
 * and the Auth user, the completion — its work budgeted by its timeout
 * (the `runBackfill` idiom); the browser calls again with the same act
 * until it answers `erasureDone`.
 */
export const eraseClient = onCall(
  {
    timeoutSeconds: ERASE_CLIENT_TIMEOUT_SECONDS,
    memory: LARGE_MEMORY,
    ...WALK_IN_SECRETS,
    ...replayProtectedOptions(Callables.EraseClient),
  },
  wiredCallable(
    {
      callable: Callables.EraseClient,
      failureCode: null,
      timeoutSeconds: ERASE_CLIENT_TIMEOUT_SECONDS,
      traced: true,
    },
    root.erasure,
    decodeClientPrivacyCall,
    (ports, cmd, budget) => eraseClientPipeline(ports)(cmd, budget),
    refusalOf,
  ),
);

// ── The client issue sink (OR-34) ─────────────────────────────────────────

/**
 * The sink's bucket — module state, so each instance holds its own: twenty
 * calls a second, two instances at most (the definition's `maxInstances`).
 */
const issueThrottle = tokenBucket(CLIENT_ISSUE_RATE, nowUtcMs);

/**
 * The web's issues into Cloud Logging, one line each — over the telemetry
 * alone: it reads nothing and writes no document, so it never builds the
 * server ports or touches the Admin SDK. It binds no secret and logs no
 * outcome line (untraced, RU-24). Any device may dial it, signed in
 * or not, so a call first passes the instance's bucket; the batch is
 * admitted whole or refused (`client-issue.wire.ts`).
 */
export const reportClientIssues = onCall(
  {
    maxInstances: 2,
    concurrency: 80,
    memory: '256MiB',
    timeoutSeconds: REPORT_CLIENT_ISSUES_TIMEOUT_SECONDS,
  },
  throttledCallable(
    issueThrottle,
    wiredCallable(
      {
        callable: Callables.ReportClientIssues,
        failureCode: null,
        timeoutSeconds: REPORT_CLIENT_ISSUES_TIMEOUT_SECONDS,
        // Untraced (RU-24): no scope, no outcome line, no key — OR-34's
        // privacy by shape (no uid) and the throttle's "no line of ours".
        traced: false,
      },
      () => root.telemetry,
      (request) => decodeReportClientIssues(request, root.telemetry.log),
      async (
        ports,
        cmd,
      ): Promise<
        Result<WireAnswer<typeof Callables.ReportClientIssues>, never>
      > => Result.ok(await reportClientIssuesPipeline(ports)(cmd)),
      refusalOf,
    ),
  ),
);
