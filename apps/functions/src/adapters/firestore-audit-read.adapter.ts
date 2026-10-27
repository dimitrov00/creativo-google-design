import type { Firestore, Query } from 'firebase-admin/firestore';
import { Result, type UtcEpochMs } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { PageStep } from '@core/components';
import { type AuditEntry, Collections } from '@core/entities';
import type { AuditTimelinePage, AuditTimelinePorts } from '@core/ports';
import { PagingSystem, TriggerAttemptSystem } from '@core/systems';

/**
 * `auditLog/*`, read on the server (audit-hardening Phase 3, WS-C): the
 * five WS-7 timelines (`AuditTimelinePorts`) over the Admin SDK — the
 * query shapes of the web's `auditReadPorts`
 * (`libs/infrastructure/firestore`), with the same pure `PagingSystem`.
 * The admin's privacy callables read the rows filed against one person
 * through it (`pageAuditByTargetCustomer`, `pageAuditByTargetUser`); one
 * operation's rows (`auditRowsForOperation`) are not built here — nothing
 * on the server reads them.
 *
 * A timeline is `<field> == key`, `recordedAtUtcMs <` the cursor when one
 * is given, `orderBy recordedAtUtcMs desc`, `limit(size + 1)` — one row
 * more than the page, never handed over, to know whether anything older is
 * left. A page never ends inside an instant: on a tie at the page's last
 * instant every row AT it and one row below it are read, and
 * `PagingSystem` takes the instant whole. Every read rides one of the five
 * `auditLog` composites (`<field> ASC, recordedAtUtcMs DESC`). Each field
 * has its own port (RU-35). The collection has no stored-document guard:
 * `{ id, ...data }` is the `AuditEntry` (Law 5). A read that throws
 * answers `RepositoryError.readFailed(auditLog, <canonical code>)`.
 */

/** The root field a timeline is keyed by — one of the five `auditLog` composites. */
type TimelineField =
  | 'targetCustomerId'
  | 'targetUserId'
  | 'resourceId'
  | 'actorUserId'
  | 'actorAdminUserId';

/** The instant a newest-first timeline is ordered and resumed by. */
const recordedAtOf = (row: AuditEntry): UtcEpochMs => row.recordedAtUtcMs;

/** A row's id — what orders a tied instant. */
const idOf = (row: AuditEntry): string => row.id;

export const firestoreAuditReadPorts = (db: Firestore): AuditTimelinePorts => {
  const path = Collections.AuditLog;

  /** The rows a query answers, as stored. */
  const rowsOf = async (query: Query): Promise<AuditEntry[]> =>
    (await query.get()).docs.map(
      (snap) => ({ id: snap.id, ...snap.data() }) as AuditEntry,
    );

  /** One page of the timeline `field == key`. */
  const pageOf = async (
    field: TimelineField,
    key: string,
    beforeRecordedAtUtcMs: UtcEpochMs | null,
    max: number,
  ): Promise<AuditTimelinePage> => {
    const size = PagingSystem.pageSizeOf(max);
    const keyed = db.collection(path).where(field, '==', key);
    const newer =
      beforeRecordedAtUtcMs === null
        ? keyed
        : keyed.where('recordedAtUtcMs', '<', beforeRecordedAtUtcMs);
    const read = await rowsOf(
      newer.orderBy('recordedAtUtcMs', 'desc').limit(size + 1),
    );
    const step = PagingSystem.nextCursor(read, size, recordedAtOf);
    if (step.pageStep === PageStep.Page) {
      return { rows: step.rows, cursor: step.cursor };
    }
    const [sameInstant, older] = await Promise.all([
      rowsOf(keyed.where('recordedAtUtcMs', '==', step.boundary)),
      rowsOf(
        keyed
          .where('recordedAtUtcMs', '<', step.boundary)
          .orderBy('recordedAtUtcMs', 'desc')
          .limit(1),
      ),
    ]);
    return PagingSystem.sameInstantBoundary(
      step.newer,
      sameInstant,
      idOf,
      older.length > 0,
      step.boundary,
    );
  };

  /** The timeline port over `field`; a read that throws is a failed read. */
  const timeline =
    (field: TimelineField) =>
    async (
      key: string,
      beforeRecordedAtUtcMs: UtcEpochMs | null,
      max: number,
    ): Promise<Result<AuditTimelinePage, RepositoryError>> => {
      try {
        return Result.ok(await pageOf(field, key, beforeRecordedAtUtcMs, max));
      } catch (error) {
        return Result.err(
          RepositoryError.readFailed(
            path,
            TriggerAttemptSystem.failureCode(error),
          ),
        );
      }
    };

  return {
    pageAuditByTargetCustomer: timeline('targetCustomerId'),
    pageAuditByTargetUser: timeline('targetUserId'),
    pageAuditByResource: timeline('resourceId'),
    pageAuditByActorUser: timeline('actorUserId'),
    pageAuditByActorAdmin: timeline('actorAdminUserId'),
  };
};
