import { describe, expect, it } from 'vitest';
import {
  AttemptOutcome,
  BlockKind,
  BookingPolicy,
  type BookingCart,
  DayWindows,
  type DocBody,
  LocationStatus,
  MinuteBlock,
  MinuteRange,
  NotificationTopic,
  ScheduleVersion,
  ShiftSegment,
  WaitlistLifecycle,
  WriteOp,
} from '@core/components';
import {
  BarberBusyDayId,
  BarberId,
  BusyKey,
  CartLineId,
  LocationId,
  Result,
  ScheduleExceptionId,
  SeatKeyText,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
  WaitlistStatus,
  Weekday,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type Barber,
  type BarberBusyDay,
  type BarberSchedule,
  Collections,
  type ScheduleException,
  type ShopLocation,
  Subcollections,
  type WaitlistRequest,
} from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import {
  barberFixture,
  barberScheduleFixture,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  fixtureHash,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLoadBusyDay,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  memoryTxPorts,
  minute,
  minuteCount,
  recordingTelemetry,
  scheduleExceptionFixture,
  serviceFixture,
} from '@core/testing';
import {
  matchWaitlist,
  waitlistMatchNotificationId,
} from './match-waitlist.pipeline';

/*
 * The waitlist matcher (`match-waitlist.ts`, `load-day-availability.ts`):
 * a freed shop day is searched ONCE for every request watching it — every
 * barber rostered that day at a LISTED shop, busy padded by their own
 * turnaround — and a match is ONE plan, re-read and conditioned on the
 * request still being `OPEN`: the notification under its deterministic id
 * and the `MATCHED` transition. The search itself is `WaitlistSystem.match`'s
 * spec; this one asserts what the pipeline reads, the snapshot it searches
 * (through what it sends) and every plan that reached the commit.
 */

const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const PETAR = BarberId.of('b-petar');
const CENTRE = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');
const OWNER = FIXTURE_IDS.client;
/** Tuesday — a day ahead of the pinned Monday 09:00, clear of the lead time. */
const DAY = localDate('2026-09-29');
const EARLIER = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -86_400_000);

/** A stored document's body — the entity minus its id (Law 5). */
function bodyOf(entity: { readonly id: string }): DocBody {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const CART: BookingCart = {
  cartSeats: [
    {
      seatKey: SeatKeyText.of('self'),
      lines: [
        {
          lineId: CartLineId.of('line-1'),
          seatKey: SeatKeyText.of('self'),
          serviceId: FIXTURE_IDS.service,
          variantId: null,
          barberId: null,
          locationId: null,
        },
      ],
    },
  ],
  cartNextSequence: 1,
};

function requestFixture(
  id: string,
  overrides: Partial<WaitlistRequest> = {},
): WaitlistRequest {
  return {
    id: WaitlistRequestId.of(id),
    ownerUserId: OWNER,
    locationId: null,
    localDates: [DAY],
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, FIXTURE_TIME_ZONE),
    createdAtUtcMs: EARLIER,
    ...CART,
    flexibleDays: [
      DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(720))]),
    ],
    ...WaitlistLifecycle.open(EARLIER),
    ...overrides,
  };
}

/** A Tuesday roster at the given segments. */
function tuesdayRoster(
  barberId: BarberId,
  segments: readonly ShiftSegment[],
  turnaround = 0,
): BarberSchedule {
  const version: ScheduleVersion = {
    seq: 1,
    effectiveFromLocalDate: localDate('2026-01-01'),
    effectiveToLocalDate: null,
    segments,
  };
  return {
    id: barberId,
    turnaroundMinutes: minuteCount(turnaround),
    versions: [version],
  };
}

const segment = (locationId: LocationId, from: number, to: number) =>
  ShiftSegment.of(Weekday.Tue, locationId, minute(from), endMinute(to));

function busyBlocks(barberId: BarberId, ...spans: [number, number][]) {
  const day: BarberBusyDay = {
    id: BarberBusyDayId.of(BusyKey.of(barberId, DAY)),
    barberId,
    localDate: DAY,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, FIXTURE_TIME_ZONE),
    blocks: spans.map(([from, to]) =>
      MinuteBlock.of(minute(from), endMinute(to), BlockKind.Busy),
    ),
  };
  return { path: [Collections.BarberBusy, day.id], body: bodyOf(day) };
}

