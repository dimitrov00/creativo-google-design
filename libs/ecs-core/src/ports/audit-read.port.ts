import type { Page } from '@core/components';
import type { RepositoryError } from '@core/errors';
import type { AuditEntry } from '@core/entities';
import type {
  AuditResourceId,
  CustomerId,
  OperationId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/*
 * The reviewable trail (audit-hardening WS-7): who did what to whom, read
 * back. `auditLog` is admin-read in the rules and written by no client, so
 * every port here answers an admin (`admin`, `sysadmin`) and refuses
 * everybody else (`RepositoryError.readFailed`, `permission-denied`).
 *
 * A timeline is ONE equality on a root field and `recordedAtUtcMs desc` —
 * the five `auditLog` composites of `firestore.indexes.json` — read newest
 * first, a page at a time. Actor and target each live in TWO fields
 * (`actorUserId` / `actorAdminUserId`, `targetUserId` / `targetCustomerId`),
 * so each field has its own port (RU-35): no floating field-name parameter,
 * no merge of two reads in an adapter. A page never ends between two rows
 * sharing one instant — an act's fan-out rows (one per client record) share
 * its instant — by `PagingSystem`'s same-instant boundary rule, so the
 * cursor (the oldest `recordedAtUtcMs` of the page, read strictly below by
 * the next page) skips nothing.
 */

/** A page of a timeline, newest first; its cursor is the `recordedAtUtcMs` the next page reads strictly before (`null`: nothing older). */
export type AuditTimelinePage = Page<AuditEntry, UtcEpochMs>;

/** The rows filed against one client RECORD (`targetCustomerId ==`), newest first. */
export type PageAuditByTargetCustomer = (
  targetCustomerId: CustomerId,
  beforeRecordedAtUtcMs: UtcEpochMs | null,
  limit: number,
) => Promise<Result<AuditTimelinePage, RepositoryError>>;

/** The rows filed against one account (`targetUserId ==`), newest first. */
export type PageAuditByTargetUser = (
  targetUserId: UserId,
  beforeRecordedAtUtcMs: UtcEpochMs | null,
  limit: number,
) => Promise<Result<AuditTimelinePage, RepositoryError>>;

/** The rows filed against one resource (`resourceId ==`: `appointments` id, `users/{uid}`, …), newest first. */
export type PageAuditByResource = (
  resourceId: AuditResourceId,
  beforeRecordedAtUtcMs: UtcEpochMs | null,
  limit: number,
) => Promise<Result<AuditTimelinePage, RepositoryError>>;

/** The rows a USER or STAFF actor wrote (`actorUserId ==`), newest first. */
export type PageAuditByActorUser = (
  actorUserId: UserId,
  beforeRecordedAtUtcMs: UtcEpochMs | null,
  limit: number,
) => Promise<Result<AuditTimelinePage, RepositoryError>>;

/** The rows an ADMIN or IMPERSONATOR actor wrote (`actorAdminUserId ==`), newest first. */
export type PageAuditByActorAdmin = (
  actorAdminUserId: UserId,
  beforeRecordedAtUtcMs: UtcEpochMs | null,
  limit: number,
) => Promise<Result<AuditTimelinePage, RepositoryError>>;

/**
 * Every row one operation wrote (`auditOperationId ==`, its automatic
 * single-field index — never a `fieldOverride`), at most 50, in
 * `AuditSystem.chronological` order: the join from a UI reference or a
 * `callable.*` outcome line to what the act recorded.
 */
export type AuditRowsForOperation = (
  operationId: OperationId,
) => Promise<Result<readonly AuditEntry[], RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The timelines — one equality field + `recordedAtUtcMs desc` each (the five `auditLog` composites). */
export type AuditTimelinePorts = {
  readonly pageAuditByTargetCustomer: PageAuditByTargetCustomer;
  readonly pageAuditByTargetUser: PageAuditByTargetUser;
  readonly pageAuditByResource: PageAuditByResource;
  readonly pageAuditByActorUser: PageAuditByActorUser;
  readonly pageAuditByActorAdmin: PageAuditByActorAdmin;
};

/** One operation's rows. */
export type AuditOperationPorts = {
  readonly auditRowsForOperation: AuditRowsForOperation;
};

/** The admin's read of the audit trail — `AUDIT_READ_PORTS`, `auditReadPorts(db)` (`libs/infrastructure/firestore`). */
export type AuditReadPorts = AuditTimelinePorts & AuditOperationPorts;
