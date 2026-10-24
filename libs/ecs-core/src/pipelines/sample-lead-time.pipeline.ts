import { type BarberId, Result } from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import { BookingPolicy, type CapacityEntry } from '@core/components';
import type {
  BarberListPorts,
  CapacityReadPorts,
  ClockPorts,
  DefaultLocationPorts,
  LeadTimeWritePorts,
  LocationLoadPorts,
  LogPorts,
  PolicyReadPorts,
} from '@core/ports';
import { LeadTimeSystem, ZonedTimeSystem } from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

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
 *
 * Its "today" is the default location's (F-4: a barber's capacity spans
 * every shop), read once — after the policy; a zone that cannot be read is
 * the run's store failure. The run takes no command: the tick carries
 * nothing the sample reads.
 */

/** The barbers sampled, in roster order. */
export type SampleLeadTimeAnswer = {
  readonly sampledBarberIds: readonly BarberId[];
};

export type SampleLeadTimePorts = ClockPorts &
  BarberListPorts &
  CapacityReadPorts &
  PolicyReadPorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  LeadTimeWritePorts &
  LogPorts;

export const sampleLeadTime =
  (ports: SampleLeadTimePorts) =>
  async (): Promise<Result<SampleLeadTimeAnswer, RepositoryError>> => {
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    const sampledAtUtcMs = ports.nowUtcMs();
    const from = ZonedTimeSystem.shopNow(sampledAtUtcMs, zone.value).localDate;
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
    const threshold = BookingPolicy.freeThreshold(policy.value);
    const sampledBarberIds: BarberId[] = [];
    for (const barberId of barbers.value) {
      const sample = LeadTimeSystem.sample(
        entries,
        barberId,
        from,
        to,
        threshold,
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
