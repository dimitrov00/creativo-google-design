import { firstValueFrom } from 'rxjs';
import { BusyKey } from '../components/busy-key.data';
import type { DayKey } from '../components/day-key.data';
import type { DayOffset } from '../components/day-offset.data';
import { TimeInterval } from '../components/time-interval.data';
import {
  BarberBusyDayId,
  type BarberBusyDayEntity,
} from '../entities/barber-busy-day.entity';
import type { BarberId } from '../entities/barber.entity';
import type { LoadBusyDay, ObserveBusyDay } from '../ports/scheduling.port';
import {
  AvailabilitySystem,
  type ChairTime,
} from '../systems/availability.system';
import { BusySystem } from '../systems/busy.system';
import { ZonedTimeSystem } from '../systems/zoned-time.system';

/**
 * THE SCHEDULING PORTS' BUSY CONTRACT, AS DATA ANY RUNNER CAN EXECUTE — the
 * successor of `availabilityReaderBusyCases`
 * (`libs/application/booking/src/lib/ports/availability-reader.contract.ts`,
 * blueprint §7), with the same six cases under the same names.
 *
 * The legacy port computed a day's availability BEHIND the adapter, so its
 * contract pinned the adapter's padding. The ECS ports hand out the raw
 * stream instead — `observeBusyDay` in the browser, `loadBusyDay` on the
 * server (`scheduling.port.ts`) — and the caller derives `busy` itself:
 * {@link SchedulingPortsContract.busyOf}, `AvailabilitySystem.paddedBusy`
 * over `BusySystem.spansOf(stored.blocks, day)` (§4.2). The promise is the
 * one it always was: a barber's `busy` is their stored spans, the chairs
 * handed back released FIRST, then padded by their turnaround. A port that
 * pads, merges, drops or re-keys what is stored fails a case; so does a
 * derivation that releases after padding, or releases another barber's
 * chair.
 *
 * Three runners, one case list (§7): the in-memory port doubles
 * (`memoryLoadBusyDay`/`memoryObserveBusyDay`, ecs-core's own spec), the
 * browser `scheduling.adapter.ts` bundle and the functions busy adapter of
 * the booking-core flip — and until that flip, the legacy matcher's reader
 * (`apps/functions/src/lib/booking/load-day-availability.spec.ts`), which
 * seeds each case's {@link SchedulingBusyCase.spans} in today's wire shape.
 * The answers are worked out by hand; the contract's own spec checks every
 * one against the derivation too, so the cases and the systems cannot drift
 * apart.
 */

/** One case: a barber's stored day, what the caller hands back, and the `busy` that must come out. */
export type SchedulingBusyCase = {
  /** What the case pins down, in words a failing test prints. */
  readonly name: string;
  /** The barber's reset time, from their roster (`barberSchedules.turnaroundMinutes`). */
  readonly turnaroundMinutes: number;
  /** The barber's busy spans for the day, UNPADDED, as instants. */
  readonly spans: readonly TimeInterval[];
  /**
   * The same day as the projection stores it — `barberBusy/{key}`, the
   * spans as wall-clock minute blocks (`BusySystem.blocksOf`). What a runner
   * seeds its store with and what the port must hand back unchanged.
   */
  readonly stored: BarberBusyDayEntity;
  /**
   * What the caller hands back: the chair time of a visit being moved.
   * `null` — the caller hands nothing back at all (the legacy optional
   * argument left out); `[]` — an empty hand-back. Both are the ordinary
   * booking and must answer alike.
   */
  readonly release: readonly ChairTime[] | null;
  /** The padded `busy` the derivation must answer for that barber. */
  readonly busy: readonly TimeInterval[];
};

/** Where the cases sit and how a runner reads them through a port. */
export type SchedulingPortsContract = {
  /** The day the cases are placed on, from `ZonedTimeSystem.dayTable`. */
  readonly day: DayOffset;
  /** `${barberId}__${dayKey}` — the one document every case stores and reads. */
  readonly key: BusyKey;
  readonly cases: readonly SchedulingBusyCase[];
  /**
   * The derivation every caller runs over the port's answer: the stored
   * blocks back to instants, released, then padded. `null` (no document)
   * is a free day.
   */
  readonly busyOf: (
    stored: BarberBusyDayEntity | null,
    entry: SchedulingBusyCase,
  ) => readonly TimeInterval[];
  /**
   * One case through a `LoadBusyDay` port seeded with `entry.stored`: reads
   * the contract's key and derives. A port error is a broken runner and
   * rejects with it.
   */
  readonly busyThroughLoad: (
    load: LoadBusyDay,
    entry: SchedulingBusyCase,
  ) => Promise<readonly TimeInterval[]>;
  /** The same through an `ObserveBusyDay` stream: its FIRST emission. */
  readonly busyThroughObserve: (
    observe: ObserveBusyDay,
    entry: SchedulingBusyCase,
  ) => Promise<readonly TimeInterval[]>;
};