type World = {
  readonly watching: readonly WaitlistRequest[];
  /** The requests as the transaction reads them — the watched ones unless said. */
  readonly stored?: readonly WaitlistRequest[];
  readonly locations?: readonly ShopLocation[];
  readonly barbers?: readonly Barber[];
  readonly schedules?: readonly BarberSchedule[];
  readonly exceptions?: readonly ScheduleException[];
  readonly busy?: readonly {
    readonly path: readonly string[];
    readonly body: DocBody;
  }[];
  readonly extra?: readonly {
    readonly path: readonly string[];
    readonly body: DocBody;
  }[];
  readonly recent?: (
    requestId: WaitlistRequestId,
  ) => Result<boolean, RepositoryError>;
  /** A busy day's read as scripted — `null`: as stored. */
  readonly busyDay?: (
    key: BusyKey,
  ) => Result<BarberBusyDay | null, RepositoryError> | null;
  /** The nth commit (from 1) as scripted — `null`: the store's own transaction. */
  readonly commitAttempt?: (
    attempt: number,
  ) => Promise<Result<never, RepositoryError>> | null;
};

/**
 * Whose "now" decides past days, lead times and lapses (Law 7.2, F-4): the
 * default location's — the fixture shop, on `FIXTURE_TIME_ZONE`.
 */
const ZONE_PORTS = {
  ...memoryLocationLoadPorts(
    memoryProgramsWorld({ locations: [locationFixture()] }),
  ),
  ...memoryDefaultLocationPorts(),
};

function rig(world: World) {
  const store = memoryStore([
    ...(world.stored ?? world.watching).map((request) => ({
      path: [Collections.WaitlistRequests, request.id],
      body: bodyOf(request),
    })),
    ...(world.busy ?? []),
    ...(world.extra ?? []),
  ]);
  const tx = memoryTxPorts(store, { hash: fixtureHash });
  const telemetry = recordingTelemetry();
  const calls = { policy: 0, open: 0, catalogue: 0, cooldown: 0 };
  const schedules = new Map(
    (world.schedules ?? [barberScheduleFixture()]).map((s) => [s.id, s]),
  );
  const exceptions = new Map(
    (world.exceptions ?? []).map((e) => [String(e.id), e]),
  );
  const storedBusyDay = memoryLoadBusyDay(store);
  let commits = 0;
  const run = matchWaitlist({
    ...tx,
    ...telemetry,
    ...ZONE_PORTS,
    commit: (read, decide) => {
      commits += 1;
      return world.commitAttempt?.(commits) ?? tx.commit(read, decide);
    },
    loadPolicy: async () => {
      calls.policy += 1;
      return Result.ok(BookingPolicy.DEFAULT);
    },
    loadOpenWaitlist: async (day) => {
      calls.open += 1;
      return Result.ok(
        world.watching.filter((request) => request.localDates.includes(day)),
      );
    },
    loadListedCatalog: async () => {
      calls.catalogue += 1;
      return Result.ok({
        services: [serviceFixture({ offerings: [], locationIds: [] })],
        locations: world.locations ?? [locationFixture()],
        barbers: world.barbers ?? [barberFixture()],
      });
    },
    loadSchedule: async (barberId) =>
      Result.ok(schedules.get(barberId) ?? null),
    loadScheduleException: async (key) =>
      Result.ok(exceptions.get(key) ?? null),
    loadBusyDay: async (key) => world.busyDay?.(key) ?? storedBusyDay(key),
    hasRecentNotification: async (_user, _topic, requestId) => {
      calls.cooldown += 1;
      return world.recent?.(requestId) ?? Result.ok(false);
    },
  });
  return { store, tx, telemetry, calls, run };
}

const command = { localDate: DAY };

/** An answer nothing failed in. */
const NO_FAILURE = { failures: [], attemptFailure: null } as const;

/** The plan a match on `DAY` at `startMinutes` writes for `request`. */
function matchPlan(request: WaitlistRequest, startMinutes: number) {
  const notificationId = waitlistMatchNotificationId(
    request.id,
    DAY,
    fixtureHash,
  );
  return [
    WriteOp.create(
      [
        Collections.Users,
        request.ownerUserId,
        Subcollections.Notifications,
        notificationId,
      ],
      {
        sentAtUtcMs: FIXTURE_NOW_UTC_MS,
        readAtUtcMs: null,
        notificationTopic: NotificationTopic.WaitlistMatch,
        waitlistRequestId: request.id,
        localDate: DAY,
        startMinutes: minute(startMinutes),
      },
    ),
    WriteOp.update([Collections.WaitlistRequests, request.id], {
      waitlistStatus: WaitlistStatus.Matched,
      waitlistStatusAtUtcMs: FIXTURE_NOW_UTC_MS,
    }),
  ];
}

