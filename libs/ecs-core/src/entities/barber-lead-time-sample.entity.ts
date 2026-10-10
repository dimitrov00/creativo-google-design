import type { DayKey } from '../components/day-key.data';
import type { BarberId } from './barber.entity';

/** `${barberId}__${dayKey}` — one sample per barber per sampling day. */
export type BarberLeadTimeSampleId = string & {
  readonly __brand: unique symbol;
};
export const BarberLeadTimeSampleId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): BarberLeadTimeSampleId => raw as BarberLeadTimeSampleId,
} as const;

/**
 * One day's measurement of how far ahead a barber is booked —
 * `barberLeadTimeSamples/{id}` (`sample-lead-time.ts:119-129`, `sampledAtIso`
 * → `sampledAtMs`). The x-axis of the lead-time trend; a missing row is
 * honest, a retried batch would double-count. TTL-purged (`purgeAt` is
 * adapter-stamped at the root, not an entity field).
 */
export type BarberLeadTimeSampleEntity = {
  readonly id: BarberLeadTimeSampleId;
  readonly barberId: BarberId;
  /** The day the sample was TAKEN. */
  readonly dayKey: DayKey;
  readonly zone: string;
  /** The first day with a slot step of free time — `null` is fully booked to the horizon, not zero. */
  readonly firstAvailableDayKey: DayKey | null;
  readonly leadTimeDays: number | null;
  readonly freeMinutesOnFirstDay: number;
  readonly horizonDayCount: number;
  readonly sampledAtMs: number;
};
