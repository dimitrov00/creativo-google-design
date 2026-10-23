import { type Observable, combineLatest, map, of } from 'rxjs';
import type { CapacityStreamPorts, ShopDayStreamPorts } from '@core/ports';
import type {
  BarberBusyDay,
  BarberSchedule,
  ScheduleException,
  Service,
  ShopLocation,
} from '@core/entities';
import {
  type BookingCart,
  type BookingPolicy,
  CapacityEntry,
  type ChairTime,
  type RosterWindow,
  type ShopNow,
} from '@core/components';
import {
  type BarberId,
  BusyKey,
  type CapacityMonthId,
  LocalDate,
  type LocationId,
  Result,
} from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import {
  AvailabilitySystem,
  BookingCartSystem,
  type CartBarberDay,
  type CartLocatedOption,
  type CartRider,
  PartyAdmissionSystem,
  RosterSystem,
  type ShopHours,
} from '@core/systems';

/*
 * ONE SHOP DAY'S GRID, FROM THE RAW STREAMS (flip 1, F1-10).
 *
 * Availability is never computed behind a port: the day's documents arrive
 * raw from `SCHEDULING_READ_PORTS` — each barber's roster, busy day and
 * schedule exception — and the step that shows the grid derives the
 * arrangements in a `computed()` by calling the systems: `RosterSystem`
 * builds each barber's bookable windows (clamped to every listed shop's
 * hours), `AvailabilitySystem.paddedBusy` hands a moved visit's chairs back
 * and pads what is taken by the barber's turnaround, and
 * `BookingCartSystem.optionsForDay` runs the engine once per shop that can
 * serve the whole party. The server's commit runs the same systems over the
 * same documents, so the grid offers what the commit accepts.
 *
 * Split in two on purpose: {@link observeDayDocs} is the only impure half
 * (which documents, as streams), {@link dayOptions} the pure half the
 * `computed()` calls.
 */

/** Which documents one shop day is read from. */
export interface DayDocsKey {
  readonly localDate: LocalDate;
  /** Every active barber, in code-unit order — the engine's barber order, stable across reads. */
  readonly barberIds: readonly BarberId[];
  /**
   * The shop a MOVE names, read by id whatever its status — a hidden shop
   * takes no new booking, but a visit already booked there is still moved
   * by its client (team decision 2026-09-26). `null` for every other query.
   */
  readonly namedLocationId: LocationId | null;
}

/** One barber's day, as stored: `null` where there is no document. */
export interface BarberDayDocs {
  readonly barberId: BarberId;
  readonly schedule: BarberSchedule | null;
  readonly busy: BarberBusyDay | null;
  readonly exception: ScheduleException | null;
}

/** Everything one shop day's grid reads, and which key it was read for. */
export interface DayDocs {
  readonly key: DayDocsKey;
  readonly barbers: readonly BarberDayDocs[];
  readonly namedLocation: ShopLocation | null;
}

/** What one shop day's grid is asked — the bag, the catalogue, the clock and a move's carried facts. */
export interface DayQuery {
  /** The bag, as the cart math reads it. */
  readonly cart: BookingCart;
  /** The catalogue the bag's service ids resolve against. */
  readonly services: readonly Service[];
  /** Every ACTIVE barber — the roster decides who works where, not this list. */
  readonly barberIds: readonly BarberId[];
  /** `null` ⇒ "any shop": every shop is a candidate and each option names its own. */
  readonly locationId: LocationId | null;
  readonly localDate: LocalDate;
  readonly policy: BookingPolicy;
  /** "Now" on the shop's wall clock, read once by the caller. */
  readonly now: ShopNow;
  /** Everybody a MOVE carries, pinned to the party's start; `[]` on a new booking. */
  readonly riders: readonly CartRider[];
  /**
   * The chair time of the visit being MOVED, handed back first — minutes of
   * {@link DayQuery.releaseLocalDate}, the visit's own shop day; `[]` on a
   * new booking.
   */
  readonly release: readonly ChairTime[];
  /** The shop day the moved visit stands on — `null` on a new booking. */
  readonly releaseLocalDate: LocalDate | null;
  /** Every LISTED shop — the grid's whole set of shops, each clamping its own segments. */
  readonly shops: readonly ShopLocation[];
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The documents a day query reads. The barbers are sorted so the engine's
 * barber iteration — and so the order of the options — is stable across
 * reads; a moved visit's own shop is read by id only for a move at a named
 * shop (a release to hand back).
 */
export function dayDocsKey(
  query: Pick<DayQuery, 'localDate' | 'barberIds' | 'locationId' | 'release'>,
): DayDocsKey {
  return {
    localDate: query.localDate,
    barberIds: [...query.barberIds].sort(compareIds),
    namedLocationId:
      query.locationId !== null && query.release.length > 0
        ? query.locationId
        : null,
  };
}

/** Do two keys read the same documents? Structural — a recompute mints fresh keys. */
export function sameDayDocsKey(
  a: DayDocsKey | null,
  b: DayDocsKey | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.localDate === b.localDate &&
    a.namedLocationId === b.namedLocationId &&
    a.barberIds.length === b.barberIds.length &&
    a.barberIds.every((id, index) => b.barberIds.at(index) === id)
  );
}

