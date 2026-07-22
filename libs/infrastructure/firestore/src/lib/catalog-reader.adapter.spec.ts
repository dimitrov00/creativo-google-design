import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';

const {
  getDocMock,
  docMock,
  collectionMock,
  onSnapshotMock,
  queryMock,
  whereMock,
  orderByMock,
} = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  docMock: vi.fn((...args: unknown[]) => ({ __ref: args })),
  collectionMock: vi.fn((...args: unknown[]) => ({ __coll: args })),
  onSnapshotMock: vi.fn(),
  queryMock: vi.fn((coll: unknown, ...constraints: unknown[]) => ({
    __query: coll,
    constraints,
  })),
  whereMock: vi.fn((...args: unknown[]) => ({ __where: args })),
  orderByMock: vi.fn((...args: unknown[]) => ({ __orderBy: args })),
}));

vi.mock('firebase/firestore', () => ({
  getDoc: getDocMock,
  doc: docMock,
  collection: collectionMock,
  onSnapshot: onSnapshotMock,
  query: queryMock,
  where: whereMock,
  orderBy: orderByMock,
}));

import { FirestoreCatalogReader } from './catalog-reader.adapter';

function createReader(): FirestoreCatalogReader {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      FirestoreCatalogReader,
    ],
  });
  return TestBed.inject(FirestoreCatalogReader);
}

function validServiceDoc() {
  return {
    name: { en: 'Haircut', bg: 'Подстригване' },
    description: { en: 'A classic haircut', bg: 'Класическо подстригване' },
    categoryId: 'cat-1',
    priceMinorUnits: 2500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    locationIds: [],
    conflictsWith: [],
    offering: { kind: 'single' },
    upsellOnly: false,
    popular: true,
    status: 'active',
    sortOrder: 0,
  };
}

describe('FirestoreCatalogReader', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('findServiceById maps a valid document into a Service', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: 'svc-1',
      data: () => validServiceDoc(),
    });
    const reader = createReader();
    const idResult = ServiceId.create('svc-1');
    if (!idResult.isSuccess()) throw new Error('unreachable');

    const result = await reader.findServiceById(idResult.value);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.name.en).toBe('Haircut');
      expect(result.value?.price.toMinorUnits()).toBe(2500);
    }
  });

  it('findServiceById returns null when the document does not exist', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const reader = createReader();
    const idResult = ServiceId.create('svc-missing');
    if (!idResult.isSuccess()) throw new Error('unreachable');

    const result = await reader.findServiceById(idResult.value);
    expect(result.isSuccess() && result.value === null).toBe(true);
  });

  it('findServiceById surfaces a failure for a malformed document', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: 'svc-bad',
      data: () => ({ name: { en: '', bg: '' } }),
    });
    const reader = createReader();
    const idResult = ServiceId.create('svc-bad');
    if (!idResult.isSuccess()) throw new Error('unreachable');

    const result = await reader.findServiceById(idResult.value);
    expect(result.isFailure()).toBe(true);
  });

  it('listActiveServices(categoryId) filters by category and status, ordered by sortOrder', () => {
    onSnapshotMock.mockImplementation(() => () => undefined);
    const reader = createReader();
    const categoryId = ServiceCategoryId.create('cat-1');
    if (!categoryId.isSuccess()) throw new Error('unreachable');

    reader.listActiveServices(categoryId.value).subscribe();

    expect(whereMock).toHaveBeenCalledWith('categoryId', '==', 'cat-1');
    expect(whereMock).toHaveBeenCalledWith('status', '==', 'active');
    expect(orderByMock).toHaveBeenCalledWith('sortOrder');
  });

  it('listActiveServices() with no category still filters status and orders', () => {
    onSnapshotMock.mockImplementation(() => () => undefined);
    const reader = createReader();

    reader.listActiveServices().subscribe();

    expect(whereMock).toHaveBeenCalledWith('status', '==', 'active');
    expect(whereMock).not.toHaveBeenCalledWith(
      'categoryId',
      '==',
      expect.anything(),
    );
    expect(orderByMock).toHaveBeenCalledWith('sortOrder');
  });

  it('listActiveServices emits mapped services on snapshot', () => {
    let deliver: ((snapshot: unknown) => void) | undefined;
    onSnapshotMock.mockImplementation(
      (_query: unknown, next: (s: unknown) => void) => {
        deliver = next;
        return () => undefined;
      },
    );
    const reader = createReader();

    const emitted: unknown[] = [];
    reader.listActiveServices().subscribe((result) => emitted.push(result));

    deliver?.({
      docs: [{ id: 'svc-1', data: () => validServiceDoc() }],
    });

    expect(emitted).toHaveLength(1);
    const first = emitted[0] as {
      isSuccess: () => boolean;
      value: { name: { en: string } }[];
    };
    expect(first.isSuccess()).toBe(true);
    expect(first.value[0]?.name.en).toBe('Haircut');
  });
});
