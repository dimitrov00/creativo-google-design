import { describe, expect, it } from 'vitest';
import { Observable, firstValueFrom, of } from 'rxjs';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  Service,
  ServiceId,
} from '@creativo/domain/catalog';
import {
  type BarberDayAvailability,
  BarberPref,
  BookingCart,
  BookingPolicy,
  CalendarDay,
  type ChairTime,
  DateRange,
  GuestId,
  Interval,
  SeatKey,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import { AvailabilityReader } from '../ports/availability-reader.port';
import { InMemoryAvailabilityReader } from '../ports/availability-reader.contract';
import {
  ObserveDayAvailabilityUseCase,
  cartToAvailabilityLines,
} from './observe-availability.use-case';
import type { MoveRider } from './party-shops';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const day = () => unwrap(CalendarDay.create('2026-08-03', ZONE));
const barberId = (raw: string) => unwrap(BarberId.create(raw));
const locationId = () => unwrap(LocationId.create('loc-center'));

/** Local wall-clock on the fixture day, as epoch millis. */
function at(hour: number, minute = 0): number {
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute },
      ZONE,
    ),
  ).toMillis();
}

/**
 * A haircut Ivan does in 30 minutes and Niko in 45, with Niko needing 15
 * minutes of cleanup after. Both axes of the terms matrix in one fixture.
 */
function fadeService(): Service {
  return unwrap(
    Service.create({
      id: 'svc-fade',
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2500,
      currencyCode: 'EUR',
      durationMinutes: 40,
      locationIds: ['loc-center'],
      conflictsWith: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 2500,
            currencyCode: 'EUR',
            durationMinutes: 30,
          },
        },
        {
          barberId: 'niko',
          base: {
            priceMinorUnits: 2800,
            currencyCode: 'EUR',
            durationMinutes: 45,
            cleanupMinutes: 15,
          },
        },
      ],
      status: 'active',
      sortOrder: 1,
    }),
  );
}

function cartWithFade(pref: BarberPref = BarberPref.any()): BookingCart {
  // `addLine` is a Result now — it refuses a service the seat already holds.
  return unwrap(
    BookingCart.empty().addLine(SeatKey.self(), {
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberPref: pref,
    }),
  );
}

/** A reader that hands back fixed geometry — the engine is what's under test. */
function readerReturning(
  days: readonly BarberDayAvailability[],
): AvailabilityReader {
  return {
    observeDay: (): Observable<
      Result<readonly BarberDayAvailability[], RepositoryError>
    > => of(ok(days)),
    observeRangeCapacity: (): Observable<
      Result<ReadonlyMap<string, number>, RepositoryError>
    > => of(ok(new Map())),
  };
}

function barberDay(
  id: string,
  window: readonly [number, number],
): BarberDayAvailability {
  return {
    barberId: barberId(id),
    windows: [
      { interval: Interval.of(window[0], window[1]), locationId: locationId() },
    ],
    busy: [],
  };
}

const createUseCase = (reader: AvailabilityReader) =>
  new ObserveDayAvailabilityUseCase(reader);

