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
  DateRange,
  Interval,
  SeatKey,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import { AvailabilityReader } from '../ports/availability-reader.port';
import {
  ObserveDayAvailabilityUseCase,
  cartToAvailabilityLines,
} from './observe-availability.use-case';

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

describe('DateRange fixture sanity', () => {
  it('spans the days the calendar will ask for', () => {
    const range = unwrap(
      DateRange.create(day(), unwrap(CalendarDay.create('2026-08-05', ZONE))),
    );
    expect(range.dayCount()).toBe(3);
  });
});
