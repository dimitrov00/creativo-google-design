import type { Locale } from './locale.data';

/**
 * The catalog context's error codes — the 25 dotted codes of
 * `libs/domain/catalog/src/lib/*.errors.ts`, reused as is (blueprint §2.2):
 * the `DomainError` subclasses collapse into this one dictionary of plain
 * structs. Every non-`code` field is an i18n parameter, so each one is an
 * i18n-safe scalar (infrastructure Q5).
 *
 * Raised by the catalogue edge guards — `LocalizedText.parse`,
 * `MediaRef.parse`, `GeoPoint.parse`, `ServiceTerms.parse`,
 * `BarberOffering.parse`, `ServiceComposition.parse`, `DayHours.parseWeek`,
 * `VenuePhone.of` — and, for the entity-level checks (sort orders, handle,
 * years of experience, map URL, zone), by whichever edge validates a whole
 * catalogue document.
 */
export const CatalogErrorCode = {
  /** A blank id where a catalogue id was required (`idType` names which). */
  IdEmpty: 'catalog.id.empty',
  /** One locale of a `LocalizedText` is blank. */
  LocalizedTextFieldEmpty: 'catalog.localized_text.field_empty',
  /** A `MediaRef` with a blank Storage path. */
  MediaRefEmptyPath: 'catalog.media_ref.empty_path',
  /** A `MediaRef` width or height that is not a positive integer. */
  MediaRefInvalidDimension: 'catalog.media_ref.invalid_dimension',
  /** A focal point outside 0..1 on either axis. */
  MediaRefFocalPointOutOfRange: 'catalog.media_ref.focal_point_out_of_range',
  /** A venue phone whose display text is blank. */
  VenuePhoneBlankDisplay: 'catalog.venue_phone.blank_display',
  /** A barber with a blank handle. */
  BarberEmptyHandle: 'catalog.barber.empty_handle',
  /** Years of experience that are not a non-negative integer. */
  BarberInvalidYearsExperience: 'catalog.barber.invalid_years_experience',
  BarberInvalidSortOrder: 'catalog.barber.invalid_sort_order',
  ServiceCategoryInvalidSortOrder:
    'catalog.service_category.invalid_sort_order',
  /**
   * A duration that is not a positive integer of minutes — and, as in the
   * legacy `ServiceTerms.create`, a setup or cleanup pad that is not a
   * non-negative integer (`rawValue` is the offending figure).
   */
  ServiceInvalidDuration: 'catalog.service.invalid_duration',
  ServiceInvalidSortOrder: 'catalog.service.invalid_sort_order',
  /** A bundle composition that includes no service. */
  ServiceEmptyBundleIncludes: 'catalog.service.empty_bundle_includes',
  /** An offering prices a variant its service does not declare. */
  ServiceUnknownVariantTerms: 'catalog.service.unknown_variant_terms',
  /** An offering prices one variant twice. */
  ServiceDuplicateVariantTerms: 'catalog.service.duplicate_variant_terms',
  /** A service declares one variant id twice. */
  ServiceDuplicateVariant: 'catalog.service.duplicate_variant',
  /** A service lists one barber's offering twice. */
  ServiceDuplicateOffering: 'catalog.service.duplicate_offering',
  /** A price on the terms matrix in a currency other than the base terms'. */
  ServiceMixedCurrencyTerms: 'catalog.service.mixed_currency_terms',
  /** Latitude outside −90..90 or longitude outside −180..180. */
  LocationInvalidGeoCoordinate: 'catalog.location.invalid_geo_coordinate',
  /** A zone name the runtime does not know. */
  LocationInvalidTimezone: 'catalog.location.invalid_timezone',
  LocationInvalidSortOrder: 'catalog.location.invalid_sort_order',
  /** A map link that is not an absolute URL. */
  LocationInvalidMapUrl: 'catalog.location.invalid_map_url',
  /** Opening hours that are not exactly seven days, Monday first. */
  LocationInvalidHoursLength: 'catalog.location.invalid_hours_length',
  /** A time of day that is not `HH:mm` (00:00–23:59) — or not a minute of the day. */
  LocationInvalidTimeOfDay: 'catalog.location.invalid_time_of_day',
  /** An open day whose closing time is not after its opening time. */
  LocationInvalidHoursRange: 'catalog.location.invalid_hours_range',
} as const;
export type CatalogErrorCode =
  (typeof CatalogErrorCode)[keyof typeof CatalogErrorCode];

