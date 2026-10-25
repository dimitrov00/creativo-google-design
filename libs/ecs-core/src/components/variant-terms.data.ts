import type { ServiceVariantId } from '@core/primitives';
import type { ServiceTerms } from './service-terms.data';
import type { ServiceTermsInput } from './service-terms-input.data';

/**
 * One per-variant override of a barber's terms — an element of
 * `BarberOffering.overrides`, the array that replaces the legacy
 * `byVariant: Record<variantId, terms>` (blueprint §2.6: a map keyed by ids
 * is a distinct indexed field path per key). Flat (Law 6): the variant's id
 * beside the five `ServiceTerms` fields. Split out of
 * `barber-offering.data.ts` (pass D, D-7: the seed reads it).
 */
export type VariantTerms = {
  readonly variantId: ServiceVariantId;
} & ServiceTerms;

export namespace VariantTerms {
  /** An override as authored, before its edge guard. */
  export type Input = {
    readonly variantId: string;
  } & ServiceTermsInput;
}
