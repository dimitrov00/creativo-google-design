import type { ScheduleVersion, WriteProvenance } from '@core/components';
import type { MinuteCount, BarberId } from '@core/primitives';

/**
 * A barber's roster with its history — `barberSchedules/{barberId}` (the id
 * is the barber's own; `tools/seed-dev-catalog.mjs:326-335`,
 * `availability-reader.adapter.ts:97-131`). The `versions` stay in the
 * document (§9 D15: a roster has a handful — a true 1-to-N array) because
 * the version in force on a day is how booking, availability and capacity
 * pick a roster — a flat roster could not be amended from a future day.
 * Each version's `'HH:mm'` weekday map is flattened to `segments` on the
 * wall clock. The last writing call (`writeOperationId`, team onboarding
 * D12) sits beside them: the roster callables stamp it, so the roster's
 * audit row names the call that made the write; `null` for the seed.
 */
export type BarberSchedule = BarberScheduleMeta & WriteProvenance;

/** The roster itself: whose it is, the reset it keeps and its versions. */
export type BarberScheduleMeta = {
  readonly id: BarberId;
  /**
   * The separation this barber keeps between unrelated clients: every busy
   * span is padded by it on both sides, once, before availability is asked.
   */
  readonly turnaroundMinutes: MinuteCount;
  /** Sorted by `effectiveFromLocalDate`; exactly one covers any day (`ScheduleVersion.history`). */
  readonly versions: readonly ScheduleVersion[];
};
