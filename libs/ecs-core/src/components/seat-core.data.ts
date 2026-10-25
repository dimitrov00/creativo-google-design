import type {
  BarberId,
  MinuteOfDay,
  PriceCents,
  SeatId,
  ServiceId,
  ServiceVariantId,
} from '@core/primitives';
import type { BarberPreference } from './barber-pref.data';

/**
 * A seat's own 1-to-1 fields — its identity, what it is for, where it sits
 * and its tip. `barberPreference` is the stored TAG of the preference the
 * seat was resolved from (the specific barber is the seat's own `barberId`);
 * `null` is "we do not know" and never reads as `ANY`. `startMinutes` is on
 * the appointment's `localDate` (T7). `tipCents` has one home, the seat — a
 * party can be two barbers and a tip belongs to whoever did the work; it is
 * in the seat's `currency`, and `null` is "not recorded", which is not zero.
 * (Split out of `seat.data.ts`, pass D, L-2.)
 */
export type SeatCore = {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  /** The choice made within the service — `null` only when it declares none. */
  readonly variantId: ServiceVariantId | null;
  /** RESOLVED, never a preference. */
  readonly barberId: BarberId;
  readonly barberPreference: BarberPreference | null;
  readonly startMinutes: MinuteOfDay;
  readonly tipCents: PriceCents | null;
};
