import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  LocationId,
  RepositoryError,
  RepositoryErrorCode,
  Result,
  ServiceCategoryId,
} from '@core/primitives';
import { locationFixture } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { catalogReadPorts, locationLoadPorts } =
  await import('./catalog.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

const idsOf = (answer: Result<readonly { readonly id: string }[], unknown>) =>
  answer.ok ? answer.value.map((entity) => entity.id) : answer;

const catalog = () =>
  new FakeFirestore({
    'services/fade': {
      categoryId: 'hair',
      serviceStatus: 'ACTIVE',
      sortOrder: 2,
    },
    'services/classic': {
      categoryId: 'hair',
      serviceStatus: 'ACTIVE',
      sortOrder: 1,
    },
    'services/shave': {
      categoryId: 'beard',
      serviceStatus: 'ACTIVE',
      sortOrder: 3,
    },
    'services/retired': {
      categoryId: 'hair',
      serviceStatus: 'ARCHIVED',
      sortOrder: 0,
    },
    'serviceCategories/beard': { sortOrder: 2 },
    'serviceCategories/hair': { sortOrder: 1 },
    'barbers/ivan': {
      locationIds: ['loc-center'],
      barberStatus: 'ACTIVE',
      sortOrder: 1,
    },
    'barbers/niko': {
      locationIds: ['loc-mladost'],
      barberStatus: 'ACTIVE',
      sortOrder: 2,
    },
    'barbers/gone': {
      locationIds: ['loc-center'],
      barberStatus: 'INACTIVE',
      sortOrder: 0,
    },
    'locations/loc-mladost': { locationStatus: 'ACTIVE', sortOrder: 2 },
    'locations/loc-center': { locationStatus: 'ACTIVE', sortOrder: 1 },
    'locations/loc-hidden': { locationStatus: 'HIDDEN', sortOrder: 0 },
  });

describe('catalogReadPorts — what /book may list, live', () => {
  it('lists every ACTIVE service by sortOrder — index #2', () => {
    const fake = catalog();

    const services = recorded(
      catalogReadPorts(asDb(fake)).observeServices(null),
    );

    expect(services.seen.map(idsOf)).toEqual([['classic', 'fade', 'shave']]);
    expect(fake.reads[0]?.constraints).toEqual([
      'serviceStatus == "ACTIVE"',
      'orderBy sortOrder asc',
    ]);
  });

  it('narrows the services to one category — index #1, the archived one left out', () => {
    const fake = catalog();

    const services = recorded(
      catalogReadPorts(asDb(fake)).observeServices(
        ServiceCategoryId.of('hair'),
      ),
    );

    expect(services.seen.map(idsOf)).toEqual([['classic', 'fade']]);
    expect(fake.reads[0]?.constraints).toEqual([
      'categoryId == "hair"',
      'serviceStatus == "ACTIVE"',
      'orderBy sortOrder asc',
    ]);
  });

  it('answers a service as its whole stored body beside its id', () => {
    const services = recorded(
      catalogReadPorts(asDb(catalog())).observeServices(
        ServiceCategoryId.of('beard'),
      ),
    );

    expect(services.seen).toEqual([
      Result.ok([
        {
          id: 'shave',
          categoryId: 'beard',
          serviceStatus: 'ACTIVE',
          sortOrder: 3,
        },
      ]),
    ]);
  });

  it('lists the ACTIVE barbers, of one shop when asked — indexes #3 and #4', () => {
    const fake = catalog();
    const ports = catalogReadPorts(asDb(fake));

    const everyone = recorded(ports.observeBarbers(null));
    const center = recorded(ports.observeBarbers(LocationId.of('loc-center')));

    expect(everyone.seen.map(idsOf)).toEqual([['ivan', 'niko']]);
    expect(center.seen.map(idsOf)).toEqual([['ivan']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      ['barberStatus == "ACTIVE"', 'orderBy sortOrder asc'],
      [
        'locationIds array-contains "loc-center"',
        'barberStatus == "ACTIVE"',
        'orderBy sortOrder asc',
      ],
    ]);
  });

  it('lists the categories by sortOrder, and the ACTIVE shops — index #5, the hidden one left out', () => {
    const fake = catalog();
    const ports = catalogReadPorts(asDb(fake));

    const categories = recorded(ports.observeCategories());
    const shops = recorded(ports.observeLocations());

    expect(categories.seen.map(idsOf)).toEqual([['hair', 'beard']]);
    expect(shops.seen.map(idsOf)).toEqual([['loc-center', 'loc-mladost']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      ['orderBy sortOrder asc'],
      ['locationStatus == "ACTIVE"', 'orderBy sortOrder asc'],
    ]);
  });

  it('follows the catalogue: a shop listed after the first snapshot joins the list', () => {
    const fake = catalog();
    const shops = recorded(catalogReadPorts(asDb(fake)).observeLocations());

    fake.set('locations/loc-hidden', {
      locationStatus: 'ACTIVE',
      sortOrder: 0,
    });

    expect(shops.seen.map(idsOf)).toEqual([
      ['loc-center', 'loc-mladost'],
      ['loc-hidden', 'loc-center', 'loc-mladost'],
    ]);
  });

  it('answers a refused listen as the port’s RepositoryError', () => {
    const fake = catalog().failWith({ code: 'unavailable-forever' });

    const services = recorded(
      catalogReadPorts(asDb(fake)).observeServices(null),
    );

    expect(services.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'services',
        reason: 'unavailable-forever',
      }),
    ]);
  });
});

describe('locationLoadPorts — one shop by id, once (an event save’s zone)', () => {
  it('loads a shop as its whole stored body beside its id, in one document read', async () => {
    const shop = locationFixture({ id: LocationId.of('loc-center') });
    const { id, ...body } = shop;
    const fake = new FakeFirestore({ [`locations/${id}`]: body });

    const loaded = await locationLoadPorts(asDb(fake)).loadLocation(id);

    expect(loaded).toEqual(Result.ok(shop));
    expect(fake.reads).toEqual([
      { kind: 'document', path: 'locations/loc-center', constraints: [] },
    ]);
  });

  it('loads a hidden shop too — a shop’s clock does not depend on its listing', async () => {
    const fake = catalog();

    const loaded = await locationLoadPorts(asDb(fake)).loadLocation(
      LocationId.of('loc-hidden'),
    );

    expect(loaded).toEqual(
      Result.ok({
        id: 'loc-hidden',
        locationStatus: 'HIDDEN',
        sortOrder: 0,
      }),
    );
  });

  it('answers null for an id that names no shop', async () => {
    const loaded = await locationLoadPorts(asDb(catalog())).loadLocation(
      LocationId.of('loc-nowhere'),
    );

    expect(loaded).toEqual(Result.ok(null));
  });

  it('answers a failed read as the port’s RepositoryError, naming the document', async () => {
    const fake = catalog().failWith({ code: 'unavailable' });

    const loaded = await locationLoadPorts(asDb(fake)).loadLocation(
      LocationId.of('loc-center'),
    );

    expect(loaded).toEqual(
      Result.err(
        RepositoryError.readFailed('locations/loc-center', 'unavailable'),
      ),
    );
  });
});
