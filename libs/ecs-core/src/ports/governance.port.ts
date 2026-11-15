import type { PermissionsCall, RolesCall, TeamCall } from '@core/components';
import type { Result, AppointmentId, BackfillJobId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Appointment, AuditEntry, BackfillJob } from '@core/entities';
import type { Callable } from './scheduling.port';

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
 * `createAuditRows` — the document-change trigger's ONLY write
 * (`auditDocumentChange`, §4.1; audit-hardening WS-3, RU-40 — the users and
 * the thirteen governed collections): the same deterministic-id `create()` rows,
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

// ── The web's roles change ────────────────────────────────────────────────

/**
 * `setRoles` — an admin's change of one account's roles (security hardening
 * S-WS-E): the account and the whole new set in; the stored set and whether
 * anything was written out.
 */
export type SetRoles = Callable<RolesCall, RolesCall.Changed>;

// ── The web's Team screens ────────────────────────────────────────────────

/**
 * `listTeam` — the Team page's one read (team onboarding D8): nothing in;
 * every barber record and every staff account out, as far as the caller's
 * permissions reach (the records alone for someone who edits profiles and
 * does not manage the team).
 */
export type ListTeam = Callable<TeamCall.ListRequest, TeamCall.Listed>;

/**
 * `addBarber` — a new barber record as a `DRAFT` (team onboarding D8): the
 * add sheet's answers in; the record out. The act's operation id IS the new
 * record's id, so a retry writes nothing twice.
 */
export type AddBarber = Callable<TeamCall, TeamCall.Saved>;

/** `editBarber` — one part of one record, replaced whole (`barberEdit` says which). */
export type EditBarber = Callable<TeamCall.Edit, TeamCall.Saved>;

/** `setBarberOfferings` — a barber's services and prices: the whole list, or a colleague's copied. */
export type SetBarberOfferings = Callable<TeamCall.Offerings, TeamCall.Saved>;

/** `deleteDraftBarber` — «Изтрий»: a record that never went live, removed. */
export type DeleteDraftBarber = Callable<TeamCall.Named, TeamCall.Saved>;

/**
 * `activateBarber` — the idempotent go-live step (team onboarding D9),
 * asked when a member's page opens on a `DRAFT` and after each save on one:
 * the answer says what the step came to.
 */
export type ActivateBarber = Callable<TeamCall.Named, TeamCall.Activation>;

/**
 * `setBarberPhoto` — a barber's ONE photo replaced from a picture the
 * caller staged (`StagedUploadPorts`), for whoever `TEAM_PROFILES` reaches
 * the record for. The server copies it into the shop's media and onto the
 * linked account's avatar.
 */
export type SetBarberPhoto = Callable<TeamCall.Photo, TeamCall.Saved>;

/**
 * `setStaffPermissions` — the owner's save of what a staff level may do
 * (staff permissions P6): the cells wanted in; the cells that really
 * changed out, each with its scope before and after.
 */
export type SaveStaffPermissions = Callable<
  PermissionsCall,
  PermissionsCall.Saved
>;

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

/** The admin's roles change — the staff client card's «Роли» block; ONE token, `ROLES_ADMIN_PORTS` (web). */
export type RolesAdminPorts = {
  readonly setRoles: SetRoles;
};

/** The Team page's read. */
export type TeamListPorts = {
  readonly listTeam: ListTeam;
};

/** The owner's save of what each staff level may do — «Права». */
export type StaffPermissionsSavePorts = {
  readonly setStaffPermissions: SaveStaffPermissions;
};

/** A barber record added, edited part by part, taken live and deleted (team onboarding D5, D8, D9). */
export type BarberRecordPorts = {
  readonly addBarber: AddBarber;
  readonly editBarber: EditBarber;
  readonly setBarberOfferings: SetBarberOfferings;
  readonly deleteDraftBarber: DeleteDraftBarber;
  readonly activateBarber: ActivateBarber;
};

/** A barber's one photo set from a staged picture — what `changeBarberPhoto` dials. */
export type BarberPhotoCallPorts = {
  readonly setBarberPhoto: SetBarberPhoto;
};

/** A barber record's writes — the add sheet's and the member page's. */
export type TeamRecordPorts = BarberRecordPorts & BarberPhotoCallPorts;

/** The Team screens' calls — ONE token, `TEAM_ADMIN_PORTS` (web), `teamAdminPorts(gateway)`. */
export type TeamAdminPorts = TeamListPorts &
  StaffPermissionsSavePorts &
  TeamRecordPorts;

/** The governance context's whole port suite — an intersection of its bundles. */
export type GovernancePorts = AuditPorts & BackfillJobPorts;