/** The start each sent notification names, by request. */
function sentStarts(tx: ReturnType<typeof rig>['tx']): readonly number[] {
  const starts: number[] = [];
  for (const plan of tx.plans) {
    for (const write of plan) {
      if (write.writeAction === 'CREATE') {
        starts.push(Number(write.body['startMinutes']));
      }
    }
  }
  return starts;
}

describe('matchWaitlist — one plan per match', () => {
  it('tells the owner in ONE plan: the notification under its deterministic id and the MATCHED transition, conditioned on an OPEN re-read', async () => {
    const request = requestFixture('wl_1');
    const { tx, run } = rig({ watching: [request] });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [request.id],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    expect(tx.plans).toEqual([matchPlan(request, 600)]);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.WaitlistRequests, request.id],
    ]);
    expect(waitlistMatchNotificationId(request.id, DAY, fixtureHash)).toBe(
      fixtureHash(`wl_match${request.id}${DAY}`),
    );
  });

  it('plans nothing when the request is no longer OPEN in the transaction', async () => {
    const request = requestFixture('wl_1');
    const { tx, run } = rig({
      watching: [request],
      stored: [{ ...request, waitlistStatus: WaitlistStatus.Matched }],
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    expect(tx.plans).toEqual([[]]);
  });

  it('notifies once across two overlapping deliveries of one freed day', async () => {
    const request = requestFixture('wl_1');
    const { tx, store, run } = rig({ watching: [request] });
    await run(command);
    await run(command);
    expect(tx.plans).toEqual([matchPlan(request, 600), []]);
    const inbox = [...store.keys()].filter((path) =>
      path.startsWith(`${Collections.Users}/${OWNER}/`),
    );
    expect(inbox).toHaveLength(1);
  });

  it('reads a notification already there as told — the deterministic id’s replay, never a second message', async () => {
    const request = requestFixture('wl_1');
    const told = matchPlan(request, 600)[0] as WriteOp.Create;
    const { tx, telemetry, run } = rig({
      watching: [request],
      extra: [{ path: told.path, body: told.body }],
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    expect(tx.plans).toEqual([]);
    expect(telemetry.lines).toEqual([]);
  });

  it('keeps the cross-day cooldown: a person told within six hours is not told again', async () => {
    const { tx, calls, run } = rig({
      watching: [requestFixture('wl_1')],
      recent: () => Result.ok(true),
    });
    await run(command);
    expect(calls.cooldown).toBe(1);
    expect(tx.transactions).toEqual([]);
  });

  it('asks nobody about a day nothing fits — no cooldown probe, no transaction', async () => {
    const { tx, calls, run } = rig({
      watching: [requestFixture('wl_1')],
      busy: [busyBlocks(IVAN, [540, 1080])],
    });
    await run(command);
    expect(calls.cooldown).toBe(0);
    expect(tx.transactions).toEqual([]);
  });

  it('reads nothing past the open requests when nobody watches the day', async () => {
    const { calls, run } = rig({ watching: [] });
    await run(command);
    expect(calls).toEqual({ policy: 1, open: 1, catalogue: 0, cooldown: 0 });
  });

  it('loads the day ONCE for every request watching it, and one request’s failure costs the others nothing', async () => {
    const first = requestFixture('wl_1');
    const second = requestFixture('wl_2', {
      ownerUserId: UserId.of('u-other'),
    });
    const failure = RepositoryError.readFailed(
      'users/x/notifications',
      'unavailable',
    );
    const { tx, telemetry, calls, run } = rig({
      watching: [first, second],
      recent: (id) =>
        id === first.id ? Result.err(failure) : Result.ok(false),
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [second.id],
        expiredRequestIds: [],
        failures: [failure],
        attemptFailure: {
          error: failure,
          failureCode: 'unavailable',
          attemptOutcome: AttemptOutcome.Transient,
        },
      },
    });
    expect(calls.catalogue).toBe(1);
    expect(tx.plans).toEqual([matchPlan(second, 600)]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'waitlist match failed',
        fields: { requestId: first.id, error: failure },
      },
    ]);
  });

  it('answers a zone it cannot read as its store failure, before reading anything else (4A-2 (e))', async () => {
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const tx = memoryTxPorts(memoryStore());
    const run = matchWaitlist({
      ...tx,
      ...recordingTelemetry(),
      ...memoryDefaultLocationPorts(),
      loadLocation: async () => Result.err(failed),
      loadPolicy: async () => {
        throw new Error('nothing past the zone is read');
      },
      loadOpenWaitlist: async () => {
        throw new Error('nothing past the zone is read');
      },
      loadListedCatalog: async () =>
        Result.ok({ services: [], locations: [], barbers: [] }),
      loadSchedule: async () => Result.ok(null),
      loadScheduleException: async () => Result.ok(null),
      loadBusyDay: async () => Result.ok(null),
      hasRecentNotification: async () => Result.ok(false),
    });
    expect(await run(command)).toEqual(Result.err(failed));
    expect(tx.transactions).toEqual([]);
  });

  it('answers a policy it cannot read before loading anything else', async () => {
    const failure = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'unavailable',
    );
    const tx = memoryTxPorts(memoryStore());
    const run = matchWaitlist({
      ...tx,
      ...recordingTelemetry(),
      ...ZONE_PORTS,
      loadPolicy: async () => Result.err(failure),
      loadOpenWaitlist: async () => {
        throw new Error('nothing past the policy is read');
      },
      loadListedCatalog: async () =>
        Result.ok({ services: [], locations: [], barbers: [] }),
      loadSchedule: async () => Result.ok(null),
      loadScheduleException: async () => Result.ok(null),
      loadBusyDay: async () => Result.ok(null),
      hasRecentNotification: async () => Result.ok(false),
    });
    expect(await run(command)).toEqual({ ok: false, error: failure });
  });
});

