import { DomainError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';
import { VenuePhoneValidationError } from './venue-phone.errors';

export class InvalidGeoCoordinateError extends DomainError {
  readonly code = 'catalog.location.invalid_geo_coordinate' as const;
  constructor(
    public readonly axis: 'lat' | 'lng',
    public readonly rawValue: number,
  ) {
    super(`Invalid ${axis} coordinate: ${rawValue}`, { axis, rawValue });
  }
}

export class InvalidLocationTimezoneError extends DomainError {
  readonly code = 'catalog.location.invalid_timezone' as const;
  constructor(public readonly rawValue: string) {
    super(`Invalid location time zone: "${rawValue}"`, { rawValue });
  }
}

export class InvalidLocationSortOrderError extends DomainError {
  readonly code = 'catalog.location.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(`Location sort order must be a non-negative integer: ${rawValue}`, {
      rawValue,
    });
  }
}

export class InvalidMapUrlError extends DomainError {
  readonly code = 'catalog.location.invalid_map_url' as const;
  constructor(public readonly rawValue: string) {
    super(`Invalid map URL: "${rawValue}"`, { rawValue });
  }
}

export class InvalidLocationHoursLengthError extends DomainError {
  readonly code = 'catalog.location.invalid_hours_length' as const;
  constructor(public readonly rawLength: number) {
    super(
      `Location weekly hours must have exactly 7 entries (Mon..Sun), got ${rawLength}`,
      { rawLength },
    );
  }
}

export class InvalidLocationTimeOfDayError extends DomainError {
  readonly code = 'catalog.location.invalid_time_of_day' as const;
  constructor(public readonly rawValue: string) {
    super(`Invalid time of day "${rawValue}" — expected HH:mm`, { rawValue });
  }
}

export class InvalidLocationHoursRangeError extends DomainError {
  readonly code = 'catalog.location.invalid_hours_range' as const;
  constructor(public readonly dayIndex: number) {
    super(
      `Location hours "closes" must be after "opens" for day index ${dayIndex}`,
      { dayIndex },
    );
  }
}

export type LocationHoursValidationError =
  | InvalidLocationHoursLengthError
  | InvalidLocationTimeOfDayError
  | InvalidLocationHoursRangeError;

export type LocationValidationError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | VenuePhoneValidationError
  | InvalidGeoCoordinateError
  | InvalidLocationTimezoneError
  | InvalidLocationSortOrderError
  | InvalidMapUrlError
  | LocationHoursValidationError;
