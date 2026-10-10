import { describe, expect, it } from 'vitest';
import {
  ServiceTerms,
  ServiceVariant,
  ServiceVariantId,
} from './service-terms.data';

const terms = (overrides: Partial<ServiceTerms> = {}): ServiceTerms => ({
  ...ServiceTerms.unpadded(1500, 'EUR', 45),
  ...overrides,
});

// catalog service-terms.spec.ts, on the stored struct.
describe('ServiceTerms — setup and cleanup', () => {
  it('defaults both pads to zero, so an unpadded service occupies exactly its duration', () => {
    const bare = ServiceTerms.unpadded(1500, 'EUR', 45);
    expect(bare.setupMinutes).toBe(0);
    expect(bare.cleanupMinutes).toBe(0);
    expect(ServiceTerms.occupiedMinutes(bare)).toBe(45);
  });

  it('keeps the pads OUTSIDE the sold duration', () => {
    // The client is quoted and charged for 45 minutes; the chair is held for 60.
    const padded = ServiceTerms.of(1500, 'EUR', 45, 5, 10);
    expect(padded.durationMinutes).toBe(45);
    expect(ServiceTerms.occupiedMinutes(padded)).toBe(60);
  });

  it('rejects a negative or fractional pad', () => {
    expect(ServiceTerms.parse(terms({ cleanupMinutes: -5 }))).toEqual({
      ok: false,
      error: [{ code: 'catalog.service.invalid_duration', rawValue: -5 }],
    });
    expect(ServiceTerms.parse(terms({ setupMinutes: 2.5 })).ok).toBe(false);
  });

  it('distinguishes terms that differ only in their padding', () => {
    expect(ServiceTerms.equals(terms(), terms({ cleanupMinutes: 10 }))).toBe(
      false,
    );
    expect(ServiceTerms.equals(terms(), terms())).toBe(true);
  });
});

describe('ServiceTerms.parse', () => {
  it('accepts valid terms and normalises the currency code', () => {
    expect(ServiceTerms.parse(terms({ currencyCode: ' eur ' }))).toEqual({
      ok: true,
      value: {
        priceMinorUnits: 1500,
        currencyCode: 'EUR',
        durationMinutes: 45,
        setupMinutes: 0,
        cleanupMinutes: 0,
      },
    });
  });

  it('accepts a free service', () => {
    expect(ServiceTerms.parse(terms({ priceMinorUnits: 0 })).ok).toBe(true);
  });

  it('rejects a zero, negative or fractional duration', () => {
    for (const durationMinutes of [0, -15, 30.5]) {
      expect(ServiceTerms.parse(terms({ durationMinutes }))).toEqual({
        ok: false,
        error: [
          {
            code: 'catalog.service.invalid_duration',
            rawValue: durationMinutes,
          },
        ],
      });
    }
  });

  it('rejects an unknown currency code and a negative price as money errors', () => {
    expect(ServiceTerms.parse(terms({ currencyCode: 'XYZ' }))).toEqual({
      ok: false,
      error: [{ code: 'money.unknown_currency', rawCode: 'XYZ' }],
    });
    expect(ServiceTerms.parse(terms({ priceMinorUnits: -100 }))).toEqual({
      ok: false,
      error: [{ code: 'money.invalid_amount', rawAmount: -100 }],
    });
  });

  it('collects every violation at once', () => {
    const result = ServiceTerms.parse({
      priceMinorUnits: 12.5,
      currencyCode: 'EUR',
      durationMinutes: 0,
      setupMinutes: -1,
      cleanupMinutes: 1.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((e) => e.code)).toEqual([
        'money.invalid_amount',
        'catalog.service.invalid_duration',
        'catalog.service.invalid_duration',
        'catalog.service.invalid_duration',
      ]);
    }
  });
});

describe('ServiceTerms.price', () => {
  it('lifts the flat pair into a standalone Money figure', () => {
    expect(ServiceTerms.price(terms())).toEqual({
      amountMinorUnits: 1500,
      currencyCode: 'EUR',
    });
  });
});

describe('ServiceVariant.parse', () => {
  const name = { bg: 'Къса коса', en: 'Short hair' };

  it('accepts an author-chosen slug and trims the name', () => {
    expect(
      ServiceVariant.parse({
        id: 'short',
        name: { bg: ' Къса коса ', en: 'Short hair' },
      }),
    ).toEqual({
      ok: true,
      value: { id: ServiceVariantId.of('short'), name },
    });
  });

  it('rejects a blank id and blank name fields together', () => {
    const result = ServiceVariant.parse({
      id: '  ',
      name: { bg: '', en: 'Short' },
    });
    expect(result).toEqual({
      ok: false,
      error: [
        { code: 'catalog.id.empty', idType: 'ServiceVariantId' },
        { code: 'catalog.localized_text.field_empty', locale: 'bg' },
      ],
    });
  });

  it('reports a blank id alone when the name is fine', () => {
    expect(ServiceVariant.parse({ id: '', name })).toEqual({
      ok: false,
      error: [{ code: 'catalog.id.empty', idType: 'ServiceVariantId' }],
    });
  });
});

describe('ServiceVariant.parseAll', () => {
  const short = { id: 'short', name: { bg: 'Къса', en: 'Short' } };
  const long = { id: 'long', name: { bg: 'Дълга', en: 'Long' } };

  it('keeps declaration order', () => {
    const result = ServiceVariant.parseAll([short, long]);
    expect(result.ok && result.value.map((v) => v.id)).toEqual([
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
        { code: 'catalog.service.duplicate_variant', variantId: 'short' },
      ],
    });
  });

  it('reports each variant’s own violations beside the duplicates', () => {
    const result = ServiceVariant.parseAll([
      { id: 'x', name: { bg: 'X', en: '' } },
      { id: 'x', name: { bg: 'X', en: 'X' } },
    ]);
    expect(result.ok === false && result.error.map((e) => e.code)).toEqual([
      'catalog.localized_text.field_empty',
      'catalog.service.duplicate_variant',
    ]);
  });
});
