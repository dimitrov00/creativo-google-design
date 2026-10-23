import { describe, expect, it } from 'vitest';
import { BookingPolicy, CapacityEntry } from '@core/components';
import {
  BarberId,
  BarberLeadTimeSampleId,
  type CapacityMonthId,
  type LocalDate,
  LocationId,
  MinuteCount,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { BarberLeadTimeSample, CapacityMonth } from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  minuteCount,
  pinnedNowUtcMs,
  recordingTelemetry,
} from '@core/testing';
import { sampleLeadTime } from './sample-lead-time.pipeline';

/*
 * The daily lead-time sample (`sample-lead-time.ts`): the capacity months
 * the horizon spans, read ONCE for every rostered barber, one sample per
 * barber through `writeLeadTimeSample` (which stamps the TTL). The walk
 * itself is `LeadTimeSystem`'s spec; this one asserts what the pipeline
 * reads, what reached the writer, and that one barber's failure costs the
 * others nothing.
 */

const IVAN = FIXTURE_IDS.barber;
const PETAR = BarberId.of('b-petar');
const CENTRE = FIXTURE_IDS.location;
const SOUTH = LocationId.of('loc-south');
// Today (2026-09-28) through the default two-month horizon: 2026-11-30.
const HORIZON_DAYS = 64;

const entry = (
  day: LocalDate,
  barberId: BarberId,
  locationId: LocationId,
  minutes: number,
) => CapacityEntry.of(day, barberId, locationId, minuteCount(minutes));

/**
 * Whose "today" the sample is taken on (Law 7.2, F-4): the default
 * location's — the fixture shop, on `FIXTURE_TIME_ZONE`.
 */
const ZONE_PORTS = {
  ...memoryLocationLoadPorts(
    memoryProgramsWorld({ locations: [locationFixture()] }),
  ),
  ...memoryDefaultLocationPorts(),
};

function rig(
  entries: readonly CapacityEntry[],
  barbers: readonly BarberId[] = [IVAN],
) {
  const asked: (readonly CapacityMonthId[])[] = [];
  const written: BarberLeadTimeSample[] = [];
  const telemetry = recordingTelemetry();
  const run = sampleLeadTime({
    ...telemetry,
    ...ZONE_PORTS,
    nowUtcMs: pinnedNowUtcMs(),
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    listBarbers: async () => Result.ok(barbers),
    loadCapacityMonths: async (months) => {
      asked.push(months);
      return Result.ok(
        months.map((month): CapacityMonth => ({
          id: month,
          month,
          entries: entries.filter(
            (candidate) => candidate.localDate.slice(0, 7) === month,
          ),
        })),
      );
    },
    writeLeadTimeSample: async (sample) => {
      written.push(sample);
      return Result.ok(undefined);
    },
  });
  return { asked, written, telemetry, run };
}

function sampleOf(
  barberId: BarberId,
  first: LocalDate | null,
  leadTimeDays: number | null,
  freeMinutes: number,
): BarberLeadTimeSample {
  return {
    id: BarberLeadTimeSampleId.of(`${barberId}__${FIXTURE_TODAY}`),
    barberId,
    localDate: FIXTURE_TODAY,
    firstAvailableLocalDate: first,
    leadTimeDays,
    freeMinutesOnFirstDay:
      freeMinutes === 0 ? MinuteCount.ZERO : minuteCount(freeMinutes),
    horizonDayCount: HORIZON_DAYS,
    sampledAtUtcMs: FIXTURE_NOW_UTC_MS,
  };
}

