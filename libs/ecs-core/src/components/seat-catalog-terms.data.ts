import type { DurationMinutes, PriceCents } from '@core/primitives';

/**
 * What the CATALOGUE said when staff overrode a seat's terms
 * (`appointment-document.ts:122-135`). Both figures are `null` together for
 * the ordinary seat whose terms ARE the catalogue's — and for every seat
 * written before provenance existed, which is "we do not know", not a claim.
 * (Split out of `seat.data.ts`, pass D, L-2.)
 */
export type SeatCatalogTerms = {
  readonly catalogPriceCents: PriceCents | null;
  readonly catalogDurationMinutes: DurationMinutes | null;
};
