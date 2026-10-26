import type { Result, AppointmentId, BackfillJobId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Appointment, AuditEntry, BackfillJob } from '@core/entities';

/**
 * The governance context's ports (blueprint §4, §4.1, §4.2): the audit
 * trail and the operator backfill's reads and progress write. A booking
 * verb's, an own profile edit's and a streak publish's audit rows are NOT
 * written through these ports: they are `WriteOp.create` entries of the
 * act's own `CommitPlan` (audit-hardening WS-1, `AuditSystem.commitWrites`
 * / `createsOf`), landing with the act or not at all. Impersonation
 * starts and ends, and every backfill row
 * stamp, are `CommitPlan` transactions (`tx.port.ts`) — the backfill's
 * `writePage` re-reads each row inside its own plan, so a staff edit since
 * the page was read is never clobbered (`run-backfill.ts:214-233`).
 */

// ── Audit ─────────────────────────────────────────────────────────────────

/**
 * The ONE after-commit audit write left (§4; L2 of the audit-hardening
 * pass): the operator backfill's per-CALL row — one call is many commits
 * and a job document, so there is no single commit to join. Rows planned
 * by `AuditSystem.plan`, ids `hash(AuditSystem.rowBasis(…))`, each written
 * with `create()` — ALREADY_EXISTS is the replay, not an error — and NEVER
 * fatal: a failure is logged and the call's answer stands. Never inside a
 * transaction (there, ALREADY_EXISTS refuses the whole plan).
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

/** The after-commit audit write — the operator backfill's per-call row only (L2). */
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

/** The operator backfill's job progress and appointment pages — `firestore-jobs.adapter.ts`. */
export type BackfillJobPorts = {
  readonly loadBackfillJob: LoadBackfillJob;
  readonly writeBackfillJob: WriteBackfillJob;
  readonly pageAppointments: PageAppointments;
};

/** The governance context's whole port suite — an intersection of its bundles. */
export type GovernancePorts = AuditPorts & BackfillJobPorts;
