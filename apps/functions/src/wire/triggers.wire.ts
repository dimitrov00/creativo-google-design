import {
  AuditResourceId,
  BarberId,
  BusyKey,
  CustomerId,
  defect,
  LogEvent,
  type PrimitiveError,
  Result,
  type StoredFields,
  TriggerEventId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { type GovernanceError, type RepositoryError } from '@core/errors';
import {
  BookingPolicy,
  CapacityTrigger,
  GovernedCollection,
  PreciseInstant,
} from '@core/components';
import { POLICY_RECOMPUTE_DOC, type PolicyRecomputeJob } from '@core/entities';
import {
  type AppointmentSide,
  type AttemptFailure,
  AuditSystem,
  ClientStatsSystem,
  type DocumentChange,
  GovernedChangeSystem,
  type StoredDocument,
  StoredDocumentSystem,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type AuditDocumentChangeAnswer,
  type ContinuePolicyRecomputeCommand,
  type MatchWaitlistCommand,
  type ProjectClientStatsCommand,
  type RebuildBusyCommand,
  type RebuildCapacityCommand,
  type StartPolicyRecomputeCommand,
} from '@core/pipelines';
import {
  attemptEventOf,
  attemptLineFields,
  type DeliveredEvent,
  type EdgePorts,
} from '../edge';
import { eventInstantOf, field, isStoreFailure } from './wire-read';

/**
 * The flip-1 TRIGGERS' edge (blueprint §4.1, F1-3): a Firestore write or a
 * schedule tick in, a pipeline command out — and, for the retrying ones, how
 * a pipeline's answer becomes today's attempt line and redelivery. A decoder
 * reads the event as stored (the document body IS the entity minus `id`,
 * Law 5); it decides nothing a pipeline decides — no zone either: every
 * pipeline reads its location's (or the default location's) `timeZone`
 * itself (Law 7.2, flatten-spec F-4, Phase 4a 4A-11).
 *
 * - `decodeRebuildBusyEvent` — both sides of an `appointments` write;
 * - `decodeCapacityEvent` — a busy day, an exception, a roster, a shop, the
 *   policy or the daily sweep → the rebuild's scope;
 * - `decodeMatchWaitlistEvent` — the busy day a write touched;
 * - `decodeDispatchProjectionsEvent` — the client records before ∪ after a
 *   write that changed what stats read (`ClientStatsSystem.dispatchSubjects`;
 *   most writes — an arrival, a tip — decode to nobody);
 * - `decodePolicyRecomputeEvent` / `decodePolicyStepEvent` /
 *   `decodePolicySweepRun` — the policy pass's settings write, job write and
 *   daily tick;
 * - `decodeDocumentChangeEvent` — a write of `users` or of one of the
 *   thirteen governed collections (audit-hardening WS-3, RU-40: ONE decoder
 *   for all fourteen audit triggers), its writer from the auth context and
 *   the changed field NAMES; a `users` write adds both sides'
 *   `profileEditedAtUtcMs` stamps and the role / status tags.
 *
 * **Which triggers retry.** The fourteen audit triggers (`auditProfileChanges`
 * and the thirteen `audit…Changes` of the governed collections),
 * `dispatchClientProjections`,
 * the policy pass's start and step and its daily sweep, and every projection
 * trigger — since edge-hardening D-5 `rebuildBusyOnAppointmentChange`,
 * `rebuildCapacityOnBusyChange` and `matchWaitlistOnBusyChange`, since pass E
 * (E-1) the four other capacity triggers on an exception, a roster, a shop
 * and the policy (each recomputes its projection from its source, so a
 * redelivery is a no-op on what the first delivery wrote; a shop's or the
 * policy's re-sweep still logs one barber's failed commit and moves on,
 * left to the 03:00 sweep — pass E R-1). The two plain schedules
 * (`sweepCapacityDaily`, `sampleBarberLeadTimeDaily`) keep today's options
 * (F1-2): a refusal fails the run (`failOnRefusal`) and the scheduler's
 * `retryCount` reruns it. Attempts and budgets are `edge.ts`'s
 * (`retryingTrigger`, `workBudget`): a transient failure is rethrown and
 * redelivered, every other is logged once and dropped.
 *
 * **A malformed side (edge-hardening D-3).** An appointment side is read
 * through the read-time guard (`StoredDocumentSystem.appointmentSide`),
 * each side SEPARATELY: an admitted side is the entity; a refused side is
 * reported once (`onRefused` — the composition root logs `'malformed
 * document refused'` with its path and field) and reaches the command as
 * `null` beside what it still names (`StoredDocumentSystem.salvageSides`:
 * its busy keys and location, the refusal itself) — which only PICK the
 * work, since the pipelines re-read the store. The decoders guard and
 * forward; whether the refusal is the answer (`REPOSITORY_MALFORMED`,
 * judged `data-loss`: permanent) — only when the sides together name
 * nothing to do — is decided past the edge: by `rebuildBusy` over its one
 * `affectedKeys`, and by `ClientStatsSystem.dispatchSubjects` for the
 * client projection. So a malformed visit never freezes its own repair.
 */

/** One step's platform timeout; the step's budget is a share of it (`retryingTrigger`). */
export const POLICY_STEP_TIMEOUT_SECONDS = 540;

/** The slice of a document snapshot a decoder reads. */
type StoredSnapshot = {
  readonly exists: boolean;
  data(): { readonly [field: string]: unknown } | undefined;
};

/** The slice of a Firestore write event a decoder reads. */
export type DocumentWriteEvent<P> = {
  readonly id: string;
  readonly time: string;
  readonly params: P;
  readonly data?: {
    readonly before?: StoredSnapshot;
    readonly after?: StoredSnapshot;
  };
};

/** A Firestore write event with its auth context (`onDocumentWrittenWithAuthContext`). */
export type AuthDocumentWriteEvent<P> = DocumentWriteEvent<P> & {
  readonly authType: string;
  readonly authId?: string;
};

/** The slice of a scheduled tick a decoder reads. */
export type ScheduledTick = {
  readonly jobName?: string;
  readonly scheduleTime: string;
};

/** A side of a write as stored — its id beside its body — `null` when the document is absent there. */
function storedOf(
  snapshot: StoredSnapshot | undefined,
  id: string,
): StoredDocument | null {
  const data = snapshot?.exists === true ? snapshot.data() : undefined;
  return data === undefined ? null : { id, ...data };
}

/**
 * A side of a write read AS STORED, unguarded — the policy job's document
 * only (not one of the guarded collections, edge-hardening D-1).
 */
function entityOf<E>(
  snapshot: StoredSnapshot | undefined,
  id: string,
): E | null {
  const stored = storedOf(snapshot, id);
  return stored === null ? null : (stored as unknown as E);
}

/**
 * How a refused side is reported — once per side; the root logs it (D-4).
 * Module-private: a decoder's callback parameter, never a port (Law 9.3 —
 * the decoders' signatures spell it inline for their callers).
 */
type OnRefused = (error: RepositoryError) => void;

const IGNORE_REFUSAL: OnRefused = () => undefined;

/** A side of an appointment write, guarded: admitted, refused (reported once) or absent. */
function appointmentSide(
  snapshot: StoredSnapshot | undefined,
  id: string,
  onRefused: OnRefused,
): AppointmentSide {
  const side = StoredDocumentSystem.appointmentSide(storedOf(snapshot, id));
  if (side.refusal !== null) onRefused(side.refusal);
  return side;
}

/** A side of a write as its raw body, `{}` when absent. */
function bodyOf(snapshot: StoredSnapshot | undefined): {
  readonly [field: string]: unknown;
} {
  return snapshot?.data() ?? {};
}

/** Whole seconds, an optional fraction (dot included), a zone. */
const RFC3339 =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+|)(Z|[+-]\d{2}:\d{2})$/i;