/**
 * The day's raw documents, live: per barber the roster, the busy day and the
 * schedule exception (a day off has to grey the sheet, not just the commit),
 * and a move's named shop. One read failing is the whole day failing:
 * quietly dropping a barber would render a grid that looks complete while
 * hiding someone's free time.
 */
export function observeDayDocs(
  ports: ShopDayStreamPorts,
  key: DayDocsKey,
): Observable<Result<DayDocs, RepositoryError>> {
  const perBarber: Observable<Result<BarberDayDocs, RepositoryError>>[] =
    key.barberIds.map((barberId) => {
      const busyKey = BusyKey.of(barberId, key.localDate);
      return combineLatest([
        ports.observeSchedule(barberId),
        ports.observeBusyDay(busyKey),
        ports.observeExceptions(busyKey),
      ]).pipe(
        map(([schedule, busy, exception]) => {
          if (!schedule.ok) return schedule;
          if (!busy.ok) return busy;
          if (!exception.ok) return exception;
          return Result.ok({
            barberId,
            schedule: schedule.value,
            busy: busy.value,
            exception: exception.value,
          });
        }),
      );
    });
  const barbers$: Observable<
    Result<readonly BarberDayDocs[], RepositoryError>
  > =
    perBarber.length === 0
      ? of(Result.ok([]))
      : combineLatest(perBarber).pipe(
          map((results) => {
            const barbers: BarberDayDocs[] = [];
            for (const result of results) {
              if (!result.ok) return result;
              barbers.push(result.value);
            }
            return Result.ok(barbers);
          }),
        );
  const named$: Observable<Result<ShopLocation | null, RepositoryError>> =
    key.namedLocationId === null
      ? of(Result.ok(null))
      : ports.observeLocation(key.namedLocationId);
  return combineLatest([barbers$, named$]).pipe(
    map(([barbers, named]) => {
      if (!barbers.ok) return barbers;
      if (!named.ok) return named;
      return Result.ok({
        key,
        barbers: barbers.value,
        namedLocation: named.value,
      });
    }),
  );
}

/**
 * A moved visit's held chairs ON `localDate` — the release the engine hands
 * back. The chairs are minutes of the visit's own shop day; on any other day
 * they release nothing.
 */
export function releaseOn(
  release: readonly ChairTime[],
  releaseLocalDate: LocalDate | null,
  localDate: LocalDate,
): readonly ChairTime[] {
  return releaseLocalDate === localDate ? release : [];
}

/**
 * The shops a day may offer, each with its hours that day: every LISTED
 * shop — and, for a visit being MOVED at a named shop, that shop too,
 * listed or not, still clamped to its own hours (never offered unbounded).
 */
function offeredShopHours(
  query: DayQuery,
  namedLocation: ShopLocation | null,
): readonly ShopHours[] {
  const hours: ShopHours[] = [];
  for (const shop of query.shops) {
    if (!PartyAdmissionSystem.shopListed(shop)) continue;
    hours.push({
      locationId: shop.id,
      hours: RosterSystem.shopDayHours(shop.openingHours, query.localDate),
    });
  }
  if (namedLocation !== null) {
    const own = {
      locationId: namedLocation.id,
      hours: RosterSystem.shopDayHours(
        namedLocation.openingHours,
        query.localDate,
      ),
    };
    // The move's own shop, by its own hours — replacing the listed entry.
    return [
      ...hours.filter((entry) => entry.locationId !== own.locationId),
      own,
    ];
  }
  return hours;
}

