import type { LocalizedText } from '../components/localized-text.data';

export type ServiceCategoryId = string & { readonly __brand: unique symbol };
export const ServiceCategoryId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): ServiceCategoryId => raw as ServiceCategoryId,
} as const;

/**
 * A tenant-defined service category — `serviceCategories/{id}`
 * (`catalog-reader.adapter.ts:144-148`). Ordered by `sortOrder` (a
 * non-negative integer); the booking services step groups services by these
 * when configured to. No `status`: none is stored.
 */
export type ServiceCategoryEntity = {
  readonly id: ServiceCategoryId;
  readonly name: LocalizedText;
  readonly sortOrder: number;
};
