import { Observable, map, of } from 'rxjs';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { BarberId, LocationId, Service } from '@creativo/domain/catalog';
import {
  type AvailabilityLine,
  type AvailabilityOption,
  type BarberDayAvailability,
  BookingCart,
  BookingPolicy,
  CalendarDay,
  DateRange,
  Interval,
  type LineTerms,
  type RosterWindow,
  availableStarts,
  distinctStarts,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import { AvailabilityReader } from '../ports/availability-reader.port';

export interface ObserveDayAvailabilityInput {
  readonly cart: BookingCart;
  /** The catalog snapshot the cart's service ids resolve against. */
  readonly services: readonly Service[];
  /** Every ACTIVE barber — the roster decides who works where, not this list. */
  readonly barberIds: readonly BarberId[];
  /** `null` ⇒ "any shop": every shop is a candidate and each option names its own. */
  readonly locationId: LocationId | null;
  readonly day: CalendarDay;
  readonly policy: BookingPolicy;
  /** "Now", as an instant. Injected so the grid is testable and so a stale tab re-floors on refresh. */
  readonly now: ZonedDateTime;
  readonly maxOptions?: number;
  /**
   * Restrict the search to these instants — the day's declared windows.
   * Absent ⇒ the whole day, which is what the normal single-day grid asks for.
   */
  readonly withinMs?: readonly Interval[];
}

/**
 * One arrangement, and the shop it happens at.
 *
 * The location rides on the OPTION rather than on the query, because with "any
 * shop" the answer is a mix and the grid has to be able to say which. An
 * `Appointment` holds exactly one `locationId`, so an option is always
 * single-shop — see `optionsForDay` for how that is guaranteed.
 */
export interface LocatedOption {
  readonly locationId: LocationId;
  readonly option: AvailabilityOption;
}

export interface DayAvailability {
  readonly day: CalendarDay;
  /** One canonical arrangement per (shop, start). */
  readonly options: readonly LocatedOption[];
  /** Distinct party start times across every shop — what the slot grid renders. */
  readonly starts: readonly number[];
}

/**
 * Cart → engine lines, resolving terms across BOTH catalog axes.
 *
 * Exported and pure: the schedule grid, the review step's re-check and the
 * server's commit-time verification must all build the same lines from the
 * same cart, and a second implementation of this mapping is a second answer
 * to "how long does this take".
 *
 * A line whose service is missing from the snapshot is DROPPED rather than
 * guessed at — offering a time for a service that no longer exists would only
 * fail later, at the write, after the client has committed to it.
 */
export function cartToAvailabilityLines(
  cart: BookingCart,
  services: readonly Service[],
  barberIds: readonly BarberId[],
): readonly AvailabilityLine[] {
  const byId = new Map(services.map((service) => [service.id.value, service]));

  return cart.entries().flatMap(([, lines]) =>
    lines.flatMap((line): readonly AvailabilityLine[] => {
      const service = byId.get(line.serviceId.value);
      if (!service) return [];

      const toTerms = (barberId: BarberId | null): LineTerms => {
        const terms = service.termsFor(barberId, line.variantId);
        return {
          durationMinutes: terms.durationMinutes,
          padBeforeMinutes: terms.setupMinutes,
          padAfterMinutes: terms.cleanupMinutes,
        };
      };

      return [
        {
          lineId: line.id.value,
          barberPref: line.barberPref,
          // The catalog terms, before anyone picks a barber.
          ...toTerms(null),
          // …and what each barber in the pool actually takes. Resolved for
          // every barber, not only the preferred one: with an `any`
          // preference the engine tries them all, and each has to be
          // measured on their own terms.
          termsByBarber: new Map(
            barberIds.map((barberId) => [barberId.value, toTerms(barberId)]),
          ),
        },
      ];
    }),
  );
}

/**
 * Live availability for one day, as arrangements the party could actually take.
 *
 * The engine runs in the BROWSER against geometry the reader streams. That is
 * deliberate: a slot grid that re-queries the server on every duration change
 * is a grid that lags, and the identical pure code runs again inside
 * `commitBooking` as the authority. The client's answer is an offer; the
 * server's is the truth.
 */
export class ObserveDayAvailabilityUseCase {
  constructor(private readonly reader: AvailabilityReader) {}

  execute(
    input: ObserveDayAvailabilityInput,
  ): Observable<Result<DayAvailability, RepositoryError>> {
    const lines = cartToAvailabilityLines(
      input.cart,
      input.services,
      input.barberIds,
    );
    if (lines.length === 0) {
      return of(
        ok<DayAvailability, RepositoryError>({
          day: input.day,
          options: [],
          starts: [],
        }),
      );
    }

    // Minimum lead time is applied HERE, once, as an instant floor — rather
    // than by trimming windows, which would also shrink the capacity
    // denominator every statistic divides by.
    const notBeforeMs =
      input.now.toMillis() + input.policy.minLeadMinutes * 60_000;

    return this.reader
      .observeDay(input.locationId, input.day, input.barberIds)
      .pipe(
        map((result) => {
          if (result.isFailure()) {
            return fail<DayAvailability, RepositoryError>(result.error);
          }
          const options = optionsForDay({
            lines,
            barbers: result.value,
            policy: input.policy,
            notBeforeMs,
            maxOptions: input.maxOptions,
            withinMs: input.withinMs,
          });
          return ok<DayAvailability, RepositoryError>({
            day: input.day,
            options,
            starts: distinctStarts(options.map((entry) => entry.option)),
          });
        }),
      );
  }
}

/**
 * Arrangements for a day, grouped so that each one happens at ONE shop.
 *
 * The engine itself is shop-blind: it places lines into whatever windows it is
 * given. Handing it a mixed pool would let it seat a father at Center and his
 * son at Mladost at the same time — geometrically valid, physically absurd, and
 * unrepresentable anyway, since an `Appointment` holds one `locationId`.
 *
 * So the pool is partitioned by the location on each barber's windows and the
 * engine runs once per shop. Running it N times rather than teaching it about
 * places keeps the backtracker — the part that is hard to get right and is
 * covered by property tests — completely untouched.
 *
 * BUSY is not partitioned: a barber booked at the other shop is not free here
 * either, so every shop's run sees their whole day.
 */
export function optionsForDay(query: {
  readonly lines: readonly AvailabilityLine[];
  readonly barbers: readonly BarberDayAvailability[];
  readonly policy: BookingPolicy;
  readonly notBeforeMs: number;
  readonly maxOptions?: number;
  /** The client's declared windows for this day, if they narrowed it. */
  readonly withinMs?: readonly Interval[];
}): readonly LocatedOption[] {
  const byLocation = new Map<
    string,
    {
      readonly locationId: LocationId;
      readonly barbers: BarberDayAvailability[];
    }
  >();

  for (const barber of query.barbers) {
    for (const window of barber.windows) {
      const key = window.locationId.value;
      const entry = byLocation.get(key) ?? {
        locationId: window.locationId,
        barbers: [],
      };
      let forBarber = entry.barbers.find((candidate) =>
        candidate.barberId.equals(barber.barberId),
      );
      if (!forBarber) {
        forBarber = {
          barberId: barber.barberId,
          windows: [],
          busy: barber.busy,
        };
        entry.barbers.push(forBarber);
      }
      (forBarber.windows as RosterWindow[]).push(window);
      byLocation.set(key, entry);
    }
  }

  const located: LocatedOption[] = [];
  // Sorted by shop id so two identical queries produce identical output —
  // `Map` iteration order would depend on which barber was read first.
  for (const key of [...byLocation.keys()].sort()) {
    const entry = byLocation.get(key);
    if (!entry) continue;
    // `availableStarts`, not `availableOptions`: the grid needs one arrangement
    // per time, and the exhaustive walk spends its whole budget enumerating the
    // morning nine ways over.
    for (const option of availableStarts({
      lines: query.lines,
      barbers: entry.barbers,
      policy: query.policy,
      notBeforeMs: query.notBeforeMs,
      maxOptions: query.maxOptions,
      withinMs: query.withinMs,
    })) {
      located.push({ locationId: entry.locationId, option });
    }
  }

  return located.sort(
    (a, b) =>
      a.option.envelope.startMs - b.option.envelope.startMs ||
      a.locationId.value.localeCompare(b.locationId.value),
  );
}

export interface ObserveRangeCapacityInput {
  readonly locationId: LocationId | null;
  readonly range: DateRange;
  readonly barberIds: readonly BarberId[];
}

/**
 * Per-day free minutes across a range — the calendar's markers.
 *
 * Coarse on purpose. A month of full arrangements is a payload nobody reads,
 * and a calendar dot only has to answer "is there anything here at all". The
 * exact offer is computed when a day is actually opened.
 */
export class ObserveRangeCapacityUseCase {
  constructor(private readonly reader: AvailabilityReader) {}

  execute(
    input: ObserveRangeCapacityInput,
  ): Observable<Result<ReadonlyMap<string, number>, RepositoryError>> {
    return this.reader.observeRangeCapacity(
      input.locationId,
      input.range,
      input.barberIds,
    );
  }
}
