import type { Currency } from './currency.primitive';
import { BarberId, ServiceVariantId } from './ids.primitive';
import type { Locale } from './locale.data';

/**
 * The catalog context's error codes — the 25 codes of
 * `libs/domain/catalog/src/lib/*.errors.ts`, SCREAMING_SNAKE with the
 * `CATALOG_` prefix (Law 7.5, flatten-spec §4.2; the legacy dotted
 * `catalog.service.invalid_duration` is now `CATALOG_SERVICE_INVALID_DURATION`):
 * the `DomainError` subclasses collapse into this one dictionary of flat
 * structs discriminated by `errorCode`. Every other field is an i18n
 * parameter, so each one is an i18n-safe scalar (infrastructure Q5); the UI
 * resolves `errors.<errorCode>`.
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
  IdEmpty: 'CATALOG_ID_EMPTY',
  /** One locale of a `LocalizedText` is blank. */
  LocalizedTextFieldEmpty: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
  /** A `MediaRef` with a blank Storage path. */
  MediaRefEmptyPath: 'CATALOG_MEDIA_REF_EMPTY_PATH',
  /** A `MediaRef` width or height that is not a positive integer. */
  MediaRefInvalidDimension: 'CATALOG_MEDIA_REF_INVALID_DIMENSION',
  /** A focal point outside 0..1 on either axis. */
  MediaRefFocalPointOutOfRange: 'CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE',
  /** A venue phone whose display text is blank. */
  VenuePhoneBlankDisplay: 'CATALOG_VENUE_PHONE_BLANK_DISPLAY',
  /** A barber with a blank handle. */
  BarberEmptyHandle: 'CATALOG_BARBER_EMPTY_HANDLE',
  /** Years of experience that are not a non-negative integer. */
  BarberInvalidYearsExperience: 'CATALOG_BARBER_INVALID_YEARS_EXPERIENCE',
  BarberInvalidSortOrder: 'CATALOG_BARBER_INVALID_SORT_ORDER',
  ServiceCategoryInvalidSortOrder:
    'CATALOG_SERVICE_CATEGORY_INVALID_SORT_ORDER',
  /**
   * A duration that is not a positive integer of minutes — and, as in the
   * legacy `ServiceTerms.create`, a setup or cleanup pad that is not a
   * non-negative integer (`rawValue` is the offending figure).
   */
  ServiceInvalidDuration: 'CATALOG_SERVICE_INVALID_DURATION',
  ServiceInvalidSortOrder: 'CATALOG_SERVICE_INVALID_SORT_ORDER',
  /** A bundle composition that includes no service. */
  ServiceEmptyBundleIncludes: 'CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES',
  /** An offering prices a variant its service does not declare. */
  ServiceUnknownVariantTerms: 'CATALOG_SERVICE_UNKNOWN_VARIANT_TERMS',
  /** An offering prices one variant twice. */
  ServiceDuplicateVariantTerms: 'CATALOG_SERVICE_DUPLICATE_VARIANT_TERMS',
  /** A service declares one variant id twice. */
  ServiceDuplicateVariant: 'CATALOG_SERVICE_DUPLICATE_VARIANT',
  /** A service lists one barber's offering twice. */
  ServiceDuplicateOffering: 'CATALOG_SERVICE_DUPLICATE_OFFERING',
  /** A price on the terms matrix in a currency other than the base terms'. */
  ServiceMixedCurrencyTerms: 'CATALOG_SERVICE_MIXED_CURRENCY_TERMS',
  /** Latitude outside −90..90 or longitude outside −180..180. */
  LocationInvalidGeoCoordinate: 'CATALOG_LOCATION_INVALID_GEO_COORDINATE',
  /** A zone name the runtime does not know. */
  LocationInvalidTimezone: 'CATALOG_LOCATION_INVALID_TIMEZONE',
  LocationInvalidSortOrder: 'CATALOG_LOCATION_INVALID_SORT_ORDER',
  /** A map link that is not an absolute URL. */
  LocationInvalidMapUrl: 'CATALOG_LOCATION_INVALID_MAP_URL',
  /** Opening hours that are not exactly seven days, Monday first. */
  LocationInvalidHoursLength: 'CATALOG_LOCATION_INVALID_HOURS_LENGTH',
  /** A time of day that is not `HH:mm` (00:00–23:59) — or not a minute of the day. */
  LocationInvalidTimeOfDay: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY',
  /** An open day whose closing time is not after its opening time. */
  LocationInvalidHoursRange: 'CATALOG_LOCATION_INVALID_HOURS_RANGE',
} as const;
export type CatalogErrorCode =
  (typeof CatalogErrorCode)[keyof typeof CatalogErrorCode];

