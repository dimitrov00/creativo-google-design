import {
  type MinuteCount,
  type BarberId,
  BarberLeadTimeSampleId,
  type LocalDate,
  type UtcEpochMs,
} from '@core/primitives';

/**
 * One day's measurement of how far ahead a barber is booked —
 * `barberLeadTimeSamples/{id}`, id `${barberId}__${localDate}`
 * (`sample-lead-time.ts:119-129`). The x-axis of the lead-time trend; a
 * missing row is honest, a retried batch would double-count. TTL-purged
 * (`purgeAt` is adapter-stamped at the root, not an entity field). No zone
 * (Law 7.2); the sampling instant is `sampledAtUtcMs`.
 */
export type BarberLeadTimeSample = {
  readonly id: BarberLeadTimeSampleId;
  readonly barberId: BarberId;
  /** The shop day the sample was TAKEN. */
  readonly localDate: LocalDate;
  /** The first day with a slot step of free time — `null` is fully booked to the horizon, not zero. */
  readonly firstAvailableLocalDate: LocalDate | null;
  readonly leadTimeDays: number | null;
  readonly freeMinutesOnFirstDay: MinuteCount;
  readonly horizonDayCount: number;
  readonly sampledAtUtcMs: UtcEpochMs;
};
