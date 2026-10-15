import {
  BarberId,
  BusyKey,
  type CustomerId,
  type GovernanceError,
  type RepositoryError,
  type Result,
  TriggerEventId,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { BookingPolicy, PreciseInstant } from '@core/components';
import {
  type Appointment,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
} from '@core/entities';
import {
  type AttemptFailure,
  AttemptOutcome,
  AuditSystem,
  ClientStatsSystem,
  type ProfileChange,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type AuditProfileChangeAnswer,
  type ClientStatsProjection,
  CapacityTrigger,
  type ContinuePolicyRecomputeCommand,
  type MatchWaitlistCommand,
  type ProjectClientStatsCommand,
  type RebuildBusyCommand,
  type RebuildCapacityCommand,
  repositoryFailure,
  type SampleLeadTimeCommand,
  type StartPolicyRecomputeCommand,
} from '@core/pipelines';
import { type DeliveredEvent, type EdgePorts, WIRE_ZONE } from '../edge';

/**
 * The flip-1 TRIGGERS' edge (blueprint §4.1, F1-3): a Firestore write or a
 * schedule tick in, a pipeline command out — and, for the retrying ones, how
 * a pipeline's answer becomes today's attempt line and redelivery. A decoder
 * reads the event as stored (the document body IS the entity minus `id`,
 * Law 5) and says the tenant's zone in one place (`WIRE_ZONE`, the
 * functions' `TENANT_ZONE`, flatten-spec F-4); it decides nothing a
 * pipeline decides.
 *
 * - `decodeRebuildBusyEvent` — both sides of an `appointments` write;
 * - `decodeCapacityEvent` — a busy day, an exception, a roster, a shop, the
 *   policy or the daily sweep → the rebuild's scope;
 * - `decodeMatchWaitlistEvent` — the busy day a write touched;
 * - `decodeDispatchProjectionsEvent` — the client records before ∪ after a
 *   write that changed what stats read (`ClientStatsSystem.statsInputChanged`;
 *   most writes — an arrival, a tip — decode to nobody);
 * - `decodePolicyRecomputeEvent` / `decodePolicyStepEvent` /
 *   `decodePolicySweepRun` — the policy pass's settings write, job write and
 *   daily tick;
 * - `decodeProfileChangeEvent` — a `users/{uid}` write, its writer from the
 *   auth context;
 * - `decodeLeadTimeRun` — the daily sample's tick.
 *
 * Triggers keep today's options (F1-2); attempts and budgets are
 * `edge.ts`'s (`retryingTrigger`, `workBudget`).
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

/** A side of a write as the stored entity, `null` when the document is absent there. */
function entityOf<E>(
  snapshot: StoredSnapshot | undefined,
  id: string,
): E | null {
  const data = snapshot?.exists === true ? snapshot.data() : undefined;
  return data === undefined ? null : ({ id, ...data } as E);
}

/** A side of a write as its raw body, `{}` when absent. */
function bodyOf(snapshot: StoredSnapshot | undefined): {
  readonly [field: string]: unknown;
} {
  return snapshot?.data() ?? {};
}

/** The instant a delivery's wire time names (RFC 3339), `null` when it does not parse. */
function eventInstantOf(time: string): UtcEpochMs | null {
  const instant = ZonedTimeSystem.parseOffsetIso(time);
  return instant.ok ? instant.value : null;
}

/** Whole seconds, an optional fraction (dot included), a zone. */
const RFC3339 =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+|)(Z|[+-]\d{2}:\d{2})$/i;

/**
 * A change that delivered an unreadable time reads as the LATEST instant —
 * newer than any stamp, so the system's conservative answer (restart,
 * judge) is the one taken, never a skip (today's reading).
 */
const LATEST_INSTANT = ((): PreciseInstant => {
  const latest = PreciseInstant.of(Number.MAX_SAFE_INTEGER, 999_999_999);
  if (latest === null) throw new Error('the D17 bound is no instant');
  return latest;
})();

/**
 * An event's RFC 3339 time at FULL precision (§9 D17) — whole seconds
 * through the offset, the fraction read to the nanosecond: a Firestore
 * event's time is stamped in microseconds, and two settings writes inside
 * one millisecond must still order.
 */
export function preciseInstantOf(time: string): PreciseInstant {
  const [, wholeSeconds, fraction, zone] = RFC3339.exec(time) ?? [];
  if (wholeSeconds === undefined || zone === undefined) return LATEST_INSTANT;
  const whole = ZonedTimeSystem.parseOffsetIso(`${wholeSeconds}${zone}`);
  if (!whole.ok) return LATEST_INSTANT;
  const digits = (fraction ?? '').slice(1, 10).padEnd(9, '0');
  return (
    PreciseInstant.of(Math.floor(whole.value / 1000), Number(digits)) ??
    LATEST_INSTANT
  );
}