/**
 * Every barber's shop day as the engine reads it: the roster's windows at
 * the offered shops (narrowed to the chosen shop, if any) and the busy
 * minutes, the moved visit's chairs handed back and the rest padded by the
 * barber's turnaround. Busy is location-AGNOSTIC: a barber booked at the
 * other shop is not free here either. A barber with no roster, or no window
 * left, is not on the day.
 */
export function barberDays(
  query: DayQuery,
  docs: DayDocs,
): readonly CartBarberDay[] {
  const shopHours = offeredShopHours(query, docs.namedLocation);
  const offered = shopHours.map((entry) => entry.locationId);
  const release = releaseOn(
    query.release,
    query.releaseLocalDate,
    query.localDate,
  );
  const days: CartBarberDay[] = [];
  for (const barber of docs.barbers) {
    if (barber.schedule === null) continue;
    // Only at a shop the day may offer: a shop absent from `shopHours` reads
    // as "no bound" to the roster, which is wrong for one hidden since.
    const all: RosterWindow[] = [];
    for (const window of RosterSystem.buildDayWindows({
      barberId: barber.barberId,
      localDate: query.localDate,
      versions: barber.schedule.versions,
      exceptions: barber.exception === null ? [] : [barber.exception],
      shopHours,
    })) {
      if (offered.includes(window.locationId)) all.push(window);
    }
    const windows =
      query.locationId === null
        ? all
        : RosterSystem.windowsAt(all, query.locationId);
    if (windows.length === 0) continue;
    days.push({
      barberId: barber.barberId,
      windows,
      busy: AvailabilitySystem.paddedBusy({
        barberId: barber.barberId,
        spans: barber.busy === null ? [] : barber.busy.blocks,
        turnaroundMinutes: barber.schedule.turnaroundMinutes,
        release,
      }),
    });
  }
  return days;
}

/**
 * One shop day's arrangements, each at ONE shop, sorted by start then shop
 * — the grid's offer. The lead time is applied once, as a floor on the
 * starts (`AvailabilitySystem.leadFloor`), never by trimming windows.
 */
export function dayOptions(
  query: DayQuery,
  docs: DayDocs,
): readonly CartLocatedOption[] {
  return BookingCartSystem.optionsForDay({
    cart: query.cart,
    services: query.services,
    riders: query.riders,
    barbers: barberDays(query, docs),
    localDate: query.localDate,
    policy: query.policy,
    notBefore: AvailabilitySystem.leadFloor(
      query.now,
      query.policy,
      query.localDate,
    ),
    within: null,
    budget: AvailabilitySystem.DEFAULT_BUDGET,
  });
}

/** The capacity months a run of days reads — `YYYY-MM`, in order, each once. */
export function capacityMonthsOf(
  from: LocalDate,
  to: LocalDate,
): readonly CapacityMonthId[] {
  const months: CapacityMonthId[] = [];
  for (const day of LocalDate.range(from, to)) {
    const month = LocalDate.monthKey(day);
    if (!months.includes(month)) months.push(month);
  }
  return months;
}

/** The month documents' entries, live, in one list — `null` months (never rebuilt) hold nothing. */
export function observeCapacityEntries(
  ports: CapacityStreamPorts,
  months: readonly CapacityMonthId[],
): Observable<Result<readonly CapacityEntry[], RepositoryError>> {
  if (months.length === 0) return of(Result.ok([]));
  return combineLatest(
    months.map((month) => ports.observeCapacityMonth(month)),
  ).pipe(
    map((results) => {
      const entries: CapacityEntry[] = [];
      for (const result of results) {
        if (!result.ok) return result;
        if (result.value !== null) entries.push(...result.value.entries);
      }
      return Result.ok(entries);
    }),
  );
}

/**
 * Per-day free minutes across a run — the calendar's markers
 * (`CapacityEntry.freeMinutesOn`): the barbers the bag accepts, at the one
 * shop asked about (`null` = every shop). Coarse on purpose: a calendar dot
 * only answers "is there anything here at all".
 */
export function capacityByDay(
  entries: readonly CapacityEntry[],
  from: LocalDate,
  to: LocalDate,
  barberIds: readonly BarberId[],
  locationId: LocationId | null,
): ReadonlyMap<string, number> {
  // `freeMinutesOn` walks a SORTED month — the stored order (D7).
  const sorted = [...entries].sort(CapacityEntry.compare);
  const byDay = new Map<string, number>();
  for (const day of LocalDate.range(from, to)) {
    byDay.set(
      day,
      CapacityEntry.freeMinutesOn(sorted, day, barberIds, locationId),
    );
  }
  return byDay;
}
