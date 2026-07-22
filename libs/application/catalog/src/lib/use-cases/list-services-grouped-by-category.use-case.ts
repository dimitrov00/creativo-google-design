import { Observable, combineLatest, map } from 'rxjs';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Service, ServiceCategory } from '@creativo/domain/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { CatalogReader } from '../ports/catalog-reader.port';

export interface ServiceCategoryGroup {
  readonly category: ServiceCategory;
  readonly services: readonly Service[];
}

/** Groups active services under their category, both sorted by `sortOrder` — the shape a services-picker step actually renders. */
export class ListServicesGroupedByCategoryUseCase {
  constructor(private readonly catalog: CatalogReader) {}

  execute(): Observable<
    Result<readonly ServiceCategoryGroup[], RepositoryError>
  > {
    return combineLatest([
      this.catalog.listServiceCategories(),
      this.catalog.listActiveServices(),
    ]).pipe(
      map(([categoriesResult, servicesResult]) => {
        if (categoriesResult.isFailure()) {
          return fail(categoriesResult.error);
        }
        if (servicesResult.isFailure()) {
          return fail(servicesResult.error);
        }
        const categories = [...categoriesResult.value].sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );
        const groups: ServiceCategoryGroup[] = categories.map((category) => ({
          category,
          services: servicesResult.value
            .filter((service) => service.categoryId.equals(category.id))
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }));
        return ok(groups);
      }),
    );
  }
}