export function decodeRebuildBusyEvent(
  event: DocumentWriteEvent<{ readonly appointmentId: string }>,
): RebuildBusyCommand {
  return {
    before: entityOf<Appointment>(
      event.data?.before,
      event.params.appointmentId,
    ),
    after: entityOf<Appointment>(event.data?.after, event.params.appointmentId),
    timeZone: WIRE_ZONE,
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
      return {
        capacityTrigger: CapacityTrigger.Day,
        barberId,
        localDate,
        timeZone: WIRE_ZONE,
      };
    }
    case CapacitySource.Roster: {
      const barberId = BarberId.parse(params.barberId ?? '');
      return barberId.ok
        ? {
            capacityTrigger: CapacityTrigger.Roster,
            barberId: barberId.value,
            timeZone: WIRE_ZONE,
          }
        : null;
    }
    case CapacitySource.Location:
    case CapacitySource.Settings:
    case CapacitySource.Sweep:
      return { capacityTrigger: CapacityTrigger.Sweep, timeZone: WIRE_ZONE };
  }
}

/** The busy day a `barberBusy` write touched — `null` when the id is no busy key. */
export function decodeMatchWaitlistEvent(
  event: DocumentWriteEvent<{ readonly docId: string }>,
): MatchWaitlistCommand | null {
  const key = BusyKey.parse(event.params.docId);
  return key === null
    ? null
    : { localDate: BusyKey.split(key).localDate, timeZone: WIRE_ZONE };
}

/**
 * Everybody an appointment write can have moved — the client records on the
 * visit before AND after it (a person removed from a party must lose the
 * visit) — or nobody, for a write that changed nothing stats read.
 */
export function decodeDispatchProjectionsEvent(
  event: DocumentWriteEvent<{ readonly appointmentId: string }>,
): ProjectClientStatsCommand {
  const before = entityOf<Appointment>(
    event.data?.before,
    event.params.appointmentId,
  );
  const after = entityOf<Appointment>(
    event.data?.after,
    event.params.appointmentId,
  );
  if (!ClientStatsSystem.statsInputChanged(before, after)) {
    return { customerIds: [] };
  }
  const none: readonly CustomerId[] = [];
  return {
    customerIds: ClientStatsSystem.affectedSubjects(
      before === null ? none : before.subjectCustomerIds,
      after === null ? none : after.subjectCustomerIds,
    ),
  };
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

/** The daily lead-time sample's command: the tenant's clock. */
export function decodeLeadTimeRun(): SampleLeadTimeCommand {
  return { timeZone: WIRE_ZONE };
}

/** A `users/{uid}` write as the profile change it audits — field NAMES only. */
export function decodeProfileChangeEvent(
  event: AuthDocumentWriteEvent<{ readonly uid: string }>,
): ProfileChange {
  const before = event.data?.before;
  const after = event.data?.after;
  return {
    eventId: TriggerEventId.of(event.id),
    eventAtUtcMs: eventInstantOf(event.time),
    ownerUserId: UserId.of(event.params.uid),
    writer: AuditSystem.profileWriter(event.authType, event.authId ?? null),
    beforeExists: before?.exists === true,
    afterExists: after?.exists === true,
    fields: AuditSystem.changedProfileFields(bodyOf(before), bodyOf(after)),
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

/** Today's attempt-line outcome spelling (`lib/trigger-attempts.ts`). */
const LEGACY_ATTEMPT_OUTCOME: { readonly [K in AttemptOutcome]: string } = {
  [AttemptOutcome.Transient]: 'transient',
  [AttemptOutcome.Permanent]: 'permanent',
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

/** ONE attempt line for a failure the work survived — today's keys and values. */
export function logAttempt(
  fn: string,
  event: DeliveredEvent,
  failure: AttemptFailure,
  ports: EdgePorts,
): void {
  const line = TriggerAttemptSystem.attemptLine(
    fn,
    {
      id: TriggerEventId.of(event.id),
      eventAtUtcMs: eventInstantOf(event.time),
    },
    failure,
    ports.nowUtcMs(),
  );
  ports.log('error', 'trigger attempt failed', {
    fn: line.fn,
    eventId: line.eventId,
    outcome: LEGACY_ATTEMPT_OUTCOME[line.attemptOutcome],
    code: line.failureCode,
    ageMs: line.ageMs,
  });
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

/** The client projection's answer as an attempt report — the policy read is every client's failure. */
export function projectionReport(
  result: Result<ClientStatsProjection, RepositoryError>,
): AttemptReport {
  return {
    attemptFailure: result.ok
      ? result.value.attemptFailure
      : repositoryFailure(result.error),
    survivedFailure: null,
  };
}

/** The profile audit's answer as an attempt report — a refusal is permanent by construction. */
export function profileAuditReport(
  result: Result<
    AuditProfileChangeAnswer,
    GovernanceError.AuditEntryEmptyAction | RepositoryError
  >,
): AttemptReport {
  if (result.ok) return { attemptFailure: null, survivedFailure: null };
  const error = result.error;
  return {
    attemptFailure:
      'path' in error
        ? repositoryFailure(error)
        : TriggerAttemptSystem.attemptFailure(error, error.errorCode),
    survivedFailure: null,
  };
}

/**
 * A non-retrying trigger's answer: a refusal fails the invocation as
 * today's throw did (the platform logs it; nothing redelivers).
 */
export function failOnRefusal<T>(result: Result<T, RepositoryError>): T {
  if (result.ok) return result.value;
  throw attemptThrowable(repositoryFailure(result.error));
}
