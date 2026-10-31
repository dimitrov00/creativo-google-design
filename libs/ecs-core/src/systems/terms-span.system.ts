import {
  type BarberOffering,
  Money,
  type ServiceTerms,
} from '@core/components';
import {
  type Currency,
  DurationMinutes,
  type BarberId,
  type ServiceVariantId,
  PriceCents,
} from '@core/primitives';
import {
  OfferingPriceSystem,
  type PricedService,
} from './offering-price.system';

/**
 * What a line costs and how long it takes — as a SPAN, always
 * (`booking-bag-sheet.ts:54-69`). "Anyone" is not a missing answer: whoever
 * is free decides the price and charges their own rate, so an open barber
 * leaves the span open; a pinned barber collapses it to a point. Money in
 * cents of one `currency`.
 */
export type TermsSpan = {
  readonly currency: Currency;
  readonly minPriceCents: PriceCents;
  readonly maxPriceCents: PriceCents;
  readonly minMinutes: DurationMinutes;
  readonly maxMinutes: DurationMinutes;
};

function spanOfTerms(terms: readonly ServiceTerms[]): TermsSpan {
  const first = terms[0] as ServiceTerms;
  let minPrice = first.priceCents;
  let maxPrice = minPrice;
  let minMinutes = first.durationMinutes;
  let maxMinutes = minMinutes;
  for (let i = 1; i < terms.length; i++) {
    const next = terms[i] as ServiceTerms;
    if (next.priceCents < minPrice) minPrice = next.priceCents;
    if (next.priceCents > maxPrice) maxPrice = next.priceCents;
    if (next.durationMinutes < minMinutes) minMinutes = next.durationMinutes;
    if (next.durationMinutes > maxMinutes) maxMinutes = next.durationMinutes;
  }
  return {
    currency: first.currency,
    minPriceCents: minPrice,
    maxPriceCents: maxPrice,
    minMinutes,
    maxMinutes,
  };
}

/**
 * TermsSpanSystem — the bag's quotes (`booking-bag-sheet.ts:336-404`): one
 * line's span and the spans of several lines summed. Numbers only; the
 * labels («28,00 €», «13,00 € – 15,50 €») are the template's.
 */
export const TermsSpanSystem = {
  /**
   * What a (service, variant, barber) will cost and take. A named barber
   * resolves to exactly the terms the server will charge; "anyone"
   * (`null`) spans everyone who performs it, because the scheduler picks the
   * performer and their rate comes with them; a service nobody performs yet
   * quotes its own terms — the only quote there is.
   */
  spanFor(
    service: PricedService,
    variantId: ServiceVariantId | null,
    barberId: BarberId | null,
  ): TermsSpan {
    const terms: ServiceTerms[] = [];
    if (barberId !== null) {
      terms.push(OfferingPriceSystem.termsFor(service, barberId, variantId));
    } else {
      for (let i = 0; i < service.offerings.length; i++) {
        terms.push(
          OfferingPriceSystem.termsFor(
            service,
            (service.offerings[i] as BarberOffering).barberId,
            variantId,
          ),
        );
      }
    }
    if (terms.length === 0) {
      terms.push(OfferingPriceSystem.termsFor(service, null, variantId));
    }
    return spanOfTerms(terms);
  },

  /**
   * Several spans as one: floors add to the floor, ceilings to the ceiling
   * (a pinned 14,50 € line and an open 13,00–15,50 € line are honestly
   * 27,50 – 30,00 €). Mixed currencies are a data error, and a PARTIAL total
   * would be worse than none: `null` — and `null` for no spans at all.
   */
  sum(spans: readonly TermsSpan[]): TermsSpan | null {
    let total: TermsSpan | null = null;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i] as TermsSpan;
      if (total === null) {
        total = span;
        continue;
      }
      // Money's one rule: amounts in two currencies never add.
      if (span.currency !== total.currency) return null;
      total = {
        currency: total.currency,
        minPriceCents: PriceCents.add(total.minPriceCents, span.minPriceCents),
        maxPriceCents: PriceCents.add(total.maxPriceCents, span.maxPriceCents),
        minMinutes: DurationMinutes.sum(total.minMinutes, span.minMinutes),
        maxMinutes: DurationMinutes.sum(total.maxMinutes, span.maxMinutes),
      };
    }
    return total;
  },

  /** One price, not a range — the label prints a single value. */
  isPricePoint(span: TermsSpan): boolean {
    return span.minPriceCents === span.maxPriceCents;
  },

  /** The span's floor and ceiling as `Money`, for the template's formatter. */
  priceBounds(span: TermsSpan): { readonly min: Money; readonly max: Money } {
    return {
      min: Money.fromCents(span.minPriceCents, span.currency),
      max: Money.fromCents(span.maxPriceCents, span.currency),
    };
  },
} as const;
