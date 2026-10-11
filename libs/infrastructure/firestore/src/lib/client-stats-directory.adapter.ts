import { Injectable, inject } from '@angular/core';
import {
  type QueryConstraint,
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { PageStep, PagingSystem } from '@core/systems';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  CLIENT_STATS_COLLECTION,
  type ClientStatsDirectory,
  type ClientStatsPage,
  clientStatsFromDocument,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';

/**
 * `clientStats/*`, EVERY client's, walked a page at a time in the order of
 * the document ids (client-card-revision-3.md §4.4). One reader has use
 * for it: the admin's preview of a rhythm rule, which folds each person's
 * visits of the last year through the rule twice.
 *
 * Ascending by document id is the order Firestore keeps by itself: no
 * index is declared for it. The rule that lets the book read one client's
 * statistics lets it list them; the spend lives in `restricted/money`, a
 * subcollection, which a collection read never returns and this adapter
 * never names.
 *
 * One document more than asked is read, and never handed over: it is how
 * the page knows that somebody is left, so `next` is a cursor only while
 * it leads somewhere. The cursor is the id of the last document the page
 * READ: a document that does not parse is left out of the records and
 * still moves the cursor, so it cannot end the walk or stall it.
 */
@Injectable()
export class FirestoreClientStatsDirectory implements ClientStatsDirectory {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async page(
    max: number,
    after: string | null,
  ): Promise<Result<ClientStatsPage, RepositoryError>> {
    const size = atLeastOne(max);
    try {
      const snapshot = await getDocs(
        query(
          collection(this.db, CLIENT_STATS_COLLECTION),
          orderBy(documentId()),
          ...pastClient(after),
          limit(size + 1),
        ),
      );
      // The size + 1 read cut (`PagingSystem.nextCursor`): the extra row
      // says whether anyone is left, and the cursor is the page's last id.
      // Ids are unique, so a page never ends inside a tie.
      const step = PagingSystem.nextCursor(
        snapshot.docs,
        size,
        (entry) => entry.id,
      );
      const read =
        step.pageStep === PageStep.Page
          ? step.rows
          : snapshot.docs.slice(0, size);
      return ok({
        records: read.flatMap((entry) => {
          const record = clientStatsFromDocument(entry.id, entry.data());
          return record === null ? [] : [record];
        }),
        next: step.pageStep === PageStep.Page ? step.cursor : null,
      });
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read the clients’ statistics', error),
      );
    }
  }
}

/** The clients after the cursor; from the first when there is none. */
function pastClient(after: string | null): QueryConstraint[] {
  return after !== null && after.trim().length > 0 ? [startAfter(after)] : [];
}

/** A whole count of at least one, whatever was asked. */
function atLeastOne(raw: number): number {
  return Number.isFinite(raw) ? PagingSystem.pageSize(raw) : 1;
}
