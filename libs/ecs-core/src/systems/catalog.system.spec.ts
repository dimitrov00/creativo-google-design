import { describe, expect, it } from 'vitest';
import type { Service, ServiceCategory } from '@core/entities';
import { ServiceCategoryId, ServiceId } from '@core/primitives';
import { deepFreeze, serviceFixture, textFixture } from '@core/testing';
import { CatalogSystem } from './catalog.system';

/*
 * Which catalogue services a surface lists and how it groups them — the
 * marketing shelf (`LandingContentService.shelfServices`) and the category
 * grouping (the admin rhythm page's services sheet, whose feature spec case
 * is restated below on the same fixture data).
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
function service(
  id: string,
  categoryId: string,
  sortOrder: number,
  upsellOnly = false,
): Service {
  return serviceFixture({
    id: ServiceId.of(id),
    name: textFixture(id),
    description: textFixture(id),
    categoryId: ServiceCategoryId.of(categoryId),
    sortOrder,
    upsellOnly,
  });
}

describe('CatalogSystem.shelf — the marketing shelf', () => {
  it('keeps every service but the upsell-only add-ons, in input order, each as given', () => {
    const cut = service('svc_cut', 'cat_a', 2);
    const wax = service('svc_wax', 'cat_a', 0, true);
    const beard = service('svc_beard', 'cat_b', 1);
    const shelf = CatalogSystem.shelf([cut, wax, beard]);
    expect(shelf).toEqual([cut, beard]);
    expect(shelf[0]).toBe(cut);
  });

  it('shelves nothing from nothing, and nothing from add-ons alone', () => {
    expect(CatalogSystem.shelf([])).toEqual([]);
    expect(CatalogSystem.shelf([service('svc_wax', 'cat_a', 0, true)])).toEqual(
      [],
    );
  });

  it('reads any value carrying `upsellOnly` — a view model passes as well', () => {
    const vms = [
      { id: 'a', upsellOnly: false },
      { id: 'b', upsellOnly: true },
    ];
    expect(CatalogSystem.shelf(vms)).toEqual([{ id: 'a', upsellOnly: false }]);
  });
});

describe('CatalogSystem.byCategory — the category grouping', () => {
  it('groups services under their category, both sorted by sortOrder', () => {
    const categories = [category('cat_b', 1), category('cat_a', 0)];
    const services = [
      service('svc_2', 'cat_a', 1),
      service('svc_1', 'cat_a', 0),
      service('svc_3', 'cat_b', 0),
    ];

    const groups = CatalogSystem.byCategory(categories, services);

    expect(groups.map((g) => g.category.id)).toEqual(['cat_a', 'cat_b']);
    expect(groups[0]?.services.map((s) => s.id)).toEqual(['svc_1', 'svc_2']);
    expect(groups[1]?.services.map((s) => s.id)).toEqual(['svc_3']);
  });

  it('heads an empty group with a category that holds no service, and files an orphan under none', () => {
    const groups = CatalogSystem.byCategory(
      [category('cat_a', 0), category('cat_empty', 1)],
      [service('svc_1', 'cat_a', 0), service('svc_orphan', 'cat_gone', 0)],
    );
    expect(
      groups.map((g) => [g.category.id, g.services.map((s) => s.id)]),
    ).toEqual([
      ['cat_a', ['svc_1']],
      ['cat_empty', []],
    ]);
  });

  it('keeps input order between equal sort orders (stable)', () => {
    const groups = CatalogSystem.byCategory(
      [category('cat_x', 0), category('cat_y', 0)],
      [service('svc_b', 'cat_x', 0), service('svc_a', 'cat_x', 0)],
    );
    expect(groups.map((g) => g.category.id)).toEqual(['cat_x', 'cat_y']);
    expect(groups[0]?.services.map((s) => s.id)).toEqual(['svc_b', 'svc_a']);
  });
});

describe('CatalogSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const categories = deepFreeze([category('cat_b', 1), category('cat_a', 0)]);
    const services = deepFreeze([
      service('svc_2', 'cat_a', 1),
      service('svc_1', 'cat_a', 0, true),
    ]);
    expect(CatalogSystem.byCategory(categories, services)).toEqual(
      CatalogSystem.byCategory(categories, services),
    );
    expect(CatalogSystem.shelf(services)).toEqual(
      CatalogSystem.shelf(services),
    );
    expect(categories.map((c) => c.id)).toEqual(['cat_b', 'cat_a']);
  });
});
