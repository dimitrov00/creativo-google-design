import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Result, ok, fail } from '@creativo/domain/kernel';
import {
  Barber,
  BarberId,
  Location,
  LocationDayHours,
  LocationId,
  MediaRef,
  MediaRefProps,
  Service,
  ServiceCategory,
  ServiceCategoryId,
  ServiceId,
} from '@creativo/domain/catalog';
import { CatalogReader } from '@creativo/application/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  barberDocRef,
  barbersCollection,
  locationDocRef,
  locationsCollection,
  serviceCategoriesCollection,
  serviceDocRef,
  servicesCollection,
} from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

function collectOrFail<T>(
  results: readonly Result<T, RepositoryError>[],
): Result<readonly T[], RepositoryError> {
  const values: T[] = [];
  for (const result of results) {
    if (result.isFailure()) {
      return fail(result.error);
    }
    values.push(result.value);
  }
  return ok(values);
}

// ── shared MediaRef deserialization — used by Service.cover, Barber.avatar, Location.cover/photos ──
// (read-only adapter — no `toPersistence` side; catalog content is authored
// elsewhere, see the port's doc comment)

function mediaRefFromPersistence(
  data: DocumentData,
): Result<MediaRef, RepositoryError> {
  const props: MediaRefProps = {
    id: data['id'],
    path: data['path'],
    width: data['width'],
    height: data['height'],
    blurhash: data['blurhash'] ?? undefined,
    focalPoint: data['focalPoint']
      ? { x: data['focalPoint'].x, y: data['focalPoint'].y }
      : undefined,
  };
  const result = MediaRef.reconstitute(props);
  if (result.isFailure()) {
    return fail(new RepositoryError('Malformed MediaRef', result.error));
  }
  return ok(result.value);
}

function mediaRefListFromPersistence(
  data: unknown[] | undefined,
): Result<MediaRef[], RepositoryError> {
  const refs: MediaRef[] = [];
  for (const entry of data ?? []) {
    const result = mediaRefFromPersistence(entry as DocumentData);
    if (result.isFailure()) {
      return fail(result.error);
    }
    refs.push(result.value);
  }
  return ok(refs);
}

// ── Service ──────────────────────────────────────────────────────────

