import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreCatalogReader } from './catalog-reader.adapter';

function readerFor(context: RulesTestContext): FirestoreCatalogReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreCatalogReader,
    ],
  });
  return TestBed.inject(FirestoreCatalogReader);
}

function serviceDoc(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

describe('FirestoreCatalogReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-catalog');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('lets an anonymous (unauthenticated) client read catalog data', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'services', 'svc-1'), serviceDoc());
    });

    const reader = readerFor(testEnv.unauthenticatedContext());

    const idResult = ServiceId.create('svc-1');
    if (!idResult.isSuccess()) throw new Error('unreachable');
    const result = await reader.findServiceById(idResult.value);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.name.en).toBe('Haircut');
    }
  });

  it('excludes archived services and filters by category through listActiveServices', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(
        doc(db, 'services', 'svc-active-cat1'),
        serviceDoc({ categoryId: 'cat-1', sortOrder: 1 }),
      );
      await setDoc(
        doc(db, 'services', 'svc-active-cat2'),
        serviceDoc({ categoryId: 'cat-2', sortOrder: 0 }),
      );
      await setDoc(
        doc(db, 'services', 'svc-archived'),
        serviceDoc({ categoryId: 'cat-1', status: 'archived', sortOrder: 2 }),
      );
    });

    const reader = readerFor(testEnv.unauthenticatedContext());
    const categoryId = ServiceCategoryId.create('cat-1');
    if (!categoryId.isSuccess()) throw new Error('unreachable');

    const emitted = await new Promise<readonly { id: unknown }[]>(
      (resolve, reject) => {
        const subscription = reader
          .listActiveServices(categoryId.value)
          .subscribe((result) => {
            if (result.isFailure()) {
              reject(result.error);
              return;
            }
            subscription.unsubscribe();
            resolve(result.value as never);
          });
      },
    );

    expect(emitted).toHaveLength(1);
  });

  it('denies writes through the rules (public read, staff/content-manager write only)', async () => {
    const clientDb = testEnv
      .authenticatedContext('client-1', { roles: ['client'] })
      .firestore();
    await expect(
      setDoc(doc(clientDb, 'services', 'svc-hacked'), serviceDoc()),
    ).rejects.toBeTruthy();
  });
});
