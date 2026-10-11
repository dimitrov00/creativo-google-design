import { describe, expect, it } from 'vitest';
import { termsFixture } from '../testing/booking-core.fixtures';
import { Currency } from '../primitives/currency.primitive';
import { BarberId, ServiceVariantId } from '../primitives/ids.primitive';
import {
  BarberOffering,
  type BarberOfferingInput,
} from './barber-offering.data';
import type { ServiceTermsInput, ServiceVariant } from './service-terms.data';

const SHORT = ServiceVariantId.of('short');
const LONG = ServiceVariantId.of('long');
const VARIANTS: readonly ServiceVariant[] = [
  { variantId: SHORT, name: { bg: 'Къса', en: 'Short' } },
  { variantId: LONG, name: { bg: 'Дълга', en: 'Long' } },
];

// The seed's classic cut (tools/seed/catalog.mjs): Ivan prices both lengths,
// Niko prices only short differently, Stefan has a base only.
const IVAN: BarberOffering = {
  barberId: BarberId.of('ivan'),
  ...termsFixture(1450, 35),
  overrides: [
    { variantId: SHORT, ...termsFixture(1450, 35) },
    { variantId: LONG, ...termsFixture(1850, 50) },
  ],
};
const NIKO: BarberOffering = {
  barberId: BarberId.of('niko'),
  ...termsFixture(1300, 30),
  overrides: [{ variantId: SHORT, ...termsFixture(1300, 30) }],
};

/** Raw authored terms — `{ priceCents, currency, durationMinutes, … }`. */
function rawTerms(
  priceCents: number,
  durationMinutes: number,
  currency = 'EUR',
): ServiceTermsInput {
  return {
    priceCents,
    currency,
    durationMinutes,
    setupMinutes: 0,
    cleanupMinutes: 0,
  };
}

function input(
  overrides: Partial<BarberOfferingInput> = {},
): BarberOfferingInput {
  return {
    barberId: 'ivan',
    ...rawTerms(1450, 35),
    overrides: [{ variantId: 'long', ...rawTerms(1850, 50) }],
    ...overrides,
  };
}

// catalog service.spec.ts "terms matrix", per offering.
describe('BarberOffering.termsFor', () => {
  it('resolves a variant to that barber’s override', () => {
    const resolved = BarberOffering.termsFor(IVAN, LONG);
    expect(resolved.priceCents).toBe(1850);
    expect(resolved.durationMinutes).toBe(50);
  });

  it('falls back to the barber’s base when they don’t price that variant', () => {
    expect(BarberOffering.termsFor(NIKO, LONG).priceCents).toBe(1300);
  });

  it('falls back to the base — the offering itself — when no variant was chosen', () => {
    expect(BarberOffering.termsFor(IVAN, null)).toBe(IVAN);
  });
});

describe('BarberOffering.allTerms', () => {
  it('lists base first, then every override in order', () => {
    expect(BarberOffering.allTerms(IVAN).map((t) => t.priceCents)).toEqual([
      1450, 1450, 1850,
    ]);
    const bare = { ...NIKO, overrides: [] };
    expect(BarberOffering.allTerms(bare)).toEqual([bare]);
  });
});

describe('BarberOffering.parse', () => {
  it('accepts a valid offering, brands the ids and normalises the terms', () => {
    const result = BarberOffering.parse(input({ currency: 'eur' }), VARIANTS);
    expect(result).toEqual({
      ok: true,
      value: {
        barberId: 'ivan',
        ...termsFixture(1450, 35),
        overrides: [{ variantId: 'long', ...termsFixture(1850, 50) }],
      },
    });
  });

  it('rejects an override naming a variant the service does not offer', () => {
    expect(
      BarberOffering.parse(
        input({ overrides: [{ variantId: 'xl', ...rawTerms(2000, 60) }] }),
        VARIANTS,
      ),
    ).toEqual({
      ok: false,
      error: [
        {
          errorCode: 'CATALOG_SERVICE_UNKNOWN_VARIANT_TERMS',
          barberId: 'ivan',
          variantId: 'xl',
        },
      ],
    });
  });

  it('rejects a variant priced twice', () => {
    const long = { variantId: 'long', ...rawTerms(1850, 50) };
    expect(
      BarberOffering.parse(input({ overrides: [long, long] }), VARIANTS),
    ).toEqual({
      ok: false,
      error: [
        {
          errorCode: 'CATALOG_SERVICE_DUPLICATE_VARIANT_TERMS',
          barberId: 'ivan',
          variantId: 'long',
        },
      ],
    });
  });

  it('collects a blank barber id, bad base terms and bad override terms together', () => {
    const result = BarberOffering.parse(
      {
        barberId: ' ',
        ...rawTerms(1450, 0),
        overrides: [{ variantId: 'short', ...rawTerms(-1, 30) }],
      },
      VARIANTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.slice(0, 2)).toEqual([
        { errorCode: 'CATALOG_ID_EMPTY', idType: 'BarberId' },
        { errorCode: 'CATALOG_SERVICE_INVALID_DURATION', rawValue: 0 },
      ]);
      expect(result.error[2]).toEqual(
        expect.objectContaining({ rawAmount: -1 }),
      );
      expect(result.error).toHaveLength(3);
    }
  });

  it('accepts an offering with no overrides — sparse by construction', () => {
    const result = BarberOffering.parse(input({ overrides: [] }), []);
    expect(result.ok && result.value.overrides).toEqual([]);
  });
});

describe('BarberOffering.parseAll', () => {
  it('keeps declaration order', () => {
    const result = BarberOffering.parseAll(
      [input(), input({ barberId: 'niko', overrides: [] })],
      VARIANTS,
    );
    expect(result.ok && result.value.map((o) => o.barberId)).toEqual([
      'ivan',
      'niko',
    ]);
  });

  it('rejects the same barber offering twice', () => {
    expect(BarberOffering.parseAll([input(), input()], VARIANTS)).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_SERVICE_DUPLICATE_OFFERING', barberId: 'ivan' },
      ],
    });
  });

  it('reports each offering’s own violations', () => {
    const result = BarberOffering.parseAll(
      [input({ durationMinutes: -5 })],
      VARIANTS,
    );
    expect(
      result.ok === false &&
        result.error.map((e) => ('errorCode' in e ? e.errorCode : null)),
    ).toEqual(['CATALOG_SERVICE_INVALID_DURATION']);
  });
});

describe('BarberOffering.mixedCurrency', () => {
  const base = termsFixture(1500, 30);

  it('is null when the whole matrix shares the base currency', () => {
    expect(BarberOffering.mixedCurrency(base, [IVAN, NIKO])).toBeNull();
    expect(BarberOffering.mixedCurrency(base, [])).toBeNull();
  });

  it('reports a foreign currency on an offering’s base', () => {
    const leva = { ...NIKO, ...termsFixture(2500, 30, 0, 0, Currency.BGN) };
    expect(BarberOffering.mixedCurrency(base, [IVAN, leva])).toEqual({
      errorCode: 'CATALOG_SERVICE_MIXED_CURRENCY_TERMS',
      expected: 'EUR',
      found: 'BGN',
    });
  });

  it('reports a foreign currency on an override', () => {
    const leva: BarberOffering = {
      ...IVAN,
      overrides: [
        { variantId: LONG, ...termsFixture(3600, 50, 0, 0, Currency.BGN) },
      ],
    };
    expect(BarberOffering.mixedCurrency(base, [leva])).toEqual({
      errorCode: 'CATALOG_SERVICE_MIXED_CURRENCY_TERMS',
      expected: 'EUR',
      found: 'BGN',
    });
  });
});
