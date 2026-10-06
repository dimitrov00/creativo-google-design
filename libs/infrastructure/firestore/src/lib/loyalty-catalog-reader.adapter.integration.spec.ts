import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { LOYALTY_CATALOG_COLLECTIONS } from '@creativo/application/engagement';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreLoyaltyCatalogReader } from './loyalty-catalog-reader.adapter';

function readerFor(context: RulesTestContext): FirestoreLoyaltyCatalogReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreLoyaltyCatalogReader,
    ],
  });
  return TestBed.inject(FirestoreLoyaltyCatalogReader);
}

describe('FirestoreLoyaltyCatalogReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  /** The catalogue as the dev seed writes it under `--catalog-only`. */
  async function seedCatalog(skip: ReadonlySet<string> = new Set()) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      const collections = new Map<string, Readonly<Record<string, object>>>(
        Object.entries(loyaltyFixtures.catalog),
      );
      for (const collection of LOYALTY_CATALOG_COLLECTIONS) {
        for (const [id, data] of Object.entries(
          collections.get(collection) ?? {},
        )) {
          if (skip.has(id)) continue;
          await setDoc(doc(db, collection, id), data);
        }
      }
    });
  }

  const client = () =>
    readerFor(
      testEnv.authenticatedContext('dev-client-1', { roles: ['client'] }),
    );

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-loyalty-catalog');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('reads the six collections into one validated catalogue, for any signed-in person', async () => {
    await seedCatalog();
    const result = await client().getCatalog();
    if (result.isFailure()) throw result.error;
    expect(result.value.categories).toHaveLength(6);
    expect(result.value.families).toHaveLength(42);
    expect(result.value.seasons).toHaveLength(3);
    expect(result.value.tiers.map((t) => t.id)).toEqual([
      'bronze',
      'silver',
      'gold',
      'platinum',
    ]);
  });

  it('keeps a good answer for the session, one read shared by callers asking at once', async () => {
    await seedCatalog();
    const reader = client();
    const [first, second] = await Promise.all([
      reader.getCatalog(),
      reader.getCatalog(),
    ]);
    const third = await reader.getCatalog();
    expect(first.isSuccess() && second.isSuccess() && third.isSuccess()).toBe(
      true,
    );
    if (first.isSuccess() && third.isSuccess()) {
      expect(third.value).toBe(first.value);
    }
  });

  it('fails a catalogue that does not hold together, and reads again next time', async () => {
    await seedCatalog(new Set(['series-2026-autumn-beard']));
    const reader = client();
    const broken = await reader.getCatalog();
    expect(broken.isFailure() && broken.error.message).toContain(
      'engagement.loyalty_catalog.dangling_season',
    );
    await seedCatalog();
    expect((await reader.getCatalog()).isSuccess()).toBe(true);
  });

  it('reads an unpublished catalogue as an empty one', async () => {
    const result = await client().getCatalog();
    expect(result.isSuccess() && result.value.families).toEqual([]);
  });

  it('is refused to an anonymous visitor', async () => {
    await seedCatalog();
    const anonymous = readerFor(testEnv.unauthenticatedContext());
    expect((await anonymous.getCatalog()).isFailure()).toBe(true);
  });
});
