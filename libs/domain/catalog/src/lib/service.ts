import {
  Money,
  Result,
  combine,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { LocationId, ServiceCategoryId, ServiceId } from './ids';
import { locationScopeServes } from './location';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import { MediaRef } from './media-ref';
import {
  EmptyBundleIncludesError,
  InvalidServiceDurationError,
  InvalidServiceSortOrderError,
  ServiceValidationError,
} from './service.errors';

export type ServiceStatus = 'active' | 'archived';

/**
 * Discriminated `single | bundle` so "bundle without parts" is
 * unrepresentable (ports v2's `Service.kind`/`includes` split — `includes`
 * only exists as a field on the `bundle` variant).
 */
export type ServiceOffering =
  | { readonly kind: 'single' }
  | { readonly kind: 'bundle'; readonly includes: readonly ServiceId[] };

export type ServiceOfferingProps =
  | { readonly kind: 'single' }
  | { readonly kind: 'bundle'; readonly includes: readonly string[] };

export interface ServiceProps {
  id: string;
  name: LocalizedTextProps;
  description: LocalizedTextProps;
  categoryId: string;
  priceMinorUnits: number;
  currencyCode: string;
  durationMinutes: number;
  cover?: MediaRef;
  locationIds: readonly string[];
  conflictsWith: readonly string[];
  offering: ServiceOfferingProps;
  upsellOnly: boolean;
  popular: boolean;
  status: ServiceStatus;
  sortOrder: number;
}

/**
 * **Aggregate root** for a bookable offering.
 *
 * Deviation from v2's `Service` (see deviation log): v2's per-barber
 * `offerings`/`variants` pricing matrix (`Terms`, `termsFor`, `priceRange`,
 * `durationRange`) is simplified to one canonical `price` + `durationMinutes`
 * per service for this pure-domain pass — resolving a specific barber's/
 * variant's terms is a booking-time concern deferred to the
 * booking/scheduling application layer once that use-case lands. The
 * `single | bundle` split and `conflictsWith` are kept: real business
 * rules, cheap to model without the matrix.
 */
export class Service {
  private constructor(
    readonly id: ServiceId,
    readonly name: LocalizedText,
    readonly description: LocalizedText,
    readonly categoryId: ServiceCategoryId,
    readonly price: Money,
    readonly durationMinutes: number,
    readonly cover: MediaRef | null,
    readonly locationIds: readonly LocationId[],
    readonly conflictsWith: readonly ServiceId[],
    readonly offering: ServiceOffering,
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
    const offeringResult = Service.validateOffering(props.offering);
    if (offeringResult.isFailure()) {
      errors.push(...offeringResult.error);
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
      offeringResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, categoryId, price, durationMinutes, sortOrder] = combined.value;

    return ok(
      new Service(
        id,
        nameResult.value,
        descriptionResult.value,
        categoryId,
        price,
        durationMinutes,
        props.cover ?? null,
        locationIdsResult.value,
        conflictsWithResult.value,
        offeringResult.value,
        props.upsellOnly,
        props.popular,
        props.status,
        sortOrder,
      ),
    );
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

  private static validateOffering(
    raw: ServiceOfferingProps,
  ): Result<ServiceOffering, (EmptyIdError | EmptyBundleIncludesError)[]> {
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

  /** Is this service offered at `locationId`? Empty `locationIds` ⇒ all locations. */
  servesLocation(locationId: LocationId): boolean {
    return locationScopeServes(this.locationIds, locationId);
  }

  /** Does this service conflict with `serviceId` (cannot be booked together)? */
  conflictsWithService(serviceId: ServiceId): boolean {
    return this.conflictsWith.some((id) => id.equals(serviceId));
  }

  isBundle(): boolean {
    return this.offering.kind === 'bundle';
  }
}
