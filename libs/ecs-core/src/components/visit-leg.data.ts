import type {
  BarberId,
  DurationMinutes,
  SeatId,
  ServiceId,
  ServiceVariantId,
} from '@core/primitives';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). A type-only component: no companion, nothing to put in one.
 */

/** One service of a visit — enough to book it again («Същото»). Array element. */
export type VisitLeg = {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly durationMinutes: DurationMinutes;
};
