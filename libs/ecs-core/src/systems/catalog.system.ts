import type { Service, ServiceCategory } from '@core/entities';

/** What the shelf reads of a service — whether it is an upsell-only add-on. */
export type ShelfService = Pick<Service, 'upsellOnly'>;

/** What the grouping reads of a category — its id and its place. */
export type GroupedCategory = Pick<ServiceCategory, 'id' | 'sortOrder'>;

/** What the grouping reads of a service — its category and its place in it. */
export type GroupedService = Pick<Service, 'categoryId' | 'sortOrder'>;

/** One category of the catalogue with its services, each as given. */
export type CategoryGroup<C, S> = {
  readonly category: C;
  readonly services: readonly S[];
};

function bySortOrder(
  a: { readonly sortOrder: number },
  b: { readonly sortOrder: number },
): number {
  return a.sortOrder - b.sortOrder;
}

/**
 * CatalogSystem — which catalogue services a surface lists, and how it
 * groups them: the marketing shelf (`LandingContentService.shelfServices`)
 * and the category grouping (the admin rhythm page's services sheet). Each
 * service and category is returned as given (Law 3: zero inbound mapping),
 * so a view model carrying the same fields passes as well as the entity.
 */
export const CatalogSystem = {
  /**
   * The marketing shelf — every service but the upsell-only add-ons (they
   * belong to `/book`, not to the shelf), in input order.
   */
  shelf<S extends ShelfService>(services: readonly S[]): readonly S[] {
    const shelf: S[] = [];
    for (let i = 0; i < services.length; i++) {
      const service = services[i] as S;
      if (!service.upsellOnly) shelf.push(service);
    }
    return shelf;
  },

  /**
   * THE CATEGORY GROUPING: every category in its `sortOrder`, each holding
   * the services filed under it in theirs (both sorts stable — ties keep
   * input order). A category with no service still heads an empty group; a
   * service whose category is not listed is under none.
   */
  byCategory<C extends GroupedCategory, S extends GroupedService>(
    categories: readonly C[],
    services: readonly S[],
  ): readonly CategoryGroup<C, S>[] {
    const ordered = [...categories].sort(bySortOrder);
    const groups: CategoryGroup<C, S>[] = [];
    for (let c = 0; c < ordered.length; c++) {
      const category = ordered[c] as C;
      const filed: S[] = [];
      for (let s = 0; s < services.length; s++) {
        const service = services[s] as S;
        if (service.categoryId === category.id) filed.push(service);
      }
      filed.sort(bySortOrder);
      groups.push({ category, services: filed });
    }
    return groups;
  },
} as const;
