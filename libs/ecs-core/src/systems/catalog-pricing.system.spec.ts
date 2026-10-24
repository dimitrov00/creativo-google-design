import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CompositionKind } from '@core/components';
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
 * `catalog-wording.service.ts`): the tile's "from" price is the cheapest
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

describe('CatalogPricingSystem.performersByPrice — who performs it, cheapest first', () => {
  const petar = BarberId.of('petar');

  it('lists every performer at THEIR base terms, cheapest first', () => {
    const performers = S.performersByPrice(cut, null);
    expect(performers.map((entry) => entry.barberId)).toEqual([niko, ivan]);
    expect(performers.map((entry) => entry.terms.priceCents)).toEqual([
      1300, 1450,
    ]);
  });

  it('quotes the chosen variant — an override where the barber has one, their base where not', () => {
    const performers = S.performersByPrice(cut, long);
    expect(
      performers.map((entry) => [entry.barberId, entry.terms.priceCents]),
    ).toEqual([
      [niko, 1300],
      [ivan, 1850],
    ]);
    expect(S.performersByPrice(cut, short)).toEqual(
      S.performersByPrice(cut, null),
    );
  });

  it('keeps declaration order between performers who charge the same (a stable sort)', () => {
    expect(S.performersByPrice(fixed, null).map((e) => e.barberId)).toEqual([
      ivan,
      niko,
    ]);
    const tie = serviceFixture({
      ...terms(1000, 20),
      offerings: [
        { barberId: petar, ...terms(1200, 20), overrides: [] },
        { barberId: niko, ...terms(900, 20), overrides: [] },
        { barberId: ivan, ...terms(1200, 20), overrides: [] },
      ],
    });
    expect(S.performersByPrice(tie, null).map((e) => e.barberId)).toEqual([
      niko,
      petar,
      ivan,
    ]);
  });

  it('lists nobody for a service nobody performs — its own terms are no performer’s', () => {
    expect(S.performersByPrice(unclaimed, null)).toEqual([]);
  });

  it('lists one performer as the one', () => {
    const solo = serviceFixture({
      ...terms(1000, 20),
      offerings: [{ barberId: petar, ...terms(1100, 25), overrides: [] }],
    });
    expect(S.performersByPrice(solo, null)).toEqual([
      { barberId: petar, terms: solo.offerings[0] },
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const service = deepFreeze(cut);
    expect(S.performersByPrice(service, long)).toEqual(
      S.performersByPrice(service, long),
    );
    expect(service).toEqual(cut);
  });
});

describe('CatalogPricingSystem.bundleSaving — what a bundle saves, in whole cents', () => {
  const member = (
    id: string,
    offerings: readonly [BarberId, number, number][],
    own: readonly [number, number] = [1000, 20],
  ) =>
    serviceFixture({
      id: ServiceId.of(id),
      ...terms(own[0], own[1]),
      offerings: offerings.map(([barberId, price, minutes]) => ({
        barberId,
        ...terms(price, minutes),
        overrides: [],
      })),
    });
  const bundle = (
    offerings: readonly [BarberId, number, number][],
    own: readonly [number, number] = [2000, 50],
  ) =>
    serviceFixture({
      id: ServiceId.of('svc-full-care'),
      ...terms(own[0], own[1]),
      compositionKind: CompositionKind.Bundle,
      bundleServiceIds: [ServiceId.of('svc-a'), ServiceId.of('svc-b')],
      offerings: offerings.map(([barberId, price, minutes]) => ({
        barberId,
        ...terms(price, minutes),
        overrides: [],
      })),
    } as Partial<ReturnType<typeof serviceFixture>>);

  // The sheet's own fixture: 14,50 + 12,00 apart, 21,50 together.
  const cutMember = member('svc-a', [[ivan, 1450, 30]]);
  const shave = member('svc-b', [[ivan, 1200, 20]]);

  it('prices the members against the bundle’s cheapest performer', () => {
    expect(
      S.bundleSaving(bundle([[ivan, 2150, 45]]), [cutMember, shave]),
    ).toEqual({ savedCents: 500, savedMinutes: 5 });
  });

  it('reads the cheapest BASE offering — the first of equals — as the barber', () => {
    const both = [
      member('svc-a', [
        [ivan, 1450, 30],
        [niko, 1000, 30],
      ]),
      member('svc-b', [
        [ivan, 1200, 20],
        [niko, 900, 20],
      ]),
    ];
    // Niko's bundle is the cheaper one: 10,00 + 9,00 against 18,00.
    expect(
      S.bundleSaving(
        bundle([
          [ivan, 2150, 45],
          [niko, 1800, 45],
        ]),
        both,
      ),
    ).toEqual({ savedCents: 100, savedMinutes: 5 });
    // A tie keeps the first declared.
    expect(
      S.bundleSaving(
        bundle([
          [ivan, 1800, 45],
          [niko, 1800, 45],
        ]),
        both,
      ),
    ).toEqual({ savedCents: 850, savedMinutes: 5 });
  });

  it('is null when that barber does not offer every member — a total nobody can book', () => {
    const noShave = member('svc-b', [[niko, 1200, 20]]);
    expect(
      S.bundleSaving(bundle([[ivan, 2150, 45]]), [cutMember, noShave]),
    ).toBeNull();
  });

  it('is null at the exact sum and above it — an unearned saving is worse than none (DEP-10)', () => {
    expect(
      S.bundleSaving(bundle([[ivan, 2650, 45]]), [cutMember, shave]),
    ).toBeNull();
    expect(
      S.bundleSaving(bundle([[ivan, 2700, 45]]), [cutMember, shave]),
    ).toBeNull();
    // Float major units summed 0,10 + 0,20 above 0,30 (epsilon); cents do not.
    expect(
      S.bundleSaving(bundle([[ivan, 30, 45]]), [
        member('svc-a', [[ivan, 10, 30]]),
        member('svc-b', [[ivan, 20, 20]]),
      ]),
    ).toBeNull();
  });

  it('never saves negative minutes', () => {
    expect(
      S.bundleSaving(bundle([[ivan, 2150, 80]]), [cutMember, shave]),
    ).toEqual({ savedCents: 500, savedMinutes: 0 });
  });

  it('prices a bundle nobody performs at its own terms, against members nobody performs', () => {
    const ownA = member('svc-a', [], [1400, 30]);
    const ownB = member('svc-b', [], [1100, 20]);
    expect(S.bundleSaving(bundle([], [2000, 40]), [ownA, ownB])).toEqual({
      savedCents: 500,
      savedMinutes: 10,
    });
    // A member somebody performs has no "nobody's" terms to price against.
    expect(S.bundleSaving(bundle([], [2000, 40]), [ownA, shave])).toBeNull();
  });

  it('is null for a service that is not a bundle, and for a bundle with no member', () => {
    expect(S.bundleSaving(cut, [cutMember, shave])).toBeNull();
    expect(S.bundleSaving(bundle([[ivan, 2150, 45]]), [])).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const b = deepFreeze(bundle([[ivan, 2150, 45]]));
    const members = deepFreeze([cutMember, shave]);
    expect(S.bundleSaving(b, members)).toEqual(S.bundleSaving(b, members));
  });
});
