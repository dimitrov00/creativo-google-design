import { Result, combine, combineAll, fail, ok } from '@creativo/domain/kernel';
import { LocationId, locationScopeServes } from '@creativo/domain/catalog';
import { PositionId } from './ids';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import {
  InvalidPositionApplyUrlError,
  InvalidPositionSortOrderError,
  PositionValidationError,
} from './position.errors';

export type PositionStatus = 'open' | 'closed';

export interface PositionProps {
  id: string;
  title: LocalizedTextProps;
  summary: LocalizedTextProps;
  /** Empty ⇒ open at every location, same convention as `Barber`/`Service`. */
  locationIds: readonly string[];
  status: PositionStatus;
  /** Where "Apply" sends a candidate. `null` ⇒ the UI falls back to the shop's shared contact link. */
  applyUrl?: string;
  sortOrder: number;
}

/** **Aggregate root** for an open role on the careers page. Admin-managed — status is a plain field an admin flips, not a domain-enforced transition graph (mirrors `Location.status`, not `Appointment.status`). */
export class Position {
  private constructor(
    readonly id: PositionId,
    readonly title: LocalizedText,
    readonly summary: LocalizedText,
    readonly locationIds: readonly LocationId[],
    readonly status: PositionStatus,
    readonly applyUrl: string | null,
    readonly sortOrder: number,
  ) {}

  static create(
    props: PositionProps,
  ): Result<Position, PositionValidationError[]> {
    return Position.build(props);
  }

  static reconstitute(
    props: PositionProps,
  ): Result<Position, PositionValidationError[]> {
    return Position.build(props);
  }

  private static build(
    props: PositionProps,
  ): Result<Position, PositionValidationError[]> {
    const idResult = PositionId.create(props.id);
    const sortOrderResult = Position.validateSortOrder(props.sortOrder);

    const combined = combineAll([idResult, sortOrderResult] as const);
    const errors: PositionValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const titleResult = LocalizedText.create(props.title);
    if (titleResult.isFailure()) {
      errors.push(...titleResult.error);
    }
    const summaryResult = LocalizedText.create(props.summary);
    if (summaryResult.isFailure()) {
      errors.push(...summaryResult.error);
    }
    const locationIdsResult = combine(
      props.locationIds.map((raw) => LocationId.create(raw)),
    );
    if (locationIdsResult.isFailure()) {
      errors.push(...locationIdsResult.error);
    }
    const applyUrlResult = Position.validateApplyUrl(props.applyUrl);
    if (applyUrlResult.isFailure()) {
      errors.push(applyUrlResult.error);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      titleResult.isFailure() ||
      summaryResult.isFailure() ||
      locationIdsResult.isFailure() ||
      applyUrlResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, sortOrder] = combined.value;

    return ok(
      new Position(
        id,
        titleResult.value,
        summaryResult.value,
        locationIdsResult.value,
        props.status,
        applyUrlResult.value,
        sortOrder,
      ),
    );
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidPositionSortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidPositionSortOrderError(raw));
  }

  private static validateApplyUrl(
    raw: string | undefined,
  ): Result<string | null, InvalidPositionApplyUrlError> {
    if (raw === undefined || raw.trim().length === 0) {
      return ok(null);
    }
    try {
      new URL(raw);
      return ok(raw);
    } catch {
      return fail(new InvalidPositionApplyUrlError(raw));
    }
  }

  /** Is this role open at `locationId`? Empty `locationIds` ⇒ every location. */
  servesLocation(locationId: LocationId): boolean {
    return locationScopeServes(this.locationIds, locationId);
  }

  isOpen(): boolean {
    return this.status === 'open';
  }
}
