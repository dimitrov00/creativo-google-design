import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { LocationId } from '@creativo/domain/catalog';
import { ShopEventId } from './ids';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import {
  InvalidShopEventApplyUrlError,
  InvalidShopEventSortOrderError,
  ShopEventValidationError,
} from './shop-event.errors';

export interface ShopEventProps {
  id: string;
  title: LocalizedTextProps;
  description: LocalizedTextProps;
  startDateIso: string;
  timezone: string;
  locationId?: string;
  /** RSVP link. `null` ⇒ the UI falls back to the shop's shared contact link. */
  applyUrl?: string;
  sortOrder: number;
}

/**
 * **Aggregate root** for a community/marketing event. Unlike `Position`/
 * `Course`, there is no admin-set status field — Upcoming vs. Past is
 * derived from `startDate` against "now" (an event that happened
 * yesterday is past no matter what a checkbox says), computed by callers
 * via `isUpcoming(now)`/`isPast(now)`, and enforced as a Firestore query
 * filter at the repository layer.
 */
export class ShopEvent {
  private constructor(
    readonly id: ShopEventId,
    readonly title: LocalizedText,
    readonly description: LocalizedText,
    readonly startDate: ZonedDateTime,
    readonly locationId: LocationId | null,
    readonly applyUrl: string | null,
    readonly sortOrder: number,
  ) {}

  static create(
    props: ShopEventProps,
  ): Result<ShopEvent, ShopEventValidationError[]> {
    return ShopEvent.build(props);
  }

  static reconstitute(
    props: ShopEventProps,
  ): Result<ShopEvent, ShopEventValidationError[]> {
    return ShopEvent.build(props);
  }

  private static build(
    props: ShopEventProps,
  ): Result<ShopEvent, ShopEventValidationError[]> {
    const idResult = ShopEventId.create(props.id);
    const startDateResult = ZonedDateTime.fromISO(
      props.startDateIso,
      props.timezone,
    );
    const sortOrderResult = ShopEvent.validateSortOrder(props.sortOrder);

    const combined = combineAll([
      idResult,
      startDateResult,
      sortOrderResult,
    ] as const);
    const errors: ShopEventValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const titleResult = LocalizedText.create(props.title);
    if (titleResult.isFailure()) {
      errors.push(...titleResult.error);
    }
    const descriptionResult = LocalizedText.create(props.description);
    if (descriptionResult.isFailure()) {
      errors.push(...descriptionResult.error);
    }
    const locationIdResult = props.locationId
      ? LocationId.create(props.locationId)
      : ok<LocationId | null, never>(null);
    if (locationIdResult.isFailure()) {
      errors.push(locationIdResult.error);
    }
    const applyUrlResult = ShopEvent.validateApplyUrl(props.applyUrl);
    if (applyUrlResult.isFailure()) {
      errors.push(applyUrlResult.error);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      titleResult.isFailure() ||
      descriptionResult.isFailure() ||
      locationIdResult.isFailure() ||
      applyUrlResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, startDate, sortOrder] = combined.value;

    return ok(
      new ShopEvent(
        id,
        titleResult.value,
        descriptionResult.value,
        startDate,
        locationIdResult.value,
        applyUrlResult.value,
        sortOrder,
      ),
    );
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidShopEventSortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidShopEventSortOrderError(raw));
  }

  private static validateApplyUrl(
    raw: string | undefined,
  ): Result<string | null, InvalidShopEventApplyUrlError> {
    if (raw === undefined || raw.trim().length === 0) {
      return ok(null);
    }
    try {
      new URL(raw);
      return ok(raw);
    } catch {
      return fail(new InvalidShopEventApplyUrlError(raw));
    }
  }

  isUpcoming(now: ZonedDateTime): boolean {
    return this.startDate.isSameOrAfter(now);
  }

  isPast(now: ZonedDateTime): boolean {
    return this.startDate.isBefore(now);
  }
}
