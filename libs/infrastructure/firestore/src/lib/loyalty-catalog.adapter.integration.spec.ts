import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { loyaltyCatalogMemo } from '@creativo/infrastructure/firebase-app';
import { EngagementErrorCode, Result } from '@core/primitives';
import { LoyaltyCatalogSystem } from '@core/systems';
import {
  FIXTURE_TODAY,
  loyaltyCatalogFixture,
  loyaltyCatalogJson,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { loyaltyCatalogReadPorts } from './loyalty-catalog.adapter';

/** A fresh session's catalogue read for `context`, on the fixtures' day. */
const portsFor = (context: RulesTestContext) =>
  loyaltyCatalogReadPorts(
    modularFirestore(context),
    loyaltyCatalogMemo(),
    async () => Result.ok(FIXTURE_TODAY),
  );

describe('loyaltyCatalogReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  /** The catalogue as the dev seed writes it under `--catalog-only`: every body as the fixture file holds it. */
  async function seedCatalog(skip: ReadonlySet<string> = new Set()) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      for (const [name, documents] of Object.entries(loyaltyCatalogJson)) {
        for (const [id, body] of Object.entries(documents)) {
          if (!skip.has(id)) await setDoc(doc(db, name, id), body);
        }
      }
    });
  }

  const client = () =>
    portsFor(
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

  it('reads the six collections as stored, for any signed-in person — a catalogue the system takes unmapped', async () => {
    await seedCatalog();

    const catalog = unwrapOk(await client().loadLoyaltyCatalog());
    const valid = unwrapOk(LoyaltyCatalogSystem.validate(catalog));

    expect(catalog).toEqual(loyaltyCatalogFixture());
    expect(valid.categories).toHaveLength(6);
    expect(valid.families).toHaveLength(42);
    expect(valid.seasons).toHaveLength(3);
    expect(valid.tiers.map((tier) => tier.id)).toEqual([
      'bronze',
      'silver',
      'gold',
      'platinum',
    ]);
  });

  it('keeps a good answer for the session, one read shared by callers asking at once', async () => {
    await seedCatalog();
    const ports = client();

    const [first, second] = await Promise.all([
      ports.loadLoyaltyCatalog(),
      ports.loadLoyaltyCatalog(),
    ]);
    const third = await ports.loadLoyaltyCatalog();

    expect(unwrapOk(second)).toBe(unwrapOk(first));
    expect(unwrapOk(third)).toBe(unwrapOk(first));
  });

  it('answers a catalogue that does not hold together as stored: the system refuses it', async () => {
    await seedCatalog(new Set(['series-2026-autumn-beard']));

    const catalog = unwrapOk(await client().loadLoyaltyCatalog());

    expect(
      unwrapErr(LoyaltyCatalogSystem.validate(catalog)).map(
        (fault) => fault.errorCode,
      ),
    ).toContain(EngagementErrorCode.LoyaltyCatalogDanglingSeason);
  });

  it('reads an unpublished catalogue as an empty one', async () => {
    const catalog = unwrapOk(await client().loadLoyaltyCatalog());

    expect(catalog.series).toEqual([]);
    expect(catalog.streaks).toEqual([]);
  });

  it('is refused to an anonymous visitor, and the refusal is not kept', async () => {
    await seedCatalog();
    const anonymous = portsFor(testEnv.unauthenticatedContext());

    expect((await anonymous.loadLoyaltyCatalog()).ok).toBe(false);
    expect((await anonymous.loadLoyaltyCatalog()).ok).toBe(false);
  });
});
