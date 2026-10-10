import type { ScheduleVersion } from '../components/schedule-version.data';
import type { BarberId } from './barber.entity';

/**
 * A barber's roster with its history — `barberSchedules/{barberId}` (the id
 * is the barber's own; `tools/seed-dev-catalog.mjs:326-335`,
 * `availability-reader.adapter.ts:97-131`). The `versions` stay in the
 * document (§9 D15: a roster has a handful) because the version in force on
 * a date is how booking, availability and capacity pick a roster — a flat
 * roster could not be amended from a future day. Each version's
 * `'HH:mm'` weekday map is flattened to `segments` in minutes.
 */
export type BarberScheduleEntity = {
  readonly id: BarberId;
  /**
   * The separation this barber keeps between unrelated clients: every busy
   * span is padded by it on both sides, once, before availability is asked.
   */
  readonly turnaroundMinutes: number;
  /** Sorted by `effectiveFromDayKey`; exactly one covers any day (`ScheduleVersion.history`). */
  readonly versions: readonly ScheduleVersion[];
};