/** Which side of a `MediaRef` failed `CATALOG_MEDIA_REF_INVALID_DIMENSION`. */
export const MediaDimension = {
  Width: 'WIDTH',
  Height: 'HEIGHT',
} as const;
export type MediaDimension =
  (typeof MediaDimension)[keyof typeof MediaDimension];

/** Which coordinate failed `CATALOG_LOCATION_INVALID_GEO_COORDINATE`. */
export const GeoAxis = {
  Lat: 'LAT',
  Lng: 'LNG',
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
    return { errorCode: CatalogErrorCode.IdEmpty, idType };
  },
  localizedTextFieldEmpty(
    locale: Locale,
  ): CatalogError.LocalizedTextFieldEmpty {
    return { errorCode: CatalogErrorCode.LocalizedTextFieldEmpty, locale };
  },
  mediaRefEmptyPath(): CatalogError.MediaRefEmptyPath {
    return { errorCode: CatalogErrorCode.MediaRefEmptyPath };
  },
  mediaRefInvalidDimension(
    mediaDimension: MediaDimension,
    rawValue: number,
  ): CatalogError.MediaRefInvalidDimension {
    return {
      errorCode: CatalogErrorCode.MediaRefInvalidDimension,
      mediaDimension,
      rawValue,
    };
  },
  mediaRefFocalPointOutOfRange(
    x: number,
    y: number,
  ): CatalogError.MediaRefFocalPointOutOfRange {
    return { errorCode: CatalogErrorCode.MediaRefFocalPointOutOfRange, x, y };
  },
  venuePhoneBlankDisplay(): CatalogError.VenuePhoneBlankDisplay {
    return { errorCode: CatalogErrorCode.VenuePhoneBlankDisplay };
  },
  barberEmptyHandle(): CatalogError.BarberEmptyHandle {
    return { errorCode: CatalogErrorCode.BarberEmptyHandle };
  },
  barberInvalidYearsExperience(
    rawValue: number,
  ): CatalogError.BarberInvalidYearsExperience {
    return {
      errorCode: CatalogErrorCode.BarberInvalidYearsExperience,
      rawValue,
    };
  },
  barberInvalidSortOrder(
    rawValue: number,
  ): CatalogError.BarberInvalidSortOrder {
    return { errorCode: CatalogErrorCode.BarberInvalidSortOrder, rawValue };
  },
  serviceCategoryInvalidSortOrder(
    rawValue: number,
  ): CatalogError.ServiceCategoryInvalidSortOrder {
    return {
      errorCode: CatalogErrorCode.ServiceCategoryInvalidSortOrder,
      rawValue,
    };
  },
  serviceInvalidDuration(
    rawValue: number,
  ): CatalogError.ServiceInvalidDuration {
    return { errorCode: CatalogErrorCode.ServiceInvalidDuration, rawValue };
  },
  serviceInvalidSortOrder(
    rawValue: number,
  ): CatalogError.ServiceInvalidSortOrder {
    return { errorCode: CatalogErrorCode.ServiceInvalidSortOrder, rawValue };
  },
  serviceEmptyBundleIncludes(): CatalogError.ServiceEmptyBundleIncludes {
    return { errorCode: CatalogErrorCode.ServiceEmptyBundleIncludes };
  },
  /** The raw ids are echoed as authored (i18n params), under their brands. */
  serviceUnknownVariantTerms(
    barberId: string,
    variantId: string,
  ): CatalogError.ServiceUnknownVariantTerms {
    return {
      errorCode: CatalogErrorCode.ServiceUnknownVariantTerms,
      barberId: BarberId.of(barberId),
      variantId: ServiceVariantId.of(variantId),
    };
  },
  serviceDuplicateVariantTerms(
    barberId: string,
    variantId: string,
  ): CatalogError.ServiceDuplicateVariantTerms {
    return {
      errorCode: CatalogErrorCode.ServiceDuplicateVariantTerms,
      barberId: BarberId.of(barberId),
      variantId: ServiceVariantId.of(variantId),
    };
  },
  serviceDuplicateVariant(
    variantId: string,
  ): CatalogError.ServiceDuplicateVariant {
    return {
      errorCode: CatalogErrorCode.ServiceDuplicateVariant,
      variantId: ServiceVariantId.of(variantId),
    };
  },
  serviceDuplicateOffering(
    barberId: string,
  ): CatalogError.ServiceDuplicateOffering {
    return {
      errorCode: CatalogErrorCode.ServiceDuplicateOffering,
      barberId: BarberId.of(barberId),
    };
  },
  serviceMixedCurrencyTerms(
    expected: Currency,
    found: Currency,
  ): CatalogError.ServiceMixedCurrencyTerms {
    return {
      errorCode: CatalogErrorCode.ServiceMixedCurrencyTerms,
      expected,
      found,
    };
  },
  locationInvalidGeoCoordinate(
    geoAxis: GeoAxis,
    rawValue: number,
  ): CatalogError.LocationInvalidGeoCoordinate {
    return {
      errorCode: CatalogErrorCode.LocationInvalidGeoCoordinate,
      geoAxis,
      rawValue,
    };
  },
  locationInvalidTimezone(
    rawValue: string,
  ): CatalogError.LocationInvalidTimezone {
    return { errorCode: CatalogErrorCode.LocationInvalidTimezone, rawValue };
  },
  locationInvalidSortOrder(
    rawValue: number,
  ): CatalogError.LocationInvalidSortOrder {
    return { errorCode: CatalogErrorCode.LocationInvalidSortOrder, rawValue };
  },
  locationInvalidMapUrl(rawValue: string): CatalogError.LocationInvalidMapUrl {
    return { errorCode: CatalogErrorCode.LocationInvalidMapUrl, rawValue };
  },
  locationInvalidHoursLength(
    rawLength: number,
  ): CatalogError.LocationInvalidHoursLength {
    return {
      errorCode: CatalogErrorCode.LocationInvalidHoursLength,
      rawLength,
    };
  },
  locationInvalidTimeOfDay(
    rawValue: string,
  ): CatalogError.LocationInvalidTimeOfDay {
    return { errorCode: CatalogErrorCode.LocationInvalidTimeOfDay, rawValue };
  },
  locationInvalidHoursRange(
    dayIndex: number,
  ): CatalogError.LocationInvalidHoursRange {
    return { errorCode: CatalogErrorCode.LocationInvalidHoursRange, dayIndex };
  },

  /** Narrows an error to one code — `CatalogError.is(e, CatalogErrorCode.IdEmpty)`. */
  is<C extends CatalogErrorCode>(
    error: CatalogError,
    errorCode: C,
  ): error is Extract<CatalogError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace CatalogError {
  export type IdEmpty = {
    readonly errorCode: typeof CatalogErrorCode.IdEmpty;
    /** The id type that was blank, e.g. `'ServiceId'`, `'MediaRefId'`. */
    readonly idType: string;
  };
  export type LocalizedTextFieldEmpty = {
    readonly errorCode: typeof CatalogErrorCode.LocalizedTextFieldEmpty;
    readonly locale: Locale;
  };
  export type MediaRefEmptyPath = {
    readonly errorCode: typeof CatalogErrorCode.MediaRefEmptyPath;
  };
  export type MediaRefInvalidDimension = {
    readonly errorCode: typeof CatalogErrorCode.MediaRefInvalidDimension;
    readonly mediaDimension: MediaDimension;
    readonly rawValue: number;
  };
  export type MediaRefFocalPointOutOfRange = {
    readonly errorCode: typeof CatalogErrorCode.MediaRefFocalPointOutOfRange;
    readonly x: number;
    readonly y: number;
  };
  export type VenuePhoneBlankDisplay = {
    readonly errorCode: typeof CatalogErrorCode.VenuePhoneBlankDisplay;
  };
  export type BarberEmptyHandle = {
    readonly errorCode: typeof CatalogErrorCode.BarberEmptyHandle;
  };
  export type BarberInvalidYearsExperience = {
    readonly errorCode: typeof CatalogErrorCode.BarberInvalidYearsExperience;
    readonly rawValue: number;
  };
  export type BarberInvalidSortOrder = {
    readonly errorCode: typeof CatalogErrorCode.BarberInvalidSortOrder;
    readonly rawValue: number;
  };
  export type ServiceCategoryInvalidSortOrder = {
    readonly errorCode: typeof CatalogErrorCode.ServiceCategoryInvalidSortOrder;
    readonly rawValue: number;
  };
  export type ServiceInvalidDuration = {
    readonly errorCode: typeof CatalogErrorCode.ServiceInvalidDuration;
    readonly rawValue: number;
  };
  export type ServiceInvalidSortOrder = {
    readonly errorCode: typeof CatalogErrorCode.ServiceInvalidSortOrder;
    readonly rawValue: number;
  };
  export type ServiceEmptyBundleIncludes = {
    readonly errorCode: typeof CatalogErrorCode.ServiceEmptyBundleIncludes;
  };
  export type ServiceUnknownVariantTerms = {
    readonly errorCode: typeof CatalogErrorCode.ServiceUnknownVariantTerms;
    readonly barberId: BarberId;
    readonly variantId: ServiceVariantId;
  };
  export type ServiceDuplicateVariantTerms = {
    readonly errorCode: typeof CatalogErrorCode.ServiceDuplicateVariantTerms;
    readonly barberId: BarberId;
    readonly variantId: ServiceVariantId;
  };
  export type ServiceDuplicateVariant = {
    readonly errorCode: typeof CatalogErrorCode.ServiceDuplicateVariant;
    readonly variantId: ServiceVariantId;
  };
  export type ServiceDuplicateOffering = {
    readonly errorCode: typeof CatalogErrorCode.ServiceDuplicateOffering;
    readonly barberId: BarberId;
  };
  export type ServiceMixedCurrencyTerms = {
    readonly errorCode: typeof CatalogErrorCode.ServiceMixedCurrencyTerms;
    /** The base terms' currency. */
    readonly expected: Currency;
    /** The first other currency met on the matrix. */
    readonly found: Currency;
  };
  export type LocationInvalidGeoCoordinate = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidGeoCoordinate;
    readonly geoAxis: GeoAxis;
    readonly rawValue: number;
  };
  export type LocationInvalidTimezone = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidTimezone;
    readonly rawValue: string;
  };
  export type LocationInvalidSortOrder = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidSortOrder;
    readonly rawValue: number;
  };
  export type LocationInvalidMapUrl = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidMapUrl;
    readonly rawValue: string;
  };
  export type LocationInvalidHoursLength = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidHoursLength;
    readonly rawLength: number;
  };
  export type LocationInvalidTimeOfDay = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidTimeOfDay;
    /** The text as given; a minute figure that is not a minute of the day is its decimal string. */
    readonly rawValue: string;
  };
  export type LocationInvalidHoursRange = {
    readonly errorCode: typeof CatalogErrorCode.LocationInvalidHoursRange;
    /** `0` = Monday … `6` = Sunday — the index into the seven `DayHours`. */
    readonly dayIndex: number;
  };
}
