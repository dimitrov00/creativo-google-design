import { Observable, map, of } from 'rxjs';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  Service,
  type ServiceTerms,
} from '@creativo/domain/catalog';
import {
  BarberId as EcsBarberId,
  CartLineId as EcsCartLineId,
  Currency,
  DurationMinutes,
  LocationId as EcsLocationId,
  MinuteCount,
  PriceCents,
  SeatKeyText,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  defect,
} from '@core/primitives';
import {
  type BookingCart as CartData,
  ServiceTerms as EcsServiceTerms,
} from '@core/components';
import { BookingCartSystem, type CartService } from '@core/systems';
import {
  type AvailabilityLine,
  type AvailabilityOption,
  type BarberDayAvailability,
  BookingCart,
  BookingPolicy,
  CalendarDay,
  type ChairTime,
  DateRange,
  Interval,
  type LineTerms,
  type RosterWindow,
  availableStarts,
  distinctStarts,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import { AvailabilityReader } from '../ports/availability-reader.port';
import {
  type MoveRider,
  type PartyServices,
  partyServicesOf,
  shopsServingParty,
} from './party-shops';

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
  /**
   * Everybody a MOVE carries without searching for them: the visit's seats
   * the cart cannot name, pinned to the party's start
   * (`MoveRider`). A start where one of them could not sit is not offered,
   * and neither is a shop that does not offer one of their services: the
   * server would refuse both
   * (`booking.reschedule.carried_seat_unplaceable`). Absent on every
   * ordinary booking.
   */
  readonly riders?: readonly MoveRider[];
  /**
   * The chair time of the visit being MOVED (`Appointment.chairTimes`),
   * handed back before anything is placed. Its own seats never block its
   * own move: the server decides a move with the visit's contribution
   * subtracted, so a grid that kept it would under-offer every short move.
   * This applies to the cart's lines and the riders alike. The reader does
   * the release, because only it holds the spans before their turnaround
   * padding (`paddedBusy`). Absent on every ordinary booking.
   */
  readonly release?: readonly ChairTime[];
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
  const prefs = new Map(
    cart
      .entries()
      .flatMap(([, lines]) =>
        lines.map((line) => [line.id.value, line.barberPref] as const),
      ),
  );
  return BookingCartSystem.toAvailabilityLines(
    cartDataOf(cart),
    servicesDataOf(services),
    barberIds.map((barberId) => EcsBarberId.of(barberId.value)),
  ).map((line) => ({
    lineId: line.lineId,
    // The caller's own preference object for the line (the system's is
    // the same answer, as a struct).
    barberPref: prefs.get(line.lineId) as AvailabilityLine['barberPref'],
    personKey: line.personKey ?? undefined,
    durationMinutes: line.durationMinutes,
    padBeforeMinutes: line.padBeforeMinutes,
    padAfterMinutes: line.padAfterMinutes,
    // The dense per-barber terms, keyed back by the pool's ids.
    termsByBarber: new Map(
      barberIds.map((barberId, index) => [
        barberId.value,
        line.termsByBarber.at(index) as LineTerms,
      ]),
    ),
  }));
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
      .observeDay(input.locationId, input.day, input.barberIds, input.release)
      .pipe(
        map((result) => {
          if (result.isFailure()) {
            return fail<DayAvailability, RepositoryError>(result.error);
          }
          const options = optionsForDay({
            lines,
            services: input.services,
            party: partyServicesOf(input.cart, input.riders),
            barbers: result.value,
            policy: input.policy,
            notBeforeMs,
            maxOptions: input.maxOptions,
            withinMs: input.withinMs,
            riders: input.riders,
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
 *
 * A SHOP IS RUN ONLY FOR A PARTY IT CAN SERVE WHOLE (`shopsServingParty`).
 * The server checks `Service.servesLocation` for every seat it decides, the
 * cart's and a move's carried ones alike, and refuses the booking at a shop
 * that does not offer one of them. A time offered there is a time the
 * client learns about only at review. A move's riders are then asked about
 * a second time, by the engine: each one's barber must be rostered and free
 * at the shifted time.
 */
export function optionsForDay(query: {
  readonly lines: readonly AvailabilityLine[];
  /** The catalog snapshot the party's services resolve against. */
  readonly services: readonly Service[];
  /**
   * What the visit asks a shop to offer (`partyServicesOf` the cart and
   * `riders`).
   */
  readonly party: PartyServices;
  readonly barbers: readonly BarberDayAvailability[];
  readonly policy: BookingPolicy;
  readonly notBeforeMs: number;
  readonly maxOptions?: number;
  /** The client's declared windows for this day, if they narrowed it. */
  readonly withinMs?: readonly Interval[];
  /**
   * A move's carried seats. They are checked against each shop's run: a
   * rider's barber must be rostered at the shop the party is placed at, and
   * the shop must offer the rider's service.
   */
  readonly riders?: readonly MoveRider[];
}): readonly LocatedOption[] {
  const riders = query.riders ?? [];

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

  // A shop that cannot serve somebody on the visit has no time for this
  // party, whatever the chairs say: the server refuses that seat there.
  const serving = new Set(
    shopsServingParty(
      query.party,
      query.services,
      [...byLocation.values()].map((entry) => entry.locationId),
    ).map((locationId) => locationId.value),
  );

  const located: LocatedOption[] = [];
  // Sorted by shop id so two identical queries produce identical output —
  // `Map` iteration order would depend on which barber was read first.
  for (const key of [...byLocation.keys()].sort()) {
    const entry = byLocation.get(key);
    if (!entry || !serving.has(key)) continue;
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
      riders,
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

// ── The bridge: legacy classes → ecs-core structs (Phase 4 deletes it) ───

function cartDataOf(cart: BookingCart): CartData {
  return {
    cartSeats: cart.entries().map(([rawSeatKey, lines]) => {
      const seatKey = SeatKeyText.of(rawSeatKey);
      return {
        seatKey,
        lines: lines.map((line) => ({
          lineId: EcsCartLineId.of(line.id.value),
          seatKey,
          serviceId: EcsServiceId.of(line.serviceId.value),
          variantId:
            line.variantId === null
              ? null
              : EcsServiceVariantId.of(line.variantId.value),
          barberId:
            line.barberPref.kind === 'specific'
              ? EcsBarberId.of(line.barberPref.barberId.value)
              : null,
          locationId: null,
        })),
      };
    }),
    cartNextSequence: cart.nextLineSequence,
  };
}

/** Unreachable refusals of figures the legacy catalogue already checked. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** The legacy terms (a `Money` price) as the flat branded slice. */
function termsDataOf(terms: ServiceTerms): EcsServiceTerms {
  return EcsServiceTerms.of(
    sure(PriceCents.of(terms.price.toMinorUnits()), 'a catalogue price'),
    sure(Currency.parse(terms.price.currencyCode()), 'a catalogue currency'),
    sure(DurationMinutes.of(terms.durationMinutes), 'a catalogue duration'),
    sure(MinuteCount.of(terms.setupMinutes), 'a setup pad'),
    sure(MinuteCount.of(terms.cleanupMinutes), 'a cleanup pad'),
  );
}

/**
 * A catalogue service as the cart math reads it — its id, scope and terms
 * matrix.
 */
function serviceDataOf(service: Service): CartService {
  return {
    id: EcsServiceId.of(service.id.value),
    locationIds: service.locationIds.map((id) => EcsLocationId.of(id.value)),
    ...termsDataOf(service.baseTerms),
    offerings: service.offerings.map((offering) => ({
      barberId: EcsBarberId.of(offering.barberId.value),
      ...termsDataOf(offering.base),
      overrides: offering.overrideEntries().map(([variantId, terms]) => ({
        variantId: EcsServiceVariantId.of(variantId),
        ...termsDataOf(terms),
      })),
    })),
  };
}

/**
 * The catalogue as the cart math reads it. The legacy lookup (a `Map` by id)
 * kept the LAST of two services under one id and the system finds the
 * first, so the list is walked from the end and each id kept once.
 */
function servicesDataOf(services: readonly Service[]): readonly CartService[] {
  const out: CartService[] = [];
  const seen = new Set<string>();
  for (const service of [...services].reverse()) {
    if (seen.has(service.id.value)) continue;
    seen.add(service.id.value);
    out.push(serviceDataOf(service));
  }
  return out;
}
