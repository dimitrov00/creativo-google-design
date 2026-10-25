import { describe, expect, it } from 'vitest';
import {
  BookingPolicy,
  CapacityEntry,
  CapacityTrigger,
  type DocBody,
  ExceptionEffectRule,
  WriteAction,
  WriteOp,
} from '@core/components';
import {
  BarberId,
  CapacityMonthId,
  type LocalDate,
  LocationId,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { Collections, QueryOp } from '@core/entities';
import { CapacitySystem, LeadTimeSystem } from '@core/systems';
import {
  barberBusyDayFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  FIXTURE_TODAY,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  memoryTxPorts,
  minuteCount,
  recordingTelemetry,
  scheduleExceptionFixture,
} from '@core/testing';
import { rebuildCapacity } from './rebuild-capacity.pipeline';

/*
 * The capacity rollup's rebuild (`rebuild-capacity.ts`, `capacity-plan.ts`):
 * one barber's span in ONE transaction whose read set is the ACTIVE shops,
 * the roster, the busy and exception ranges and the month documents, and
 * whose plan is the FULL sorted `entries[]` of every month it touches —
 * replace, never merge. The window math is `CapacitySystem`'s spec; this one
 * asserts the read set, the plan that reached the commit and the guards.
 */

const IVAN = FIXTURE_IDS.barber;
const PETAR = BarberId.of('b-petar');
const CENTRE = FIXTURE_IDS.location;
const MONTH = CapacityMonthId.of('2026-09');
const MONTH_PATH = [Collections.Capacity, MONTH];

/** A stored document's body — the entity minus its id (Law 5). */
function bodyOf(entity: { readonly id: string }): DocBody {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const entry = (
  day: LocalDate,
  barberId: BarberId,
  locationId: LocationId,
  minutes: number,
) => CapacityEntry.of(day, barberId, locationId, minuteCount(minutes));

/**
 * Whose "today" the rebuild reads (Law 7.2, F-4): the default location's —
 * the fixture shop, on `FIXTURE_TIME_ZONE`.
 */
const ZONE_PORTS = {
  ...memoryLocationLoadPorts(
    memoryProgramsWorld({ locations: [locationFixture()] }),
  ),
  ...memoryDefaultLocationPorts(),
};

/** Ivan's roster and the centre shop, and whatever else a case stores. */
function seeded(
  extra: readonly {
    readonly path: readonly string[];
    readonly body: DocBody;
  }[] = [],
) {
  return memoryStore([
    {
      path: [Collections.Locations, CENTRE],
      body: bodyOf(locationFixture()),
    },
    {
      path: [Collections.BarberSchedules, IVAN],
      body: bodyOf(barberScheduleFixture()),
    },
    ...extra,
  ]);
}

function rig(
  store = seeded(),
  options: {
    readonly policy?: BookingPolicy;
    readonly barbers?: readonly BarberId[];
  } = {},
) {
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const run = rebuildCapacity({
    ...tx,
    ...telemetry,
    ...ZONE_PORTS,
    loadPolicy: async () => Result.ok(options.policy ?? BookingPolicy.DEFAULT),
    listBarbers: async () => Result.ok(options.barbers ?? [IVAN]),
  });
  return { store, tx, telemetry, run };
}

const today = {
  capacityTrigger: CapacityTrigger.Day,
  barberId: IVAN,
  localDate: FIXTURE_TODAY,
} as const;

describe('rebuildCapacity — one (barber, day)', () => {
  it('writes the month’s full sorted entries, the busy time padded and taken out of the rostered window', async () => {
    const busy = barberBusyDayFixture();
    const { tx, run } = rig(
      seeded([{ path: [Collections.BarberBusy, busy.id], body: bodyOf(busy) }]),
    );
    const answer = await run(today);
    expect(answer).toEqual({ ok: true, value: { rebuiltBarberIds: [IVAN] } });
    // 09:00–18:00 rostered, 10:00–10:30 busy: 510 free minutes.
    expect(tx.plans).toEqual([
      [
        WriteOp.set(MONTH_PATH, {
          month: MONTH,
          entries: [entry(FIXTURE_TODAY, IVAN, CENTRE, 510)],
        }),
      ],
    ]);
  });

  it('reads the ACTIVE shops, the roster, the busy and exception ranges (#13, #16) and the month documents in its transaction', async () => {
    const { tx, run } = rig();
    await run(today);
    const read = tx.transactions[0];
    expect(read?.reads).toEqual([
      [Collections.BarberSchedules, IVAN],
      MONTH_PATH,
    ]);
    expect(read?.queries).toEqual([
      {
        collection: [Collections.Locations],
        where: [{ field: 'locationStatus', op: QueryOp.Eq, value: 'ACTIVE' }],
        orderBy: [],
        limit: null,
      },
      ...[Collections.BarberBusy, Collections.ScheduleExceptions].map(
        (collection) => ({
          collection: [collection],
          where: [
            { field: 'barberId', op: QueryOp.Eq, value: IVAN },
            { field: 'localDate', op: QueryOp.Gte, value: FIXTURE_TODAY },
            { field: 'localDate', op: QueryOp.Lte, value: FIXTURE_TODAY },
          ],
          orderBy: [],
          limit: null,
        }),
      ),
    ]);
  });

  it('REPLACES the scope: a stale shop entry of the day goes, another barber’s entries stay, the new one lands in order', async () => {
    const stored = {
      month: MONTH,
      entries: [
        entry(FIXTURE_TODAY, IVAN, LocationId.of('loc-gone'), 120),
        entry(FIXTURE_TODAY, PETAR, CENTRE, 300),
        entry(localDate('2026-09-30'), IVAN, CENTRE, 540),
      ],
    };
    const { tx, run } = rig(seeded([{ path: MONTH_PATH, body: stored }]));
    await run(today);
    expect(tx.plans).toEqual([
      [
        WriteOp.set(MONTH_PATH, {
          month: MONTH,
          entries: [
            entry(FIXTURE_TODAY, IVAN, CENTRE, 540),
            entry(FIXTURE_TODAY, PETAR, CENTRE, 300),
            entry(localDate('2026-09-30'), IVAN, CENTRE, 540),
          ],
        }),
      ],
    ]);
    // Never a merge: the plan is a whole-document `Set`.
    expect(tx.plans[0]?.[0]?.writeAction).toBe(WriteAction.Set);
  });

  it('drops the day’s entry when a published exception closes it — absent, never a zero', async () => {
    const closed = scheduleExceptionFixture();
    const stored = {
      month: MONTH,
      entries: [entry(FIXTURE_TODAY, IVAN, CENTRE, 540)],
    };
    const { tx, run } = rig(
      seeded([
        { path: MONTH_PATH, body: stored },
        {
          path: [Collections.ScheduleExceptions, closed.id],
          body: bodyOf({ ...closed, ...ExceptionEffectRule.closed() }),
        },
      ]),
    );
    await run(today);
    expect(tx.plans).toEqual([
      [WriteOp.set(MONTH_PATH, { month: MONTH, entries: [] })],
    ]);
  });

  it('returns a past day before any read but the zone’s — a TTL purge must not rewrite a retired month', async () => {
    const { tx, run } = rig();
    const answer = await run({ ...today, localDate: localDate('2026-09-27') });
    expect(answer).toEqual({ ok: true, value: { rebuiltBarberIds: [] } });
    expect(tx.transactions).toEqual([]);
    expect(tx.plans).toEqual([]);
  });

  it('answers a zone it cannot read as its store failure, rebuilding nothing (4A-2 (e))', async () => {
    const tx = memoryTxPorts(seeded());
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const run = rebuildCapacity({
      ...tx,
      ...recordingTelemetry(),
      ...memoryDefaultLocationPorts(),
      loadLocation: async () => Result.err(failed),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([IVAN]),
    });
    expect(await run(today)).toEqual(Result.err(failed));
    expect(tx.transactions).toEqual([]);
  });

  it('answers a default location that is not stored as a read failure naming it', async () => {
    const tx = memoryTxPorts(seeded());
    const run = rebuildCapacity({
      ...tx,
      ...recordingTelemetry(),
      ...memoryLocationLoadPorts(memoryProgramsWorld({ locations: [] })),
      ...memoryDefaultLocationPorts(),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([IVAN]),
    });
    expect(await run(today)).toEqual(
      Result.err(
        RepositoryError.readFailed(
          'locations/loc-center',
          'CATALOG_LOCATION_ZONE_UNKNOWN',
        ),
      ),
    );
    expect(tx.transactions).toEqual([]);
  });

  it('is idempotent — a redelivered busy write rebuilds the identical plan and leaves the identical month document (edge-hardening D-5)', async () => {
    const busy = barberBusyDayFixture();
    const { store, tx, run } = rig(
      seeded([
        { path: [Collections.BarberBusy, busy.id], body: bodyOf(busy) },
        {
          path: MONTH_PATH,
          body: {
            month: MONTH,
            entries: [entry(FIXTURE_TODAY, PETAR, CENTRE, 300)],
          },
        },
      ]),
    );
    const first = await run(today);
    const monthAfterFirst = store.get(MONTH_PATH.join('/'));
    const second = await run(today);
    expect(second).toEqual(first);
    expect(tx.plans).toHaveLength(2);
    expect(tx.plans[1]).toEqual(tx.plans[0]);
    expect(store.get(MONTH_PATH.join('/'))).toEqual(monthAfterFirst);
    expect(monthAfterFirst).toEqual({
      month: MONTH,
      entries: [
        entry(FIXTURE_TODAY, IVAN, CENTRE, 510),
        entry(FIXTURE_TODAY, PETAR, CENTRE, 300),
      ],
    });
  });

  it('lets an infrastructure failure go on to the edge', async () => {
    const telemetry = recordingTelemetry();
    const outage = Object.assign(new Error('10 ABORTED'), { code: 10 });
    const run = rebuildCapacity({
      ...memoryTxPorts(seeded()),
      ...telemetry,
      ...ZONE_PORTS,
      commit: async () => {
        throw outage;
      },
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([IVAN]),
    });
    await expect(run(today)).rejects.toBe(outage);
  });
});

describe('rebuildCapacity — a horizon', () => {
  const horizonMonths = (policy: BookingPolicy) =>
    LeadTimeSystem.monthKeysBetween(
      FIXTURE_TODAY,
      CapacitySystem.horizonSpanEnd(
        BookingPolicy.horizonEndFrom(policy, FIXTURE_TODAY),
      ),
    );

  it('rebuilds a roster change over today through the month after the horizon, every month in one plan', async () => {
    const { tx, run } = rig();
    const answer = await run({
      capacityTrigger: CapacityTrigger.Roster,
      barberId: IVAN,
    });
    expect(answer).toEqual({ ok: true, value: { rebuiltBarberIds: [IVAN] } });
    expect(tx.plans).toHaveLength(1);
    expect(tx.plans[0]?.map((write) => write.path)).toEqual(
      horizonMonths(BookingPolicy.DEFAULT).map((month) => [
        Collections.Capacity,
        month,
      ]),
    );
    expect(horizonMonths(BookingPolicy.DEFAULT)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('sweeps every rostered barber, one transaction each — one barber’s failure costs the others nothing', async () => {
    const telemetry = recordingTelemetry();
    const store = seeded();
    const tx = memoryTxPorts(store);
    const outage = Object.assign(new Error('9 FAILED_PRECONDITION'), {
      code: 9,
    });
    let calls = 0;
    const run = rebuildCapacity({
      ...tx,
      ...telemetry,
      ...ZONE_PORTS,
      commit: (read, decide) => {
        calls += 1;
        if (calls === 1) return Promise.reject(outage);
        return tx.commit(read, decide);
      },
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([PETAR, IVAN]),
    });
    const answer = await run({
      capacityTrigger: CapacityTrigger.Sweep,
    });
    expect(answer).toEqual({ ok: true, value: { rebuiltBarberIds: [IVAN] } });
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'capacity sweep failed for barber',
        fields: { barberId: PETAR, error: outage },
      },
    ]);
    expect(tx.plans).toHaveLength(1);
  });

  it('answers a policy it cannot read, rebuilding nothing', async () => {
    const tx = memoryTxPorts(seeded());
    const failure = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'unavailable',
    );
    const run = rebuildCapacity({
      ...tx,
      ...recordingTelemetry(),
      ...ZONE_PORTS,
      loadPolicy: async () => Result.err(failure),
      listBarbers: async () => Result.ok([IVAN]),
    });
    const answer = await run({
      capacityTrigger: CapacityTrigger.Sweep,
    });
    expect(answer).toEqual({ ok: false, error: failure });
    expect(tx.transactions).toEqual([]);
  });

  it('warns rather than silently truncating a span past 500 days', async () => {
    const policy = { ...BookingPolicy.DEFAULT, horizonMonths: 24 };
    const { telemetry, run } = rig(seeded(), { policy });
    await run({
      capacityTrigger: CapacityTrigger.Roster,
      barberId: IVAN,
    });
    expect(telemetry.lines).toContainEqual({
      level: 'warn',
      msg: 'capacity span truncated at 500 days',
      fields: {
        fromKey: FIXTURE_TODAY,
        toKey: CapacitySystem.horizonSpanEnd(
          BookingPolicy.horizonEndFrom(policy, FIXTURE_TODAY),
        ),
      },
    });
  });
});