/** Which side of a `MediaRef` failed `catalog.media_ref.invalid_dimension`. */
export const MediaDimension = {
  Width: 'width',
  Height: 'height',
} as const;
export type MediaDimension =
  (typeof MediaDimension)[keyof typeof MediaDimension];

/** Which coordinate failed `catalog.location.invalid_geo_coordinate`. */
export const GeoAxis = {
  Lat: 'lat',
  Lng: 'lng',
} as const;
export type GeoAxis = (typeof GeoAxis)[keyof typeof GeoAxis];

export type CatalogError =
  | CatalogError.IdEmpty
  | CatalogError.LocalizedTextFieldEmpty
  | CatalogError.MediaRefEmptyPath
  | CatalogError.MediaRefInvalidDimension
  | CatalogError.MediaRefFocalPointOutOfRange
  | CatalogError.VenuePhoneBlankDisplay
  | CatalogError.BarberEmptyHandle
  | CatalogError.BarberInvalidYearsExperience
  | CatalogError.BarberInvalidSortOrder
  | CatalogError.ServiceCategoryInvalidSortOrder
  | CatalogError.ServiceInvalidDuration
  | CatalogError.ServiceInvalidSortOrder
  | CatalogError.ServiceEmptyBundleIncludes
  | CatalogError.ServiceUnknownVariantTerms
  | CatalogError.ServiceDuplicateVariantTerms
  | CatalogError.ServiceDuplicateVariant
  | CatalogError.ServiceDuplicateOffering
  | CatalogError.ServiceMixedCurrencyTerms
  | CatalogError.LocationInvalidGeoCoordinate
  | CatalogError.LocationInvalidTimezone
  | CatalogError.LocationInvalidSortOrder
  | CatalogError.LocationInvalidMapUrl
  | CatalogError.LocationInvalidHoursLength
  | CatalogError.LocationInvalidTimeOfDay
  | CatalogError.LocationInvalidHoursRange;

