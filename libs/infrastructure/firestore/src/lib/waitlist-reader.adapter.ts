import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { getDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { WaitlistRequest } from '@creativo/domain/scheduling';
import {
  type WaitlistReader,
  waitlistFromDocument,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  waitlistRequestDocRef,
  waitlistRequestsCollection,
} from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * The read half of the waitlist — straight from Firestore under owner-scoped
 * rules, exactly as the port documents: reads and writes have different
 * trust shapes, and only the WRITE needs a callable.
 *
 * `findMine` is what lands the match notification's deep link: the link
 * carries a request id, and rebuilding the flow around it needs the bag and
 * the shop the request froze. A foreign or missing id both come back `null`
 * — the rules deny the former identically to the latter, so the link is not
 * a probe.
 */
@Injectable()
export class FirestoreWaitlistReader implements WaitlistReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  observeMine(
    userId: UserId,
  ): Observable<Result<readonly WaitlistRequest[], RepositoryError>> {
    return subscribeWithRetry<readonly WaitlistRequest[]>((onNext, onError) =>
      onSnapshot(
        query(
          waitlistRequestsCollection(this.db),
          where('ownerUserId', '==', userId.value),
          orderBy('createdAtIso', 'desc'),
        ),
        (snapshot) =>
          onNext(
            snapshot.docs
              .map((doc) => waitlistFromDocument(doc.id, doc.data()))
              .filter(
                (request): request is WaitlistRequest => request !== null,
              ),
          ),
        onError,
      ),
    );
  }

  async findMine(
    requestId: string,
  ): Promise<Result<WaitlistRequest | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(waitlistRequestDocRef(this.db, requestId));
      if (!snapshot.exists()) return ok(null);
      return ok(waitlistFromDocument(snapshot.id, snapshot.data() ?? {}));
    } catch (error) {
      // A rules denial for someone else's id lands here — and answers
      // exactly like a missing doc, by design.
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'permission-denied') return ok(null);
      return fail(
        new RepositoryError('Failed to load waitlist request', error),
      );
    }
  }
}
