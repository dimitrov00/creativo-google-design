import { CapacityEntry } from '../components/capacity-entry.data';
import type { DayKey } from '../components/day-key.data';
import {
  type BarberLeadTimeSampleEntity,
  BarberLeadTimeSampleId,
} from '../entities/barber-lead-time-sample.entity';
import type { BarberId } from '../entities/barber.entity';
import { ZonedTimeSystem } from './zoned-time.system';

/** The first day a barber has sellable time, and how far away it is. */
export type FirstAvailableDay = {
  readonly dayKey: DayKey;
  /** Days from the walk's start — `0` is free TODAY. */
  readonly leadTimeDays: number;
  readonly freeMinutes: number;
};

/** The sample document body — the entity minus `id`. */
export type LeadTimeSampleBody = Omit<BarberLeadTimeSampleEntity, 'id'>;

/** One sample: its id (`{barberId}__{dayKey}`) and body. */
export type LeadTimeSample = {
  readonly id: BarberLeadTimeSampleId;
  readonly body: LeadTimeSampleBody;
};

/**
 * LeadTimeSystem — how far out a barber's first free day is
 * (`sample-lead-time.ts:155-200`), read off the capacity rollup's sorted
 * entries rather than the availability engine, so the number the owner sees
 * agrees with what a client would have found on the calendar.
 *
 * The rollup stores a day's free minutes as a SUM, not its longest block:
 * this is a LOWER BOUND on true lead time — it can report "free tomorrow"
 * when the first genuinely bookable slot is later, never the reverse. The
 * right direction to be wrong for a trend line; nothing should present it
 * as a bookable promise.
 */
export const LeadTimeSystem = {
  /**
   * Walk forward from `fromDayKey` (TODAY — same-day walk-ups are most of a
   * barbershop's volume, so a lead time that could never be zero would hide
   * the quiet days) to `toDayKey` inclusive, to the first day the barber's
   * free minutes — every shop summed: the question is when, not where —
   * reach `thresholdMinutes`. `null` is fully booked to the horizon, which
   * is NOT zero. One linear pass over the sorted `entries`.
   */
  firstAvailableDay(
    entries: readonly CapacityEntry[],
    barberId: BarberId,
    fromDayKey: DayKey,
    toDayKey: DayKey,
    thresholdMinutes: number,
  ): FirstAvailableDay | null {
    let i = 0;
    let leadTimeDays = 0;
    for (
      let dayKey = fromDayKey;
      dayKey <= toDayKey;
      dayKey = ZonedTimeSystem.addDays(dayKey, 1)
    ) {
      while (
        i < entries.length &&
        (entries[i] as CapacityEntry).dayKey < dayKey
      ) {
        i++;
      }
      let freeMinutes = 0;
      for (let k = i; k < entries.length; k++) {
        const entry = entries[k] as CapacityEntry;
        if (entry.dayKey !== dayKey) break;
        if (entry.barberId === barberId) freeMinutes += entry.freeMinutes;
      }
      if (freeMinutes >= thresholdMinutes) {
        return { dayKey, leadTimeDays, freeMinutes };
      }
      leadTimeDays += 1;
    }
    return null;
  },

  /** Every `YYYY-MM` the inclusive span touches, in order — the month documents to read. */
  monthKeysBetween(fromDayKey: DayKey, toDayKey: DayKey): readonly string[] {
    const keys: string[] = [];
    if (toDayKey < fromDayKey) return keys;
    const last = CapacityEntry.monthOf(toDayKey);
    let cursor = ZonedTimeSystem.startOfMonth(fromDayKey);
    for (;;) {
      const month = CapacityEntry.monthOf(cursor);
      keys.push(month);
      if (month >= last) return keys;
      cursor = ZonedTimeSystem.addMonths(cursor, 1);
    }
  },

  /** Days in the inclusive span (`0` when inverted) — the sample's horizon. */
  dayCountBetween(fromDayKey: DayKey, toDayKey: DayKey): number {
    const count = ZonedTimeSystem.daysBetween(fromDayKey, toDayKey) + 1;
    return count > 0 ? count : 0;
  },

  /**
   * The day's sample for one barber — what `barberLeadTimeSamples/{id}`
   * stores. A day has to hold at least `thresholdMinutes` (one slot step) of
   * free time to count. `sampledAtMs` is the pipeline's clock.
   */
  sample(
    entries: readonly CapacityEntry[],
    barberId: BarberId,
    fromDayKey: DayKey,
    toDayKey: DayKey,
    thresholdMinutes: number,
    zone: string,
    sampledAtMs: number,
  ): LeadTimeSample {
    const found = LeadTimeSystem.firstAvailableDay(
      entries,
      barberId,
      fromDayKey,
      toDayKey,
      thresholdMinutes,
    );
    return {
      id: BarberLeadTimeSampleId.of(`${barberId}__${fromDayKey}`),
      body: {
        barberId,
        dayKey: fromDayKey,
        zone,
        firstAvailableDayKey: found === null ? null : found.dayKey,
        leadTimeDays: found === null ? null : found.leadTimeDays,
        freeMinutesOnFirstDay: found === null ? 0 : found.freeMinutes,
        horizonDayCount: LeadTimeSystem.dayCountBetween(fromDayKey, toDayKey),
        sampledAtMs,
      },
    };
  },
} as const;
