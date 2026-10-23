import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberId, ServiceId, ServiceVariantId } from '@core/primitives';
import {
  deepFreeze,
  textFixture,
  serviceFixture,
  termsFixture,
} from '@core/testing';
import { CatalogPricingSystem } from './catalog-pricing.system';

/*
 * The catalogue views' numbers (features/shared/catalog `catalog.vm.ts`,
 * `catalog-presenter.service.ts`): the tile's "from" price is the cheapest
 * BASE offering; the card's tag folds EVERY bookable terms and says «от»
 * only when prices differ; the duration range spans offerings × variants;
 * a service nobody performs quotes its base.
 */

const terms = (price: number, minutes: number) => termsFixture(price, minutes);
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const long = ServiceVariantId.of('long');
const short = ServiceVariantId.of('short');

/** Ivan 14,50/35 (long 18,50/50); Niko 13,00/30; base 15,00/30. */
const cut = serviceFixture({
  id: ServiceId.of('svc-cut'),
  ...terms(1500, 30),
  variants: [
    { variantId: short, name: textFixture('Short') },
    { variantId: long, name: textFixture('Long') },
  ],
  offerings: [
    {
      barberId: ivan,
      ...terms(1450, 35),
      overrides: [{ variantId: long, ...terms(1850, 50) }],
    },
    { barberId: niko, ...terms(1300, 30), overrides: [] },
  ],
});
const fixed = serviceFixture({
  id: ServiceId.of('svc-beard'),
  ...terms(1000, 20),
  offerings: [
    { barberId: ivan, ...terms(1000, 20), overrides: [] },
    { barberId: niko, ...terms(1000, 20), overrides: [] },
  ],
});
const unclaimed = serviceFixture({
  id: ServiceId.of('svc-new'),
  ...terms(2200, 45),
  offerings: [],
});

const S = CatalogPricingSystem;

describe('CatalogPricingSystem', () => {
  it('quotes the cheapest BASE offering as the tile’s "from" price', () => {
    expect(S.priceFrom(cut)).toBe(1300);
    expect(S.priceFrom(unclaimed)).toBe(2200);
  });

  it('folds every bookable terms into the card’s tag, «от» only when prices differ', () => {
    expect(S.cardPrice(cut)).toEqual({
      cheapestCents: 1300,
      spread: true,
    });
    expect(S.cardPrice(fixed)).toEqual({
      cheapestCents: 1000,
      spread: false,
    });
    expect(S.cardPrice(unclaimed)).toEqual({
      cheapestCents: 2200,
      spread: false,
    });
  });

  it('spans the duration across offerings × variants', () => {
    expect(S.durationRange(cut)).toEqual({ min: 30, max: 50 });
    expect(S.durationRange(unclaimed)).toEqual({ min: 45, max: 45 });
  });

  it('lists what a barber performs at THEIR base terms, the services as given', () => {
    const shelf = [cut, fixed, unclaimed];
    const ivans = S.servicesByBarber(shelf, ivan);
    expect(ivans.map((entry) => entry.service)).toEqual([cut, fixed]);
    expect(ivans[0]?.service).toBe(cut);
    expect(ivans.map((entry) => entry.terms.priceCents)).toEqual([1450, 1000]);
    expect(S.servicesByBarber(shelf, BarberId.of('nobody'))).toEqual([]);
  });

  it('never quotes a "from" above the card’s cheapest (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 100, max: 9000 }), {
          minLength: 1,
          maxLength: 4,
        }),
        (prices) => {
          const service = serviceFixture({
            ...terms(5000, 30),
            offerings: prices.map((price, index) => ({
              barberId: BarberId.of(`b${index}`),
              ...terms(price, 30),
              overrides: [],
            })),
          });
          expect(S.cardPrice(service).cheapestCents).toBeLessThanOrEqual(
            S.priceFrom(service),
          );
          expect(S.priceFrom(service)).toBe(Math.min(...prices));
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const service = deepFreeze(cut);
    const run = () => ({
      from: S.priceFrom(service),
      tag: S.cardPrice(service),
      range: S.durationRange(service),
      byBarber: S.servicesByBarber([service], niko),
    });
    expect(run()).toEqual(run());
    expect(service).toEqual(cut);
  });
});
