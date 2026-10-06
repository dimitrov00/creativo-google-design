import { Injectable, inject } from '@angular/core';
import {
  type DocumentData,
  type QueryDocumentSnapshot,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type BadgeProgress,
  type LedgerEntry,
  type LoyaltyAccount,
  type LoyaltyReader,
  type SeasonProgress,
  badgeProgressFromDocument,
  ledgerEntryFromDocument,
  loyaltyAccountFromDocument,
  seasonProgressFromDocument,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  badgeProgressCollection,
  clientJournalCollection,
  loyaltyAccountDocRef,
  seasonProgressCollection,
} from './firestore-paths';

/**
 * `loyaltyAccounts/{uid}` with its `badgeProgress` and `seasonProgress`,
 * and the client's point rows in `clientJournal` — read once, parsed by the
 * port layer's mappers (the writer in functions and the dev seed share
 * them).
 *
 * `getDoc` / `getDocs` go to the server and fall back to the persistent
 * cache when the network is gone, so a barber offline in the chair still
 * sees the last figures (the `FirestoreClientStatsReader` precedent).
 *
 * The account is one document: if it does not parse, the read fails — the
 * card shows its retry, never figures nobody can vouch for. A list read
 * leaves out the one document that does not parse rather than costing the
 * client the whole list (the history precedent).
 */
@Injectable()
export class FirestoreLoyaltyReader implements LoyaltyReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async getAccount(
    userId: string,
  ): Promise<Result<LoyaltyAccount | null, RepositoryError>> {
    const subject = UserId.create(userId);
    if (subject.isFailure()) return ok(null);
    try {
      const snapshot = await getDoc(
        loyaltyAccountDocRef(this.db, subject.value),
      );
      return snapshot.exists()
        ? loyaltyAccountFromDocument(userId, snapshot.data())
        : ok(null);
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read the loyalty account', error),
      );
    }
  }

  async listBadgeProgress(
    userId: string,
  ): Promise<Result<readonly BadgeProgress[], RepositoryError>> {
    const subject = UserId.create(userId);
    if (subject.isFailure()) return ok([]);
    try {
      const snapshot = await getDocs(
        badgeProgressCollection(this.db, subject.value),
      );
      return ok(parsed(snapshot.docs, badgeProgressFromDocument));
    } catch (error) {
      return fail(new RepositoryError('Failed to read badge progress', error));
    }
  }

  async listSeasonProgress(
    userId: string,
  ): Promise<Result<readonly SeasonProgress[], RepositoryError>> {
    const subject = UserId.create(userId);
    if (subject.isFailure()) return ok([]);
    try {
      const snapshot = await getDocs(
        seasonProgressCollection(this.db, subject.value),
      );
      return ok(parsed(snapshot.docs, seasonProgressFromDocument));
    } catch (error) {
      return fail(new RepositoryError('Failed to read season progress', error));
    }
  }

  /**
   * The newest point rows the client may see. Filtered on `effect.kind` in
   * the query, not afterwards: a client-visible row can also record a
   * medal, a rhythm step, a tier or a reward, and five of those must not
   * crowd the points out of «Движение на точките». The `visibility` filter
   * is also what the rule demands: a query that could return a staff row
   * is refused whole.
   */
  async listLedgerTail(
    userId: string,
    max: number,
  ): Promise<Result<readonly LedgerEntry[], RepositoryError>> {
    const subject = UserId.create(userId);
    if (subject.isFailure() || max < 1) return ok([]);
    try {
      const snapshot = await getDocs(
        query(
          clientJournalCollection(this.db),
          where('userId', '==', subject.value.value),
          where('visibility', '==', 'client'),
          where('effect.kind', '==', 'points'),
          orderBy('seq', 'desc'),
          limit(Math.floor(max)),
        ),
      );
      return ok(parsed(snapshot.docs, ledgerEntryFromDocument));
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read the points ledger', error),
      );
    }
  }
}

/** Every document that parses, in the order read; one that does not is left out. */
function parsed<T>(
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  read: (id: string, data: unknown) => Result<T, RepositoryError>,
): T[] {
  return docs.flatMap((entry) => {
    const result = read(entry.id, entry.data());
    return result.isSuccess() ? [result.value] : [];
  });
}