/**
 * An event's RFC 3339 time at FULL precision (§9 D17) — whole seconds
 * through the offset, the fraction read to the nanosecond: a Firestore
 * event's time is stamped in microseconds, and two settings writes inside
 * one millisecond must still order. A change that delivered an unreadable
 * time reads as {@link PreciseInstant.LATEST} — newer than any stamp, so the
 * system's conservative answer (restart, judge) is the one taken, never a
 * skip (today's reading).
 */
export function preciseInstantOf(time: string): PreciseInstant {
  const [, wholeSeconds, fraction, zone] = RFC3339.exec(time) ?? [];
  if (wholeSeconds === undefined || zone === undefined) {
    return PreciseInstant.LATEST;
  }
  const whole = ZonedTimeSystem.parseOffsetIso(`${wholeSeconds}${zone}`);
  if (!whole.ok) return PreciseInstant.LATEST;
  const digits = (fraction ?? '').slice(1, 10).padEnd(9, '0');
  return (
    PreciseInstant.fromWholeSecond(whole.value, Number(digits)) ??
    PreciseInstant.LATEST
  );
}

/**
 * Both sides of an `appointments` write as the busy rebuild's command — each
 * side guarded on its own (D-3): a refused side is `null`, and the command
 * carries what the refused sides leave (`StoredDocumentSystem.salvageSides`:
 * their busy keys, the first location, the first refusal). Whether that
 * refusal is the answer — no day left to rebuild — is `rebuildBusy`'s.
 */
