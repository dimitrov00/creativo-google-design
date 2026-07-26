import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  Query,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Position, PositionId } from '@creativo/domain/programs';
import { PositionRepository } from '@creativo/application/programs';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { positionDocRef, positionsCollection } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

function toPersistence(position: Position): DocumentData {
  return {
    title: { en: position.title.en, bg: position.title.bg },
    summary: { en: position.summary.en, bg: position.summary.bg },
    locationIds: position.locationIds.map((id) => id.value),
    status: position.status,
    applyUrl: position.applyUrl,
    sortOrder: position.sortOrder,
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<Position, RepositoryError> {
  const title = data['title'] as DocumentData;
  const summary = data['summary'] as DocumentData;
  const reconstituted = Position.reconstitute({
    id,
    title: { en: title['en'], bg: title['bg'] },
    summary: { en: summary['en'], bg: summary['bg'] },
    locationIds: (data['locationIds'] as string[] | undefined) ?? [],
    status: data['status'],
    ...(data['applyUrl'] && { applyUrl: data['applyUrl'] }),
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed position document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

@Injectable()
export class FirestorePositionRepository implements PositionRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async findById(
    id: PositionId,
  ): Promise<Result<Position | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(positionDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch position', error));
    }
  }

  async save(position: Position): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(
        positionDocRef(this.db, position.id),
        toPersistence(position),
      );
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save position', error));
    }
  }

  observeOpen(): Observable<Result<readonly Position[], RepositoryError>> {
    return this.observeQuery(
      query(
        positionsCollection(this.db),
        where('status', '==', 'open'),
        orderBy('sortOrder'),
      ),
    );
  }

  observeAll(): Observable<Result<readonly Position[], RepositoryError>> {
    return this.observeQuery(
      query(positionsCollection(this.db), orderBy('sortOrder')),
    );
  }

  private observeQuery(
    positionsQuery: Query<DocumentData>,
  ): Observable<Result<readonly Position[], RepositoryError>> {
    return subscribeWithRetry<readonly Position[]>((onNext, onError) =>
      onSnapshot(
        positionsQuery,
        (snapshot) => {
          const positions: Position[] = [];
          for (const docSnap of snapshot.docs) {
            const result = toDomain(docSnap.id, docSnap.data());
            if (result.isFailure()) {
              onError(result.error);
              return;
            }
            positions.push(result.value);
          }
          onNext(positions);
        },
        onError,
      ),
    );
  }
}
