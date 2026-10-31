import {
  type Firestore,
  type QueryConstraint,
  collection,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { type OperationId, Result, type UtcEpochMs } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import { PageStep } from '@core/components';
import { type AuditEntry, Collections } from '@core/entities';
import type { AuditReadPorts, AuditTimelinePage } from '@core/ports';
import { AuditSystem, PagingSystem } from '@core/systems';
import { readQuery } from './observe';
import { readFailed } from './stored-entity';

/** The most rows one operation's read hands over. */
const OPERATION_ROWS_MAX = 50;

/** The instant a newest-first timeline is ordered and resumed by. */
const recordedAtOf = (row: AuditEntry): UtcEpochMs => row.recordedAtUtcMs;

/** A row's id — what orders a tied instant. */
const idOf = (row: AuditEntry): string => row.id;

/**
 * The root field a timeline is keyed by — one of the five `auditLog`
 * composites (`<field> ASC, recordedAtUtcMs DESC`, `firestore.indexes.json`).
 */
type TimelineField =
  | 'targetCustomerId'
  | 'targetUserId'
  | 'resourceId'
  | 'actorUserId'
  | 'actorAdminUserId';

/**
 * `auditLog/*`, read side (audit-hardening WS-7) — the admin's reviewable
 * trail. The rules let an admin (`admin`, `sysadmin`) read and nobody else;
 * a refusal answers `RepositoryError.readFailed(…, 'permission-denied')`.
 * The collection has no stored-document guard, so every row reads as
 * stored: `{ id, ...data }` is the `AuditEntry` (Law 5, zero mapping).
 *
 * A timeline is `<field> == key`, `recordedAtUtcMs <` the cursor when one
 * is given, `orderBy recordedAtUtcMs desc`, `limit(size + 1)` — one row more
 * than the page, never handed over, to know whether anything older is
 * left. An act writes one row per client record at ONE instant, so a page
 * must never end inside an instant: on a tie at the page's last instant
 * every row AT it and one row below it are read, and `PagingSystem` takes
 * the instant whole (the client-history reader's rule, `appointments.adapter.ts`).
 * Every read rides one of the five composites (equality + range/order on
 * `recordedAtUtcMs`), or — the tie's `==` pair — the same composite.
 *
 * One operation's rows are `auditOperationId == id`, at most 50, ordered by
 * `AuditSystem.chronological` (the ordering rule is a system's, Law 4);
 * the field keeps its automatic single-field index.
 */
export const auditReadPorts = (db: Firestore): AuditReadPorts => {
  const path = Collections.AuditLog;
  const auditLog = collection(db, path);

  /** A timeline's rows, newest first, as stored. */
  const newestFirst = (
    keyedBy: QueryConstraint,
    before: readonly QueryConstraint[],
    max: number,
  ) =>
    readQuery<AuditEntry>(
      query(
        auditLog,
        keyedBy,
        ...before,
        orderBy('recordedAtUtcMs', 'desc'),
        limit(max),
      ),
      path,
    );

  /** One page of the timeline `field == key`. */
  const pageOf = async (
    field: TimelineField,
    key: string,
    beforeRecordedAtUtcMs: UtcEpochMs | null,
    max: number,
  ): Promise<Result<AuditTimelinePage, RepositoryError>> => {
    const size = PagingSystem.pageSizeOf(max);
    const keyedBy = where(field, '==', key);
    const read = await newestFirst(
      keyedBy,
      beforeRecordedAtUtcMs === null
        ? []
        : [where('recordedAtUtcMs', '<', beforeRecordedAtUtcMs)],
      size + 1,
    );
    if (!read.ok) return read;
    const step = PagingSystem.nextCursor(read.value, size, recordedAtOf);
    if (step.pageStep === PageStep.Page) {
      return Result.ok({ rows: step.rows, cursor: step.cursor });
    }
    const [sameInstant, older] = await Promise.all([
      readQuery<AuditEntry>(
        query(auditLog, keyedBy, where('recordedAtUtcMs', '==', step.boundary)),
        path,
      ),
      newestFirst(keyedBy, [where('recordedAtUtcMs', '<', step.boundary)], 1),
    ]);
    if (!sameInstant.ok) return sameInstant;
    if (!older.ok) return older;
    return Result.ok(
      PagingSystem.sameInstantBoundary(
        step.newer,
        sameInstant.value,
        idOf,
        older.value.length > 0,
        step.boundary,
      ),
    );
  };

  /** The timeline port over `field`; a query the SDK refuses to build is a failed read. */
  const timeline =
    (field: TimelineField) =>
    async (
      key: string,
      beforeRecordedAtUtcMs: UtcEpochMs | null,
      max: number,
    ): Promise<Result<AuditTimelinePage, RepositoryError>> => {
      try {
        return await pageOf(field, key, beforeRecordedAtUtcMs, max);
      } catch (cause) {
        return Result.err(readFailed(path, cause));
      }
    };

  return {
    pageAuditByTargetCustomer: timeline('targetCustomerId'),
    pageAuditByTargetUser: timeline('targetUserId'),
    pageAuditByResource: timeline('resourceId'),
    pageAuditByActorUser: timeline('actorUserId'),
    pageAuditByActorAdmin: timeline('actorAdminUserId'),

    auditRowsForOperation: async (operationId: OperationId) => {
      const read = await readQuery<AuditEntry>(
        query(
          auditLog,
          where('auditOperationId', '==', operationId),
          limit(OPERATION_ROWS_MAX),
        ),
        path,
      );
      return read.ok ? Result.ok(AuditSystem.chronological(read.value)) : read;
    },
  };
};