export function decodeRebuildBusyEvent(
  event: DocumentWriteEvent<{ readonly appointmentId: string }>,
  onRefused: (error: RepositoryError) => void = IGNORE_REFUSAL,
): RebuildBusyCommand {
  const id = event.params.appointmentId;
  const before = appointmentSide(event.data?.before, id, onRefused);
  const after = appointmentSide(event.data?.after, id, onRefused);
  const salvage = StoredDocumentSystem.salvageSides(before, after);
  return {
    before: before.appointment,
    after: after.appointment,
    salvagedKeys: salvage.busyKeys,
    salvagedLocationId: salvage.locationId,
    refusal: salvage.refusal,
  };
}

/** Which write woke the capacity rebuild — the ONLY source of these strings. */
export const CapacitySource = {
  BusyDay: 'BUSY_DAY',
  Exception: 'EXCEPTION',
  Roster: 'ROSTER',
  Location: 'LOCATION',
  Settings: 'SETTINGS',
  Sweep: 'SWEEP',
} as const;
export type CapacitySource =
  (typeof CapacitySource)[keyof typeof CapacitySource];

/**
 * The rebuild's scope for one entry point — `null` when a busy or exception
 * document id is no busy key (nothing to rebuild, as today).
 */
export function decodeCapacityEvent(
  source: CapacitySource,
  params: { readonly docId?: string; readonly barberId?: string } = {},
): RebuildCapacityCommand | null {
  switch (source) {
    case CapacitySource.BusyDay:
    case CapacitySource.Exception: {
      const key = BusyKey.parse(params.docId ?? '');
      if (key === null) return null;
      const { barberId, localDate } = BusyKey.split(key);
      return { capacityTrigger: CapacityTrigger.Day, barberId, localDate };
    }
    case CapacitySource.Roster: {
      const barberId = BarberId.parse(params.barberId ?? '');
      return barberId.ok
        ? { capacityTrigger: CapacityTrigger.Roster, barberId: barberId.value }
        : null;
    }
    case CapacitySource.Location:
    case CapacitySource.Settings:
    case CapacitySource.Sweep:
      return { capacityTrigger: CapacityTrigger.Sweep };
  }
}

/** The busy day a `barberBusy` write touched — `null` when the id is no busy key. */
export function decodeMatchWaitlistEvent(
  event: DocumentWriteEvent<{ readonly docId: string }>,
): MatchWaitlistCommand | null {
  const key = BusyKey.parse(event.params.docId);
  return key === null ? null : { localDate: BusyKey.split(key).localDate };
}

/**
 * Everybody an appointment write can have moved — the client records on the
 * visit before AND after it (a person removed from a party must lose the
 * visit) — or nobody, for a write that changed nothing stats read. Each side
 * guarded on its own (D-3) and forwarded; whom that names — and when a
 * refused side's refusal is the answer instead — is
 * `ClientStatsSystem.dispatchSubjects`'.
 */
export function decodeDispatchProjectionsEvent(
  event: DocumentWriteEvent<{ readonly appointmentId: string }>,
  onRefused: (error: RepositoryError) => void = IGNORE_REFUSAL,
): Result<ProjectClientStatsCommand, RepositoryError> {
  const id = event.params.appointmentId;
  const subjects = ClientStatsSystem.dispatchSubjects(
    appointmentSide(event.data?.before, id, onRefused),
    appointmentSide(event.data?.after, id, onRefused),
  );
  return subjects.ok ? Result.ok({ customerIds: subjects.value }) : subjects;
}