describe('matchWaitlist — the busy the grid sees', () => {
  it('pads each barber by their OWN turnaround before searching', async () => {
    const padded = rig({
      watching: [requestFixture('wl_1')],
      schedules: [tuesdayRoster(IVAN, [segment(CENTRE, 600, 720)], 10)],
      busy: [busyBlocks(IVAN, [600, 630])],
    });
    await padded.run(command);
    // 10:00–10:30 busy, 10 minutes reset after it: the first start is 10:40.
    expect(sentStarts(padded.tx)).toEqual([640]);

    const unpadded = rig({
      watching: [requestFixture('wl_1')],
      schedules: [tuesdayRoster(IVAN, [segment(CENTRE, 600, 720)], 0)],
      busy: [busyBlocks(IVAN, [600, 630])],
    });
    await unpadded.run(command);
    expect(sentStarts(unpadded.tx)).toEqual([630]);
  });

  it('reads a published exception before building the windows — a closed day offers nothing', async () => {
    const { tx, run } = rig({
      watching: [requestFixture('wl_1')],
      exceptions: [
        scheduleExceptionFixture({
          id: ScheduleExceptionId.of(BusyKey.of(IVAN, DAY)),
          localDate: DAY,
        }),
      ],
    });
    await run(command);
    expect(tx.transactions).toEqual([]);
  });
});