describe('cartToAvailabilityLines', () => {
  it('resolves BOTH terms axes — per barber, and the catalog default', () => {
    const lines = cartToAvailabilityLines(
      cartWithFade(),
      [fadeService()],
      [barberId('ivan'), barberId('niko')],
    );

    expect(lines).toHaveLength(1);
    const line = lines[0];
    // Default = `termsFor(null)`: the catalog price before anyone is picked.
    expect(line?.durationMinutes).toBe(40);
    expect(line?.termsByBarber?.get('ivan')).toEqual({
      durationMinutes: 30,
      padBeforeMinutes: 0,
      padAfterMinutes: 0,
    });
    // Niko's cleanup rides along as a pad, NOT folded into the duration.
    expect(line?.termsByBarber?.get('niko')).toEqual({
      durationMinutes: 45,
      padBeforeMinutes: 0,
      padAfterMinutes: 15,
    });
  });

  it('names each line’s PERSON by its seat — the key the engine keeps one person in one chair by', () => {
    const guest = GuestId.fromSequence(3);
    const cart = unwrap(
      cartWithFade().addLine(SeatKey.guest(guest), {
        serviceId: unwrap(ServiceId.create('svc-fade')),
        variantId: null,
        barberPref: BarberPref.any(),
      }),
    );

    const lines = cartToAvailabilityLines(
      cart,
      [fadeService()],
      [barberId('ivan'), barberId('niko')],
    );

    expect(lines.map((line) => line.personKey)).toEqual(['self', 'guest-3']);
  });

  it('never offers one person’s two services in two chairs at once', async () => {
    // The booker with a fade AND a beard, both «any barber», and two barbers
    // free all morning. Person-blind, the grid offered both at 09:00.
    const beard = unwrap(
      Service.create({
        id: 'svc-beard',
        name: { bg: 'Брада', en: 'Beard' },
        description: { bg: '—', en: '—' },
        categoryId: 'cat-hair',
        priceMinorUnits: 1500,
        currencyCode: 'EUR',
        durationMinutes: 30,
        locationIds: ['loc-center'],
        conflictsWith: [],
        composition: { kind: 'single' },
        upsellOnly: false,
        popular: false,
        offerings: [],
        status: 'active',
        sortOrder: 2,
      }),
    );
    const cart = unwrap(
      cartWithFade().addLine(SeatKey.self(), {
        serviceId: beard.id,
        variantId: null,
        barberPref: BarberPref.any(),
      }),
    );
    const lines = cartToAvailabilityLines(
      cart,
      [fadeService(), beard],
      [barberId('ivan'), barberId('niko')],
    );

    const result = await firstValueFrom(
      new ObserveDayAvailabilityUseCase(
        readerReturning([
          barberDay('ivan', [at(9), at(12)]),
          barberDay('niko', [at(9), at(12)]),
        ]),
      ).execute({
        cart,
        services: [fadeService(), beard],
        barberIds: [barberId('ivan'), barberId('niko')],
        locationId: locationId(),
        day: day(),
        policy: unwrap(
          BookingPolicy.create({
            maxPartySize: 5,
            slotStepMinutes: 15,
            minLeadMinutes: 0,
            horizonMonths: 2,
            maxFlexibleDays: 7,
            autoConfirm: true,
            cancellationWindowHours: 24,
          }),
        ),
        now: unwrap(ZonedDateTime.fromMillis(at(6), ZONE)),
      }),
    );

    const options = unwrap(result).options;
    expect(options.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.personKey === 'self')).toBe(true);
    for (const { option } of options) {
      const [first, second] = option.assignments;
      if (!first || !second) throw new Error('two services, two seats');
      expect(Interval.overlaps(first.slot, second.slot)).toBe(false);
    }
  });

  it('DROPS a line whose service is not in the snapshot', () => {
    // Offering a time for a service that no longer exists only fails later,
    // at the write, after the client has already committed to it.
    const lines = cartToAvailabilityLines(
      cartWithFade(),
      [],
      [barberId('ivan')],
    );
    expect(lines).toEqual([]);
  });
});

