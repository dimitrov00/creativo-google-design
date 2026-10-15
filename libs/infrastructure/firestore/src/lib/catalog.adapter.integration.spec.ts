import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { firstValueFrom } from 'rxjs';
import { LocationId, ServiceCategoryId } from '@core/primitives';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { catalogReadPorts } from './catalog.adapter';

/** Enough of a stored catalogue body for every query here. */
const service = (
  categoryId: string,
  serviceStatus: string,
  sortOrder: number,
) => ({
  name: { en: 'Haircut', bg: 'Подстригване' },
  categoryId,
  serviceStatus,
  sortOrder,
});

describe('catalogReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const anonymous = () =>
    catalogReadPorts(modularFirestore(testEnv.unauthenticatedContext()));

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-catalog');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      await setDoc(
        doc(db, 'services', 'svc-active-cat1'),
        service('cat-1', 'ACTIVE', 1),
      );
      await setDoc(
        doc(db, 'services', 'svc-active-cat2'),
        service('cat-2', 'ACTIVE', 0),
      );
      await setDoc(
        doc(db, 'services', 'svc-archived'),
        service('cat-1', 'ARCHIVED', 2),
      );
      await setDoc(doc(db, 'serviceCategories', 'cat-2'), { sortOrder: 2 });
      await setDoc(doc(db, 'serviceCategories', 'cat-1'), { sortOrder: 1 });
      await setDoc(doc(db, 'barbers', 'ivan'), {
        locationIds: ['loc-center'],
        barberStatus: 'ACTIVE',
        sortOrder: 1,
      });
      await setDoc(doc(db, 'barbers', 'niko'), {
        locationIds: ['loc-mladost'],
        barberStatus: 'ACTIVE',
        sortOrder: 2,
      });
      await setDoc(doc(db, 'barbers', 'gone'), {
        locationIds: ['loc-center'],
        barberStatus: 'INACTIVE',
        sortOrder: 0,
      });
      await setDoc(doc(db, 'locations', 'loc-center'), {
        locationStatus: 'ACTIVE',
        sortOrder: 1,
      });
      await setDoc(doc(db, 'locations', 'loc-hidden'), {
        locationStatus: 'HIDDEN',
        sortOrder: 0,
      });
    });
  });

  it('lets an anonymous (unauthenticated) visitor read the catalogue, the body as stored', async () => {
    const services = await firstValueFrom(anonymous().observeServices(null));

    expect(services.ok && services.value[0]).toEqual({
      id: 'svc-active-cat2',
      ...service('cat-2', 'ACTIVE', 0),
    });
  });

  it('excludes archived services and filters by category — indexes #1 and #2', async () => {
    const ports = anonymous();

    const everything = await firstValueFrom(ports.observeServices(null));
    const cat1 = await firstValueFrom(
      ports.observeServices(ServiceCategoryId.of('cat-1')),
    );

    expect(everything.ok && everything.value.map((s) => s.id)).toEqual([
      'svc-active-cat2',
      'svc-active-cat1',
    ]);
    expect(cat1.ok && cat1.value.map((s) => s.id)).toEqual(['svc-active-cat1']);
  });

  it('lists the active barbers, of one shop when asked — indexes #3 and #4', async () => {
    const ports = anonymous();

    const everyone = await firstValueFrom(ports.observeBarbers(null));
    const center = await firstValueFrom(
      ports.observeBarbers(LocationId.of('loc-center')),
    );

    expect(everyone.ok && everyone.value.map((b) => b.id)).toEqual([
      'ivan',
      'niko',
    ]);
    expect(center.ok && center.value.map((b) => b.id)).toEqual(['ivan']);
  });

  it('lists the categories by sortOrder and the listed shops only — index #5', async () => {
    const ports = anonymous();

    const categories = await firstValueFrom(ports.observeCategories());
    const shops = await firstValueFrom(ports.observeLocations());

    expect(categories.ok && categories.value.map((c) => c.id)).toEqual([
      'cat-1',
      'cat-2',
    ]);
    expect(shops.ok && shops.value.map((l) => l.id)).toEqual(['loc-center']);
  });

  it('denies writes through the rules (public read, catalogue-manager write only)', async () => {
    const clientDb = modularFirestore(
      testEnv.authenticatedContext('client-1', { roles: ['client'] }),
    );

    await expect(
      setDoc(
        doc(clientDb, 'services', 'svc-hacked'),
        service('cat-1', 'ACTIVE', 9),
      ),
    ).rejects.toBeTruthy();
  });
});
