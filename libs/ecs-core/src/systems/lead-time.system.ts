import type { CapacityEntry } from '../components/capacity-entry.data';
import type { BarberLeadTimeSample } from '../entities/barber-lead-time-sample.entity';
import { MinuteCount } from '../primitives/duration-minutes.primitive';
import {
  type BarberId,
  BarberLeadTimeSampleId,
  type CapacityMonthId,
} from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/** The first day a barber has sellable time, and how far away it is. */
export type FirstAvailableDay = {
  readonly localDate: LocalDate;
  /** Days from the walk's start — `0` is free TODAY. */
  readonly leadTimeDays: number;
  readonly freeMinutes: MinuteCount;
};

/** The sample document body — the entity minus `id`. */
export type LeadTimeSampleBody = Omit<BarberLeadTimeSample, 'id'>;

/** One sample: its id (`{barberId}__{localDate}`) and body. */
export type LeadTimeSample = {
  readonly id: BarberLeadTimeSampleId;
  readonly body: LeadTimeSampleBody;
};

/**
 * LeadTimeSystem — how far out a barber's first free day is
 * (`sample-lead-time.ts:155-200`), read off the capacity rollup's sorted
 * entries rather than the availability engine, so the number the owner sees
 * agrees with what a client would have found on the calendar. Days are
 * `LocalDate` arithmetic (flatten-spec T8); no zone.
 *
 * The rollup stores a day's free minutes as a SUM, not its longest block:
 * this is a LOWER BOUND on true lead time — it can report "free tomorrow"
 * when the first genuinely bookable slot is later, never the reverse. The
 * right direction to be wrong for a trend line; nothing should present it
 * as a bookable promise.
 */
export const LeadTimeSystem = {
  /**
   * Walk forward from `fromLocalDate` (TODAY — same-day walk-ups are most of
   * a barbershop's volume, so a lead time that could never be zero would
   * hide the quiet days) to `toLocalDate` inclusive, to the first day the
   * barber's free minutes — every shop summed: the question is when, not
   * where — reach `threshold`. `null` is fully booked to the horizon, which
   * is NOT zero. One linear pass over the sorted `entries`.
   */
  firstAvailableDay(
    entries: readonly CapacityEntry[],
    barberId: BarberId,
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate,
    threshold: MinuteCount,
  ): FirstAvailableDay | null {
    let i = 0;
    let leadTimeDays = 0;
    for (
      let localDate = fromLocalDate;
      localDate <= toLocalDate;
      localDate = LocalDate.addDays(localDate, 1)
    ) {
      while (
        i < entries.length &&
        (entries[i] as CapacityEntry).localDate < localDate
      ) {
        i++;
      }
      let freeMinutes = MinuteCount.ZERO;
      for (let k = i; k < entries.length; k++) {
        const entry = entries[k] as CapacityEntry;
        if (entry.localDate !== localDate) break;
        if (entry.barberId === barberId) {
          freeMinutes = MinuteCount.add(freeMinutes, entry.freeMinutes);
        }
      }
      if (freeMinutes >= threshold) {
        return { localDate, leadTimeDays, freeMinutes };
      }
      leadTimeDays += 1;
    }
    return null;
  },

  /** Every `YYYY-MM` the inclusive span touches, in order — the month documents to read. */
  monthKeysBetween(
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate,
  ): readonly CapacityMonthId[] {
    const keys: CapacityMonthId[] = [];
    if (toLocalDate < fromLocalDate) return keys;
    const last = LocalDate.monthKey(toLocalDate);
    let cursor = LocalDate.startOfMonth(fromLocalDate);
    for (;;) {
      const month = LocalDate.monthKey(cursor);
      keys.push(month);
      if (month >= last) return keys;
      cursor = LocalDate.addMonths(cursor, 1);
    }
  },

  /** Days in the inclusive span (`0` when inverted) — the sample's horizon. */
  dayCountBetween(fromLocalDate: LocalDate, toLocalDate: LocalDate): number {
    const count = LocalDate.daysBetween(fromLocalDate, toLocalDate) + 1;
    return count > 0 ? count : 0;
  },

  /**
   * The day's sample for one barber — what `barberLeadTimeSamples/{id}`
   * stores. A day has to hold at least `threshold` (one slot step) of free
   * time to count. `sampledAtUtcMs` is the pipeline's clock — a lifecycle
   * stamp, never compared here.
   */
  sample(
    entries: readonly CapacityEntry[],
    barberId: BarberId,
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate,
    threshold: MinuteCount,
    sampledAtUtcMs: UtcEpochMs,
  ): LeadTimeSample {
    const found = LeadTimeSystem.firstAvailableDay(
      entries,
      barberId,
      fromLocalDate,
      toLocalDate,
      threshold,
    );
    return {
      id: BarberLeadTimeSampleId.of(`${barberId}__${fromLocalDate}`),
      body: {
        barberId,
        localDate: fromLocalDate,
        firstAvailableLocalDate: found === null ? null : found.localDate,
        leadTimeDays: found === null ? null : found.leadTimeDays,
        freeMinutesOnFirstDay:
          found === null ? MinuteCount.ZERO : found.freeMinutes,
        horizonDayCount: LeadTimeSystem.dayCountBetween(
          fromLocalDate,
          toLocalDate,
        ),
        sampledAtUtcMs,
      },
    };
  },
} as const;
