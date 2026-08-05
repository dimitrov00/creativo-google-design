import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  DocumentData,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { ShopEvent, ShopEventId } from '@creativo/domain/programs';
import { ShopEventRepository } from '@creativo/application/programs';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { eventDocRef, eventsCollection } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/** Matches the scheduling zone used elsewhere for query bounds (`CreateBookingUseCase`) — every shop event is Stara Zagora local time. */
const SCHEDULING_ZONE = 'Europe/Sofia';

function toPersistence(event: ShopEvent): DocumentData {
  return {
    title: { en: event.title.en, bg: event.title.bg },
    description: { en: event.description.en, bg: event.description.bg },
    startDateIso: event.startDate.toISO(),
    timezone: event.startDate.zoneName,
    locationId: event.locationId?.value ?? null,
    applyUrl: event.applyUrl,
    sortOrder: event.sortOrder,
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<ShopEvent, RepositoryError> {
  const title = data['title'] as DocumentData;
  const description = data['description'] as DocumentData;
  const reconstituted = ShopEvent.reconstitute({
    id,
    title: { en: title['en'], bg: title['bg'] },
    description: { en: description['en'], bg: description['bg'] },
    startDateIso: data['startDateIso'],
    timezone: data['timezone'],
    ...(data['locationId'] && { locationId: data['locationId'] }),
    ...(data['applyUrl'] && { applyUrl: data['applyUrl'] }),
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed event document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

@Injectable()
export class FirestoreEventRepository implements ShopEventRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);
  private readonly clock = inject(CLOCK);

  async findById(
    id: ShopEventId,
  ): Promise<Result<ShopEvent | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(eventDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch event', error));
    }
  }

  async save(event: ShopEvent): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(eventDocRef(this.db, event.id), toPersistence(event));
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save event', error));
    }
  }

  observeUpcoming(): Observable<Result<readonly ShopEvent[], RepositoryError>> {
    return this.observeSide('upcoming');
  }

  observePast(): Observable<Result<readonly ShopEvent[], RepositoryError>> {
    return this.observeSide('past');
  }

  private observeSide(
    side: 'upcoming' | 'past',
  ): Observable<Result<readonly ShopEvent[], RepositoryError>> {
    const nowResult = this.clock.now(SCHEDULING_ZONE);
    if (nowResult.isFailure()) {
      return of(
        fail(
          new RepositoryError(
            'Failed to resolve the current time',
            nowResult.error,
          ),
        ),
      );
    }
    const nowIso = nowResult.value.toISO();

    const sideQuery =
      side === 'upcoming'
        ? query(
            eventsCollection(this.db),
            where('startDateIso', '>=', nowIso),
            orderBy('startDateIso', 'asc'),
          )
        : query(
            eventsCollection(this.db),
            where('startDateIso', '<', nowIso),
            orderBy('startDateIso', 'desc'),
            // The Past tab is a highlight reel, not an archive — and it is
            // on a PUBLIC page, so an unbounded listener re-billed every
            // event the shop ever held to every visitor who clicked Past.
            limit(24),
          );

    return subscribeWithRetry<readonly ShopEvent[]>((onNext, onError) =>
      onSnapshot(
        sideQuery,
        (snapshot) => {
          const events: ShopEvent[] = [];
          for (const docSnap of snapshot.docs) {
            const result = toDomain(docSnap.id, docSnap.data());
            if (result.isFailure()) {
              onError(result.error);
              return;
            }
            events.push(result.value);
          }
          onNext(events);
        },
        onError,
      ),
    );
  }
}
