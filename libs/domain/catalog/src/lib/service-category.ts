import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { ServiceCategoryId } from './ids';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import {
  InvalidServiceCategorySortOrderError,
  ServiceCategoryValidationError,
} from './service-category.errors';

export interface ServiceCategoryProps {
  id: string;
  name: LocalizedTextProps;
  sortOrder: number;
}

/**
 * Tenant-defined category — an entry in the catalog category registry, not
 * an aggregate. Ordered; the booking services step groups services by
 * these when configured to.
 */
export class ServiceCategory {
  private constructor(
    readonly id: ServiceCategoryId,
    readonly name: LocalizedText,
    readonly sortOrder: number,
  ) {}

  static create(
    props: ServiceCategoryProps,
  ): Result<ServiceCategory, ServiceCategoryValidationError[]> {
    return ServiceCategory.build(props);
  }

  static reconstitute(
    props: ServiceCategoryProps,
  ): Result<ServiceCategory, ServiceCategoryValidationError[]> {
    return ServiceCategory.build(props);
  }

  private static build(
    props: ServiceCategoryProps,
  ): Result<ServiceCategory, ServiceCategoryValidationError[]> {
    const idResult = ServiceCategoryId.create(props.id);
    const sortOrderResult = ServiceCategory.validateSortOrder(props.sortOrder);

    const combined = combineAll([idResult, sortOrderResult] as const);
    const errors: ServiceCategoryValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const nameResult = LocalizedText.create(props.name);
    if (nameResult.isFailure()) {
      errors.push(...nameResult.error);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (combined.isFailure() || nameResult.isFailure()) {
      // Unreachable given the check above — narrows both Results to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, sortOrder] = combined.value;
    return ok(new ServiceCategory(id, nameResult.value, sortOrder));
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidServiceCategorySortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidServiceCategorySortOrderError(raw));
  }
}