describe('matchWaitlist — only the shops the public surface lists', () => {
  const hidden = locationFixture({
    id: MLADOST,
    locationStatus: LocationStatus.Hidden,
  });

  it('drops a split day’s hours at a hidden shop and keeps the listed one’s', async () => {
    const split = [segment(CENTRE, 540, 600), segment(MLADOST, 600, 720)];
    const asked = requestFixture('wl_1', {
      flexibleDays: [
        DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(720))]),
      ],
    });
    const listedOnly = rig({
      watching: [asked],
      locations: [locationFixture(), hidden],
      schedules: [tuesdayRoster(IVAN, split)],
    });
    await listedOnly.run(command);
    expect(listedOnly.tx.transactions).toEqual([]);

    const bothListed = rig({
      watching: [asked],
      locations: [
        locationFixture(),
        { ...hidden, locationStatus: LocationStatus.Active },
      ],
      schedules: [tuesdayRoster(IVAN, split)],
    });
    await bothListed.run(command);
    expect(sentStarts(bothListed.tx)).toEqual([600]);
  });

  it('leaves out a barber who works only at a hidden shop that day, and a roster naming a shop that is not there', async () => {
    const { tx, run } = rig({
      watching: [requestFixture('wl_1')],
      locations: [locationFixture(), hidden],
      barbers: [barberFixture({ id: NIKO }), barberFixture({ id: PETAR })],
      schedules: [
        tuesdayRoster(NIKO, [segment(MLADOST, 540, 1080)]),
        tuesdayRoster(PETAR, [segment(LocationId.of('loc-typo'), 360, 1380)]),
      ],
    });
    await run(command);
    expect(tx.transactions).toEqual([]);
  });

  it('reads a day whose every shop is hidden as an empty day — nothing sent, the lapses still read', async () => {
    const lapsed = requestFixture('wl_old', {
      localDates: [localDate('2026-09-25'), DAY],
      flexibleDays: [
        DayWindows.of(localDate('2026-09-25'), [
          MinuteRange.of(minute(600), endMinute(720)),
        ]),
      ],
    });
    const { tx, run } = rig({
      watching: [requestFixture('wl_1'), lapsed],
      locations: [hidden],
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [],
        expiredRequestIds: [lapsed.id],
        ...NO_FAILURE,
      },
    });
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.WaitlistRequests, lapsed.id], {
          waitlistStatus: WaitlistStatus.Expired,
          waitlistStatusAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
      ],
    ]);
  });

  it('reads a day nobody is rostered on as an empty day too', async () => {
    const { tx, run } = rig({
      watching: [requestFixture('wl_1')],
      schedules: [],
    });
    await run(command);
    expect(tx.transactions).toEqual([]);
  });
});

describe('matchWaitlist — a day gone by', () => {
  const PAST = localDate('2026-09-25');
  const pastCommand = { localDate: PAST };
  const lapsed = requestFixture('wl_old', {
    localDates: [PAST],
    flexibleDays: [
      DayWindows.of(PAST, [MinuteRange.of(minute(600), endMinute(720))]),
    ],
  });

  it('retires the requests whose every day has passed, re-read in their own transaction — no policy read, no snapshot', async () => {
    const { tx, calls, run } = rig({ watching: [lapsed] });
    expect(await run(pastCommand)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [],
        expiredRequestIds: [lapsed.id],
        ...NO_FAILURE,
      },
    });
    expect(calls).toEqual({ policy: 0, open: 1, catalogue: 0, cooldown: 0 });
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.WaitlistRequests, lapsed.id], {
          waitlistStatus: WaitlistStatus.Expired,
          waitlistStatusAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
      ],
    ]);
  });

  it('leaves a request with a day still ahead watching', async () => {
    const live = requestFixture('wl_live', {
      localDates: [PAST, DAY],
      flexibleDays: [
        DayWindows.of(PAST, [MinuteRange.of(minute(600), endMinute(720))]),
        DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(720))]),
      ],
    });
    const { tx, run } = rig({ watching: [live] });
    await run(pastCommand);
    expect(tx.transactions).toEqual([]);
  });

  it('expires nothing a re-read finds already concluded', async () => {
    const { tx, run } = rig({
      watching: [lapsed],
      stored: [{ ...lapsed, waitlistStatus: WaitlistStatus.Cancelled }],
    });
    expect(await run(pastCommand)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    expect(tx.plans).toEqual([[]]);
  });
});