describe('ObserveDayAvailabilityUseCase', () => {
  const policy = unwrap(
    BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 120,
      horizonMonths: 2,
      maxFlexibleDays: 7,
      autoConfirm: true,
      cancellationWindowHours: 24,
    }),
  );

  const baseInput = (cart = cartWithFade()) => ({
    cart,
    services: [fadeService()],
    barberIds: [barberId('ivan'), barberId('niko')],
    locationId: locationId(),
    day: day(),
    policy,
    now: unwrap(ZonedDateTime.fromMillis(at(6), ZONE)),
  });

  it('sells each barber their OWN duration', async () => {
    // Windows that do not overlap, so each barber owns a distinct start —
    // the grid keeps one arrangement per time, so two barbers sharing a
    // start would only ever surface one of them.
    const useCase = createUseCase(
      readerReturning([
        barberDay('ivan', [at(12), at(12, 30)]),
        barberDay('niko', [at(14), at(15)]),
      ]),
    );

    const result = unwrap(await firstValueFrom(useCase.execute(baseInput())));

    const byBarber = new Map(
      result.options.map(({ option }) => [
        option.assignments[0]?.barberId.value,
        Interval.durationMinutes(option.assignments[0]?.slot as Interval),
      ]),
    );
    expect(byBarber.get('ivan')).toBe(30);
    expect(byBarber.get('niko')).toBe(45);
  });

  it('keeps ONE arrangement per start, so a long day reaches the evening', () => {
    // Regression: the exhaustive walk is capped, and a party of two with
    // three barbers exhausts the cap inside the first couple of hours. The
    // grid then showed a morning-only shop. Deduplicating during the search
    // spends the budget on breadth instead.
    const starts = new Set<number>();
    const useCase = createUseCase(
      readerReturning([
        barberDay('ivan', [at(9), at(20)]),
        barberDay('niko', [at(9), at(20)]),
      ]),
    );

    return firstValueFrom(useCase.execute(baseInput())).then((result) => {
      const value = unwrap(result);
      for (const { option } of value.options)
        starts.add(option.envelope.startMs);
      // One option per start, and the day runs past the afternoon.
      expect(value.options.length).toBe(starts.size);
      expect(Math.max(...value.starts)).toBeGreaterThan(at(17));
    });
  });

  it('applies the minimum lead time as a floor on the first start', async () => {
    const useCase = createUseCase(
      readerReturning([barberDay('ivan', [at(9), at(18)])]),
    );

    // "Now" is 10:00 with a 120-minute lead, so nothing before 12:00.
    const result = unwrap(
      await firstValueFrom(
        useCase.execute({
          ...baseInput(),
          now: unwrap(ZonedDateTime.fromMillis(at(10), ZONE)),
        }),
      ),
    );

    expect(result.starts[0]).toBe(at(12));
  });

  it('returns nothing — without touching the reader — for an empty cart', async () => {
    let touched = false;
    const useCase = createUseCase({
      observeDay: () => {
        touched = true;
        return of(ok([]));
      },
      observeRangeCapacity: () => of(ok(new Map())),
    });

    const result = unwrap(
      await firstValueFrom(
        useCase.execute({ ...baseInput(BookingCart.empty()) }),
      ),
    );

    expect(result.options).toEqual([]);
    expect(touched).toBe(false);
  });

  it('offers a gap only the faster barber fits', async () => {
    // 30 minutes of room, both barbers free, `any` preference. Ivan fits at
    // 30; Niko needs 45 + 15 cleanup. The slot must still be offered.
    const useCase = createUseCase(
      readerReturning([
        barberDay('ivan', [at(12), at(12, 30)]),
        barberDay('niko', [at(12), at(12, 30)]),
      ]),
    );

    const result = unwrap(await firstValueFrom(useCase.execute(baseInput())));

    expect(result.starts).toEqual([at(12)]);
    for (const { option } of result.options) {
      expect(option.assignments[0]?.barberId.value).toBe('ivan');
    }
  });
});

