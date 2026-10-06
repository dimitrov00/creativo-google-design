import { Injectable, inject } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  CLIENT_MONEY_DOC,
  CLIENT_STATS_COLLECTION,
  CLIENT_STATS_RESTRICTED_COLLECTION,
  type ClientMoneyRecord,
  type ClientStatsReader,
  type ClientStatsRecord,
  clientMoneyFromDocument,
  clientStatsFromDocument,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';

/**
 * `clientStats/{uid}` and its admin-only `restricted/money`, read once.
 *
 * `getDoc` goes to the server and falls back to the persistent cache when
 * the network is gone, so a barber offline in the chair still sees the last
 * numbers. Parsing is the port layer's, shared with the writer in functions.
 */
@Injectable()
export class FirestoreClientStatsReader implements ClientStatsReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async get(
    userId: string,
  ): Promise<Result<ClientStatsRecord | null, RepositoryError>> {
    if (userId.trim().length === 0) return ok(null);
    try {
      const snapshot = await getDoc(
        doc(this.db, CLIENT_STATS_COLLECTION, userId),
      );
      return ok(
        snapshot.exists()
          ? clientStatsFromDocument(userId, snapshot.data())
          : null,
      );
    } catch (error) {
      return fail(new RepositoryError('Failed to read client stats', error));
    }
  }

  async getMoney(
    userId: string,
  ): Promise<Result<ClientMoneyRecord | null, RepositoryError>> {
    if (userId.trim().length === 0) return ok(null);
    try {
      const snapshot = await getDoc(
        doc(
          this.db,
          CLIENT_STATS_COLLECTION,
          userId,
          CLIENT_STATS_RESTRICTED_COLLECTION,
          CLIENT_MONEY_DOC,
        ),
      );
      return ok(
        snapshot.exists()
          ? clientMoneyFromDocument(userId, snapshot.data())
          : null,
      );
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read client lifetime spend', error),
      );
    }
  }
}
