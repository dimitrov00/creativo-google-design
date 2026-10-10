import { describe, expect, it } from 'vitest';
import { BarberId } from '../entities/barber.entity';
import {
  BarberOffering,
  type BarberOfferingInput,
} from './barber-offering.data';
import {
  ServiceTerms,
  ServiceVariantId,
  type ServiceVariant,
} from './service-terms.data';

const SHORT = ServiceVariantId.of('short');
const LONG = ServiceVariantId.of('long');
const VARIANTS: readonly ServiceVariant[] = [
  { id: SHORT, name: { bg: 'Къса', en: 'Short' } },
  { id: LONG, name: { bg: 'Дълга', en: 'Long' } },
];

// The seed's classic cut (tools/seed/catalog.mjs): Ivan prices both lengths,
// Niko prices only short differently, Stefan has a base only.
const IVAN: BarberOffering = {
  barberId: BarberId.of('ivan'),
  base: ServiceTerms.unpadded(1450, 'EUR', 35),
  overrides: [
    { variantId: SHORT, terms: ServiceTerms.unpadded(1450, 'EUR', 35) },
    { variantId: LONG, terms: ServiceTerms.unpadded(1850, 'EUR', 50) },
  ],
};
const NIKO: BarberOffering = {
  barberId: BarberId.of('niko'),
  base: ServiceTerms.unpadded(1300, 'EUR', 30),
  overrides: [
    { variantId: SHORT, terms: ServiceTerms.unpadded(1300, 'EUR', 30) },
  ],
};

function input(
  overrides: Partial<BarberOfferingInput> = {},
): BarberOfferingInput {
  return {
    barberId: 'ivan',
    base: ServiceTerms.unpadded(1450, 'EUR', 35),
    overrides: [
      { variantId: 'long', terms: ServiceTerms.unpadded(1850, 'EUR', 50) },
    ],
    ...overrides,
  };
}

// catalog service.spec.ts "terms matrix", per offering.
describe('BarberOffering.termsFor', () => {
  it('resolves a variant to that barber’s override', () => {
    const resolved = BarberOffering.termsFor(IVAN, LONG);
    expect(resolved.priceMinorUnits).toBe(1850);
    expect(resolved.durationMinutes).toBe(50);
  });

  it('falls back to the barber’s base when they don’t price that variant', () => {
    expect(BarberOffering.termsFor(NIKO, LONG).priceMinorUnits).toBe(1300);
  });

  it('falls back to the base when no variant was chosen', () => {
    expect(BarberOffering.termsFor(IVAN, null)).toBe(IVAN.base);
  });
});

describe('BarberOffering.allTerms', () => {
  it('lists base first, then every override in order', () => {
    expect(BarberOffering.allTerms(IVAN).map((t) => t.priceMinorUnits)).toEqual(
      [1450, 1450, 1850],
    );
    expect(BarberOffering.allTerms({ ...NIKO, overrides: [] })).toEqual([
      NIKO.base,
    ]);
  });
});

describe('BarberOffering.parse', () => {
  it('accepts a valid offering, brands the ids and normalises the terms', () => {
    const result = BarberOffering.parse(
      input({ base: { ...ServiceTerms.unpadded(1450, 'eur', 35) } }),
      VARIANTS,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        barberId: 'ivan',
        base: ServiceTerms.unpadded(1450, 'EUR', 35),
        overrides: [
          { variantId: 'long', terms: ServiceTerms.unpadded(1850, 'EUR', 50) },
        ],
      },
    });
  });

  it('rejects an override naming a variant the service does not offer', () => {
    expect(
      BarberOffering.parse(
        input({
          overrides: [
            { variantId: 'xl', terms: ServiceTerms.unpadded(2000, 'EUR', 60) },
          ],
        }),
        VARIANTS,
      ),
    ).toEqual({
      ok: false,
      error: [
        {
          code: 'catalog.service.unknown_variant_terms',
          barberId: 'ivan',
          variantId: 'xl',
        },
      ],
    });
  });

  it('rejects a variant priced twice', () => {
    const long = {
      variantId: 'long',
      terms: ServiceTerms.unpadded(1850, 'EUR', 50),
    };
    expect(
      BarberOffering.parse(input({ overrides: [long, long] }), VARIANTS),
    ).toEqual({
      ok: false,
      error: [
        {
          code: 'catalog.service.duplicate_variant_terms',
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
        base: ServiceTerms.unpadded(1450, 'EUR', 0),
        overrides: [
          { variantId: 'short', terms: ServiceTerms.unpadded(-1, 'EUR', 30) },
        ],
      },
      VARIANTS,
    );
    expect(result.ok === false && result.error).toEqual([
      { code: 'catalog.id.empty', idType: 'BarberId' },
      { code: 'catalog.service.invalid_duration', rawValue: 0 },
      { code: 'money.invalid_amount', rawAmount: -1 },
    ]);
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
      error: [{ code: 'catalog.service.duplicate_offering', barberId: 'ivan' }],
    });
  });

  it('reports each offering’s own violations', () => {
    const result = BarberOffering.parseAll(
      [input({ base: ServiceTerms.unpadded(1450, 'EUR', -5) })],
      VARIANTS,
    );
    expect(result.ok === false && result.error.map((e) => e.code)).toEqual([
      'catalog.service.invalid_duration',
    ]);
  });
});

describe('BarberOffering.mixedCurrency', () => {
  const base = ServiceTerms.unpadded(1500, 'EUR', 30);

  it('is null when the whole matrix shares the base currency', () => {
    expect(BarberOffering.mixedCurrency(base, [IVAN, NIKO])).toBeNull();
    expect(BarberOffering.mixedCurrency(base, [])).toBeNull();
  });

  it('reports a foreign currency on an offering’s base', () => {
    const leva = { ...NIKO, base: ServiceTerms.unpadded(2500, 'BGN', 30) };
    expect(BarberOffering.mixedCurrency(base, [IVAN, leva])).toEqual({
      code: 'catalog.service.mixed_currency_terms',
      expected: 'EUR',
      found: 'BGN',
    });
  });

  it('reports a foreign currency on an override', () => {
    const leva: BarberOffering = {
      ...IVAN,
      overrides: [
        { variantId: LONG, terms: ServiceTerms.unpadded(3600, 'BGN', 50) },
      ],
    };
    expect(BarberOffering.mixedCurrency(base, [leva])).toEqual({
      code: 'catalog.service.mixed_currency_terms',
      expected: 'EUR',
      found: 'BGN',
    });
  });
});
