import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import type { SchedulingReadPorts } from '@core/ports';
import type { BarberSchedule, ShopLocation } from '@core/entities';
import { CapacityEntry } from '@core/components';
import {
  BarberId,
  CapacityMonthId,
  LocationId,
  MinuteCount,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { BookingCartSystem, type DayDocsKey } from '@core/systems';
import {
  barberScheduleFixture,
  localDate,
  memorySchedulingReadPorts,
  unwrapOk,
} from '@core/testing';
import { observeCapacityEntries, observeDayDocs } from './shop-day.pipeline';

/*
 * ONE SHOP DAY'S RAW STREAMS — the cases of the booking feature's former
 * `day-availability.spec.ts` (deleted in pass E, E-10) that pin the impure
 * half (which documents a day reads, as streams; the month documents of the
 * calendar's markers), restated on the pipeline they moved to. Which
 * documents is `BookingCartSystem.dayDocsKey`'s decision, pinned by its own
 * spec.
 */

const IVAN = BarberId.of('b-ivan');
const NIKO = BarberId.of('b-niko');
const CENTER = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const TUESDAY = localDate('2026-09-29');

function key(barberIds: readonly BarberId[]): DayDocsKey {
  return BookingCartSystem.dayDocsKey({
    localDate: TUESDAY,
    barberIds,
    locationId: null,
    release: [],
  });
}

/**
 * The scheduling double over these rosters, with the reads of a shop by id
 * counted and, when asked, one barber's roster read failing — the one
 * member a spec wraps.
 */
function ports(
  state: {
    readonly schedules?: readonly BarberSchedule[];
    readonly locations?: readonly ShopLocation[];
    readonly failing?: BarberId;
  } = {},
): SchedulingReadPorts & { readonly locationReads: () => number } {
  const base = memorySchedulingReadPorts({
    schedules: state.schedules ?? [],
    locations: state.locations ?? [],
  });
  let locationReads = 0;
  return {
    ...base,
    observeSchedule: (barberId) =>
      barberId === state.failing
        ? of(Result.err(RepositoryError.unavailable()))
        : base.observeSchedule(barberId),
    observeLocation: (locationId) => {
      locationReads += 1;
      return base.observeLocation(locationId);
    },
    locationReads: () => locationReads,
  };
}

describe('observeDayDocs — which documents a day reads', () => {
  it('reads every barber’s roster, busy day and exception, in the key’s order', async () => {
    const read = await firstValueFrom(
      observeDayDocs(
        ports({ schedules: [barberScheduleFixture()] }),
        key([NIKO, IVAN]),
      ),
    );

    expect(
      read.ok && read.value.barbers.map((barber) => barber.barberId),
    ).toEqual([IVAN, NIKO]);
    expect(read.ok && read.value.barbers[1]?.schedule).toBeNull();
  });

  it('fails the whole day when one barber’s read fails — never a grid that hides someone', async () => {
    const read = await firstValueFrom(
      observeDayDocs(
        ports({ schedules: [barberScheduleFixture()], failing: NIKO }),
        key([IVAN, NIKO]),
      ),
    );

    expect(read.ok).toBe(false);
  });

  it('answers an empty day for no barber, and reads a shop only when the key names one', async () => {
    const reads = ports();
    const read = await firstValueFrom(observeDayDocs(reads, key([])));

    expect(read.ok && read.value.barbers).toEqual([]);
    expect(reads.locationReads()).toBe(0);

    await firstValueFrom(
      observeDayDocs(reads, { ...key([IVAN]), namedLocationId: CENTER }),
    );
    expect(reads.locationReads()).toBe(1);
  });

  it('answers the documents for the key it was asked, as read', async () => {
    const asked = key([IVAN]);
    const read = await firstValueFrom(
      observeDayDocs(ports({ schedules: [barberScheduleFixture()] }), asked),
    );
    expect(read.ok && read.value.key).toBe(asked);
    expect(read.ok && read.value.namedLocation).toBeNull();
    expect(read.ok && read.value.barbers[0]?.schedule).toEqual(
      barberScheduleFixture(),
    );
  });
});

describe('observeCapacityEntries — the calendar markers’ month documents', () => {
  const OCTOBER = localDate('2026-10-01');
  const free = (minutes: number) => unwrapOk(MinuteCount.of(minutes));
  const ENTRIES = [
    CapacityEntry.of(OCTOBER, IVAN, CENTER, free(120)),
    CapacityEntry.of(OCTOBER, NIKO, CENTER, free(60)),
    CapacityEntry.of(OCTOBER, IVAN, MLADOST, free(30)),
  ];

  it('collects the months’ entries, a month never rebuilt holding none', async () => {
    const october = CapacityMonthId.of('2026-10');
    const read = await firstValueFrom(
      observeCapacityEntries(
        memorySchedulingReadPorts({
          capacityMonths: [{ id: october, month: october, entries: ENTRIES }],
        }),
        [CapacityMonthId.of('2026-09'), october],
      ),
    );

    expect(read.ok && read.value).toEqual(ENTRIES);
  });

  it('reads nothing for no month', async () => {
    const read = await firstValueFrom(
      observeCapacityEntries(memorySchedulingReadPorts({}), []),
    );
    expect(read).toEqual(Result.ok([]));
  });
});
