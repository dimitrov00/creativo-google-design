import {
  type BarberId,
  MinuteCount,
  type RepositoryError,
  Result,
  type TimeZone,
} from '@core/primitives';
import { BookingPolicy, type CapacityEntry } from '@core/components';
import type { SchedulingPorts, TelemetryPorts, TxPorts } from '@core/ports';
import { LeadTimeSystem, ZonedTimeSystem } from '@core/systems';

/**
 * `sampleLeadTime` — how far out each rostered barber's first free day is,
 * sampled once a day (`sample-lead-time.ts`, blueprint §4.1): "how far
 * ahead was Ivan booked on 14 July" is a question about the future as it
 * looked that morning, so a sample not taken is a sample lost.
 *
 * Read off the capacity rollup — the month documents the horizon spans, read
 * ONCE and shared by every barber — so the number an owner sees agrees with
 * what a client would have found on the calendar (`LeadTimeSystem`, a LOWER
 * bound: the rollup stores a day's free minutes as a sum). A day must hold
 * one slot step of free time to count. One barber's failed write never
 * costs the others their sample; a missing row is honest. The writer stamps
 * the TTL (`writeLeadTimeSample`, F1-7). Runs daily, ungated (F1-2).
 */

export type SampleLeadTimeCommand = {
  /** The tenant's zone — whose "today" the sample is taken on. */
  readonly timeZone: TimeZone;
};

/** The barbers sampled, in roster order. */
export type SampleLeadTimeAnswer = {
  readonly sampledBarberIds: readonly BarberId[];
};

export type SampleLeadTimePorts = Pick<TxPorts, 'nowUtcMs'> &
  Pick<
    SchedulingPorts,
    'loadCapacityMonths' | 'listBarbers' | 'writeLeadTimeSample' | 'loadPolicy'
  > &
  Pick<TelemetryPorts, 'log'>;

export const sampleLeadTime =
  (ports: SampleLeadTimePorts) =>
  async (
    cmd: SampleLeadTimeCommand,
  ): Promise<Result<SampleLeadTimeAnswer, RepositoryError>> => {
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const sampledAtUtcMs = ports.nowUtcMs();
    const from = ZonedTimeSystem.shopNow(
      sampledAtUtcMs,
      cmd.timeZone,
    ).localDate;
    const to = BookingPolicy.horizonEndFrom(policy.value, from);

    // The month documents the horizon spans — read once, for every barber.
    const months = await ports.loadCapacityMonths(
      LeadTimeSystem.monthKeysBetween(from, to),
    );
    if (!months.ok) return months;
    const entries: CapacityEntry[] = [];
    for (const month of months.value) {
      if (month !== null) entries.push(...month.entries);
    }

    // The ROSTER is the population, not the catalogue.
    const barbers = await ports.listBarbers();
    if (!barbers.ok) return barbers;
    const threshold = MinuteCount.of(policy.value.slotStepMinutes);
    const sampledBarberIds: BarberId[] = [];
    for (const barberId of barbers.value) {
      const sample = LeadTimeSystem.sample(
        entries,
        barberId,
        from,
        to,
        threshold.ok ? threshold.value : MinuteCount.ZERO,
        sampledAtUtcMs,
      );
      try {
        const written = await ports.writeLeadTimeSample({
          id: sample.id,
          ...sample.body,
        });
        if (written.ok) {
          sampledBarberIds.push(barberId);
          continue;
        }
        ports.log('error', 'lead-time sample failed for barber', {
          barberId,
          error: written.error,
        });
      } catch (error) {
        ports.log('error', 'lead-time sample failed for barber', {
          barberId,
          error,
        });
      }
    }
    return Result.ok({ sampledBarberIds });
  };