describe('sampleLeadTime', () => {
  it('reports zero lead time when the barber is free today', async () => {
    const { written, run } = rig([entry(FIXTURE_TODAY, IVAN, CENTRE, 120)]);
    expect(await run()).toEqual({
      ok: true,
      value: { sampledBarberIds: [IVAN] },
    });
    expect(written).toEqual([sampleOf(IVAN, FIXTURE_TODAY, 0, 120)]);
  });

  it('counts the days to the first opening, across a month boundary', async () => {
    const day = localDate('2026-10-02');
    const { written, run } = rig([entry(day, IVAN, CENTRE, 60)]);
    await run();
    expect(written).toEqual([sampleOf(IVAN, day, 4, 60)]);
  });

  it('records null when nothing is free inside the horizon — fully booked is not zero', async () => {
    const { written, run } = rig([]);
    await run();
    expect(written).toEqual([sampleOf(IVAN, null, null, 0)]);
  });

  it('ignores free time below one slot step', async () => {
    const { written, run } = rig([
      entry(FIXTURE_TODAY, IVAN, CENTRE, 10),
      entry(localDate('2026-09-29'), IVAN, CENTRE, 15),
    ]);
    await run();
    expect(written).toEqual([sampleOf(IVAN, localDate('2026-09-29'), 1, 15)]);
  });

  it('sums a barber working two shops on one day', async () => {
    const { written, run } = rig([
      entry(FIXTURE_TODAY, IVAN, CENTRE, 10),
      entry(FIXTURE_TODAY, IVAN, SOUTH, 10),
    ]);
    await run();
    expect(written).toEqual([sampleOf(IVAN, FIXTURE_TODAY, 0, 20)]);
  });

  it('reads the horizon’s month documents ONCE and samples every rostered barber independently', async () => {
    const { asked, written, run } = rig(
      [
        entry(FIXTURE_TODAY, PETAR, CENTRE, 30),
        entry(localDate('2026-10-05'), IVAN, CENTRE, 45),
      ],
      [IVAN, PETAR],
    );
    await run();
    expect(asked).toEqual([['2026-09', '2026-10', '2026-11']]);
    expect(written).toEqual([
      sampleOf(IVAN, localDate('2026-10-05'), 7, 45),
      sampleOf(PETAR, FIXTURE_TODAY, 0, 30),
    ]);
  });

  it('stamps each sample with the day it was taken and the pipeline’s clock', async () => {
    const { written, run } = rig([entry(FIXTURE_TODAY, IVAN, CENTRE, 30)]);
    await run();
    expect(written[0]?.localDate).toBe(FIXTURE_TODAY);
    expect(written[0]?.sampledAtUtcMs).toBe(FIXTURE_NOW_UTC_MS);
    expect(written[0]?.id).toBe(`${IVAN}__${FIXTURE_TODAY}`);
  });

  it('logs one barber’s failed write and samples the next — a missing row is honest', async () => {
    const telemetry = recordingTelemetry();
    const failure = RepositoryError.writeFailed(
      'barberLeadTimeSamples/x',
      'unavailable',
    );
    const written: BarberLeadTimeSample[] = [];
    const run = sampleLeadTime({
      ...telemetry,
      ...ZONE_PORTS,
      nowUtcMs: pinnedNowUtcMs(),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([PETAR, IVAN]),
      loadCapacityMonths: async (months) => Result.ok(months.map(() => null)),
      writeLeadTimeSample: async (sample) => {
        if (sample.barberId === PETAR) return Result.err(failure);
        written.push(sample);
        return Result.ok(undefined);
      },
    });
    expect(await run()).toEqual({
      ok: true,
      value: { sampledBarberIds: [IVAN] },
    });
    expect(written.map((sample) => sample.barberId)).toEqual([IVAN]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'lead-time sample failed for barber',
        fields: { barberId: PETAR, error: failure },
      },
    ]);
  });

  it('answers a policy it cannot read, sampling nobody', async () => {
    const failure = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'unavailable',
    );
    const written: BarberLeadTimeSample[] = [];
    const run = sampleLeadTime({
      ...recordingTelemetry(),
      ...ZONE_PORTS,
      nowUtcMs: pinnedNowUtcMs(),
      loadPolicy: async () => Result.err(failure),
      listBarbers: async () => Result.ok([IVAN]),
      loadCapacityMonths: async () => Result.ok([]),
      writeLeadTimeSample: async (sample) => {
        written.push(sample);
        return Result.ok(undefined);
      },
    });
    expect(await run()).toEqual({ ok: false, error: failure });
    expect(written).toEqual([]);
  });

  it('answers a zone it cannot read as its store failure, sampling nobody (4A-2 (e))', async () => {
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const written: BarberLeadTimeSample[] = [];
    const run = sampleLeadTime({
      ...recordingTelemetry(),
      ...memoryDefaultLocationPorts(),
      loadLocation: async () => Result.err(failed),
      nowUtcMs: pinnedNowUtcMs(),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([IVAN]),
      loadCapacityMonths: async () => Result.ok([]),
      writeLeadTimeSample: async (sample) => {
        written.push(sample);
        return Result.ok(undefined);
      },
    });
    expect(await run()).toEqual({ ok: false, error: failed });
    expect(written).toEqual([]);
  });
});
