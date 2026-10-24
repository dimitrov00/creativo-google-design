import { describe, expect, it } from 'vitest';
import type { Service, ServiceCategory } from '@core/entities';
import { ServiceCategoryId, ServiceId } from '@core/primitives';
import { serviceFixture, textFixture } from '@core/testing';
import { CatalogSystem } from '@core/systems';

// The grouping moved whole to `CatalogSystem.byCategory` (pass C, R-19).
const rhythmServiceGroupsOf = CatalogSystem.byCategory;

/*
 * The case of the legacy catalog
 * `list-services-grouped-by-category.use-case.spec.ts` (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), recovered from
 * `e2d7a8f` with the same arrange and assert and re-targeted: the grouping is
 * the template-layer `rhythmServiceGroupsOf` over the flat entities of the
 * catalogue's two streams — no use case, no observable, no `Result`.
 */

/** A category as stored (`serviceCategories/{id}`), the flat entity. */
function category(id: string, sortOrder: number): ServiceCategory {
  return {
    id: ServiceCategoryId.of(id),
    name: textFixture(id),
    sortOrder,
  };
}

/** A catalogue service as stored (`services/{id}`), the flat entity. */
function service(id: string, categoryId: string, sortOrder: number): Service {
  return serviceFixture({
    id: ServiceId.of(id),
    name: textFixture(id),
    description: textFixture(id),
    categoryId: ServiceCategoryId.of(categoryId),
    sortOrder,
  });
}

describe('rhythmServiceGroupsOf', () => {
  it('groups services under their category, both sorted by sortOrder', () => {
    const categories = [category('cat_b', 1), category('cat_a', 0)];
    const services = [
      service('svc_2', 'cat_a', 1),
      service('svc_1', 'cat_a', 0),
      service('svc_3', 'cat_b', 0),
    ];

    const groups = rhythmServiceGroupsOf(categories, services);

    expect(groups.map((g) => g.category.id)).toEqual(['cat_a', 'cat_b']);
    expect(groups[0]?.services.map((s) => s.id)).toEqual(['svc_1', 'svc_2']);
    expect(groups[1]?.services.map((s) => s.id)).toEqual(['svc_3']);
  });
});
