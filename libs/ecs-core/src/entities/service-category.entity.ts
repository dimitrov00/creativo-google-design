import type { LocalizedText } from '@core/components';
import { ServiceCategoryId } from '@core/primitives';

/**
 * A tenant-defined service category — `serviceCategories/{id}`
 * (`catalog-reader.adapter.ts:144-148`). Ordered by `sortOrder` (a
 * non-negative integer); the booking services step groups services by these
 * when configured to. No status: none is stored.
 */
export type ServiceCategory = {
  readonly id: ServiceCategoryId;
  readonly name: LocalizedText;
  readonly sortOrder: number;
};
