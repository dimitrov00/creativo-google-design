import { Result, combine, combineAll, fail, ok } from '@creativo/domain/kernel';
import {
  BarberValidationError,
  EmptyBarberHandleError,
  InvalidBarberSortOrderError,
  InvalidBarberYearsExperienceError,
} from './barber.errors';
import { BarberId, LocationId } from './ids';
import { locationScopeServes } from './location';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import { MediaRef } from './media-ref';

export type BarberStatus = 'active' | 'inactive';

export interface BarberProps {
  id: string;
  name: LocalizedTextProps;
  handle: string;
  title: LocalizedTextProps;
  bio: LocalizedTextProps;
  avatar?: MediaRef;
  yearsExperience?: number;
  locationIds: readonly string[];
  instagramHandle?: string;
  status: BarberStatus;
  sortOrder: number;
}

/**
 * **Aggregate root.** A craftsman's public profile. Does NOT contain
 * offerings — those live on `Service` (the pricing matrix is a per-service
 * concern; booking always reads service+offerings together).
 *
 * Deliberately NO `rating` field — fabricated ratings read as a scam.
 *
 * Deviations from v2's `Barber` (see deviation log): `createdAt`/
 * `updatedAt`/`revision` dropped (persistence concerns, out of scope for
 * this pure-domain pass); the optional `userId` link to a staff account is
 * dropped entirely to keep `catalog` independent of `accounts` while both
 * are built in parallel; `socials: { instagram? }` flattened to a single
 * `instagramHandle` field (only one platform was ever populated).
 */
export class Barber {
  private constructor(
    readonly id: BarberId,
    readonly name: LocalizedText,
    readonly handle: string,
    readonly title: LocalizedText,
    readonly bio: LocalizedText,
    readonly avatar: MediaRef | null,
    readonly yearsExperience: number | null,
    readonly locationIds: readonly LocationId[],
    readonly instagramHandle: string | null,
    readonly status: BarberStatus,
    readonly sortOrder: number,
  ) {}

  static create(props: BarberProps): Result<Barber, BarberValidationError[]> {
    return Barber.build(props);
  }

  static reconstitute(
    props: BarberProps,
  ): Result<Barber, BarberValidationError[]> {
    return Barber.build(props);
  }

  private static build(
    props: BarberProps,
  ): Result<Barber, BarberValidationError[]> {
    const idResult = BarberId.create(props.id);
    const handleResult = Barber.validateHandle(props.handle);
    const yearsExperienceResult = Barber.validateYearsExperience(
      props.yearsExperience,
    );
    const sortOrderResult = Barber.validateSortOrder(props.sortOrder);

    const combined = combineAll([
      idResult,
      handleResult,
      yearsExperienceResult,
      sortOrderResult,
    ] as const);
    const errors: BarberValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const nameResult = LocalizedText.create(props.name);
    if (nameResult.isFailure()) {
      errors.push(...nameResult.error);
    }
    const titleResult = LocalizedText.create(props.title);
    if (titleResult.isFailure()) {
      errors.push(...titleResult.error);
    }
    const bioResult = LocalizedText.create(props.bio);
    if (bioResult.isFailure()) {
      errors.push(...bioResult.error);
    }
    const locationIdsResult = combine(
      props.locationIds.map((raw) => LocationId.create(raw)),
    );
    if (locationIdsResult.isFailure()) {
      errors.push(...locationIdsResult.error);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      nameResult.isFailure() ||
      titleResult.isFailure() ||
      bioResult.isFailure() ||
      locationIdsResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, handle, yearsExperience, sortOrder] = combined.value;
    const instagramHandle = props.instagramHandle?.trim();

    return ok(
      new Barber(
        id,
        nameResult.value,
        handle,
        titleResult.value,
        bioResult.value,
        props.avatar ?? null,
        yearsExperience,
        locationIdsResult.value,
        instagramHandle && instagramHandle.length > 0 ? instagramHandle : null,
        props.status,
        sortOrder,
      ),
    );
  }

  private static validateHandle(
    raw: string,
  ): Result<string, EmptyBarberHandleError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new EmptyBarberHandleError());
  }

  private static validateYearsExperience(
    raw: number | undefined,
  ): Result<number | null, InvalidBarberYearsExperienceError> {
    if (raw === undefined) {
      return ok(null);
    }
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidBarberYearsExperienceError(raw));
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidBarberSortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidBarberSortOrderError(raw));
  }

  /** Does this barber work at `locationId`? Empty `locationIds` ⇒ all locations. */
  servesLocation(locationId: LocationId): boolean {
    return locationScopeServes(this.locationIds, locationId);
  }
}