/** A `settings/{docId}` write as the pass's start command (policies through the component's edge guard). */
export function decodePolicyRecomputeEvent(
  event: DocumentWriteEvent<{ readonly docId?: string }>,
): StartPolicyRecomputeCommand {
  return {
    settingsDocId: event.params.docId ?? '',
    before: BookingPolicy.withDefaults(event.data?.before?.data() ?? null),
    after: BookingPolicy.withDefaults(event.data?.after?.data() ?? null),
    generation: event.id,
    changedAt: preciseInstantOf(event.time),
  };
}

/** A `backfillJobs/clientStatsPolicy` write as the step it fires. */
export function decodePolicyStepEvent(
  event: DocumentWriteEvent<Record<string, string>>,
): ContinuePolicyRecomputeCommand {
  return {
    fired: entityOf<PolicyRecomputeJob>(
      event.data?.after,
      POLICY_RECOMPUTE_DOC,
    ),
  };
}

/** The daily sweep's tick as the delivery its attempt line names. */
export function decodePolicySweepRun(
  tick: ScheduledTick,
  fn: string,
): DeliveredEvent {
  return {
    id: `${tick.jobName ?? fn}@${tick.scheduleTime}`,
    time: tick.scheduleTime,
  };
}

/**
 * A side's raw `profileEditedAtUtcMs` stamp (Phase 4a 4A-16): the stored
 * number as its brand; an absent side, an absent key or a value that is no
 * instant reads `null`. Decoded only — whether the callable already audited
 * the event is `AuditSystem.planProfileChange`'s.
 */
function profileEditedAtOf(
  snapshot: StoredSnapshot | undefined,
): UtcEpochMs | null {
  if (snapshot?.exists !== true) return null;
  const stamp = field(bodyOf(snapshot), 'profileEditedAtUtcMs');
  if (typeof stamp !== 'number') return null;
  const instant = UtcEpochMs.of(stamp);
  return instant.ok ? instant.value : null;
}

/** A side of a write as its stored fields — `null` when the document is absent there. */
function fieldsOf(snapshot: StoredSnapshot | undefined): StoredFields | null {
  return snapshot?.exists === true ? (snapshot.data() ?? null) : null;
}

/**
 * A brand the event's own path made — a Firestore path segment is never
 * empty and holds no `/`, so a refusal is a broken platform, never an
 * expected outcome: thrown as a defect inside the trigger's handler, where
 * `retryingTrigger` judges it PERMANENT (one attempt line, no redelivery).
 */
function fromPath<T>(parsed: Result<T, PrimitiveError>): T {
  return parsed.ok
    ? parsed.value
    : defect(
        `a document path is no ${parsed.error.brand}: ${parsed.error.raw}`,
      );
}

/**
 * ONE decoder behind every audit trigger (audit-hardening WS-3, RU-40): a
 * write of `users` or of a governed collection as the change it audits —
 * field NAMES only, never a value (R36). The shared core is the delivery's
 * id, the event's instant (`null` when unreadable — the pipeline's clock
 * stands in), the writer the auth context names
 * (`AuditSystem.writerOf`) and both sides' existence. A `users/{docId}`
 * write adds the account (`docId`), the audited profile fields, the role /
 * status tags and both sides' `profileEditedAtUtcMs` stamps (4A-16); any
 * other collection the resource `<path>/<docId>` (branded here, Law 7.4),
 * the client record a `customers` write is (`CustomerId.parse` of the id;
 * `null` for every other collection) and the changed top-level field names
 * (`GovernedChangeSystem.changedFields`: a delete lists the before-image's).
 */
export function decodeDocumentChangeEvent(
  governedCollection: GovernedCollection,
  event: AuthDocumentWriteEvent<{ readonly docId: string }>,
): DocumentChange {
  const before = event.data?.before;
  const after = event.data?.after;
  const docId = event.params.docId;
  const core = {
    eventId: TriggerEventId.of(event.id),
    eventAtUtcMs: eventInstantOf(event.time),
    writer: AuditSystem.writerOf(event.authType, event.authId ?? null),
    beforeExists: before?.exists === true,
    afterExists: after?.exists === true,
  };
  if (governedCollection === GovernedCollection.Users) {
    const was = bodyOf(before);
    const is = bodyOf(after);
    return {
      governedCollection,
      ...core,
      ownerUserId: UserId.of(docId),
      fields: AuditSystem.changedProfileFields(was, is),
      ...AuditSystem.profileTagDelta(was, is),
      beforeProfileEditedAtUtcMs: profileEditedAtOf(before),
      afterProfileEditedAtUtcMs: profileEditedAtOf(after),
    };
  }
  return {
    governedCollection,
    ...core,
    resourceId: fromPath(
      AuditResourceId.parse(
        `${GovernedChangeSystem.pathOf(governedCollection)}/${docId}`,
      ),
    ),
    targetCustomerId:
      governedCollection === GovernedCollection.Customers
        ? fromPath(CustomerId.parse(docId))
        : null,
    fields: GovernedChangeSystem.changedFields(
      fieldsOf(before),
      fieldsOf(after),
    ),
  };
}

