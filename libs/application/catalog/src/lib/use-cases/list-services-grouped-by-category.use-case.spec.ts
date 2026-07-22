import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { Result, ok } from '@creativo/domain/kernel';
import { Service, ServiceCategory } from '@creativo/domain/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { CatalogReader } from '../ports/catalog-reader.port';
import { ListServicesGroupedByCategoryUseCase } from './list-services-grouped-by-category.use-case';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function category(id: string, sortOrder: number): ServiceCategory {
  return requiredValue(
    ServiceCategory.create({ id, name: { en: id, bg: id }, sortOrder }),
  );
}

function service(id: string, categoryId: string, sortOrder: number): Service {
  return requiredValue(
    Service.create({
      id,
      name: { en: id, bg: id },
      description: { en: id, bg: id },
      categoryId,
      priceMinorUnits: 1000,
      currencyCode: 'EUR',
      durationMinutes: 30,
      locationIds: [],
      conflictsWith: [],
      offering: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder,
    }),
  );
}

function fakeCatalog(
  categories: readonly ServiceCategory[],
  services: readonly Service[],
): CatalogReader {
  return {
    listActiveServices: () =>
      of(ok(services) as Result<readonly Service[], RepositoryError>),
    findServiceById: () => {
      throw new Error('not used in this spec');
    },
    listServiceCategories: () =>
      of(ok(categories) as Result<readonly ServiceCategory[], RepositoryError>),
    listActiveBarbers: () => {
      throw new Error('not used in this spec');
    },
    findBarberById: () => {
      throw new Error('not used in this spec');
    },
    listActiveLocations: () => {
      throw new Error('not used in this spec');
    },
    findLocationById: () => {
      throw new Error('not used in this spec');
    },
  };
}

describe('ListServicesGroupedByCategoryUseCase', () => {
  it('groups services under their category, both sorted by sortOrder', async () => {
    const categories = [category('cat_b', 1), category('cat_a', 0)];
    const services = [
      service('svc_2', 'cat_a', 1),
      service('svc_1', 'cat_a', 0),
      service('svc_3', 'cat_b', 0),
    ];
    const useCase = new ListServicesGroupedByCategoryUseCase(
      fakeCatalog(categories, services),
    );

    const result = await firstValueFrom(useCase.execute());

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      const groups = result.value;
      expect(groups.map((g) => g.category.id.value)).toEqual([
        'cat_a',
        'cat_b',
      ]);
      expect(groups[0]?.services.map((s) => s.id.value)).toEqual([
        'svc_1',
        'svc_2',
      ]);
      expect(groups[1]?.services.map((s) => s.id.value)).toEqual(['svc_3']);
    }
  });
});
