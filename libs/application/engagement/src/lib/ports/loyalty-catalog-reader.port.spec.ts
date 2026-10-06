import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@creativo/application/shared';
import { InMemoryLoyaltyCatalogReader, loyaltyFixtures } from '../../testing';
import { LOYALTY_CATALOG_READER } from './loyalty-catalog-reader.port';

/** The port's reference reader, held to the port's promises. */
describe('LoyaltyCatalogReader — the in-memory reference', () => {
  it('names its token', () => {
    expect(LOYALTY_CATALOG_READER.toString()).toContain('LoyaltyCatalogReader');
  });

  it('reads the fixture catalogue, validated whole', async () => {
    const reader = new InMemoryLoyaltyCatalogReader();
    const catalog = await reader.getCatalog();
    expect(catalog.isSuccess() && catalog.value.families).toHaveLength(42);
    expect(reader.reads).toBe(1);
  });

  it('fails an inconsistent catalogue rather than drawing half of it', async () => {
    const seasons = Object.fromEntries(
      Object.entries(loyaltyFixtures.catalog.seasons).filter(
        ([id]) => id !== 'season-2026-autumn',
      ),
    );
    const reader = new InMemoryLoyaltyCatalogReader({
      ...loyaltyFixtures.catalog,
      seasons,
    });
    const catalog = await reader.getCatalog();
    expect(catalog.isFailure() && catalog.error.message).toContain(
      'engagement.loyalty_catalog.dangling_season',
    );
  });

  it('fails while told to, and reads again once recovered', async () => {
    const reader = new InMemoryLoyaltyCatalogReader().failWith();
    const failed = await reader.getCatalog();
    expect(failed.isFailure() && failed.error).toBeInstanceOf(RepositoryError);
    reader.recover();
    expect((await reader.getCatalog()).isSuccess()).toBe(true);
    expect(reader.reads).toBe(2);
  });
});
