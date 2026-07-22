import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { LocationId } from './ids';
import {
  InvalidGeoCoordinateError,
  InvalidLocationHoursLengthError,
  InvalidLocationHoursRangeError,
  InvalidLocationSortOrderError,
  InvalidLocationTimeOfDayError,
  InvalidLocationTimezoneError,
  InvalidMapUrlError,
  LocationHoursValidationError,
  LocationValidationError,
} from './location.errors';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import { MediaRef } from './media-ref';
import { VenuePhone, VenuePhoneProps } from './venue-phone';

export type LocationStatus = 'active' | 'hidden';

/** Discriminated — kills the `opens: ''` / `closes: ''` sentinel. */
export type LocationDayHours =
  | { readonly kind: 'closed' }
  | { readonly kind: 'open'; readonly opens: string; readonly closes: string };

/** Tuple of 7, ISO order Mon..Sun — length is a type invariant (ports v2's `Location.WeeklyHours`). */
export type LocationWeeklyHours = readonly [
  LocationDayHours,
  LocationDayHours,
  LocationDayHours,
  LocationDayHours,
  LocationDayHours,
  LocationDayHours,
  LocationDayHours,
];

export interface LocationGeo {
  readonly lat: number;
  readonly lng: number;
}

export interface LocationProps {
  id: string;
  name: LocalizedTextProps;
  address: LocalizedTextProps;
  phone: VenuePhoneProps;
  geo: LocationGeo;
  mapUrl?: string;
  cover?: MediaRef;
  photos?: readonly MediaRef[];
  hours: readonly LocationDayHours[];
  timezone: string;
  status: LocationStatus;
  sortOrder: number;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * **Aggregate root.** A physical shop location.
 *
 * Invariants: `hours` has exactly 7 entries (Mon-first); `opens < closes`
 * on open days. Weekday LABELS are a presentation concern (`Intl.
 * DateTimeFormat`), never modeled as data here.
 */
export class Location {
  private constructor(
    readonly id: LocationId,
    readonly name: LocalizedText,
    readonly address: LocalizedText,
    readonly phone: VenuePhone,
    readonly geo: LocationGeo,
    readonly mapUrl: string | null,
    readonly cover: MediaRef | null,
    readonly photos: readonly MediaRef[],
    readonly hours: LocationWeeklyHours,
    readonly timezone: string,
    readonly status: LocationStatus,
    readonly sortOrder: number,
  ) {}

  static create(
    props: LocationProps,
  ): Result<Location, LocationValidationError[]> {
    return Location.build(props);
  }

  static reconstitute(
    props: LocationProps,
  ): Result<Location, LocationValidationError[]> {
    return Location.build(props);
  }

  private static build(
    props: LocationProps,
  ): Result<Location, LocationValidationError[]> {
    const idResult = LocationId.create(props.id);
    const geoResult = Location.validateGeo(props.geo);
    const timezoneResult = Location.validateTimezone(props.timezone);
    const sortOrderResult = Location.validateSortOrder(props.sortOrder);
    const mapUrlResult = Location.validateMapUrl(props.mapUrl);

    const combined = combineAll([
      idResult,
      geoResult,
      timezoneResult,
      sortOrderResult,
      mapUrlResult,
    ] as const);
    const errors: LocationValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const phoneResult = VenuePhone.create(props.phone);
    if (phoneResult.isFailure()) {
      errors.push(...phoneResult.error);
    }
    const nameResult = LocalizedText.create(props.name);
    if (nameResult.isFailure()) {
      errors.push(...nameResult.error);
    }
    const addressResult = LocalizedText.create(props.address);
    if (addressResult.isFailure()) {
      errors.push(...addressResult.error);
    }
    const hoursResult = Location.validateHours(props.hours);
    if (hoursResult.isFailure()) {
      errors.push(...hoursResult.error);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      phoneResult.isFailure() ||
      nameResult.isFailure() ||
      addressResult.isFailure() ||
      hoursResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, geo, timezone, sortOrder, mapUrl] = combined.value;

    return ok(
      new Location(
        id,
        nameResult.value,
        addressResult.value,
        phoneResult.value,
        geo,
        mapUrl,
        props.cover ?? null,
        props.photos ? [...props.photos] : [],
        hoursResult.value,
        timezone,
        props.status,
        sortOrder,
      ),
    );
  }

  private static validateGeo(
    raw: LocationGeo,
  ): Result<LocationGeo, InvalidGeoCoordinateError> {
    if (raw.lat < -90 || raw.lat > 90) {
      return fail(new InvalidGeoCoordinateError('lat', raw.lat));
    }
    if (raw.lng < -180 || raw.lng > 180) {
      return fail(new InvalidGeoCoordinateError('lng', raw.lng));
    }
    return ok({ lat: raw.lat, lng: raw.lng });
  }

  private static validateTimezone(
    raw: string,
  ): Result<string, InvalidLocationTimezoneError> {
    return ZonedDateTime.isValidZone(raw)
      ? ok(raw)
      : fail(new InvalidLocationTimezoneError(raw));
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidLocationSortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidLocationSortOrderError(raw));
  }

  private static validateMapUrl(
    raw: string | undefined,
  ): Result<string | null, InvalidMapUrlError> {
    if (raw === undefined) {
      return ok(null);
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return ok(null);
    }
    if (!Location.isValidUrl(trimmed)) {
      return fail(new InvalidMapUrlError(raw));
    }
    return ok(trimmed);
  }

  private static isValidUrl(candidate: string): boolean {
    try {
      return Boolean(new URL(candidate));
    } catch {
      return false;
    }
  }

  private static validateHours(
    raw: readonly LocationDayHours[],
  ): Result<LocationWeeklyHours, LocationHoursValidationError[]> {
    if (raw.length !== 7) {
      return fail([new InvalidLocationHoursLengthError(raw.length)]);
    }

    const errors: (
      InvalidLocationTimeOfDayError | InvalidLocationHoursRangeError
    )[] = [];
    const days: LocationDayHours[] = [];
    raw.forEach((day, index) => {
      if (day.kind === 'closed') {
        days.push({ kind: 'closed' });
        return;
      }
      if (!TIME_REGEX.test(day.opens)) {
        errors.push(new InvalidLocationTimeOfDayError(day.opens));
        return;
      }
      if (!TIME_REGEX.test(day.closes)) {
        errors.push(new InvalidLocationTimeOfDayError(day.closes));
        return;
      }
      // Zero-padded HH:mm strings compare correctly lexically.
      if (day.opens >= day.closes) {
        errors.push(new InvalidLocationHoursRangeError(index));
        return;
      }
      days.push({ kind: 'open', opens: day.opens, closes: day.closes });
    });

    if (errors.length > 0) {
      return fail(errors);
    }
    // `raw.length === 7` was checked above and every entry pushed exactly
    // one value to `days` when it produced no error, so `days` is a
    // 7-tuple here — the cast makes that (runtime-checked) fact visible to
    // the type system.
    return ok(days as unknown as LocationWeeklyHours);
  }
}

/**
 * Is `locationIds` scoped to include `locationId`? Empty `locationIds` ⇒
 * "available everywhere" (the seed default), otherwise membership decides.
 * Ports v2's `Location.serves` — defined once here so `Barber`/`Service`
 * both read the same predicate instead of re-implementing
 * `length === 0 || includes(...)` independently.
 */
export function locationScopeServes(
  locationIds: readonly LocationId[],
  locationId: LocationId,
): boolean {
  return (
    locationIds.length === 0 || locationIds.some((id) => id.equals(locationId))
  );
}
