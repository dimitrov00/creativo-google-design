import { Observable, of } from 'rxjs';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  type BarberDayAvailability,
  CalendarDay,
  type ChairTime,
  Interval,
  type RosterWindow,
  paddedBusy,
  windowsAt,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import { AvailabilityReader } from './availability-reader.port';

/**
 * THE PORT'S BUSY CONTRACT, AS DATA ANY IMPLEMENTATION'S SPEC CAN RUN.
 *
 * `AvailabilityReader.observeDay` promises that each barber's `busy` is
 * `paddedBusy` of their stored spans, their turnaround and the `release`.
 * TypeScript cannot hold an implementation to it: an `observeDay` with fewer
 * parameters still satisfies the interface. That is how the Firestore
 * adapter dropped `release` for a whole round while every use-case spec,
 * written against a fake that honoured it, stayed green.
 *
 * So the promise is written down once, here, as cases with their answers,
 * and every implementation that reads stored geometry (the Firestore
 * adapter, {@link InMemoryAvailabilityReader}) runs all of them. An
 * implementation that ignores `release`, or pads after releasing the wrong
 * way round, fails a case. The answers are worked out by hand, and a spec
 * checks each one against `paddedBusy` too, so the cases and the domain rule
 * cannot drift apart either.
 */
export interface AvailabilityReaderBusyCase {
  /** What the case pins down, in words a failing test prints. */
  readonly name: string;
  /** The barber's reset time, from their roster. */
  readonly turnaroundMinutes: number;
  /** The barber's `barberBusy` spans for the day, UNPADDED, as stored. */
  readonly spans: readonly Interval[];
  /** What the caller hands back: the chair time of a visit being moved. */
  readonly release?: readonly ChairTime[];
  /** The `busy` the port must answer for that barber. */
  readonly busy: readonly Interval[];
}

/**
 * The cases, placed on `day` for `barberId`. `otherBarberId` names somebody
 * else, whose released chairs must never free this barber's time.
 *
 * Every instant is a wall-clock time on `day` in its own zone, between 09:00
 * and 13:00, so any day that is not a DST transition morning holds them.
 */
export function availabilityReaderBusyCases(input: {
  readonly day: CalendarDay;
  readonly barberId: BarberId;
  readonly otherBarberId: BarberId;
}): readonly AvailabilityReaderBusyCase[] {
  const { day, barberId, otherBarberId } = input;
  const at = (hour: number, minute = 0): number => {
    const instant = ZonedDateTime.fromParts(
      { year: day.year, month: day.month, day: day.day, hour, minute },
      day.zone,
    );
    if (instant.isFailure()) {
      throw new Error(`contract fixture: ${day.key()} ${hour}:${minute}`);
    }
    return instant.value.toMillis();
  };
  const span = (from: [number, number], to: [number, number]): Interval =>
    Interval.of(at(...from), at(...to));

  /** The visit being moved holds 10:00–11:00; a neighbour follows it. */
  const merged = [span([10, 0], [12, 0])];
  const ownChair: ChairTime = {
    barberId,
    occupied: span([10, 0], [11, 0]),
  };

  return [
    {
      name: 'nothing handed back: every span padded by the turnaround',
      turnaroundMinutes: 15,
      spans: [span([10, 0], [11, 0])],
      busy: [span([9, 45], [11, 15])],
    },
    {
      name: 'an empty release is the ordinary booking',
      turnaroundMinutes: 15,
      spans: [span([10, 0], [11, 0])],
      release: [],
      busy: [span([9, 45], [11, 15])],
    },
    {
      name: 'the moved visit’s own chair is released BEFORE padding, and the neighbour keeps its turnaround',
      turnaroundMinutes: 15,
      // The projection merged the visit (10:00–11:00) and its neighbour
      // (11:00–12:00) into one span. Released first and padded after, the
      // neighbour is still guarded on both sides; padded first and released
      // after, 10:45–11:00 of the neighbour's turnaround would be freed.
      spans: merged,
      release: [ownChair],
      busy: [span([10, 45], [12, 15])],
    },
    {
      name: 'somebody else’s chair frees none of this barber’s time',
      turnaroundMinutes: 15,
      spans: merged,
      release: [{ barberId: otherBarberId, occupied: ownChair.occupied }],
      busy: [span([9, 45], [12, 15])],
    },
    {
      name: 'a visit that was the whole day leaves the day free',
      turnaroundMinutes: 15,
      spans: [span([10, 0], [11, 0])],
      release: [ownChair],
      busy: [],
    },
    {
      name: 'every chair of a party is released, one barber’s share at a time',
      turnaroundMinutes: 0,
      spans: [span([9, 0], [9, 30]), span([10, 0], [11, 0])],
      release: [
        { barberId, occupied: span([9, 0], [9, 30]) },
        { barberId: otherBarberId, occupied: span([10, 0], [11, 0]) },
      ],
      busy: [span([10, 0], [11, 0])],
    },
  ];
}

/** One barber's day as the projection and the roster hold it. */
export interface StoredBarberDay {
  readonly barberId: BarberId;
  /** The rostered windows, already materialised (`buildDayWindows`). */
  readonly windows: readonly RosterWindow[];
  /** The `barberBusy` spans, UNPADDED. */
  readonly spans: readonly Interval[];
  readonly turnaroundMinutes: number;
}

/**
 * The port over geometry held in memory: the reference implementation of
 * the busy contract, for every spec that needs a reader with stored spans.
 *
 * It answers the way the Firestore adapter must: windows narrowed to the
 * shop asked about (a barber with none there is left out), busy
 * location-agnostic and equal to `paddedBusy(spans, turnaround, release)`,
 * barbers in id order. It records every `release` it was handed, so a spec
 * can see what a use case asked for. Capacity is the projection's rollup,
 * which this does not model: every day reads as having no free minutes.
 */
export class InMemoryAvailabilityReader implements AvailabilityReader {
  /** Every `release` `observeDay` was called with, in order. */
  readonly released: (readonly ChairTime[] | undefined)[] = [];

  constructor(
    private readonly stored: (day: CalendarDay) => readonly StoredBarberDay[],
  ) {}

  observeDay(
    locationId: LocationId | null,
    day: CalendarDay,
    barberIds: readonly BarberId[],
    release?: readonly ChairTime[],
  ): Observable<Result<readonly BarberDayAvailability[], RepositoryError>> {
    this.released.push(release);
    const asked = new Set(barberIds.map((id) => id.value));
    const days = this.stored(day)
      .filter((entry) => asked.has(entry.barberId.value))
      .sort((a, b) => a.barberId.value.localeCompare(b.barberId.value))
      .flatMap((entry): readonly BarberDayAvailability[] => {
        const windows = locationId
          ? windowsAt(entry.windows, locationId)
          : entry.windows;
        if (windows.length === 0) return [];
        return [
          {
            barberId: entry.barberId,
            windows,
            busy: paddedBusy({
              barberId: entry.barberId,
              spans: entry.spans,
              turnaroundMinutes: entry.turnaroundMinutes,
              release,
            }),
          },
        ];
      });
    return of(ok<readonly BarberDayAvailability[], RepositoryError>(days));
  }

  observeRangeCapacity(): Observable<
    Result<ReadonlyMap<string, number>, RepositoryError>
  > {
    return of(ok<ReadonlyMap<string, number>, RepositoryError>(new Map()));
  }
}