describe('ObserveDayAvailabilityUseCase — a move', () => {
  const policy = unwrap(
    BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 120,
      horizonMonths: 2,
      maxFlexibleDays: 7,
      autoConfirm: true,
      cancellationWindowHours: 24,
    }),
  );

  /** The client keeps Ivan for their fade: 30 minutes with him. */
  const input = (
    extra: {
      readonly riders?: readonly MoveRider[];
      readonly release?: readonly ChairTime[];
    } = {},
  ) => ({
    cart: cartWithFade(BarberPref.specific(barberId('ivan'))),
    services: [fadeService()],
    barberIds: [barberId('ivan'), barberId('niko')],
    locationId: locationId(),
    day: day(),
    policy,
    now: unwrap(ZonedDateTime.fromMillis(at(6), ZONE)),
    ...extra,
  });

  /** The son the shop seated beside the client, 45 minutes with Niko. */
  const son: MoveRider = {
    serviceId: unwrap(ServiceId.create('svc-fade')),
    barberId: barberId('niko'),
    offsetMinutes: 0,
    terms: { durationMinutes: 45, padBeforeMinutes: 0, padAfterMinutes: 0 },
  };

  /**
   * The port's reference reader over stored geometry — the one every spec
   * shares, held to the busy contract by its own spec. It records every
   * release it was handed.
   */
  function storedReader(
    days: readonly {
      readonly id: string;
      readonly window: readonly [number, number];
      readonly spans: readonly Interval[];
      readonly turnaroundMinutes?: number;
    }[],
  ): InMemoryAvailabilityReader {
    return new InMemoryAvailabilityReader(() =>
      days.map((entry) => ({
        barberId: barberId(entry.id),
        windows: [
          {
            interval: Interval.of(entry.window[0], entry.window[1]),
            locationId: locationId(),
          },
        ],
        spans: entry.spans,
        turnaroundMinutes: entry.turnaroundMinutes ?? 0,
      })),
    );
  }

  it('drops every start where a carried seat’s barber is busy at the shifted time', async () => {
    // Niko is somebody else's until 13:00. The client alone could start at
    // 12:00; with the son beside him, nothing before 13:00 is a time the
    // server would take.
    const reader = storedReader([
      { id: 'ivan', window: [at(12), at(14)], spans: [] },
      {
        id: 'niko',
        window: [at(12), at(14)],
        spans: [Interval.of(at(12), at(13))],
      },
    ]);
    const useCase = createUseCase(reader);

    const alone = unwrap(await firstValueFrom(useCase.execute(input())));
    const carried = unwrap(
      await firstValueFrom(useCase.execute(input({ riders: [son] }))),
    );

    expect(alone.starts[0]).toBe(at(12));
    // 13:30 goes too: the son's 45 minutes would run past Niko's day.
    expect(carried.starts).toEqual([at(13), at(13, 15)]);
  });

  it('never lets the moved visit’s OWN seats block its move — the client’s and the carried son’s alike', async () => {
    // The visit being moved: the client with Ivan 12:00–12:30, the son with
    // Niko 12:00–12:45. Nobody else is booked. Moving it a quarter of an hour
    // overlaps both old chairs, which the server allows: it decides a move
    // with the visit's own contribution subtracted.
    const own: readonly ChairTime[] = [
      {
        barberId: barberId('ivan'),
        occupied: Interval.of(at(12), at(12, 30)),
      },
      {
        barberId: barberId('niko'),
        occupied: Interval.of(at(12), at(12, 45)),
      },
    ];
    const reader = storedReader([
      {
        id: 'ivan',
        window: [at(12), at(14)],
        spans: [own[0]?.occupied as Interval],
        turnaroundMinutes: 10,
      },
      {
        id: 'niko',
        window: [at(12), at(14)],
        spans: [own[1]?.occupied as Interval],
        turnaroundMinutes: 10,
      },
    ]);
    const useCase = createUseCase(reader);

    const kept = unwrap(
      await firstValueFrom(useCase.execute(input({ riders: [son] }))),
    );
    const released = unwrap(
      await firstValueFrom(
        useCase.execute(input({ riders: [son], release: own })),
      ),
    );

    // Without the release the visit collides with itself, turnaround and
    // all: the son's old chair keeps Niko until 12:55.
    expect(kept.starts[0]).toBe(at(12, 55));
    // With it, the day is the whole day again, for the lines and the rider.
    expect(released.starts.slice(0, 2)).toEqual([at(12), at(12, 15)]);
    // …because the use case handed the reader exactly the visit's chairs.
    expect(reader.released.at(-1)).toBe(own);
    expect(reader.released[0]).toBeUndefined();
  });
});

