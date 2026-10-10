import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import { BarberId } from '../entities/barber.entity';
import { deepFreeze, serviceFixture, textFixture } from '../testing';
import { type TermsSpan, TermsSpanSystem } from './terms-span.system';

/*
 * The bag's quoting rules (booking-bag-sheet.ts:54-69, 336-404): a pinned
 * barber is a point, "anyone" spans every performer, a service nobody
 * performs quotes its base, and spans sum floor-to-floor and
 * ceiling-to-ceiling — never a partial total across currencies.
 */

const terms = (price: number, minutes: number, currency = 'EUR') =>
  ServiceTerms.unpadded(price, currency, minutes);
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const long = ServiceVariantId.of('long');

/** Ivan 14,50 / 35 (long 18,50 / 50); Niko 13,00 / 30; base 15,00 / 30. */
const cut = serviceFixture({
  baseTerms: terms(1500, 30),
  variants: [{ id: long, name: textFixture('Long') }],
  offerings: [
    {
      barberId: ivan,
      base: terms(1450, 35),
      overrides: [{ variantId: long, terms: terms(1850, 50) }],
    },
    { barberId: niko, base: terms(1300, 30), overrides: [] },
  ],
});

const span = (
  min: number,
  max: number,
  minMinutes: number,
  maxMinutes: number,
  currencyCode = 'EUR',
): TermsSpan => ({
  currencyCode,
  minPriceMinorUnits: min,
  maxPriceMinorUnits: max,
  minMinutes,
  maxMinutes,
});

const S = TermsSpanSystem;

describe('TermsSpanSystem.spanFor — what a line will cost and take', () => {
  it('collapses to a point for a named barber — the terms the server will charge', () => {
    expect(S.spanFor(cut, long, ivan)).toEqual(span(1850, 1850, 50, 50));
    expect(S.isPricePoint(S.spanFor(cut, null, niko))).toBe(true);
  });

  it('spans everyone who performs it when the barber is still open', () => {
    expect(S.spanFor(cut, null, null)).toEqual(span(1300, 1450, 30, 35));
    expect(S.spanFor(cut, long, null)).toEqual(span(1300, 1850, 30, 50));
  });

  it('quotes the base terms for a service nobody performs yet', () => {
    const unclaimed = serviceFixture({
      baseTerms: terms(2000, 45),
      offerings: [],
    });
    expect(S.spanFor(unclaimed, null, null)).toEqual(span(2000, 2000, 45, 45));
  });
});

describe('TermsSpanSystem.sum — several spans as one', () => {
  it('adds floors to the floor and ceilings to the ceiling', () => {
    // A pinned 14,50 € line and an open 13,00–15,50 € line.
    expect(S.sum([span(1450, 1450, 35, 35), span(1300, 1550, 30, 45)])).toEqual(
      span(2750, 3000, 65, 80),
    );
  });

  it('answers nothing rather than a partial total across currencies', () => {
    expect(
      S.sum([span(1450, 1450, 35, 35), span(1300, 1300, 30, 30, 'BGN')]),
    ).toBeNull();
    expect(S.sum([])).toBeNull();
  });

  it('is order-independent and bounds every part (property)', () => {
    const anySpan = fc
      .tuple(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 5, max: 120 }),
        fc.integer({ min: 0, max: 60 }),
      )
      .map(([min, extra, minutes, more]) =>
        span(min, min + extra, minutes, minutes + more),
      );
    fc.assert(
      fc.property(
        fc.array(anySpan, { minLength: 1, maxLength: 5 }),
        (spans) => {
          const total = S.sum(spans) as TermsSpan;
          expect(S.sum([...spans].reverse())).toEqual(total);
          expect(total.minPriceMinorUnits).toBeLessThanOrEqual(
            total.maxPriceMinorUnits,
          );
          expect(total.minMinutes).toBe(
            spans.reduce((sum, part) => sum + part.minMinutes, 0),
          );
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const service = deepFreeze(cut);
    const spans = deepFreeze([span(1, 2, 3, 4), span(5, 6, 7, 8)]);
    expect(S.spanFor(service, long, null)).toEqual(
      S.spanFor(service, long, null),
    );
    expect(S.sum(spans)).toEqual(S.sum(spans));
    expect(spans).toEqual([span(1, 2, 3, 4), span(5, 6, 7, 8)]);
    expect(S.priceBounds(span(1, 2, 3, 4))).toEqual({
      min: { amountMinorUnits: 1, currencyCode: 'EUR' },
      max: { amountMinorUnits: 2, currencyCode: 'EUR' },
    });
  });
});
