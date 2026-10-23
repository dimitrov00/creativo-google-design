import { describe, expect, it } from 'vitest';
import {
  CatalogError,
  CatalogErrorCode,
  GeoAxis,
  MediaDimension,
} from './catalog.error';
import { Currency, Locale, LocationId } from '@core/primitives';

describe('CatalogErrorCode', () => {
  it('keeps the 26 catalog codes, SCREAMING with the CATALOG_ prefix (flatten-spec §4.2; Phase 4a adds the zone refusal)', () => {
    expect(Object.values(CatalogErrorCode).sort()).toEqual(
      [
        'CATALOG_ID_EMPTY',
        'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
        'CATALOG_MEDIA_REF_EMPTY_PATH',
        'CATALOG_MEDIA_REF_INVALID_DIMENSION',
        'CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE',
        'CATALOG_VENUE_PHONE_BLANK_DISPLAY',
        'CATALOG_BARBER_EMPTY_HANDLE',
        'CATALOG_BARBER_INVALID_YEARS_EXPERIENCE',
        'CATALOG_BARBER_INVALID_SORT_ORDER',
        'CATALOG_SERVICE_CATEGORY_INVALID_SORT_ORDER',
        'CATALOG_SERVICE_INVALID_DURATION',
        'CATALOG_SERVICE_INVALID_SORT_ORDER',
        'CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES',
        'CATALOG_SERVICE_UNKNOWN_VARIANT_TERMS',
        'CATALOG_SERVICE_DUPLICATE_VARIANT_TERMS',
        'CATALOG_SERVICE_DUPLICATE_VARIANT',
        'CATALOG_SERVICE_DUPLICATE_OFFERING',
        'CATALOG_SERVICE_MIXED_CURRENCY_TERMS',
        'CATALOG_LOCATION_INVALID_GEO_COORDINATE',
        'CATALOG_LOCATION_INVALID_TIMEZONE',
        'CATALOG_LOCATION_INVALID_SORT_ORDER',
        'CATALOG_LOCATION_INVALID_MAP_URL',
        'CATALOG_LOCATION_INVALID_HOURS_LENGTH',
        'CATALOG_LOCATION_INVALID_TIME_OF_DAY',
        'CATALOG_LOCATION_INVALID_HOURS_RANGE',
        'CATALOG_LOCATION_ZONE_UNKNOWN',
      ].sort(),
    );
  });

  it('pins the parameter vocabularies', () => {
    expect(MediaDimension).toEqual({ Width: 'WIDTH', Height: 'HEIGHT' });
    expect(GeoAxis).toEqual({ Lat: 'LAT', Lng: 'LNG' });
  });
});

