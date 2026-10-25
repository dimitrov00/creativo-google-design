/**
 * Terms as authored (the catalogue seed, an admin write), before their edge
 * guard — raw figures (`ServiceTerms.parse` reads it; split out of
 * `service-terms.data.ts`, pass D D-7: the landing's test catalogue and
 * `BarberOffering.Input` read it too).
 */
export type ServiceTermsInput = {
  readonly priceCents: number;
  readonly currency: string;
  readonly durationMinutes: number;
  readonly setupMinutes: number;
  readonly cleanupMinutes: number;
};
