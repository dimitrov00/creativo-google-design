import { describe, expect, it } from 'vitest';
import {
  cents,
  deepFreeze,
  duration,
  EUR,
  minuteCount,
  termsFixture,
} from '@core/testing';
import { ServiceTerms } from './service-terms.data';
import type { ServiceTermsInput } from './service-terms-input.data';

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

describe('ServiceTerms.fieldFault — the read-time check of stored terms (edge hardening D-1)', () => {
  it('answers null for terms as a writer stores them', () => {
    expect(ServiceTerms.fieldFault(termsFixture(2800, 30))).toBeNull();
    expect(
      ServiceTerms.fieldFault({ ...termsFixture(0, 5), currency: 'BGN' }),
    ).toBeNull();
  });

  it('names each field broken in turn, in field order', () => {
    const terms = termsFixture(2800, 30);
    const broken = [
      ['priceCents', -1],
      ['priceCents', 28.5],
      ['currency', 'eur'],
      ['currency', 'CHF'],
      ['durationMinutes', 0],
      ['durationMinutes', '30'],
      ['setupMinutes', -5],
      ['cleanupMinutes', null],
    ] as const;
    for (const [field, value] of broken) {
      expect(ServiceTerms.fieldFault({ ...terms, [field]: value })).toBe(field);
    }
    expect(
      ServiceTerms.fieldFault({ ...terms, priceCents: -1, cleanupMinutes: -1 }),
    ).toBe('priceCents');
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze({ ...termsFixture(2800, 30), currency: 'eur' });
    expect(ServiceTerms.fieldFault(raw)).toBe(ServiceTerms.fieldFault(raw));
    expect(raw.currency).toBe('eur');
  });
});
