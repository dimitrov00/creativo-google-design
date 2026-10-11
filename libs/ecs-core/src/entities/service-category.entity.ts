import type { LocalizedText } from '../components/localized-text.data';
import { ServiceCategoryId } from '../primitives/ids.primitive';

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

/**
 * Flatten-pass staging: the barrel's id block still names this module for
 * `ServiceCategoryId` until the integrator drops that line.
 */
