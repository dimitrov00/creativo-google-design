import { Injectable, inject } from '@angular/core';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  normalizeSearchQuery,
  UserSearchPort,
  UserSearchResult,
} from '@creativo/application/governance';
import { RepositoryError } from '@creativo/application/shared';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Email, UserId } from '@creativo/domain/accounts';
import { usersCollection } from './firestore-paths';

const MAX_RESULTS = 20;

function toSearchResult(
  doc: QueryDocumentSnapshot<DocumentData>,
): Result<UserSearchResult, RepositoryError> {
  const data = doc.data();
  const idResult = UserId.create(doc.id);
  if (idResult.isFailure()) {
    return fail(
      new RepositoryError('Malformed user document: bad id', idResult.error),
    );
  }
  // The name AS WRITTEN — `searchName` is the lowercased key the index
  // matches on, and it read «мартин илиев» on the desk's rows (2026-09-18).
  const written = `${data['firstName'] ?? ''} ${data['lastName'] ?? ''}`.trim();
  const displayName: string =
    written.length > 0
      ? written
      : typeof data['searchName'] === 'string'
        ? data['searchName']
        : '';
  const email = data['email'] ? Email.fromPrimitive(data['email']) : null;
  const phone =
    typeof data['phone'] === 'string' && data['phone'].length > 0
      ? data['phone']
      : null;
  return ok({ userId: idResult.value, displayName, email, phone });
}

/** Staff/admin-only free-text lookup (`UserSearchPort`) — backed by the same
 * prefix-search fields `FirestoreProfileAdapter` writes (`searchPrefixes`/
 * `searchName`), matching v2's real `users` composite index precedent. */
@Injectable()
export class FirestoreUserSearchAdapter implements UserSearchPort {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async search(
    rawQuery: string,
  ): Promise<Result<readonly UserSearchResult[], RepositoryError>> {
    const normalized = normalizeSearchQuery(rawQuery);
    if (normalized.length === 0) {
      return ok([]);
    }
    try {
      const snapshot = await getDocs(
        query(
          usersCollection(this.db),
          where('searchPrefixes', 'array-contains', normalized),
          orderBy('searchName'),
          limit(MAX_RESULTS),
        ),
      );
      const results: UserSearchResult[] = [];
      for (const docSnapshot of snapshot.docs) {
        const mapped = toSearchResult(docSnapshot);
        if (mapped.isFailure()) {
          return mapped;
        }
        results.push(mapped.value);
      }
      return ok(results);
    } catch (error) {
      return fail(new RepositoryError('Failed to search users', error));
    }
  }
}
