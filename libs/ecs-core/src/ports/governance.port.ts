import type { Observable } from 'rxjs';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type {
  AppointmentEntity,
  AppointmentId,
} from '../entities/appointment.entity';
import type { AuditEntryEntity } from '../entities/audit-entry.entity';
import type {
  BackfillJobEntity,
  BackfillJobId,
} from '../entities/backfill-job.entity';
import type { ImpersonationSessionEntity } from '../entities/impersonation-session.entity';
import type { UserId } from '../entities/user.entity';

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
export type AppendAudit = (rows: readonly AuditEntryEntity[]) => Promise<void>;

/**
 * `createAuditRows` — the profile-change trigger's ONLY write
 * (`auditProfileChange`, §4.1): the same deterministic-id `create()` rows,
 * ALREADY_EXISTS a success (a redelivered event writes nothing new), but a
 * real failure IS reported, so the trigger's retry can deliver the row.
 */
export type CreateAuditRows = (
  rows: readonly AuditEntryEntity[],
) => Promise<Result<void, RepositoryError>>;

/**
 * `auditActionsFor` (§4.1 `runBackfill`) — every audit row filed against
 * the given appointment ids, `resourceId in` chunks of 30, single-field
 * (`run-backfill.ts:193-212`): the commit's row says who placed a booking.
 */
export type AuditActionsFor = (
  appointmentIds: readonly AppointmentId[],
) => Promise<Result<readonly AuditEntryEntity[], RepositoryError>>;

// ── Impersonation ─────────────────────────────────────────────────────────

/**
 * The admin's live session, if any — `adminUserId ==`, `status.kind ==
 * active` (index #9, `impersonation.adapter.ts:207-208`); `null` when none.
 */
export type ObserveActiveImpersonation = (
  adminUserId: UserId,
) => Observable<Result<ImpersonationSessionEntity | null, RepositoryError>>;

// ── The operator backfill ─────────────────────────────────────────────────

/** `backfillJobs/{job}` — the job's progress; `null` before its first page. */
export type LoadBackfillJob = (
  id: BackfillJobId,
) => Promise<Result<BackfillJobEntity | null, RepositoryError>>;

/** `backfillJobs/{job}` `Set` — the progress after a page (`writeJob`, §4.1). */
export type WriteBackfillJob = (
  job: BackfillJobEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * `pageEntities` (§4.1) — the next page of appointments in document-id
 * order, strictly after `afterId` (`run-backfill.ts:384-388`). A page
 * shorter than `limit` is the last.
 */
export type PageAppointments = (
  afterId: AppointmentId | null,
  limit: number,
) => Promise<Result<readonly AppointmentEntity[], RepositoryError>>;

/** The governance context's port catalogue; each root binds the `Pick` it implements. */
export type GovernancePorts = {
  readonly appendAudit: AppendAudit;
  readonly createAuditRows: CreateAuditRows;
  readonly auditActionsFor: AuditActionsFor;
  readonly observeActiveImpersonation: ObserveActiveImpersonation;
  readonly loadBackfillJob: LoadBackfillJob;
  readonly writeBackfillJob: WriteBackfillJob;
  readonly pageAppointments: PageAppointments;
};