export const CatalogError = {
  idEmpty(idType: string): CatalogError.IdEmpty {
    return { code: CatalogErrorCode.IdEmpty, idType };
  },
  localizedTextFieldEmpty(
    locale: Locale,
  ): CatalogError.LocalizedTextFieldEmpty {
    return { code: CatalogErrorCode.LocalizedTextFieldEmpty, locale };
  },
  mediaRefEmptyPath(): CatalogError.MediaRefEmptyPath {
    return { code: CatalogErrorCode.MediaRefEmptyPath };
  },
  mediaRefInvalidDimension(
    dimension: MediaDimension,
    rawValue: number,
  ): CatalogError.MediaRefInvalidDimension {
    return {
      code: CatalogErrorCode.MediaRefInvalidDimension,
      dimension,
      rawValue,
    };
  },
  mediaRefFocalPointOutOfRange(
    x: number,
    y: number,
  ): CatalogError.MediaRefFocalPointOutOfRange {
    return { code: CatalogErrorCode.MediaRefFocalPointOutOfRange, x, y };
  },
  venuePhoneBlankDisplay(): CatalogError.VenuePhoneBlankDisplay {
    return { code: CatalogErrorCode.VenuePhoneBlankDisplay };
  },
  barberEmptyHandle(): CatalogError.BarberEmptyHandle {
    return { code: CatalogErrorCode.BarberEmptyHandle };
  },
  barberInvalidYearsExperience(
    rawValue: number,
  ): CatalogError.BarberInvalidYearsExperience {
    return { code: CatalogErrorCode.BarberInvalidYearsExperience, rawValue };
  },
  barberInvalidSortOrder(
    rawValue: number,
  ): CatalogError.BarberInvalidSortOrder {
    return { code: CatalogErrorCode.BarberInvalidSortOrder, rawValue };
  },
  serviceCategoryInvalidSortOrder(
    rawValue: number,
  ): CatalogError.ServiceCategoryInvalidSortOrder {
    return {
      code: CatalogErrorCode.ServiceCategoryInvalidSortOrder,
      rawValue,
    };
  },
  serviceInvalidDuration(
    rawValue: number,
  ): CatalogError.ServiceInvalidDuration {
    return { code: CatalogErrorCode.ServiceInvalidDuration, rawValue };
  },
  serviceInvalidSortOrder(
    rawValue: number,
  ): CatalogError.ServiceInvalidSortOrder {
    return { code: CatalogErrorCode.ServiceInvalidSortOrder, rawValue };
  },
  serviceEmptyBundleIncludes(): CatalogError.ServiceEmptyBundleIncludes {
    return { code: CatalogErrorCode.ServiceEmptyBundleIncludes };
  },
  serviceUnknownVariantTerms(
    barberId: string,
    variantId: string,
  ): CatalogError.ServiceUnknownVariantTerms {
    return {
      code: CatalogErrorCode.ServiceUnknownVariantTerms,
      barberId,
      variantId,
    };
  },
  serviceDuplicateVariantTerms(
    barberId: string,
    variantId: string,
  ): CatalogError.ServiceDuplicateVariantTerms {
    return {
      code: CatalogErrorCode.ServiceDuplicateVariantTerms,
      barberId,
      variantId,
    };
  },
  serviceDuplicateVariant(
    variantId: string,
  ): CatalogError.ServiceDuplicateVariant {
    return { code: CatalogErrorCode.ServiceDuplicateVariant, variantId };
  },
  serviceDuplicateOffering(
    barberId: string,
  ): CatalogError.ServiceDuplicateOffering {
    return { code: CatalogErrorCode.ServiceDuplicateOffering, barberId };
  },
  serviceMixedCurrencyTerms(
    expected: string,
    found: string,
  ): CatalogError.ServiceMixedCurrencyTerms {
    return {
      code: CatalogErrorCode.ServiceMixedCurrencyTerms,
      expected,
      found,
    };
  },
  locationInvalidGeoCoordinate(
    axis: GeoAxis,
    rawValue: number,
  ): CatalogError.LocationInvalidGeoCoordinate {
    return {
      code: CatalogErrorCode.LocationInvalidGeoCoordinate,
      axis,
      rawValue,
    };
  },
  locationInvalidTimezone(
    rawValue: string,
  ): CatalogError.LocationInvalidTimezone {
    return { code: CatalogErrorCode.LocationInvalidTimezone, rawValue };
  },
  locationInvalidSortOrder(
    rawValue: number,
  ): CatalogError.LocationInvalidSortOrder {
    return { code: CatalogErrorCode.LocationInvalidSortOrder, rawValue };
  },
  locationInvalidMapUrl(rawValue: string): CatalogError.LocationInvalidMapUrl {
    return { code: CatalogErrorCode.LocationInvalidMapUrl, rawValue };
  },
  locationInvalidHoursLength(
    rawLength: number,
  ): CatalogError.LocationInvalidHoursLength {
    return { code: CatalogErrorCode.LocationInvalidHoursLength, rawLength };
  },
  locationInvalidTimeOfDay(
    rawValue: string,
  ): CatalogError.LocationInvalidTimeOfDay {
    return { code: CatalogErrorCode.LocationInvalidTimeOfDay, rawValue };
  },
  locationInvalidHoursRange(
    dayIndex: number,
  ): CatalogError.LocationInvalidHoursRange {
    return { code: CatalogErrorCode.LocationInvalidHoursRange, dayIndex };
  },

  /** Narrows an error to one code — `CatalogError.is(e, CatalogErrorCode.IdEmpty)`. */
  is<C extends CatalogErrorCode>(
    error: CatalogError,
    code: C,
  ): error is Extract<CatalogError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace CatalogError {
  export type IdEmpty = {
    readonly code: typeof CatalogErrorCode.IdEmpty;
    /** The id type that was blank, e.g. `'ServiceId'`, `'MediaRefId'`. */
    readonly idType: string;
  };
  export type LocalizedTextFieldEmpty = {
    readonly code: typeof CatalogErrorCode.LocalizedTextFieldEmpty;
    readonly locale: Locale;
  };
  export type MediaRefEmptyPath = {
    readonly code: typeof CatalogErrorCode.MediaRefEmptyPath;
  };
  export type MediaRefInvalidDimension = {
    readonly code: typeof CatalogErrorCode.MediaRefInvalidDimension;
    readonly dimension: MediaDimension;
    readonly rawValue: number;
  };
  export type MediaRefFocalPointOutOfRange = {
    readonly code: typeof CatalogErrorCode.MediaRefFocalPointOutOfRange;
    readonly x: number;
    readonly y: number;
  };
  export type VenuePhoneBlankDisplay = {
    readonly code: typeof CatalogErrorCode.VenuePhoneBlankDisplay;
  };
  export type BarberEmptyHandle = {
    readonly code: typeof CatalogErrorCode.BarberEmptyHandle;
  };
  export type BarberInvalidYearsExperience = {
    readonly code: typeof CatalogErrorCode.BarberInvalidYearsExperience;
    readonly rawValue: number;
  };
  export type BarberInvalidSortOrder = {
    readonly code: typeof CatalogErrorCode.BarberInvalidSortOrder;
    readonly rawValue: number;
  };
  export type ServiceCategoryInvalidSortOrder = {
    readonly code: typeof CatalogErrorCode.ServiceCategoryInvalidSortOrder;
    readonly rawValue: number;
  };
  export type ServiceInvalidDuration = {
    readonly code: typeof CatalogErrorCode.ServiceInvalidDuration;
    readonly rawValue: number;
  };
  export type ServiceInvalidSortOrder = {
    readonly code: typeof CatalogErrorCode.ServiceInvalidSortOrder;
    readonly rawValue: number;
  };
  export type ServiceEmptyBundleIncludes = {
    readonly code: typeof CatalogErrorCode.ServiceEmptyBundleIncludes;
  };
  export type ServiceUnknownVariantTerms = {
    readonly code: typeof CatalogErrorCode.ServiceUnknownVariantTerms;
    readonly barberId: string;
    readonly variantId: string;
  };
  export type ServiceDuplicateVariantTerms = {
    readonly code: typeof CatalogErrorCode.ServiceDuplicateVariantTerms;
    readonly barberId: string;
    readonly variantId: string;
  };
  export type ServiceDuplicateVariant = {
    readonly code: typeof CatalogErrorCode.ServiceDuplicateVariant;
    readonly variantId: string;
  };
  export type ServiceDuplicateOffering = {
    readonly code: typeof CatalogErrorCode.ServiceDuplicateOffering;
    readonly barberId: string;
  };
  export type ServiceMixedCurrencyTerms = {
    readonly code: typeof CatalogErrorCode.ServiceMixedCurrencyTerms;
    /** The base terms' currency. */
    readonly expected: string;
    /** The first other currency met on the matrix. */
    readonly found: string;
  };
  export type LocationInvalidGeoCoordinate = {
    readonly code: typeof CatalogErrorCode.LocationInvalidGeoCoordinate;
    readonly axis: GeoAxis;
    readonly rawValue: number;
  };
  export type LocationInvalidTimezone = {
    readonly code: typeof CatalogErrorCode.LocationInvalidTimezone;
    readonly rawValue: string;
  };
  export type LocationInvalidSortOrder = {
    readonly code: typeof CatalogErrorCode.LocationInvalidSortOrder;
    readonly rawValue: number;
  };
  export type LocationInvalidMapUrl = {
    readonly code: typeof CatalogErrorCode.LocationInvalidMapUrl;
    readonly rawValue: string;
  };
  export type LocationInvalidHoursLength = {
    readonly code: typeof CatalogErrorCode.LocationInvalidHoursLength;
    readonly rawLength: number;
  };
  export type LocationInvalidTimeOfDay = {
    readonly code: typeof CatalogErrorCode.LocationInvalidTimeOfDay;
    /** The text as given; a minute figure that is not a minute of the day is its decimal string. */
    readonly rawValue: string;
  };
  export type LocationInvalidHoursRange = {
    readonly code: typeof CatalogErrorCode.LocationInvalidHoursRange;
    /** `0` = Monday … `6` = Sunday — the index into the seven `DayHours`. */
    readonly dayIndex: number;
  };
}