describe('ObserveDayAvailabilityUseCase — a shop that cannot serve somebody on the visit', () => {
  const policy = unwrap(
    BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 0,
      horizonMonths: 2,
      maxFlexibleDays: 7,
      autoConfirm: true,
      cancellationWindowHours: 24,
    }),
  );
  const center = () => unwrap(LocationId.create('loc-center'));
  const mladost = () => unwrap(LocationId.create('loc-mladost'));

  /** A 30-minute service, offered at `locationIds` (empty ⇒ every shop). */
  function serviceAt(id: string, locationIds: readonly string[]): Service {
    return unwrap(
      Service.create({
        id,
        name: { bg: id, en: id },
        description: { bg: '—', en: '—' },
        categoryId: 'cat-hair',
        priceMinorUnits: 2000,
        currencyCode: 'EUR',
        durationMinutes: 30,
        locationIds: [...locationIds],
        conflictsWith: [],
        composition: { kind: 'single' },
        upsellOnly: false,
        popular: false,
        offerings: [],
        status: 'active',
        sortOrder: 1,
      }),
    );
  }

  /** A cut every shop offers; a beard only Center does. */
  const cut = () => serviceAt('svc-cut', []);
  const beard = () => serviceAt('svc-beard', ['loc-center']);

  /**
   * Ivan and Niko work Center 12:00–13:00 and Mladost 15:00–16:00, and
   * nobody is booked: every shop has room for the chairs.
   */
  const reader = () =>
    new InMemoryAvailabilityReader(() =>
      ['ivan', 'niko'].map((id) => ({
        barberId: barberId(id),
        windows: [
          { interval: Interval.of(at(12), at(13)), locationId: center() },
          { interval: Interval.of(at(15), at(16)), locationId: mladost() },
        ],
        spans: [],
        turnaroundMinutes: 0,
      })),
    );

  /** The son the shop seated beside the client, with Niko, for `serviceId`. */
  const son = (serviceId: string): MoveRider => ({
    serviceId: unwrap(ServiceId.create(serviceId)),
    barberId: barberId('niko'),
    offsetMinutes: 0,
    terms: { durationMinutes: 30, padBeforeMinutes: 0, padAfterMinutes: 0 },
  });

  function cartOf(serviceId: string): BookingCart {
    return unwrap(
      BookingCart.empty().addLine(SeatKey.self(), {
        serviceId: unwrap(ServiceId.create(serviceId)),
        variantId: null,
        barberPref: BarberPref.specific(barberId('ivan')),
      }),
    );
  }

  async function shopsOffered(input: {
    readonly cart?: BookingCart;
    readonly services?: readonly Service[];
    readonly locationId?: LocationId | null;
    readonly riders?: readonly MoveRider[];
  }): Promise<readonly string[]> {
    const result = unwrap(
      await firstValueFrom(
        createUseCase(reader()).execute({
          cart: input.cart ?? cartOf('svc-cut'),
          services: input.services ?? [cut(), beard()],
          barberIds: [barberId('ivan'), barberId('niko')],
          locationId: input.locationId ?? null,
          day: day(),
          policy,
          now: unwrap(ZonedDateTime.fromMillis(at(6), ZONE)),
          ...(input.riders ? { riders: input.riders } : {}),
        }),
      ),
    );
    return [...new Set(result.options.map((entry) => entry.locationId.value))];
  }

  it('offers every shop to a party every shop can serve', async () => {
    expect(await shopsOffered({})).toEqual(['loc-center', 'loc-mladost']);
    expect(await shopsOffered({ riders: [son('svc-cut')] })).toEqual([
      'loc-center',
      'loc-mladost',
    ]);
  });

  it('offers no time at a shop that does not offer a carried seat’s service — the other shop still does', async () => {
    // «Any shop»: the son's beard is Center's alone, and the server refuses
    // him at Mladost (`carried_seat_unplaceable` / `service_unavailable`).
    expect(await shopsOffered({ riders: [son('svc-beard')] })).toEqual([
      'loc-center',
    ]);
    // …and a move that switched to Mladost has no time there at all.
    expect(
      await shopsOffered({ locationId: mladost(), riders: [son('svc-beard')] }),
    ).toEqual([]);
    expect(
      await shopsOffered({ locationId: center(), riders: [son('svc-beard')] }),
    ).toEqual(['loc-center']);
  });

  it('offers nothing for a carried seat whose service the catalog no longer holds', async () => {
    // Retired: the server refuses the carried seat everywhere, and the
    // client's own line still resolves, so this is not a catalog in flight.
    expect(
      await shopsOffered({ services: [cut()], riders: [son('svc-beard')] }),
    ).toEqual([]);
  });

  it('holds the cart’s own services to the same rule as a carried seat’s', async () => {
    // The server checks `servesLocation` for every seat it decides; a beard
    // booked at Mladost would be refused as `service_not_at_location`.
    expect(await shopsOffered({ cart: cartOf('svc-beard') })).toEqual([
      'loc-center',
    ]);
  });
});

describe('DateRange fixture sanity', () => {
  it('spans the days the calendar will ask for', () => {
    const range = unwrap(
      DateRange.create(day(), unwrap(CalendarDay.create('2026-08-05', ZONE))),
    );
    expect(range.dayCount()).toBe(3);
  });
});