/** Where to place the cases. `otherBarberId` is somebody whose released chairs must never free this barber's time. */
export type SchedulingPortsContractInput = {
  readonly dayKey: DayKey;
  readonly zone: string;
  readonly barberId: BarberId;
  readonly otherBarberId: BarberId;
};

/**
 * The cases, placed on `dayKey` in `zone` for `barberId`. Every instant is
 * a wall-clock time between 09:00 and 13:00, so any day that is not a DST
 * transition morning holds them; an unknown zone or an impossible day is a
 * broken fixture and throws.
 */
export function schedulingPortsContract(
  input: SchedulingPortsContractInput,
): SchedulingPortsContract {
  const { dayKey, zone, barberId, otherBarberId } = input;
  const day = ZonedTimeSystem.dayTable(zone, dayKey, dayKey)[0];
  if (day === undefined) {
    throw new Error(
      `scheduling contract fixture: no day table for ${zone} ${dayKey}`,
    );
  }
  const at = (hour: number, minute = 0): number =>
    ZonedTimeSystem.instantOf(day, hour * 60 + minute);
  const span = (
    from: readonly [number, number],
    to: readonly [number, number],
  ): TimeInterval => TimeInterval.of(at(from[0], from[1]), at(to[0], to[1]));
  const key = BusyKey.of(barberId, dayKey);

  const stored = (spans: readonly TimeInterval[]): BarberBusyDayEntity => ({
    id: BarberBusyDayId.of(key),
    barberId,
    dayKey,
    zone,
    blocks: BusySystem.blocksOf(spans, day),
  });
  const entry = (
    name: string,
    turnaroundMinutes: number,
    spans: readonly TimeInterval[],
    release: readonly ChairTime[] | null,
    busy: readonly TimeInterval[],
  ): SchedulingBusyCase => ({
    name,
    turnaroundMinutes,
    spans,
    stored: stored(spans),
    release,
    busy,
  });

  /** The visit being moved holds 10:00–11:00; a neighbour follows it. */
  const merged = [span([10, 0], [12, 0])];
  const ownChair: ChairTime = {
    barberId,
    occupied: span([10, 0], [11, 0]),
  };

  const cases: readonly SchedulingBusyCase[] = [
    entry(
      'nothing handed back: every span padded by the turnaround',
      15,
      [span([10, 0], [11, 0])],
      null,
      [span([9, 45], [11, 15])],
    ),
    entry(
      'an empty release is the ordinary booking',
      15,
      [span([10, 0], [11, 0])],
      [],
      [span([9, 45], [11, 15])],
    ),
    // The projection merged the visit (10:00–11:00) and its neighbour
    // (11:00–12:00) into one span. Released first and padded after, the
    // neighbour is still guarded on both sides; padded first and released
    // after, 10:45–11:00 of the neighbour's turnaround would be freed.
    entry(
      'the moved visit’s own chair is released BEFORE padding, and the neighbour keeps its turnaround',
      15,
      merged,
      [ownChair],
      [span([10, 45], [12, 15])],
    ),
    entry(
      'somebody else’s chair frees none of this barber’s time',
      15,
      merged,
      [{ barberId: otherBarberId, occupied: ownChair.occupied }],
      [span([9, 45], [12, 15])],
    ),
    entry(
      'a visit that was the whole day leaves the day free',
      15,
      [span([10, 0], [11, 0])],
      [ownChair],
      [],
    ),
    entry(
      'every chair of a party is released, one barber’s share at a time',
      0,
      [span([9, 0], [9, 30]), span([10, 0], [11, 0])],
      [
        { barberId, occupied: span([9, 0], [9, 30]) },
        { barberId: otherBarberId, occupied: span([10, 0], [11, 0]) },
      ],
      [span([10, 0], [11, 0])],
    ),
  ];

  const busyOf = (
    found: BarberBusyDayEntity | null,
    which: SchedulingBusyCase,
  ): readonly TimeInterval[] =>
    AvailabilitySystem.paddedBusy({
      barberId,
      spans: found === null ? [] : BusySystem.spansOf(found.blocks, day),
      turnaroundMinutes: which.turnaroundMinutes,
      release: which.release ?? [],
    });

  return {
    day,
    key,
    cases,
    busyOf,
    busyThroughLoad: async (load, which) => {
      const read = await load(key);
      if (!read.ok) {
        throw new Error(
          `scheduling contract: loadBusyDay(${key}) failed — ${JSON.stringify(read.error)}`,
        );
      }
      return busyOf(read.value, which);
    },
    busyThroughObserve: async (observe, which) => {
      const read = await firstValueFrom(observe(key));
      if (!read.ok) {
        throw new Error(
          `scheduling contract: observeBusyDay(${key}) failed — ${JSON.stringify(read.error)}`,
        );
      }
      return busyOf(read.value, which);
    },
  };
}
