import { firstValueFrom } from 'rxjs';
import { BlockKind, MinuteBlock } from '../components/minute-block.data';
import type { MinuteRange } from '../components/minute-range.data';
import type { BarberBusyDay } from '../entities/barber-busy-day.entity';
import { BusyKey } from '../primitives/busy-key.primitive';
import { MinuteCount } from '../primitives/duration-minutes.primitive';
import { BarberBusyDayId, type BarberId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import { EndMinute, MinuteOfDay } from '../primitives/minute-of-day.primitive';
import type { TimeZone } from '../primitives/time-zone.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import type { LoadBusyDay, ObserveBusyDay } from '../ports/scheduling.port';
import {
  AvailabilitySystem,
  type ChairTime,
} from '../systems/availability.system';
import { IntervalSetSystem } from '../systems/interval-set.system';
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
 * over the stored blocks, which ARE minute ranges (§4.2, flatten-spec §2.5).
 * The promise is the one it always was: a barber's `busy` is their stored
 * spans, the chairs handed back released FIRST, then padded by their
 * turnaround. A port that pads, merges, drops or re-keys what is stored
 * fails a case; so does a derivation that releases after padding, or
 * releases another barber's chair.
 *
 * Every span is a wall-clock range on the case's `localDate` (Law 7.3): the
 * contract never touches an instant except the stored day's first one
 * (`utcEpochMs`, `ZonedTimeSystem.startOfLocalDay`), which the projection
 * stamps and no reader computes with.
 *
 * Three runners, one case list (§7): the in-memory port doubles
 * (`memoryLoadBusyDay`/`memoryObserveBusyDay`, ecs-core's own spec), the
 * browser `scheduling.adapter.ts` bundle and the functions busy adapter of
 * the booking-core flip — and until that flip, the legacy matcher's reader
 * (`apps/functions/src/lib/booking/load-day-availability.spec.ts`), which
 * converts each case's {@link SchedulingBusyCase.spans} and `busy` to its
 * own instants at its boundary (`ZonedTimeSystem.toUtc`). The answers are
 * worked out by hand; the contract's own spec checks every one against the
 * derivation too, so the cases and the systems cannot drift apart.
 */

/** One case: a barber's stored day, what the caller hands back, and the `busy` that must come out. */
export type SchedulingBusyCase = {
  /** What the case pins down, in words a failing test prints. */
  readonly name: string;
  /** The barber's reset time, from their roster (`barberSchedules.turnaroundMinutes`). */
  readonly turnaroundMinutes: MinuteCount;
  /** The barber's busy spans for the day, UNPADDED, on the shop's wall clock. */
  readonly spans: readonly MinuteRange[];
  /**
   * The same day as the projection stores it — `barberBusy/{key}`, the
   * spans normalized into `BUSY` minute blocks (what `BusySystem.rebuild`
   * writes). What a runner seeds its store with and what the port must hand
   * back unchanged.
   */
  readonly stored: BarberBusyDay;
  /**
   * What the caller hands back: the chair time of a visit being moved.
   * `null` — the caller hands nothing back at all (the legacy optional
   * argument left out); `[]` — an empty hand-back. Both are the ordinary
   * booking and must answer alike.
   */
  readonly release: readonly ChairTime[] | null;
  /** The padded `busy` the derivation must answer for that barber. */
  readonly busy: readonly MinuteRange[];
};

/** Where the cases sit and how a runner reads them through a port. */
export type SchedulingPortsContract = {
  /** The shop day the cases are placed on. */
  readonly localDate: LocalDate;
  /** The day's first instant in the shop's zone — the stored `utcEpochMs`. */
  readonly dayStartUtcMs: UtcEpochMs;
  /** `${barberId}__${localDate}` — the one document every case stores and reads. */
  readonly key: BusyKey;
  readonly cases: readonly SchedulingBusyCase[];
  /**
   * The derivation every caller runs over the port's answer: the stored
   * blocks, released, then padded. `null` (no document) is a free day.
   */
  readonly busyOf: (
    stored: BarberBusyDay | null,
    entry: SchedulingBusyCase,
  ) => readonly MinuteRange[];
  /**
   * One case through a `LoadBusyDay` port seeded with `entry.stored`: reads
   * the contract's key and derives. A port error is a broken runner and
   * rejects with it.
   */
  readonly busyThroughLoad: (
    load: LoadBusyDay,
    entry: SchedulingBusyCase,
  ) => Promise<readonly MinuteRange[]>;
  /** The same through an `ObserveBusyDay` stream: its FIRST emission. */
  readonly busyThroughObserve: (
    observe: ObserveBusyDay,
    entry: SchedulingBusyCase,
  ) => Promise<readonly MinuteRange[]>;
};

/** Where to place the cases. `otherBarberId` is somebody whose released chairs must never free this barber's time. */
export type SchedulingPortsContractInput = {
  readonly localDate: LocalDate;
  readonly timeZone: TimeZone;
  readonly barberId: BarberId;
  readonly otherBarberId: BarberId;
};

/** A wall-clock span with both ends branded — what a chair and a block carry. */
type WallSpan = Pick<ChairTime, 'startMinutes' | 'endMinutes'>;

/** A fixture range on the wall clock; the cases only name valid ones. */
function wallSpan(startMinutes: number, endMinutes: number): WallSpan {
  const start = MinuteOfDay.of(startMinutes);
  const end = EndMinute.of(endMinutes);
  if (!start.ok || !end.ok) {
    throw new Error(
      `scheduling contract fixture: ${startMinutes}–${endMinutes}`,
    );
  }
  return { startMinutes: start.value, endMinutes: end.value };
}

/**
 * The cases, placed on `localDate` for `barberId`. Every span is a
 * wall-clock range between 09:00 and 13:00 — no instant, so every day
 * holds them, a DST transition morning included; `timeZone` only stamps
 * the stored day's first instant. A zone the runtime cannot place the day
 * in is a broken fixture and throws.
 */
export function schedulingPortsContract(
  input: SchedulingPortsContractInput,
): SchedulingPortsContract {
  const { localDate, timeZone, barberId, otherBarberId } = input;
  if (!ZonedTimeSystem.checkZone(timeZone).ok) {
    throw new Error(
      `scheduling contract fixture: cannot place ${localDate} in ${timeZone}`,
    );
  }
  const dayStartUtcMs = ZonedTimeSystem.startOfLocalDay(localDate, timeZone);
  const span = (
    from: readonly [number, number],
    to: readonly [number, number],
  ): WallSpan => wallSpan(from[0] * 60 + from[1], to[0] * 60 + to[1]);
  const chair = (owner: BarberId, range: WallSpan): ChairTime => ({
    barberId: owner,
    ...range,
  });
  const key = BusyKey.of(barberId, localDate);
  const minutes = (raw: number): MinuteCount => {
    const parsed = MinuteCount.of(raw);
    if (!parsed.ok) throw new Error(`scheduling contract fixture: ${raw} min`);
    return parsed.value;
  };

  const stored = (spans: readonly MinuteRange[]): BarberBusyDay => {
    const blocks: MinuteBlock[] = [];
    for (const merged of IntervalSetSystem.normalize(spans)) {
      const range = wallSpan(merged.startMinutes, merged.endMinutes);
      blocks.push(
        MinuteBlock.of(range.startMinutes, range.endMinutes, BlockKind.Busy),
      );
    }
    return {
      id: BarberBusyDayId.of(key),
      barberId,
      localDate,
      utcEpochMs: dayStartUtcMs,
      blocks,
    };
  };
  const entry = (
    name: string,
    turnaroundMinutes: number,
    spans: readonly MinuteRange[],
    release: readonly ChairTime[] | null,
    busy: readonly MinuteRange[],
  ): SchedulingBusyCase => ({
    name,
    turnaroundMinutes: minutes(turnaroundMinutes),
    spans,
    stored: stored(spans),
    release,
    busy,
  });

  /** The visit being moved holds 10:00–11:00; a neighbour follows it. */
  const merged = [span([10, 0], [12, 0])];
  const ownChair = chair(barberId, span([10, 0], [11, 0]));

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
      [{ ...ownChair, barberId: otherBarberId }],
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
        chair(barberId, span([9, 0], [9, 30])),
        chair(otherBarberId, span([10, 0], [11, 0])),
      ],
      [span([10, 0], [11, 0])],
    ),
  ];

  // The stored blocks ARE minute ranges (Law 6: no inbound mapping).
  const busyOf = (
    found: BarberBusyDay | null,
    which: SchedulingBusyCase,
  ): readonly MinuteRange[] =>
    AvailabilitySystem.paddedBusy({
      barberId,
      spans: found === null ? [] : found.blocks,
      turnaroundMinutes: which.turnaroundMinutes,
      release: which.release ?? [],
    });

  return {
    localDate,
    dayStartUtcMs,
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
