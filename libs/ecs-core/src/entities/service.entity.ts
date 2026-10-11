import type { BarberOffering } from '../components/barber-offering.data';
import type { ServiceStatus } from '../components/catalog-status.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { ServiceComposition } from '../components/service-composition.data';
import type {
  ServiceTerms,
  ServiceVariant,
} from '../components/service-terms.data';
import {
  type LocationId,
  type MediaRefId,
  type ServiceCategoryId,
  ServiceId,
} from '../primitives/ids.primitive';

/**
 * The identity slice of a service: the id and the plain attributes.
 *
 * The terms matrix: the service declares `variants` (short vs long hair),
 * each barber who performs it has an `offerings` element (their base terms
 * plus sparse per-variant overrides — here on the service, never on the
 * barber), and resolution falls back down the axes to the service's own
 * `ServiceTerms` fields, the catalogue price before anyone picks a barber,
 * which keeps a service nobody is priced for yet representable. Every price
 * on the matrix shares the service's `currency`
 * (`BarberOffering.mixedCurrency`). Empty `locationIds` means every
 * location; `conflictsWith` names services that cannot be booked beside this
 * one.
 */
export type ServiceMeta = {
  readonly id: ServiceId;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly categoryId: ServiceCategoryId;
  readonly variants: readonly ServiceVariant[];
  readonly offerings: readonly BarberOffering[];
  readonly locationIds: readonly LocationId[];
  readonly conflictsWith: readonly ServiceId[];
  /** Offered only as an add-on to another service, never on its own. */
  readonly upsellOnly: boolean;
  readonly popular: boolean;
  readonly serviceStatus: ServiceStatus;
  readonly sortOrder: number;
};

/**
 * The service's cover — the 1-to-1 `cover: MediaRef | null` flattened by
 * prefix (N9): the seven `MediaRef` fields, ALL `null` together.
 */
export type ServiceCover = {
  readonly coverMediaId: MediaRefId | null;
  readonly coverMediaPath: string | null;
  readonly coverMediaWidth: number | null;
  readonly coverMediaHeight: number | null;
  readonly coverMediaBlurhash: string | null;
  readonly coverMediaFocalX: number | null;
  readonly coverMediaFocalY: number | null;
};

/**
 * A bookable offering — `services/{id}` (`catalog-reader.adapter.ts:104-128`):
 * every 1-to-1 field at the root (Law 6). The five `ServiceTerms` fields sit
 * at the root, which is how the document stores them today (the earlier
 * `baseTerms` wrapper is gone); the composition is the flat
 * `compositionKind` (+ `bundleServiceIds`) slice. The stored body keeps its
 * legacy `status`, `cover` and `composition` until the booking-core flip;
 * the shims convert.
 */
export type Service = ServiceMeta &
  ServiceTerms &
  ServiceComposition &
  ServiceCover;

/**
 * Flatten-pass staging: the barrel's id block still names this module for
 * `ServiceId` until the integrator drops that line — the id itself lives in
 * `primitives/ids.primitive.ts` (§1.5).
 */
