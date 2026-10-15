import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { BarberStatus, LocationStatus, ServiceStatus } from '@core/components';
import {
  BarberId,
  LocationId,
  RepositoryError,
  ServiceId,
} from '@core/primitives';
import { Collections } from '@core/entities';
import {
  barberFixture,
  FIXTURE_IDS,
  locationFixture,
  serviceFixture,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreCatalogPorts } from './firestore-catalog.adapter';

/*
 * The catalogue's server reads, over the in-memory Admin SDK: bodies spread
 * as stored (the document IS the entity minus `id`), positions preserved, an
 * id that could not name a document never read, the listed catalogue on the
 * root status keys, and a failure answered as a value.
 */

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const RETIRED = ServiceId.of('svc-retired');
const HIDDEN = LocationId.of('loc-hidden');
const NIKO = BarberId.of('b-niko');

function seeded() {
  return createProjectionFirestore({
    [`${Collections.Services}/${FIXTURE_IDS.service}`]:
      bodyOf(serviceFixture()),
    [`${Collections.Services}/${RETIRED}`]: bodyOf(
      serviceFixture({ id: RETIRED, serviceStatus: ServiceStatus.Archived }),
    ),
    [`${Collections.Locations}/${FIXTURE_IDS.location}`]:
      bodyOf(locationFixture()),
    [`${Collections.Locations}/${HIDDEN}`]: bodyOf(
      locationFixture({ id: HIDDEN, locationStatus: LocationStatus.Hidden }),
    ),
    [`${Collections.Barbers}/${FIXTURE_IDS.barber}`]: bodyOf(barberFixture()),
    [`${Collections.Barbers}/${NIKO}`]: bodyOf(
      barberFixture({ id: NIKO, barberStatus: BarberStatus.Inactive }),
    ),
  });
}

describe('firestoreCatalogPorts.loadCatalog', () => {
  it('reads the named services in ONE getAll, positions preserved, and the named shop — as stored', async () => {
    const fake = seeded();
    const getAll = vi.spyOn(fake.db, 'getAll');
    const ports = firestoreCatalogPorts(fake.db as unknown as Firestore);
    const answer = await ports.loadCatalog(
      [FIXTURE_IDS.service, ServiceId.of('svc-nope'), RETIRED],
      FIXTURE_IDS.location,
    );
    expect(answer).toEqual({
      ok: true,
      value: {
        services: [
          serviceFixture(),
          null,
          serviceFixture({
            id: RETIRED,
            serviceStatus: ServiceStatus.Archived,
          }),
        ],
        location: locationFixture(),
      },
    });
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('reads a hidden shop as there, but not active — and a shop that is not there as nothing', async () => {
    const ports = firestoreCatalogPorts(seeded().db as unknown as Firestore);
    const hidden = await ports.loadCatalog([], HIDDEN);
    expect(hidden.ok && hidden.value.location).toEqual(
      locationFixture({ id: HIDDEN, locationStatus: LocationStatus.Hidden }),
    );
    const nowhere = await ports.loadCatalog([], LocationId.of('loc-nowhere'));
    expect(nowhere).toEqual({
      ok: true,
      value: { services: [], location: null },
    });
  });

  it('never reads an id that could not name a document, and answers it absent', async () => {
    const fake = seeded();
    const getAll = vi.spyOn(fake.db, 'getAll');
    const ports = firestoreCatalogPorts(fake.db as unknown as Firestore);
    const answer = await ports.loadCatalog(
      [ServiceId.of('__reserved__'), FIXTURE_IDS.service],
      LocationId.of('..'),
    );
    expect(answer.ok && answer.value.services).toEqual([
      null,
      serviceFixture(),
    ]);
    expect(answer.ok && answer.value.location).toBeNull();
    expect(getAll.mock.calls[0]).toHaveLength(1);
  });

  it('reads nothing when nothing is named', async () => {
    const fake = seeded();
    const getAll = vi.spyOn(fake.db, 'getAll');
    const collection = vi.spyOn(fake.db, 'collection');
    const ports = firestoreCatalogPorts(fake.db as unknown as Firestore);
    expect(await ports.loadCatalog([], null)).toEqual({
      ok: true,
      value: { services: [], location: null },
    });
    expect(getAll).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'getAll').mockRejectedValue(
      Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
    );
    const ports = firestoreCatalogPorts(fake.db as unknown as Firestore);
    expect(await ports.loadCatalog([FIXTURE_IDS.service], null)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(Collections.Services, 'unavailable'),
    });
  });
});

describe('firestoreCatalogPorts.loadListedCatalog', () => {
  it('reads every ACTIVE service, shop and barber on the root status keys', async () => {
    const ports = firestoreCatalogPorts(seeded().db as unknown as Firestore);
    expect(await ports.loadListedCatalog()).toEqual({
      ok: true,
      value: {
        services: [serviceFixture()],
        locations: [locationFixture()],
        barbers: [barberFixture()],
      },
    });
  });

  it('answers a query that throws as a value', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
    });
    const ports = firestoreCatalogPorts(fake.db as unknown as Firestore);
    const answer = await ports.loadListedCatalog();
    expect(answer).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.Services,
        'permission-denied',
      ),
    });
  });
});
