import type { BarberOffering } from '../components/barber-offering.data';
import type { ServiceState } from '../components/catalog-status.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { MediaRef } from '../components/media-ref.data';
import type { ServiceComposition } from '../components/service-composition.data';
import type {
  ServiceTerms,
  ServiceVariant,
} from '../components/service-terms.data';
import type { LocationId } from './location.entity';
import type { ServiceCategoryId } from './service-category.entity';

export type ServiceId = string & { readonly __brand: unique symbol };
export const ServiceId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): ServiceId => raw as ServiceId,
} as const;

/**
 * A bookable offering — `services/{id}` (`catalog-reader.adapter.ts:104-128`).
 *
 * The terms matrix: the service declares `variants` (short vs long hair),
 * each barber who performs it has an `offerings` entry (base terms plus
 * sparse per-variant overrides — here on the service, never on the barber),
 * and resolution falls back down the axes to `baseTerms`, the catalogue
 * price before anyone picks a barber, which keeps a service nobody is priced
 * for yet representable. Every price on the matrix shares `baseTerms`'
 * currency (`BarberOffering.mixedCurrency`).
 *
 * **Declared changes** (blueprint §2.6, repeated in §3.1): the five base
 * terms fields, stored flat at the document root today, nest under
 * `baseTerms` (a nested map equals its component type, Law 5); each
 * offering's `byVariant` Record becomes `overrides: readonly VariantTerms[]`.
 * Empty `locationIds` means every location; `conflictsWith` names services
 * that cannot be booked beside this one.
 */
export type ServiceEntity = {
  readonly id: ServiceId;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly categoryId: ServiceCategoryId;
  readonly baseTerms: ServiceTerms;
  readonly variants: readonly ServiceVariant[];
  readonly offerings: readonly BarberOffering[];
  readonly cover: MediaRef | null;
  readonly locationIds: readonly LocationId[];
  readonly conflictsWith: readonly ServiceId[];
  readonly composition: ServiceComposition | null;
  /** Offered only as an add-on to another service, never on its own. */
  readonly upsellOnly: boolean;
  readonly popular: boolean;
  readonly status: ServiceState;
  readonly sortOrder: number;
};