describe('matchWaitlist — retried (edge-hardening D-5)', () => {
  const first = requestFixture('wl_1');
  const second = requestFixture('wl_2', {
    ownerUserId: UserId.of('u-other'),
  });

  it('settles every request past one whose commit rejected, and answers the verdict TRANSIENT — a redelivery is earned', async () => {
    const outage = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const { tx, telemetry, run } = rig({
      watching: [first, second],
      commitAttempt: (attempt) =>
        attempt === 1 ? Promise.reject(outage) : null,
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [second.id],
        expiredRequestIds: [],
        failures: [outage],
        attemptFailure: {
          error: outage,
          failureCode: 'unavailable',
          attemptOutcome: AttemptOutcome.Transient,
        },
      },
    });
    expect(tx.plans).toEqual([matchPlan(second, 600)]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'waitlist match failed',
        fields: { requestId: first.id, error: String(outage) },
      },
    ]);
  });

  it('answers a request’s permanent refusal as the PERMANENT verdict — logged, never redelivered', async () => {
    const denied = RepositoryError.writeFailed(
      `${Collections.WaitlistRequests}/${first.id}`,
      'permission-denied',
    );
    const { run } = rig({
      watching: [first, second],
      commitAttempt: (attempt) =>
        attempt === 1 ? Promise.resolve(Result.err(denied)) : null,
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [second.id],
        expiredRequestIds: [],
        failures: [denied],
        attemptFailure: {
          error: denied,
          failureCode: 'permission-denied',
          attemptOutcome: AttemptOutcome.Permanent,
        },
      },
    });
  });

  it('is a no-op for whoever the first delivery told: the redelivery tells the failed request once and nobody twice', async () => {
    const outage = Object.assign(new Error('10 ABORTED'), { code: 10 });
    const { tx, store, run } = rig({
      watching: [first, second],
      commitAttempt: (attempt) =>
        attempt === 1 ? Promise.reject(outage) : null,
    });
    await run(command);
    const again = await run(command);
    expect(again).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [first.id],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    // Delivery 1: the second told. Delivery 2: the first told, the second
    // re-read as MATCHED — an empty plan.
    expect(tx.plans).toEqual([
      matchPlan(second, 600),
      matchPlan(first, 600),
      [],
    ]);
    const told = (owner: UserId) =>
      [...store.keys()].filter((path) =>
        path.startsWith(`${Collections.Users}/${owner}/`),
      );
    expect(told(first.ownerUserId)).toHaveLength(1);
    expect(told(second.ownerUserId)).toHaveLength(1);
    const third = await run(command);
    expect(third).toEqual({
      ok: true,
      value: { notifiedRequestIds: [], expiredRequestIds: [], ...NO_FAILURE },
    });
  });
});

describe('matchWaitlist — a malformed busy day skips only its barber (edge-hardening DEP-13)', () => {
  /** Ivan works 10:00–11:00, Niko 15:00–16:00 — each request fits only one of them. */
  const world = {
    barbers: [barberFixture({ id: IVAN }), barberFixture({ id: NIKO })],
    schedules: [
      tuesdayRoster(IVAN, [segment(CENTRE, 600, 660)]),
      tuesdayRoster(NIKO, [segment(CENTRE, 900, 960)]),
    ],
  };
  const morning = requestFixture('wl_ivan', {
    flexibleDays: [
      DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(660))]),
    ],
  });
  const afternoon = requestFixture('wl_niko', {
    ownerUserId: UserId.of('u-other'),
    flexibleDays: [
      DayWindows.of(DAY, [MinuteRange.of(minute(900), endMinute(960))]),
    ],
  });
  const IVAN_KEY = BusyKey.of(IVAN, DAY);

  it('matches each request to its own barber when both busy days read', async () => {
    const { tx, run } = rig({ ...world, watching: [morning, afternoon] });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [morning.id, afternoon.id],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    expect(sentStarts(tx)).toEqual([600, 900]);
  });

  it('offers none of the refused barber’s time, matches the other barber, logs the skip — no attempt failure', async () => {
    const malformed = RepositoryError.malformed(
      `${Collections.BarberBusy}/${IVAN_KEY}`,
      'blocks[0].startMinutes',
    );
    const { tx, telemetry, run } = rig({
      ...world,
      watching: [morning, afternoon],
      busyDay: (key) => (key === IVAN_KEY ? Result.err(malformed) : null),
    });
    expect(await run(command)).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [afternoon.id],
        expiredRequestIds: [],
        ...NO_FAILURE,
      },
    });
    expect(tx.plans).toEqual([matchPlan(afternoon, 900)]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'waitlist barber skipped',
        fields: { key: IVAN_KEY, error: malformed },
      },
    ]);
  });

  it('still answers any other busy-day refusal as the match’s store failure — judged by its reason at the edge', async () => {
    const unavailable = RepositoryError.readFailed(
      `${Collections.BarberBusy}/${IVAN_KEY}`,
      'unavailable',
    );
    const { tx, run } = rig({
      ...world,
      watching: [morning, afternoon],
      busyDay: (key) => (key === IVAN_KEY ? Result.err(unavailable) : null),
    });
    expect(await run(command)).toEqual(Result.err(unavailable));
    expect(tx.transactions).toEqual([]);
  });
});