describe('CatalogError factories', () => {
  it('build plain structs whose only non-errorCode fields are i18n scalars', () => {
    // The expected side is the plain serialised struct — brands erase to text.
    const cases: readonly [CatalogError, object][] = [
      [
        CatalogError.idEmpty('ServiceId'),
        { errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceId' },
      ],
      [
        CatalogError.localizedTextFieldEmpty(Locale.Bg),
        { errorCode: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY', locale: 'bg' },
      ],
      [
        CatalogError.mediaRefEmptyPath(),
        { errorCode: 'CATALOG_MEDIA_REF_EMPTY_PATH' },
      ],
      [
        CatalogError.mediaRefInvalidDimension(MediaDimension.Height, 0),
        {
          errorCode: 'CATALOG_MEDIA_REF_INVALID_DIMENSION',
          mediaDimension: 'HEIGHT',
          rawValue: 0,
        },
      ],
      [
        CatalogError.mediaRefFocalPointOutOfRange(1.5, -1),
        {
          errorCode: 'CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE',
          x: 1.5,
          y: -1,
        },
      ],
      [
        CatalogError.venuePhoneBlankDisplay(),
        { errorCode: 'CATALOG_VENUE_PHONE_BLANK_DISPLAY' },
      ],
      [
        CatalogError.barberEmptyHandle(),
        { errorCode: 'CATALOG_BARBER_EMPTY_HANDLE' },
      ],
      [
        CatalogError.barberInvalidYearsExperience(-1),
        { errorCode: 'CATALOG_BARBER_INVALID_YEARS_EXPERIENCE', rawValue: -1 },
      ],
      [
        CatalogError.barberInvalidSortOrder(-2),
        { errorCode: 'CATALOG_BARBER_INVALID_SORT_ORDER', rawValue: -2 },
      ],
      [
        CatalogError.serviceCategoryInvalidSortOrder(1.5),
        {
          errorCode: 'CATALOG_SERVICE_CATEGORY_INVALID_SORT_ORDER',
          rawValue: 1.5,
        },
      ],
      [
        CatalogError.serviceInvalidDuration(0),
        { errorCode: 'CATALOG_SERVICE_INVALID_DURATION', rawValue: 0 },
      ],
      [
        CatalogError.serviceInvalidSortOrder(-1),
        { errorCode: 'CATALOG_SERVICE_INVALID_SORT_ORDER', rawValue: -1 },
      ],
      [
        CatalogError.serviceEmptyBundleIncludes(),
        { errorCode: 'CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES' },
      ],
      [
        CatalogError.serviceUnknownVariantTerms('ivan', 'xl'),
        {
          errorCode: 'CATALOG_SERVICE_UNKNOWN_VARIANT_TERMS',
          barberId: 'ivan',
          variantId: 'xl',
        },
      ],
      [
        CatalogError.serviceDuplicateVariantTerms('ivan', 'long'),
        {
          errorCode: 'CATALOG_SERVICE_DUPLICATE_VARIANT_TERMS',
          barberId: 'ivan',
          variantId: 'long',
        },
      ],
      [
        CatalogError.serviceDuplicateVariant('short'),
        { errorCode: 'CATALOG_SERVICE_DUPLICATE_VARIANT', variantId: 'short' },
      ],
      [
        CatalogError.serviceDuplicateOffering('niko'),
        { errorCode: 'CATALOG_SERVICE_DUPLICATE_OFFERING', barberId: 'niko' },
      ],
      [
        CatalogError.serviceMixedCurrencyTerms(Currency.EUR, Currency.BGN),
        {
          errorCode: 'CATALOG_SERVICE_MIXED_CURRENCY_TERMS',
          expected: 'EUR',
          found: 'BGN',
        },
      ],
      [
        CatalogError.locationInvalidGeoCoordinate(GeoAxis.Lng, 181),
        {
          errorCode: 'CATALOG_LOCATION_INVALID_GEO_COORDINATE',
          geoAxis: 'LNG',
          rawValue: 181,
        },
      ],
      [
        CatalogError.locationInvalidTimezone('Mars/Base'),
        {
          errorCode: 'CATALOG_LOCATION_INVALID_TIMEZONE',
          rawValue: 'Mars/Base',
        },
      ],
      [
        CatalogError.locationInvalidSortOrder(-3),
        { errorCode: 'CATALOG_LOCATION_INVALID_SORT_ORDER', rawValue: -3 },
      ],
      [
        CatalogError.locationInvalidMapUrl('not a url'),
        {
          errorCode: 'CATALOG_LOCATION_INVALID_MAP_URL',
          rawValue: 'not a url',
        },
      ],
      [
        CatalogError.locationInvalidHoursLength(6),
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_LENGTH', rawLength: 6 },
      ],
      [
        CatalogError.locationInvalidTimeOfDay('25:00'),
        {
          errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY',
          rawValue: '25:00',
        },
      ],
      [
        CatalogError.locationInvalidHoursRange(4),
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_RANGE', dayIndex: 4 },
      ],
      [
        CatalogError.locationZoneUnknown(LocationId.of('loc-center')),
        {
          errorCode: 'CATALOG_LOCATION_ZONE_UNKNOWN',
          locationId: 'loc-center',
        },
      ],
    ];
    expect(cases).toHaveLength(Object.keys(CatalogErrorCode).length);
    for (const [built, expected] of cases) {
      expect(built).toEqual(expected);
    }
  });

  it('is() narrows by errorCode', () => {
    const error: CatalogError = CatalogError.serviceUnknownVariantTerms(
      'ivan',
      'xl',
    );
    expect(
      CatalogError.is(error, CatalogErrorCode.ServiceUnknownVariantTerms),
    ).toBe(true);
    expect(CatalogError.is(error, CatalogErrorCode.IdEmpty)).toBe(false);
    if (CatalogError.is(error, CatalogErrorCode.ServiceUnknownVariantTerms)) {
      expect(error.variantId).toBe('xl');
    }
  });
});
