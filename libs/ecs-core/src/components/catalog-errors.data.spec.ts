import { describe, expect, it } from 'vitest';
import {
  CatalogError,
  CatalogErrorCode,
  GeoAxis,
  MediaDimension,
} from './catalog-errors.data';
import { Locale } from './locale.data';

describe('CatalogErrorCode', () => {
  it('keeps the 25 legacy catalog codes, unchanged (blueprint §2.2)', () => {
    expect(Object.values(CatalogErrorCode).sort()).toEqual(
      [
        'catalog.id.empty',
        'catalog.localized_text.field_empty',
        'catalog.media_ref.empty_path',
        'catalog.media_ref.invalid_dimension',
        'catalog.media_ref.focal_point_out_of_range',
        'catalog.venue_phone.blank_display',
        'catalog.barber.empty_handle',
        'catalog.barber.invalid_years_experience',
        'catalog.barber.invalid_sort_order',
        'catalog.service_category.invalid_sort_order',
        'catalog.service.invalid_duration',
        'catalog.service.invalid_sort_order',
        'catalog.service.empty_bundle_includes',
        'catalog.service.unknown_variant_terms',
        'catalog.service.duplicate_variant_terms',
        'catalog.service.duplicate_variant',
        'catalog.service.duplicate_offering',
        'catalog.service.mixed_currency_terms',
        'catalog.location.invalid_geo_coordinate',
        'catalog.location.invalid_timezone',
        'catalog.location.invalid_sort_order',
        'catalog.location.invalid_map_url',
        'catalog.location.invalid_hours_length',
        'catalog.location.invalid_time_of_day',
        'catalog.location.invalid_hours_range',
      ].sort(),
    );
  });

  it('pins the parameter vocabularies', () => {
    expect(MediaDimension).toEqual({ Width: 'width', Height: 'height' });
    expect(GeoAxis).toEqual({ Lat: 'lat', Lng: 'lng' });
  });
});

describe('CatalogError factories', () => {
  it('build plain structs whose only non-code fields are i18n scalars', () => {
    const cases: readonly [CatalogError, CatalogError][] = [
      [
        CatalogError.idEmpty('ServiceId'),
        { code: 'catalog.id.empty', idType: 'ServiceId' },
      ],
      [
        CatalogError.localizedTextFieldEmpty(Locale.Bg),
        { code: 'catalog.localized_text.field_empty', locale: 'bg' },
      ],
      [
        CatalogError.mediaRefEmptyPath(),
        { code: 'catalog.media_ref.empty_path' },
      ],
      [
        CatalogError.mediaRefInvalidDimension(MediaDimension.Height, 0),
        {
          code: 'catalog.media_ref.invalid_dimension',
          dimension: 'height',
          rawValue: 0,
        },
      ],
      [
        CatalogError.mediaRefFocalPointOutOfRange(1.5, -1),
        { code: 'catalog.media_ref.focal_point_out_of_range', x: 1.5, y: -1 },
      ],
      [
        CatalogError.venuePhoneBlankDisplay(),
        { code: 'catalog.venue_phone.blank_display' },
      ],
      [
        CatalogError.barberEmptyHandle(),
        { code: 'catalog.barber.empty_handle' },
      ],
      [
        CatalogError.barberInvalidYearsExperience(-1),
        { code: 'catalog.barber.invalid_years_experience', rawValue: -1 },
      ],
      [
        CatalogError.barberInvalidSortOrder(-2),
        { code: 'catalog.barber.invalid_sort_order', rawValue: -2 },
      ],
      [
        CatalogError.serviceCategoryInvalidSortOrder(1.5),
        { code: 'catalog.service_category.invalid_sort_order', rawValue: 1.5 },
      ],
      [
        CatalogError.serviceInvalidDuration(0),
        { code: 'catalog.service.invalid_duration', rawValue: 0 },
      ],
      [
        CatalogError.serviceInvalidSortOrder(-1),
        { code: 'catalog.service.invalid_sort_order', rawValue: -1 },
      ],
      [
        CatalogError.serviceEmptyBundleIncludes(),
        { code: 'catalog.service.empty_bundle_includes' },
      ],
      [
        CatalogError.serviceUnknownVariantTerms('ivan', 'xl'),
        {
          code: 'catalog.service.unknown_variant_terms',
          barberId: 'ivan',
          variantId: 'xl',
        },
      ],
      [
        CatalogError.serviceDuplicateVariantTerms('ivan', 'long'),
        {
          code: 'catalog.service.duplicate_variant_terms',
          barberId: 'ivan',
          variantId: 'long',
        },
      ],
      [
        CatalogError.serviceDuplicateVariant('short'),
        { code: 'catalog.service.duplicate_variant', variantId: 'short' },
      ],
      [
        CatalogError.serviceDuplicateOffering('niko'),
        { code: 'catalog.service.duplicate_offering', barberId: 'niko' },
      ],
      [
        CatalogError.serviceMixedCurrencyTerms('EUR', 'BGN'),
        {
          code: 'catalog.service.mixed_currency_terms',
          expected: 'EUR',
          found: 'BGN',
        },
      ],
      [
        CatalogError.locationInvalidGeoCoordinate(GeoAxis.Lng, 181),
        {
          code: 'catalog.location.invalid_geo_coordinate',
          axis: 'lng',
          rawValue: 181,
        },
      ],
      [
        CatalogError.locationInvalidTimezone('Mars/Base'),
        { code: 'catalog.location.invalid_timezone', rawValue: 'Mars/Base' },
      ],
      [
        CatalogError.locationInvalidSortOrder(-3),
        { code: 'catalog.location.invalid_sort_order', rawValue: -3 },
      ],
      [
        CatalogError.locationInvalidMapUrl('not a url'),
        { code: 'catalog.location.invalid_map_url', rawValue: 'not a url' },
      ],
      [
        CatalogError.locationInvalidHoursLength(6),
        { code: 'catalog.location.invalid_hours_length', rawLength: 6 },
      ],
      [
        CatalogError.locationInvalidTimeOfDay('25:00'),
        { code: 'catalog.location.invalid_time_of_day', rawValue: '25:00' },
      ],
      [
        CatalogError.locationInvalidHoursRange(4),
        { code: 'catalog.location.invalid_hours_range', dayIndex: 4 },
      ],
    ];
    expect(cases).toHaveLength(Object.keys(CatalogErrorCode).length);
    for (const [built, expected] of cases) {
      expect(built).toEqual(expected);
    }
  });

  it('is() narrows by code', () => {
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
