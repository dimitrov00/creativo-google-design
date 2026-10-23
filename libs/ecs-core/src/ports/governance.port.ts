import type { Observable } from 'rxjs';
import type {
  Result,
  AppointmentId,
  BackfillJobId,
  UserId,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type {
  Appointment,
  AuditEntry,
  BackfillJob,
  ImpersonationSession,
} from '@core/entities';

/**
 * The governance context's ports (blueprint §4, §4.1, §4.2): the audit
 * trail, the impersonation reader and the operator backfill's reads and
 * progress write. Impersonation starts and ends, and every backfill row
 * stamp, are `CommitPlan` transactions (`tx.port.ts`) — the backfill's
 * `writePage` re-reads each row inside its own plan, so a staff edit since
 * the page was read is never clobbered (`run-backfill.ts:214-233`).
 */

// ── Audit ─────────────────────────────────────────────────────────────────

/**
 * The after-commit audit write (§4): rows planned by `AuditSystem.plan`,
 * ids `hash(AuditSystem.rowBasis(…))`, each written with `create()` —
 * ALREADY_EXISTS is the replay, not an error — and NEVER fatal: a failure
 * is logged through `Log`/`TrackError` and the booking stands (today's
 * `appendAudit`, `audit.ts:286`, "after the commit, never inside it").
 */
export type AppendAudit = (rows: readonly AuditEntry[]) => Promise<void>;

/**
 * `createAuditRows` — the profile-change trigger's ONLY write
 * (`auditProfileChange`, §4.1): the same deterministic-id `create()` rows,
 * ALREADY_EXISTS a success (a redelivered event writes nothing new), but a
 * real failure IS reported, so the trigger's retry can deliver the row.
 */
export type CreateAuditRows = (
  rows: readonly AuditEntry[],
) => Promise<Result<void, RepositoryError>>;

/**
 * `auditActionsFor` (§4.1 `runBackfill`) — every audit row filed against
 * the given appointment ids, `resourceId in` chunks of 30, single-field
 * (`run-backfill.ts:193-212`): the commit's row says who placed a booking.
 */
export type AuditActionsFor = (
  appointmentIds: readonly AppointmentId[],
) => Promise<Result<readonly AuditEntry[], RepositoryError>>;

// ── Impersonation ─────────────────────────────────────────────────────────

/**
 * The admin's live session, if any — `adminUserId ==`,
 * `impersonationStatus == 'ACTIVE'`, limit 1 (index #9: `adminUserId,
 * impersonationStatus`; `impersonation.adapter.ts`'s
 * `impersonationReadPorts`); the flat body as stored, `null` when none.
 * A lapsed session still reads `ACTIVE` — `ImpersonationSystem.isExpired`
 * is the rule an authorization reads, never this stream alone.
 */
export type ObserveActiveImpersonation = (
  adminUserId: UserId,
) => Observable<Result<ImpersonationSession | null, RepositoryError>>;

// ── The operator backfill ─────────────────────────────────────────────────

/** `backfillJobs/{job}` — the job's progress; `null` before its first page. */
export type LoadBackfillJob = (
  id: BackfillJobId,
) => Promise<Result<BackfillJob | null, RepositoryError>>;

/** `backfillJobs/{job}` `Set` — the progress after a page (`writeJob`, §4.1). */
export type WriteBackfillJob = (
  job: BackfillJob,
) => Promise<Result<void, RepositoryError>>;

/**
 * `pageEntities` (§4.1) — the next page of appointments in document-id
 * order, strictly after `afterId` (`run-backfill.ts:384-388`). A page
 * shorter than `limit` is the last.
 */
export type PageAppointments = (
  afterId: AppointmentId | null,
  limit: number,
) => Promise<Result<readonly Appointment[], RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The after-commit audit write — every booking pipeline's audit step. */
export type AuditAppendPorts = {
  readonly appendAudit: AppendAudit;
};

/** The profile-change trigger's reported audit write. */
export type AuditRowsPorts = {
  readonly createAuditRows: CreateAuditRows;
};

/** The audit rows filed against appointments — the backfill's author lookup. */
export type AuditQueryPorts = {
  readonly auditActionsFor: AuditActionsFor;
};

/** The audit trail — `firestore-audit.adapter.ts`. */
export type AuditPorts = AuditAppendPorts & AuditRowsPorts & AuditQueryPorts;

/** The admin's live impersonation session (web, `IMPERSONATION_READ_PORTS`). */
export type ImpersonationReadPorts = {
  readonly observeActiveImpersonation: ObserveActiveImpersonation;
};

/** The operator backfill's job progress and appointment pages — `firestore-jobs.adapter.ts`. */
export type BackfillJobPorts = {
  readonly loadBackfillJob: LoadBackfillJob;
  readonly writeBackfillJob: WriteBackfillJob;
  readonly pageAppointments: PageAppointments;
};

/** The governance context's whole port suite — an intersection of its bundles. */
export type GovernancePorts = AuditPorts &
  ImpersonationReadPorts &
  BackfillJobPorts;
