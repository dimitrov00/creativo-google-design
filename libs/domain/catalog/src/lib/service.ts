import {
  Money,
  Result,
  combine,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import {
  BarberId,
  LocationId,
  ServiceCategoryId,
  ServiceId,
  ServiceVariantId,
} from './ids';
import { locationScopeServes } from './location';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import { MediaRef } from './media-ref';
import {
  BarberOffering,
  BarberOfferingProps,
  ServiceTerms,
  ServiceVariant,
  ServiceVariantProps,
} from './service-terms';
import {
  DuplicateBarberOfferingError,
  DuplicateServiceVariantError,
  EmptyBundleIncludesError,
  InvalidServiceDurationError,
  InvalidServiceSortOrderError,
  MixedCurrencyTermsError,
  ServiceValidationError,
} from './service.errors';

export type ServiceStatus = 'active' | 'archived';

/**
 * Discriminated `single | bundle` so "bundle without parts" is
 * unrepresentable (ports v2's `Service.kind`/`includes` split — `includes`
 * only exists as a field on the `bundle` variant).
 *
 * Named *composition* rather than v2's "offering": on this aggregate
 * `offerings` means the per-barber pricing matrix below, and one word
 * cannot mean both what a service is made of and who sells it.
 */
export type ServiceComposition =
  | { readonly kind: 'single' }
  | { readonly kind: 'bundle'; readonly includes: readonly ServiceId[] };

export type ServiceCompositionProps =
  | { readonly kind: 'single' }
  | { readonly kind: 'bundle'; readonly includes: readonly string[] };

export interface ServiceProps {
  id: string;
  name: LocalizedTextProps;
  description: LocalizedTextProps;
  categoryId: string;
  /** Base terms — what the service costs before a specific barber or variant narrows it. */
  priceMinorUnits: number;
  currencyCode: string;
  durationMinutes: number;
  /** Choices within the service that can move its terms. Empty ⇒ no variant step when booking. */
  variants?: readonly ServiceVariantProps[];
  /** Who performs it and on what terms. Empty ⇒ nobody is priced yet; `baseTerms` is all there is. */
  offerings?: readonly BarberOfferingProps[];
  cover?: MediaRef;
  locationIds: readonly string[];
  conflictsWith: readonly string[];
  composition: ServiceCompositionProps;
  upsellOnly: boolean;
  popular: boolean;
  status: ServiceStatus;
  sortOrder: number;
}

/**
 * **Aggregate root** for a bookable offering.
 *
 * Carries v2's full terms matrix: a service declares `variants` (short vs
 * long hair), barbers declare `offerings` (base terms plus sparse
 * per-variant overrides), and `termsFor(barber, variant)` resolves the two
 * axes to exactly one `ServiceTerms`. `priceRange`/`durationRange` fold
 * the matrix for the catalog's "from 13,00 €" copy.
 *
 * `baseTerms` is NOT redundant with the matrix: it is the catalog price
 * before anyone picks a barber, and it keeps a service that nobody is
 * priced for yet (new service, barber offboarded) representable and
 * displayable instead of a hole. Offerings narrow it; they do not replace
 * it.
 *
 * Every price on the aggregate shares one currency — enforced at build so
 * `priceRange` can compare minor units without a currency dance, and
 * because a service quoted in two currencies is a data error, not a
 * feature.
 */
export class Service {
  private constructor(
    readonly id: ServiceId,
    readonly name: LocalizedText,
    readonly description: LocalizedText,
    readonly categoryId: ServiceCategoryId,
    readonly baseTerms: ServiceTerms,
    readonly variants: readonly ServiceVariant[],
    readonly offerings: readonly BarberOffering[],
    readonly cover: MediaRef | null,
    readonly locationIds: readonly LocationId[],
    readonly conflictsWith: readonly ServiceId[],
    readonly composition: ServiceComposition,
    readonly upsellOnly: boolean,
    readonly popular: boolean,
    readonly status: ServiceStatus,
    readonly sortOrder: number,
  ) {}

  static create(
    props: ServiceProps,
  ): Result<Service, ServiceValidationError[]> {
    return Service.build(props);
  }

  static reconstitute(
    props: ServiceProps,
  ): Result<Service, ServiceValidationError[]> {
    return Service.build(props);
  }

  private static build(
    props: ServiceProps,
  ): Result<Service, ServiceValidationError[]> {
    const idResult = ServiceId.create(props.id);
    const categoryIdResult = ServiceCategoryId.create(props.categoryId);
    const priceResult = Money.fromMinorUnitsAndCode(
      props.priceMinorUnits,
      props.currencyCode,
    );
    const durationResult = Service.validateDuration(props.durationMinutes);
    const sortOrderResult = Service.validateSortOrder(props.sortOrder);

    const combined = combineAll([
      idResult,
      categoryIdResult,
      priceResult,
      durationResult,
      sortOrderResult,
    ] as const);
    const errors: ServiceValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const nameResult = LocalizedText.create(props.name);
    if (nameResult.isFailure()) {
      errors.push(...nameResult.error);
    }
    const descriptionResult = LocalizedText.create(props.description);
    if (descriptionResult.isFailure()) {
      errors.push(...descriptionResult.error);
    }
    const locationIdsResult = combine(
      props.locationIds.map((raw) => LocationId.create(raw)),
    );
    if (locationIdsResult.isFailure()) {
      errors.push(...locationIdsResult.error);
    }
    const conflictsWithResult = combine(
      props.conflictsWith.map((raw) => ServiceId.create(raw)),
    );
    if (conflictsWithResult.isFailure()) {
      errors.push(...conflictsWithResult.error);
    }
    const compositionResult = Service.validateComposition(props.composition);
    if (compositionResult.isFailure()) {
      errors.push(...compositionResult.error);
    }

    const variantsResult = Service.buildVariants(props.variants ?? []);
    if (variantsResult.isFailure()) {
      errors.push(...variantsResult.error);
    }
    // Offerings validate their variant references against the declared
    // set, so they can only be built once variants are known-good.
    const variants = variantsResult.isSuccess() ? variantsResult.value : [];
    const offeringsResult = Service.buildOfferings(
      props.offerings ?? [],
      variants,
    );
    if (offeringsResult.isFailure()) {
      errors.push(...offeringsResult.error);
    }

    const baseTerms =
      priceResult.isSuccess() && durationResult.isSuccess()
        ? ServiceTerms.create(priceResult.value, durationResult.value)
        : null;
    if (baseTerms?.isFailure()) {
      errors.push(baseTerms.error);
    }
    if (
      baseTerms?.isSuccess() &&
      offeringsResult.isSuccess() &&
      errors.length === 0
    ) {
      const currencyError = Service.validateOneCurrency(
        baseTerms.value,
        offeringsResult.value,
      );
      if (currencyError) errors.push(currencyError);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      nameResult.isFailure() ||
      descriptionResult.isFailure() ||
      locationIdsResult.isFailure() ||
      conflictsWithResult.isFailure() ||
      compositionResult.isFailure() ||
      variantsResult.isFailure() ||
      offeringsResult.isFailure() ||
      !baseTerms ||
      baseTerms.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, categoryId, , , sortOrder] = combined.value;

    return ok(
      new Service(
        id,
        nameResult.value,
        descriptionResult.value,
        categoryId,
        baseTerms.value,
        variantsResult.value,
        offeringsResult.value,
        props.cover ?? null,
        locationIdsResult.value,
        conflictsWithResult.value,
        compositionResult.value,
        props.upsellOnly,
        props.popular,
        props.status,
        sortOrder,
      ),
    );
  }

  private static buildVariants(
    raw: readonly ServiceVariantProps[],
  ): Result<readonly ServiceVariant[], ServiceValidationError[]> {
    const errors: ServiceValidationError[] = [];
    const seen = new Set<string>();
    const variants: ServiceVariant[] = [];
    for (const props of raw) {
      if (seen.has(props.id)) {
        errors.push(new DuplicateServiceVariantError(props.id));
        continue;
      }
      seen.add(props.id);
      const result = ServiceVariant.create(props);
      if (result.isFailure()) {
        errors.push(...result.error);
        continue;
      }
      variants.push(result.value);
    }
    return errors.length > 0 ? fail(errors) : ok(variants);
  }

  private static buildOfferings(
    raw: readonly BarberOfferingProps[],
    variants: readonly ServiceVariant[],
  ): Result<readonly BarberOffering[], ServiceValidationError[]> {
    const errors: ServiceValidationError[] = [];
    const seen = new Set<string>();
    const offerings: BarberOffering[] = [];
    for (const props of raw) {
      if (seen.has(props.barberId)) {
        errors.push(new DuplicateBarberOfferingError(props.barberId));
        continue;
      }
      seen.add(props.barberId);
      const result = BarberOffering.create(props, variants);
      if (result.isFailure()) {
        errors.push(...result.error);
        continue;
      }
      offerings.push(result.value);
    }
    return errors.length > 0 ? fail(errors) : ok(offerings);
  }

  private static validateOneCurrency(
    base: ServiceTerms,
    offerings: readonly BarberOffering[],
  ): MixedCurrencyTermsError | null {
    const expected = base.price.currencyCode();
    for (const offering of offerings) {
      for (const terms of offering.allTerms()) {
        const found = terms.price.currencyCode();
        if (found !== expected) {
          return new MixedCurrencyTermsError(expected, found);
        }
      }
    }
    return null;
  }

  private static validateDuration(
    raw: number,
  ): Result<number, InvalidServiceDurationError> {
    return Number.isInteger(raw) && raw > 0
      ? ok(raw)
      : fail(new InvalidServiceDurationError(raw));
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidServiceSortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidServiceSortOrderError(raw));
  }

  private static validateComposition(
    raw: ServiceCompositionProps,
  ): Result<ServiceComposition, (EmptyIdError | EmptyBundleIncludesError)[]> {
    if (raw.kind === 'single') {
      return ok({ kind: 'single' });
    }
    if (raw.includes.length === 0) {
      return fail([new EmptyBundleIncludesError()]);
    }
    const includesResult = combine(
      raw.includes.map((id) => ServiceId.create(id)),
    );
    if (includesResult.isFailure()) {
      return fail(includesResult.error);
    }
    return ok({ kind: 'bundle', includes: includesResult.value });
  }

  // ── The terms matrix ──────────────────────────────────────────────────

  /** This barber's offering, or null when they don't perform this service. */
  offeringFor(barberId: BarberId): BarberOffering | null {
    return (
      this.offerings.find((offering) => offering.barberId.equals(barberId)) ??
      null
    );
  }

  /**
   * The one `ServiceTerms` that applies — the whole point of the matrix.
   *
   * Falls back down the axes it can't resolve: an unknown barber (or none
   * chosen) yields `baseTerms`, and a barber who doesn't price the chosen
   * variant differently yields their own base. There is always an answer,
   * so callers never branch on "priced or not".
   */
  termsFor(
    barberId?: BarberId | null,
    variantId?: ServiceVariantId | null,
  ): ServiceTerms {
    if (!barberId) return this.baseTerms;
    return this.offeringFor(barberId)?.termsFor(variantId) ?? this.baseTerms;
  }

  /** Every terms a booking of this service could land on — base plus the whole matrix. */
  private everyTerms(): readonly ServiceTerms[] {
    return [
      this.baseTerms,
      ...this.offerings.flatMap((offering) => offering.allTerms()),
    ];
  }

  /** Cheapest and dearest this service can be — drives the catalog's "from …" copy. Single currency is an invariant, so minor units compare directly. */
  priceRange(): { readonly min: Money; readonly max: Money } {
    const prices = this.everyTerms().map((terms) => terms.price);
    return {
      min: prices.reduce((a, b) =>
        b.toMinorUnits() < a.toMinorUnits() ? b : a,
      ),
      max: prices.reduce((a, b) =>
        b.toMinorUnits() > a.toMinorUnits() ? b : a,
      ),
    };
  }

  durationRange(): { readonly min: number; readonly max: number } {
    const minutes = this.everyTerms().map((terms) => terms.durationMinutes);
    return { min: Math.min(...minutes), max: Math.max(...minutes) };
  }

  /** Who performs this service, in declaration order. */
  performerIds(): readonly BarberId[] {
    return this.offerings.map((offering) => offering.barberId);
  }

  isPerformedBy(barberId: BarberId): boolean {
    return this.offeringFor(barberId) !== null;
  }

  // ── Location / conflict rules ─────────────────────────────────────────

  /** Is this service offered at `locationId`? Empty `locationIds` ⇒ all locations. */
  servesLocation(locationId: LocationId): boolean {
    return locationScopeServes(this.locationIds, locationId);
  }

  /** Does this service conflict with `serviceId` (cannot be booked together)? */
  conflictsWithService(serviceId: ServiceId): boolean {
    return this.conflictsWith.some((id) => id.equals(serviceId));
  }

  isBundle(): boolean {
    return this.composition.kind === 'bundle';
  }
}