function serviceFromDoc(
  id: string,
  data: DocumentData,
): Result<Service, RepositoryError> {
  const coverResult: Result<MediaRef | undefined, RepositoryError> = data[
    'cover'
  ]
    ? mediaRefFromPersistence(data['cover'])
    : ok(undefined);
  if (coverResult.isFailure()) {
    return fail(coverResult.error);
  }
  const reconstituted = Service.reconstitute({
    id,
    name: data['name'],
    description: data['description'],
    categoryId: data['categoryId'],
    priceMinorUnits: data['priceMinorUnits'],
    currencyCode: data['currencyCode'],
    durationMinutes: data['durationMinutes'],
    cover: coverResult.value,
    locationIds: data['locationIds'] ?? [],
    conflictsWith: data['conflictsWith'] ?? [],
    offering: data['offering'],
    upsellOnly: data['upsellOnly'],
    popular: data['popular'],
    status: data['status'],
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed service document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

// ── ServiceCategory ──────────────────────────────────────────────────

function serviceCategoryFromDoc(
  id: string,
  data: DocumentData,
): Result<ServiceCategory, RepositoryError> {
  const reconstituted = ServiceCategory.reconstitute({
    id,
    name: data['name'],
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed service category document',
        reconstituted.error,
      ),
    );
  }
  return ok(reconstituted.value);
}

// ── Barber ───────────────────────────────────────────────────────────

function barberFromDoc(
  id: string,
  data: DocumentData,
): Result<Barber, RepositoryError> {
  const avatarResult: Result<MediaRef | undefined, RepositoryError> = data[
    'avatar'
  ]
    ? mediaRefFromPersistence(data['avatar'])
    : ok(undefined);
  if (avatarResult.isFailure()) {
    return fail(avatarResult.error);
  }
  const reconstituted = Barber.reconstitute({
    id,
    name: data['name'],
    handle: data['handle'],
    title: data['title'],
    bio: data['bio'],
    avatar: avatarResult.value,
    yearsExperience: data['yearsExperience'] ?? undefined,
    locationIds: data['locationIds'] ?? [],
    instagramHandle: data['instagramHandle'] ?? undefined,
    status: data['status'],
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed barber document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

// ── Location ─────────────────────────────────────────────────────────

function locationFromDoc(
  id: string,
  data: DocumentData,
): Result<Location, RepositoryError> {
  const coverResult: Result<MediaRef | undefined, RepositoryError> = data[
    'cover'
  ]
    ? mediaRefFromPersistence(data['cover'])
    : ok(undefined);
  if (coverResult.isFailure()) {
    return fail(coverResult.error);
  }
  const photosResult = mediaRefListFromPersistence(data['photos']);
  if (photosResult.isFailure()) {
    return fail(photosResult.error);
  }
  const reconstituted = Location.reconstitute({
    id,
    name: data['name'],
    address: data['address'],
    phone: data['phone'],
    geo: data['geo'],
    mapUrl: data['mapUrl'] ?? undefined,
    cover: coverResult.value,
    photos: photosResult.value,
    hours: (data['hours'] ?? []) as LocationDayHours[],
    timezone: data['timezone'],
    status: data['status'],
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed location document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

/**
 * Read-only Firestore adapter for the catalog bounded context. There is no
 * write path here by design (`CatalogReader` port) — catalog content is
 * authored/managed elsewhere (an admin tool, Phase 6/staff scope); this
 * adapter only ever reads `services`/`serviceCategories`/`barbers`/
 * `locations`, all of which are public-read per `firestore.rules`.
 */
@Injectable()
export class FirestoreCatalogReader implements CatalogReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  listActiveServices(
    categoryId?: ServiceCategoryId,
  ): Observable<Result<readonly Service[], RepositoryError>> {
    const constraints = categoryId
      ? [
          where('categoryId', '==', categoryId.value),
          where('status', '==', 'active'),
          orderBy('sortOrder'),
        ]
      : [where('status', '==', 'active'), orderBy('sortOrder')];
    const servicesQuery = query(servicesCollection(this.db), ...constraints);

    return subscribeWithRetry<readonly Service[]>((onNext, onError) =>
      onSnapshot(
        servicesQuery,
        (snapshot) => {
          const collected = collectOrFail(
            snapshot.docs.map((d) => serviceFromDoc(d.id, d.data())),
          );
          if (collected.isFailure()) {
            onError(collected.error);
            return;
          }
          onNext(collected.value);
        },
        onError,
      ),
    );
  }

  async findServiceById(
    id: ServiceId,
  ): Promise<Result<Service | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(serviceDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return serviceFromDoc(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch service', error));
    }
  }

  listServiceCategories(): Observable<
    Result<readonly ServiceCategory[], RepositoryError>
  > {
    const categoriesQuery = query(
      serviceCategoriesCollection(this.db),
      orderBy('sortOrder'),
    );

    return subscribeWithRetry<readonly ServiceCategory[]>((onNext, onError) =>
      onSnapshot(
        categoriesQuery,
        (snapshot) => {
          const collected = collectOrFail(
            snapshot.docs.map((d) => serviceCategoryFromDoc(d.id, d.data())),
          );
          if (collected.isFailure()) {
            onError(collected.error);
            return;
          }
          onNext(collected.value);
        },
        onError,
      ),
    );
  }

  listActiveBarbers(
    locationId?: LocationId,
  ): Observable<Result<readonly Barber[], RepositoryError>> {
    const constraints = locationId
      ? [
          where('locationIds', 'array-contains', locationId.value),
          where('status', '==', 'active'),
          orderBy('sortOrder'),
        ]
      : [where('status', '==', 'active'), orderBy('sortOrder')];
    const barbersQuery = query(barbersCollection(this.db), ...constraints);

    return subscribeWithRetry<readonly Barber[]>((onNext, onError) =>
      onSnapshot(
        barbersQuery,
        (snapshot) => {
          const collected = collectOrFail(
            snapshot.docs.map((d) => barberFromDoc(d.id, d.data())),
          );
          if (collected.isFailure()) {
            onError(collected.error);
            return;
          }
          onNext(collected.value);
        },
        onError,
      ),
    );
  }

  async findBarberById(
    id: BarberId,
  ): Promise<Result<Barber | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(barberDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return barberFromDoc(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch barber', error));
    }
  }

  listActiveLocations(): Observable<
    Result<readonly Location[], RepositoryError>
  > {
    const locationsQuery = query(
      locationsCollection(this.db),
      where('status', '==', 'active'),
      orderBy('sortOrder'),
    );

    return subscribeWithRetry<readonly Location[]>((onNext, onError) =>
      onSnapshot(
        locationsQuery,
        (snapshot) => {
          const collected = collectOrFail(
            snapshot.docs.map((d) => locationFromDoc(d.id, d.data())),
          );
          if (collected.isFailure()) {
            onError(collected.error);
            return;
          }
          onNext(collected.value);
        },
        onError,
      ),
    );
  }

  async findLocationById(
    id: LocationId,
  ): Promise<Result<Location | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(locationDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return locationFromDoc(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch location', error));
    }
  }
}
