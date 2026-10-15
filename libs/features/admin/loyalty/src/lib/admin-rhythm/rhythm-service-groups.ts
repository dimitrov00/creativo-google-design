import type { Service, ServiceCategory } from '@core/entities';

/**
 * One category of the catalogue with its services — what the services
 * sheet lists under a heading, and what the rule's sentence names its
 * counted services from.
 */
export interface RhythmServiceGroup {
  readonly category: ServiceCategory;
  readonly services: readonly Service[];
}

/**
 * THE CATEGORY GROUPING — a template-layer presenter over the catalogue's
 * two streams (`CATALOG_PORTS.observeCategories` and `.observeServices`):
 * every category in its `sortOrder`, each holding its active services in
 * theirs. A category with no service still heads an empty group (the sheet
 * leaves it out once filtered); a service whose category the catalogue no
 * longer lists is under none.
 */
export function rhythmServiceGroupsOf(
  categories: readonly ServiceCategory[],
  services: readonly Service[],
): readonly RhythmServiceGroup[] {
  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      services: services
        .filter((service) => service.categoryId === category.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}