// ── Attempts: how a retrying trigger's answer meets the platform ──────────

/** What a retrying pipeline answers its edge with. */
export type AttemptReport = {
  /** The failure the delivery answers with — rethrown when a redelivery can help. */
  readonly attemptFailure: AttemptFailure | null;
  /** A failure the work got past — its line logged, never rethrown. */
  readonly survivedFailure: AttemptFailure | null;
};

/**
 * A failure as the value `retryingTrigger` judges when it is thrown: the
 * failure itself when its own code says the same, else an `Error` carrying
 * the code the pipeline judged it by (a port's refusal names it in its
 * `reason`), so the edge reaches the same verdict.
 */
export function attemptThrowable(failure: AttemptFailure): unknown {
  if (TriggerAttemptSystem.failureCode(failure.error) === failure.failureCode) {
    return failure.error;
  }
  return Object.assign(new Error(failure.failureCode), {
    code: failure.failureCode,
    cause: failure.error,
  });
}

/** ONE attempt line for a failure the work survived — the edge's one line (`attemptLineFields`). */
export function logAttempt(
  fn: string,
  event: DeliveredEvent,
  failure: AttemptFailure,
  ports: EdgePorts,
): void {
  const line = TriggerAttemptSystem.attemptLine(
    fn,
    attemptEventOf(event),
    failure,
    ports.nowUtcMs(),
  );
  ports.log('error', LogEvent.TriggerAttemptFailed, attemptLineFields(line));
}

/**
 * The tail of a retrying trigger's handler: the survived failure's line
 * logged, then the answering failure thrown for `retryingTrigger` to log and
 * — when a redelivery can help — rethrow.
 */
export function settleAttempt(
  fn: string,
  event: DeliveredEvent,
  report: AttemptReport,
  ports: EdgePorts,
): void {
  if (report.survivedFailure !== null) {
    logAttempt(fn, event, report.survivedFailure, ports);
  }
  if (report.attemptFailure !== null) {
    throw attemptThrowable(report.attemptFailure);
  }
}

/**
 * A projection's answer as an attempt report — the client projection's, the
 * busy rebuild's, the waitlist match's (each answers its verdict as
 * `attemptFailure`), or a decoder's refusal: a refusal of the whole (the
 * policy or zone read, a malformed event) is every item's failure.
 */
export function projectionReport(
  result: Result<
    { readonly attemptFailure: AttemptFailure | null },
    RepositoryError
  >,
): AttemptReport {
  return {
    attemptFailure: result.ok
      ? result.value.attemptFailure
      : TriggerAttemptSystem.repositoryFailure(result.error),
    survivedFailure: null,
  };
}

/** The document audit's answer as an attempt report — a refusal is permanent by construction. */
export function documentAuditReport(
  result: Result<
    AuditDocumentChangeAnswer,
    GovernanceError.AuditEntryEmptyAction | RepositoryError
  >,
): AttemptReport {
  if (result.ok) return { attemptFailure: null, survivedFailure: null };
  const error = result.error;
  return {
    attemptFailure: isStoreFailure(error)
      ? TriggerAttemptSystem.repositoryFailure(error)
      : TriggerAttemptSystem.attemptFailure(error, error.errorCode),
    survivedFailure: null,
  };
}

/**
 * A refusal as today's throw. In a plain schedule it fails the run (the
 * platform logs it; the scheduler's `retryCount` reruns it); inside
 * `retryingTrigger` the edge judges the throw — one attempt line, and only a
 * transient failure is rethrown and redelivered.
 */
export function failOnRefusal<T>(result: Result<T, RepositoryError>): T {
  if (result.ok) return result.value;
  throw attemptThrowable(TriggerAttemptSystem.repositoryFailure(result.error));
}
