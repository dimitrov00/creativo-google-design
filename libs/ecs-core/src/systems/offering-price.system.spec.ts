import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import { BarberId } from '../entities/barber.entity';
import { deepFreeze, serviceFixture, textFixture } from '../testing';
import { OfferingPriceSystem } from './offering-price.system';

/*
 * The `Service terms matrix` cases of
 * libs/domain/catalog/src/lib/service.spec.ts (6), COPIED over the
 * `ServiceEntity` matrix — `byVariant` is the `overrides` array.
 */

const terms = (priceMinorUnits: number, durationMinutes: number) =>
  ServiceTerms.unpadded(priceMinorUnits, 'EUR', durationMinutes);
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const short = ServiceVariantId.of('short');
const long = ServiceVariantId.of('long');

/** Ivan prices long hair higher; Niko charges one rate for both. */
function withMatrix() {
  return serviceFixture({
    baseTerms: terms(1500, 30),
    variants: [
      { id: short, name: textFixture('Short hair', 'Къса коса') },
      { id: long, name: textFixture('Long hair', 'Дълга коса') },
    ],
    offerings: [
      {
        barberId: ivan,
        base: terms(1450, 35),
        overrides: [
          { variantId: short, terms: terms(1450, 35) },
          { variantId: long, terms: terms(1850, 50) },
        ],
      },
      { barberId: niko, base: terms(1300, 30), overrides: [] },
    ],
  });
}

const S = OfferingPriceSystem;

describe('the service terms matrix', () => {
  it('resolves a barber + variant to that barber’s override', () => {
    const resolved = S.termsFor(withMatrix(), ivan, long);
    expect(resolved.priceMinorUnits).toBe(1850);
    expect(resolved.durationMinutes).toBe(50);
  });

  it('falls back to the barber’s base when they don’t price that variant', () => {
    // Niko stores no overrides at all — sparse by design, not backfilled.
    expect(S.termsFor(withMatrix(), niko, long).priceMinorUnits).toBe(1300);
  });

  it('falls back to the service’s base terms for an unknown or absent barber', () => {
    const service = withMatrix();
    const stranger = BarberId.of('not-a-performer');
    expect(S.termsFor(service, stranger, null).priceMinorUnits).toBe(1500);
    expect(S.termsFor(service, null, long).priceMinorUnits).toBe(1500);
    expect(S.termsFor(service, null, null).priceMinorUnits).toBe(1500);
  });

  it('folds the whole matrix into a price and duration range', () => {
    // base 15,00 · ivan 14,50/18,50 · niko 13,00
    expect(S.priceRange(withMatrix())).toEqual({ min: 1300, max: 1850 });
    expect(S.durationRange(withMatrix())).toEqual({ min: 30, max: 50 });
  });

  it('reports who performs it', () => {
    expect(S.performerIds(withMatrix())).toEqual(['ivan', 'niko']);
    expect(S.isPerformedBy(withMatrix(), ivan)).toBe(true);
    expect(S.isPerformedBy(withMatrix(), BarberId.of('nobody'))).toBe(false);
  });

  it('still ranges over a service nobody is priced for yet', () => {
    const service = serviceFixture({
      baseTerms: terms(1500, 30),
      offerings: [],
    });
    expect(S.priceRange(service)).toEqual({ min: 1500, max: 1500 });
    expect(S.durationRange(service)).toEqual({ min: 30, max: 30 });
  });
});

describe('OfferingPriceSystem — algebra and purity', () => {
  it('resolves inside the matrix’s own range, whoever and whatever is asked (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<BarberId | null>(ivan, niko, BarberId.of('x'), null),
        fc.constantFrom<ServiceVariantId | null>(short, long, null),
        (barber, variant) => {
          const service = withMatrix();
          const resolved = S.termsFor(service, barber, variant);
          const prices = S.priceRange(service);
          expect(resolved.priceMinorUnits).toBeGreaterThanOrEqual(prices.min);
          expect(resolved.priceMinorUnits).toBeLessThanOrEqual(prices.max);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const service = deepFreeze(withMatrix());
    const run = () => ({
      terms: S.termsFor(service, ivan, long),
      range: S.priceRange(service),
      all: S.everyTerms(service),
    });
    expect(run()).toEqual(run());
    expect(service).toEqual(withMatrix());
  });
});
