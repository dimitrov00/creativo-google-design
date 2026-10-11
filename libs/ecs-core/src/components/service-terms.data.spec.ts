import { describe, expect, it } from 'vitest';
import {
  cents,
  duration,
  EUR,
  minuteCount,
  termsFixture,
} from '../testing/booking-core.fixtures';
import { ServiceVariantId } from '../primitives/ids.primitive';
import {
  ServiceTerms,
  type ServiceTermsInput,
  ServiceVariant,
} from './service-terms.data';

const terms = (overrides: Partial<ServiceTerms> = {}): ServiceTerms => ({
  ...termsFixture(1500, 45),
  ...overrides,
});

/** Raw authored terms — the edge guard's input. */
const input = (
  overrides: Partial<ServiceTermsInput> = {},
): ServiceTermsInput => ({
  priceCents: 1500,
  currency: 'EUR',
  durationMinutes: 45,
  setupMinutes: 0,
  cleanupMinutes: 0,
  ...overrides,
});

// catalog service-terms.spec.ts, on the flat slice.
describe('ServiceTerms — setup and cleanup', () => {
  it('defaults both pads to zero, so an unpadded service occupies exactly its duration', () => {
    const bare = ServiceTerms.unpadded(cents(1500), EUR, duration(45));
    expect(bare.setupMinutes).toBe(0);
    expect(bare.cleanupMinutes).toBe(0);
    expect(ServiceTerms.occupiedMinutes(bare)).toBe(45);
  });

  it('keeps the pads OUTSIDE the sold duration', () => {
    // The client is quoted and charged for 45 minutes; the chair is held for 60.
    const padded = ServiceTerms.of(
      cents(1500),
      EUR,
      duration(45),
      minuteCount(5),
      minuteCount(10),
    );
    expect(padded.durationMinutes).toBe(45);
    expect(ServiceTerms.occupiedMinutes(padded)).toBe(60);
  });

  it('rejects a negative or fractional pad', () => {
    expect(ServiceTerms.parse(input({ cleanupMinutes: -5 }))).toEqual({
      ok: false,
      error: [{ errorCode: 'CATALOG_SERVICE_INVALID_DURATION', rawValue: -5 }],
    });
    expect(ServiceTerms.parse(input({ setupMinutes: 2.5 })).ok).toBe(false);
  });

  it('distinguishes terms that differ only in their padding', () => {
    expect(
      ServiceTerms.equals(terms(), terms({ cleanupMinutes: minuteCount(10) })),
    ).toBe(false);
    expect(ServiceTerms.equals(terms(), terms())).toBe(true);
  });
});

describe('ServiceTerms.parse', () => {
  it('accepts valid terms and normalises the currency code', () => {
    expect(ServiceTerms.parse(input({ currency: ' eur ' }))).toEqual({
      ok: true,
      value: {
        priceCents: 1500,
        currency: 'EUR',
        durationMinutes: 45,
        setupMinutes: 0,
        cleanupMinutes: 0,
      },
    });
  });

  it('accepts a free service', () => {
    expect(ServiceTerms.parse(input({ priceCents: 0 })).ok).toBe(true);
  });

  it('rejects a zero, negative or fractional duration', () => {
    for (const durationMinutes of [0, -15, 30.5]) {
      expect(ServiceTerms.parse(input({ durationMinutes }))).toEqual({
        ok: false,
        error: [
          {
            errorCode: 'CATALOG_SERVICE_INVALID_DURATION',
            rawValue: durationMinutes,
          },
        ],
      });
    }
  });

  it('rejects an unknown currency code and a negative price as money errors', () => {
    const unknown = ServiceTerms.parse(input({ currency: 'XYZ' }));
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error).toEqual([
      expect.objectContaining({ rawCode: 'XYZ' }),
    ]);
    const negative = ServiceTerms.parse(input({ priceCents: -100 }));
    expect(negative.ok).toBe(false);
    expect(!negative.ok && negative.error).toEqual([
      expect.objectContaining({ rawAmount: -100 }),
    ]);
  });

  it('collects every violation at once', () => {
    const result = ServiceTerms.parse({
      priceCents: 12.5,
      currency: 'EUR',
      durationMinutes: 0,
      setupMinutes: -1,
      cleanupMinutes: 1.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveLength(4);
      expect(result.error[0]).toEqual(
        expect.objectContaining({ rawAmount: 12.5 }),
      );
      expect(result.error.slice(1)).toEqual([
        { errorCode: 'CATALOG_SERVICE_INVALID_DURATION', rawValue: 0 },
        { errorCode: 'CATALOG_SERVICE_INVALID_DURATION', rawValue: -1 },
        { errorCode: 'CATALOG_SERVICE_INVALID_DURATION', rawValue: 1.5 },
      ]);
    }
  });
});

describe('ServiceTerms.price', () => {
  it('lifts the flat pair into a standalone Money figure', () => {
    expect(ServiceTerms.price(terms())).toEqual({
      amountCents: 1500,
      currency: 'EUR',
    });
  });
});

describe('ServiceVariant.parse', () => {
  const name = { bg: 'Къса коса', en: 'Short hair' };

  it('accepts an author-chosen slug and trims the name', () => {
    expect(
      ServiceVariant.parse({
        variantId: 'short',
        name: { bg: ' Къса коса ', en: 'Short hair' },
      }),
    ).toEqual({
      ok: true,
      value: { variantId: ServiceVariantId.of('short'), name },
    });
  });

  it('rejects a blank id and blank name fields together', () => {
    const result = ServiceVariant.parse({
      variantId: '  ',
      name: { bg: '', en: 'Short' },
    });
    expect(result).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceVariantId' },
        { errorCode: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY', locale: 'bg' },
      ],
    });
  });

  it('reports a blank id alone when the name is fine', () => {
    expect(ServiceVariant.parse({ variantId: '', name })).toEqual({
      ok: false,
      error: [{ errorCode: 'CATALOG_ID_EMPTY', idType: 'ServiceVariantId' }],
    });
  });
});

describe('ServiceVariant.parseAll', () => {
  const short = { variantId: 'short', name: { bg: 'Къса', en: 'Short' } };
  const long = { variantId: 'long', name: { bg: 'Дълга', en: 'Long' } };

  it('keeps declaration order', () => {
    const result = ServiceVariant.parseAll([short, long]);
    expect(result.ok && result.value.map((v) => v.variantId)).toEqual([
      'short',
      'long',
    ]);
  });

  it('accepts no variants — no variant step when booking', () => {
    expect(ServiceVariant.parseAll([])).toEqual({ ok: true, value: [] });
  });

  it('rejects a duplicate variant declaration', () => {
    expect(ServiceVariant.parseAll([short, long, short])).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_SERVICE_DUPLICATE_VARIANT', variantId: 'short' },
      ],
    });
  });

  it('reports each variant’s own violations beside the duplicates', () => {
    const result = ServiceVariant.parseAll([
      { variantId: 'x', name: { bg: 'X', en: '' } },
      { variantId: 'x', name: { bg: 'X', en: 'X' } },
    ]);
    expect(result.ok === false && result.error.map((e) => e.errorCode)).toEqual(
      [
        'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
        'CATALOG_SERVICE_DUPLICATE_VARIANT',
      ],
    );
  });
});
