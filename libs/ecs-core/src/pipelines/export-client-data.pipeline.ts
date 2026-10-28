import {
  Actor,
  ClientPrivacyCall,
  FlagName,
  type Role,
  Roles,
  type WriteOp,
} from '@core/components';
import { PrivacyError, RepositoryError } from '@core/errors';
import {
  type AppointmentId,
  AuditEntryId,
  type CustomerId,
  LogEvent,
  type OperationId,
  Result,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import { type AuditEntry, Collections, type Customer } from '@core/entities';
import type {
  AuditTimelinePage,
  AuditTimelinePorts,
  CallerRolesPorts,
  ClientFootprintPorts,
  ClientStatsLoadPorts,
  ClockPorts,
  CommitPorts,
  FlagsPorts,
  HashPorts,
  LoyaltyAccountReadPorts,
  TelemetryPorts,
  WalkInKeyPorts,
} from '@core/ports';
import {
  AuditSystem,
  type ClientFootprint,
  ClientExportSystem,
  ClientPrivacySystem,
  EXPORT_MAX_DOCUMENTS,
} from '@core/systems';

/**
 * `exportClientData` — an ADMIN's data-subject export of one client
 * (audit-hardening Phase 3, WS-C; GDPR Art. 15 / 20): the record the admin
 * asked for, the account it links and every document holding the person's
 * data, as ONE canonical JSON bundle (`ClientExportSystem`). Read-only but
 * for its one audit row.
 *
 * 1. The gate, before any read: the `client.privacy` flag off →
 *    `PRIVACY_UNAVAILABLE`; the token's roles, then the caller's STORED
 *    roles (`loadCallerRoles` — an export of a person's data trusts no stale
 *    claim, the `runBackfill` precedent) not the admin's (`Roles.PRIVACY`,
 *    the sysadmin is not enough) → `PRIVACY_FORBIDDEN`.
 * 2. The record (`null` → `PRIVACY_CLIENT_NOT_FOUND`); a `userId` the
 *    record does not provably link (`ClientPrivacySystem.linkOf`, the D29
 *    check) → `PRIVACY_ACCOUNT_LINK_MISMATCH` before any read keyed by it;
 *    then, when it links one, the account.
 * 3. The footprint, OUTSIDE any transaction: every list read with
 *    `EXPORT_MAX_DOCUMENTS + 1`, the audit rows filed against the record and
 *    the account paged newest first until nothing is older or the cap is
 *    passed — so a person past the cap is refused, never truncated.
 * 4. The pure decision: the bundle, its counts, or `PRIVACY_EXPORT_TOO_LARGE`
 *    (no row). The row the act writes is keyed by the act's operation id,
 *    so its id is known before the read and left out of the bundle — a
 *    replay of one operation answers the same bytes under one clock.
 * 5. ONE commit: a probe read of that row id — absent, the
 *    `PRIVACY_CLIENT_EXPORTED` row (counts only, actor the admin, target the
 *    record) is created; present (a replay), nothing is written. Then one
 *    `info` line of ids and counts — the bundle never reaches a log field.
 */

export type ExportClientDataPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  WalkInKeyPorts &
  CallerRolesPorts &
  FlagsPorts &
  ClientFootprintPorts &
  LoyaltyAccountReadPorts &
  ClientStatsLoadPorts &
  AuditTimelinePorts &
  TelemetryPorts;

/** The verified caller and the call (`ClientPrivacyCall`, decoded) — never the payload's caller. */
export type ExportClientDataCommand = {
  /** The verified session's uid. */
  readonly callerUserId: UserId;
  /** The verified token's roles — the first gate; the stored roles are the second. */
  readonly callerRoles: readonly Role[];
  readonly customerId: CustomerId;
  /** The act's own id — the row's key, kept by the web for a retry of the same act. */
  readonly operationId: OperationId;
};

/** One timeline page of audit rows filed against the person, newest first. */
const AUDIT_PAGE_SIZE = 500;

/** The most documents any one list read returns — the cap and one, so a person past it is refused. */
const LIST_LIMIT = EXPORT_MAX_DOCUMENTS + 1;

export const exportClientData =
  (ports: ExportClientDataPorts) =>
  async (
    cmd: ExportClientDataCommand,
  ): Promise<
    Result<ClientPrivacyCall.Exported, PrivacyError | RepositoryError>
  > => {
    if (!ports.flagOn(FlagName.ClientPrivacy)) {
      return Result.err(PrivacyError.unavailable());
    }
    if (!Roles.handlesClientPrivacy(cmd.callerRoles)) {
      return Result.err(PrivacyError.forbidden());
    }
    const stored = await ports.loadCallerRoles(cmd.callerUserId);
    if (!stored.ok) return stored;
    if (!Roles.handlesClientPrivacy(stored.value)) {
      return Result.err(PrivacyError.forbidden());
    }
    const loaded = await ports.loadClientRecord(cmd.customerId);
    if (!loaded.ok) return loaded;
    const record = loaded.value;
    if (record === null) return Result.err(PrivacyError.clientNotFound());
    // The D29 link, before any read keyed by the uid (P3-RU-37 (h)): a
    // corrupt or foreign `userId` never exports another account.
    const link = ClientPrivacySystem.linkOf(record, ports.hash);
    if (!link.ok) return link;

    const nowUtcMs = ports.nowUtcMs();
    const ownRowId = AuditEntryId.of(
      ports.hash(ClientExportSystem.rowIdBasis(record.id, cmd.operationId)),
    );
    const footprint = await readFootprint(ports, record, ownRowId);
    if (!footprint.ok) return footprint;
    const exported = ClientExportSystem.exportOf(
      footprint.value,
      nowUtcMs,
      ownRowId,
      ports.walkInHash,
    );
    if (!exported.ok) return exported;

    const row = ClientExportSystem.planClientExported(
      record.id,
      exported.value,
      Actor.forCaller(cmd.callerUserId, stored.value),
      cmd.operationId,
      nowUtcMs,
    );
    const committed = await ports.commit(
      async (tx) => (await tx.get([Collections.AuditLog, ownRowId])) !== null,
      (replayed): Result<{ readonly writes: readonly WriteOp[] }, never> =>
        Result.ok({
          writes: replayed ? [] : AuditSystem.createsOf([row], ports.hash),
        }),
    );
    if (!committed.ok) return committed;

    ports.log('info', LogEvent.PrivacyClientExported, {
      customerId: record.id,
      exportDocumentCount: exported.value.documentCount,
      exportByteCount: exported.value.byteCount,
    });
    return Result.ok({
      clientExportVersion: ClientPrivacyCall.EXPORT_VERSION,
      exportedCustomerId: record.id,
      exportedAtUtcMs: nowUtcMs,
      exportDocumentCount: exported.value.documentCount,
      exportByteCount: exported.value.byteCount,
      exportJson: exported.value.json,
    });
  };

// ── The read half ─────────────────────────────────────────────────────────

/** `ok([])` without a read — an account-keyed list of a record that links no account. */
async function none<E>(): Promise<Result<readonly E[], never>> {
  return Result.ok([]);
}

/**
 * Everything the bundle may hold, read outside any transaction: the
 * account, the visits, then — knowing which visits only the person sat —
 * those visits' notes and photos beside every other list, then the audit
 * rows. A failed read answers its `RepositoryError`; nothing is written.
 */
async function readFootprint(
  ports: ExportClientDataPorts,
  record: Customer,
  ownRowId: AuditEntryId,
): Promise<Result<ClientFootprint, RepositoryError>> {
  const customerId = record.id;
  const userId = record.userId;
  const [account, visits] = await Promise.all([
    userId === null
      ? Promise.resolve(Result.ok(null))
      : ports.loadProfile(userId),
    ports.listClientVisits(customerId, LIST_LIMIT),
  ]);
  if (!account.ok) return account;
  if (!visits.ok) return visits;

  const soleSubjectVisitIds: AppointmentId[] = [];
  for (const visit of visits.value) {
    if (ClientPrivacySystem.isSoleSubject(visit, customerId)) {
      soleSubjectVisitIds.push(visit.id);
    }
  }
  const [
    notes,
    photosOfClient,
    visitPhotos,
    couponGrants,
    giftVouchers,
    loyaltyAccount,
    badgeProgress,
    seasonProgress,
    clientStats,
    clientMoney,
    journal,
    notifications,
    waitlistRequests,
    invitations,
  ] = await Promise.all([
    soleSubjectVisitIds.length === 0
      ? none<never>()
      : ports.loadVisitNotes(soleSubjectVisitIds),
    ports.listPhotosOfClient(customerId, LIST_LIMIT),
    soleSubjectVisitIds.length === 0
      ? none<never>()
      : ports.listVisitPhotos(soleSubjectVisitIds, LIST_LIMIT),
    ports.listClientGrants(customerId, LIST_LIMIT),
    ports.listClientVouchers(customerId, LIST_LIMIT),
    ports.loadLoyaltyAccount(customerId),
    ports.listBadgeProgress(customerId),
    ports.listSeasonProgress(customerId),
    ports.loadClientStats(customerId),
    ports.loadClientMoney(customerId),
    ports.listClientJournal(customerId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountNotifications(userId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountWaitlist(userId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountInvitations(userId, LIST_LIMIT),
  ]);
  if (!notes.ok) return notes;
  if (!photosOfClient.ok) return photosOfClient;
  if (!visitPhotos.ok) return visitPhotos;
  if (!couponGrants.ok) return couponGrants;
  if (!giftVouchers.ok) return giftVouchers;
  if (!loyaltyAccount.ok) return loyaltyAccount;
  if (!badgeProgress.ok) return badgeProgress;
  if (!seasonProgress.ok) return seasonProgress;
  if (!clientStats.ok) return clientStats;
  if (!clientMoney.ok) return clientMoney;
  if (!journal.ok) return journal;
  if (!notifications.ok) return notifications;
  if (!waitlistRequests.ok) return waitlistRequests;
  if (!invitations.ok) return invitations;

  const base: ClientFootprint = {
    record,
    account: account.value,
    visits: visits.value,
    notes: notes.value,
    photos: [...photosOfClient.value, ...visitPhotos.value],
    couponGrants: couponGrants.value,
    giftVouchers: giftVouchers.value,
    loyaltyAccount: loyaltyAccount.value,
    badgeProgress: badgeProgress.value,
    seasonProgress: seasonProgress.value,
    clientStats: clientStats.value,
    clientMoney: clientMoney.value,
    journal: journal.value,
    notifications: notifications.value,
    waitlistRequests: waitlistRequests.value,
    invitations: invitations.value,
    auditRows: [],
  };
  const auditRows = await readAuditRows(ports, base, ownRowId);
  return auditRows.ok
    ? Result.ok({ ...base, auditRows: auditRows.value })
    : auditRows;
}

/** One newest-first timeline, read a page at a time from `before`. */
type Timeline = (
  before: UtcEpochMs | null,
) => Promise<Result<AuditTimelinePage, RepositoryError>>;

/**
 * The audit rows filed against the record, then against the linked
 * account (WS-7's `targetCustomerId` / `targetUserId` timelines), page
 * after page until nothing is older — or until the bundle is past the cap
 * (`ClientExportSystem.documentCount`), when the refusal is certain and
 * reading on would only cost. A cursor that is not strictly older than the
 * last one would read forever: answered as a failed read of `auditLog`.
 */
async function readAuditRows(
  ports: ExportClientDataPorts,
  base: ClientFootprint,
  ownRowId: AuditEntryId,
): Promise<Result<readonly AuditEntry[], RepositoryError>> {
  const record = base.record;
  const userId = record.userId;
  const timelines: Timeline[] = [
    (before) =>
      ports.pageAuditByTargetCustomer(record.id, before, AUDIT_PAGE_SIZE),
  ];
  if (userId !== null) {
    timelines.push((before) =>
      ports.pageAuditByTargetUser(userId, before, AUDIT_PAGE_SIZE),
    );
  }
  const rows: AuditEntry[] = [];
  for (const timeline of timelines) {
    let before: UtcEpochMs | null = null;
    do {
      const page = await timeline(before);
      if (!page.ok) return page;
      rows.push(...page.value.rows);
      if (
        ClientExportSystem.documentCount(
          { ...base, auditRows: rows },
          ownRowId,
        ) > EXPORT_MAX_DOCUMENTS
      ) {
        return Result.ok(rows);
      }
      const cursor: UtcEpochMs | null = page.value.cursor;
      if (
        cursor !== null &&
        before !== null &&
        UtcEpochMs.compare(cursor, before) >= 0
      ) {
        return Result.err(
          RepositoryError.readFailed(Collections.AuditLog, 'cursor-stalled'),
        );
      }
      before = cursor;
    } while (before !== null);
  }
  return Result.ok(rows);
}
