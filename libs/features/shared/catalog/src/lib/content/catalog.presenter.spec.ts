import {
  CompositionKind,
  Money,
  ServiceComposition,
  ServiceVariant,
} from '@core/components';
import type { Service } from '@core/entities';
import {
  BarberId,
  Currency,
  ServiceId,
  ServiceVariantId,
} from '@core/primitives';
import {
  barberFixture,
  cents,
  duration,
  serviceFixture,
  termsFixture,
} from '@core/testing';
import {
  barberToVm,
  formatServiceMeta,
  serviceCardPrice,
  serviceDurationRange,
  servicePriceFrom,
  serviceToVm,
  termsPrice,
  termsToVm,
} from './catalog.presenter';

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const LONG = ServiceVariantId.of('long');

/**
 * A cut two barbers perform: Ivan at 14,50 € / 35 min (18,50 € / 50 min for
 * long hair), Niko at 13,00 € / 30 min — every figure in `currency`.
 */
function cut(currency: Currency = Currency.EUR): Service {
  const variants = ServiceVariant.parseAll([
    { variantId: 'long', name: { en: 'Long hair', bg: 'Дълга коса' } },
  ]);
  if (!variants.ok) throw new Error('fixture variant refused');
  const ivan = termsFixture(1450, 35, 0, 0, currency);
  return serviceFixture({
    id: ServiceId.of('svc-cut'),
    ...ivan,
    variants: variants.value,
    offerings: [
      {
        barberId: IVAN,
        ...ivan,
        overrides: [
          { variantId: LONG, ...termsFixture(1850, 50, 0, 0, currency) },
        ],
      },
      {
        barberId: NIKO,
        ...termsFixture(1300, 30, 0, 0, currency),
        overrides: [],
      },
    ],
  });
}

describe('catalog.presenter — the service view model carries cents, currency and brands', () => {
  it('carries the catalogue’s figures as the system answered them, in the stored currency', () => {
    const vm = serviceToVm(cut(), undefined, undefined);
    expect(vm.id).toBe(ServiceId.of('svc-cut'));
    expect(vm.currency).toBe(Currency.EUR);
    // Niko's base is the cheapest base offering.
    expect(vm.priceFromCents).toBe(cents(1300));
    // Across every bookable terms: 13,00 € up to Ivan's long cut at 18,50 €.
    expect(vm.cardPrice).toEqual({ cheapestCents: cents(1300), spread: true });
    expect(vm.minutesRange).toEqual({ min: duration(30), max: duration(50) });
    expect(vm.variants.map((variant) => variant.id)).toEqual([LONG]);
    expect(vm.offerings).toEqual([
      {
        barberId: IVAN,
        base: {
          priceCents: cents(1450),
          currency: Currency.EUR,
          minutes: duration(35),
        },
      },
      {
        barberId: NIKO,
        base: {
          priceCents: cents(1300),
          currency: Currency.EUR,
          minutes: duration(30),
        },
      },
    ]);
  });

  it('lists a bundle’s members by their service ids', () => {
    const bundle = serviceFixture({
      id: ServiceId.of('svc-full-care'),
      ...ServiceComposition.bundle([
        ServiceId.of('svc-cut'),
        ServiceId.of('svc-shave'),
      ]),
    });
    const vm = serviceToVm(bundle, undefined, undefined);
    expect(vm.compositionKind).toBe(CompositionKind.Bundle);
    expect(vm.includes).toEqual([
      ServiceId.of('svc-cut'),
      ServiceId.of('svc-shave'),
    ]);
  });

  it('carries the barber’s own id', () => {
    const vm = barberToVm(barberFixture({ id: IVAN }), undefined, undefined);
    expect(vm.id).toBe(IVAN);
  });

  it('hands every figure on as money in the service’s stored currency (DEP-19)', () => {
    const eur = serviceToVm(cut(), undefined, undefined);
    expect(servicePriceFrom(eur)).toEqual(
      Money.fromCents(cents(1300), Currency.EUR),
    );
    expect(serviceCardPrice(eur)).toEqual(
      Money.fromCents(cents(1300), Currency.EUR),
    );
    const bgn = serviceToVm(cut(Currency.BGN), undefined, undefined);
    expect(servicePriceFrom(bgn)).toEqual(
      Money.fromCents(cents(1300), Currency.BGN),
    );
    expect(serviceCardPrice(bgn)).toEqual(
      Money.fromCents(cents(1300), Currency.BGN),
    );
    expect(serviceDurationRange(eur)).toBe(eur.minutesRange);
  });

  it('quotes terms as their stored cents, currency and minutes', () => {
    const terms = termsToVm(termsFixture(1850, 50));
    expect(terms).toEqual({
      priceCents: cents(1850),
      currency: Currency.EUR,
      minutes: duration(50),
    });
    expect(termsPrice(terms)).toEqual(
      Money.fromCents(cents(1850), Currency.EUR),
    );
  });
});

describe('formatServiceMeta — the card’s second line', () => {
  it('reads «от» only when some terms cost more', () => {
    expect(
      formatServiceMeta({ price: '13,00 €', fromLabel: 'от', spread: true }),
    ).toBe('от 13,00 €');
    expect(
      formatServiceMeta({ price: '13,00 €', fromLabel: 'от', spread: false }),
    ).toBe('13,00 €');
    expect(
      formatServiceMeta({
        duration: '30–50 мин',
        price: '13,00 €',
        fromLabel: 'от',
        spread: true,
      }),
    ).toBe('30–50 мин · от 13,00 €');
  });
});
