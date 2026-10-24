import {
  type Firestore,
  type QueryConstraint,
  collection,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { Result } from '@core/primitives';
import {
  CLIENT_MONEY_DOC,
  type ClientMoneyRecord,
  type ClientStatsRecord,
  Collections,
  Subcollections,
} from '@core/entities';
import type { ClientStatsReadPorts } from '@core/ports';
import { PageStep, PagingSystem } from '@core/systems';
import { readDoc, readQuery } from './observe';

/** The id a page of stored stats is ordered and resumed by. */
const idOf = (record: ClientStatsRecord) => record.id;

/**
 * `clientStats/{customerId}` and its admin-only `restricted/money` (flip 1,
 * plan §3.4; D29: keyed by the client RECORD, never the account) — the
 * successor of `FirestoreClientStatsReader` and
 * `FirestoreClientStatsDirectory`. Read once (`getDoc`/`getDocs` fall back
 * to the persistent cache offline, so a barber in the chair still sees the
 * last numbers); written only by the projection pipeline on the server.
 */
export const clientStatsReadPorts = (db: Firestore): ClientStatsReadPorts => ({
  loadClientStats: (customerId) =>
    readDoc<ClientStatsRecord>(doc(db, Collections.ClientStats, customerId)),

  loadClientMoney: (customerId) =>
    readDoc<ClientMoneyRecord>(
      doc(
        db,
        Collections.ClientStats,
        customerId,
        Subcollections.Restricted,
        CLIENT_MONEY_DOC,
      ),
    ),

  /**
   * EVERY client's stats in document-id order, a page at a time — the order
   * Firestore keeps by itself, so no index is declared. One document more
   * than the page is read and never handed over: it says whether anyone is
   * left, so the cursor (the page's last id) exists only while it leads
   * somewhere. A collection read never returns `restricted/money`: the
   * spend is never read here.
   */
  pageClientStats: async (afterCustomerId, max) => {
    const size = PagingSystem.pageSizeOf(max);
    const after: QueryConstraint[] =
      afterCustomerId === null ? [] : [startAfter(afterCustomerId)];
    const read = await readQuery<ClientStatsRecord>(
      query(
        collection(db, Collections.ClientStats),
        orderBy(documentId()),
        ...after,
        limit(size + 1),
      ),
      Collections.ClientStats,
    );
    if (!read.ok) return read;
    // Ids are unique: a page never ends inside a tie.
    const step = PagingSystem.nextCursor(read.value, size, idOf);
    return step.pageStep === PageStep.Page
      ? Result.ok({ records: step.rows, nextAfterCustomerId: step.cursor })
      : Result.ok({
          records: read.value.slice(0, size),
          nextAfterCustomerId: null,
        });
  },
});
