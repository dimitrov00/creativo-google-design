import { describe, expect, it } from 'vitest';
import { BusyKey } from './components/busy-key.data';
import { DayOffset } from './components/day-offset.data';
import { Result } from './components/result.data';
import { Seat } from './components/seat.data';
import { Weekday } from './components/weekday.data';
import { WriteOp } from './components/write-op.data';
import { QueryOp } from './ports/collections';
import type { QuerySpec } from './ports/tx.port';
import { ZonedTimeSystem } from './systems/zoned-time.system';
import {
  FIXTURE_DAY_START_MS,
  FIXTURE_IDS,
  FIXTURE_NOW_MS,
  FIXTURE_TODAY,
  FIXTURE_ZONE,
  appointmentFixture,
  applyWrites,
  barberBusyDayFixture,
  barberFixture,
  barberScheduleFixture,
  dayTableFixture,
  deepFreeze,
  fixtureHash,
  fixtureTodayAt,
  locationFixture,
  memoryCommitPlan,
  memoryReadTx,
  memoryStore,
  memoryTxPorts,
  pinnedNowMs,
  recordingTelemetry,
  scheduleExceptionFixture,
  sequentialIds,
  serviceFixture,
  steppingNowMs,
  textFixture,
  unwrapErr,
  unwrapOk,
  userFixture,
} from './testing';

const query = (overrides: Partial<QuerySpec>): QuerySpec => ({
  collection: ['appointments'],
  where: [],
  orderBy: [],
  limit: null,
  ...overrides,
});

const seeded = () =>
  memoryStore([
    {
      path: ['appointments', 'a1'],
      body: {
        n: 3,
        tag: 'x',
        keys: ['k1', 'k2'],
        status: { kind: 'confirmed' },
      },
    },
    {
      path: ['appointments', 'a2'],
      body: { n: 1, tag: 'y', keys: ['k2'], status: { kind: 'cancelled' } },
    },
    {
      path: ['appointments', 'a3'],
      body: { n: 2, tag: 'x', keys: [], status: { kind: 'confirmed' } },
    },
    { path: ['appointments', 'a3', 'photos', 'p1'], body: { n: 9 } },
    { path: ['users', 'u1'], body: { n: 1 } },
  ]);

async function ids(spec: Partial<QuerySpec>): Promise<readonly string[]> {
  const rows = await memoryReadTx(seeded()).query<{ id: string }>(query(spec));
  return rows.map((row) => row.id);
}

describe('deepFreeze', () => {
  it('freezes nested objects and arrays and returns the same value', () => {
    const value = { a: { b: [1, { c: 2 }] } };
    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(() => {
      'use strict';
      (value.a.b as number[]).push(3);
    }).toThrow();
  });

  it('leaves primitives alone', () => {
    expect(deepFreeze(7)).toBe(7);
    expect(deepFreeze(null)).toBeNull();
  });

  it('still freezes the children of a fixture that was shallow-frozen first', () => {
    const value = Object.freeze({ a: [1], b: { c: [2] } });
    deepFreeze(value);
    expect(() => {
      'use strict';
      value.a.push(2);
    }).toThrow();
    expect(Object.isFrozen(value.b.c)).toBe(true);
  });

  it('terminates on a cycle, freezing every node once', () => {
    type Node = { next: Node | null; tags: string[] };
    const a: Node = { next: null, tags: ['a'] };
    const b: Node = { next: a, tags: ['b'] };
    a.next = b;
    expect(deepFreeze(a)).toBe(a);
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.tags)).toBe(true);
  });
});

describe('unwrapOk / unwrapErr', () => {
  it('answers the side asked for and throws on the other', () => {
    expect(unwrapOk(Result.ok(1))).toBe(1);
    expect(unwrapErr(Result.err({ code: 'x.y' }))).toEqual({ code: 'x.y' });
    expect(() => unwrapOk(Result.err({ code: 'x.y' }))).toThrow(/x\.y/);
    expect(() => unwrapErr(Result.ok(1))).toThrow(/expected an error/);
  });
});

describe('the pinned primitives', () => {
  it('the literal fixture instants agree with ZonedTimeSystem', () => {
    const [today] = dayTableFixture();
    expect(today?.dayKey).toBe(FIXTURE_TODAY);
    expect(today?.dayStartMs).toBe(FIXTURE_DAY_START_MS);
    expect(today?.weekday).toBe(Weekday.Mon);
    expect(today !== undefined && DayOffset.isTransition(today)).toBe(false);
    expect(fixtureTodayAt(9)).toBe(FIXTURE_NOW_MS);
    expect(ZonedTimeSystem.dayKeyOf(FIXTURE_NOW_MS, dayTableFixture())).toBe(
      FIXTURE_TODAY,
    );
    expect(FIXTURE_ZONE).toBe('Europe/Sofia');
  });

  it('a day table spans the asked range and refuses a broken one', () => {
    expect(dayTableFixture('2026-09-28', '2026-10-04')).toHaveLength(7);
    expect(() => dayTableFixture('2026-09-28', '2026-09-27')).toThrow(
      /broken fixture/,
    );
    expect(() =>
      dayTableFixture('2026-09-28', '2026-09-28', 'Not/AZone'),
    ).toThrow(/broken fixture/);
  });

  it('pinnedNowMs, steppingNowMs and sequentialIds are deterministic', () => {
    expect(pinnedNowMs()()).toBe(FIXTURE_NOW_MS);
    expect(pinnedNowMs(5)()).toBe(5);
    const clock = steppingNowMs(100, 10);
    expect([clock(), clock(), clock()]).toEqual([100, 110, 120]);
    expect(steppingNowMs()()).toBe(FIXTURE_NOW_MS);
    const next = sequentialIds('appt');
    expect([next(), next()]).toEqual(['appt-1', 'appt-2']);
    expect(sequentialIds()()).toBe('id-1');
  });

  it('fixtureHash is a stable 64-hex digest that separates inputs', () => {
    const digest = fixtureHash('row|basis');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(fixtureHash('row|basis')).toBe(digest);
    expect(fixtureHash('row|basis2')).not.toBe(digest);
    expect(fixtureHash('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('memoryReadTx', () => {
  it('get answers the entity ({ id, ...body }) or null, and records the read', async () => {
    const tx = memoryReadTx(seeded());
    expect(await tx.get(['appointments', 'a2'])).toEqual({
      id: 'a2',
      n: 1,
      tag: 'y',
      keys: ['k2'],
      status: { kind: 'cancelled' },
    });
    expect(await tx.get(['appointments', 'missing'])).toBeNull();
    expect(tx.reads).toEqual([
      ['appointments', 'a2'],
      ['appointments', 'missing'],
    ]);
  });

  it('getAll keeps positions, absent documents as null', async () => {
    const tx = memoryReadTx(seeded());
    const rows = await tx.getAll<{ id: string }>([
      ['appointments', 'a3'],
      ['appointments', 'nope'],
      ['users', 'u1'],
    ]);
    expect(rows.map((row) => row?.id ?? null)).toEqual(['a3', null, 'u1']);
    expect(tx.reads).toHaveLength(3);
  });

  it('a query reads one collection, never a subcollection, ordered by path by default', async () => {
    expect(await ids({})).toEqual(['a1', 'a2', 'a3']);
    const tx = memoryReadTx(seeded());
    await tx.query(query({ limit: 1 }));
    expect(tx.queries).toEqual([query({ limit: 1 })]);
  });

  it('filters with every Firestore operator', async () => {
    expect(
      await ids({ where: [{ field: 'tag', op: QueryOp.Eq, value: 'x' }] }),
    ).toEqual(['a1', 'a3']);
    expect(
      await ids({ where: [{ field: 'tag', op: QueryOp.Ne, value: 'x' }] }),
    ).toEqual(['a2']);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.Lt, value: 2 }] }),
    ).toEqual(['a2']);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.Lte, value: 2 }] }),
    ).toEqual(['a2', 'a3']);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.Gt, value: 2 }] }),
    ).toEqual(['a1']);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.Gte, value: 2 }] }),
    ).toEqual(['a1', 'a3']);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.Gt, value: 'a' }] }),
    ).toEqual([]);
    expect(
      await ids({
        where: [{ field: 'keys', op: QueryOp.ArrayContains, value: 'k2' }],
      }),
    ).toEqual(['a1', 'a2']);
    expect(
      await ids({
        where: [
          { field: 'keys', op: QueryOp.ArrayContainsAny, value: ['k1', 'zz'] },
        ],
      }),
    ).toEqual(['a1']);
    expect(
      await ids({
        where: [{ field: 'keys', op: QueryOp.ArrayContainsAny, value: 'k1' }],
      }),
    ).toEqual([]);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.In, value: [1, 3] }] }),
    ).toEqual(['a1', 'a2']);
    expect(
      await ids({ where: [{ field: 'n', op: QueryOp.NotIn, value: [1, 3] }] }),
    ).toEqual(['a3']);
    expect(
      await ids({
        where: [{ field: 'absent', op: QueryOp.NotIn, value: [1] }],
      }),
    ).toEqual([]);
    expect(
      await ids({ where: [{ field: 'absent', op: QueryOp.Ne, value: 1 }] }),
    ).toEqual([]);
  });

  it('reads dotted component paths and compares maps by value', async () => {
    expect(
      await ids({
        where: [{ field: 'status.kind', op: QueryOp.Eq, value: 'confirmed' }],
      }),
    ).toEqual(['a1', 'a3']);
    expect(
      await ids({
        where: [
          { field: 'status', op: QueryOp.Eq, value: { kind: 'cancelled' } },
        ],
      }),
    ).toEqual(['a2']);
    expect(
      await ids({
        where: [
          {
            field: 'status',
            op: QueryOp.Eq,
            value: { kind: 'cancelled', x: 1 },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      await ids({ where: [{ field: 'keys', op: QueryOp.Eq, value: ['k2'] }] }),
    ).toEqual(['a2']);
    expect(
      await ids({
        where: [{ field: 'keys', op: QueryOp.Eq, value: { 0: 'k2' } }],
      }),
    ).toEqual([]);
    expect(
      await ids({ where: [{ field: 'n.deeper', op: QueryOp.Eq, value: 1 }] }),
    ).toEqual([]);
  });

  it('orders by fields, ascending or descending, then limits', async () => {
    expect(await ids({ orderBy: [{ field: 'n', descending: false }] })).toEqual(
      ['a2', 'a3', 'a1'],
    );
    expect(
      await ids({ orderBy: [{ field: 'n', descending: true }], limit: 2 }),
    ).toEqual(['a1', 'a3']);
    expect(
      await ids({
        orderBy: [
          { field: 'tag', descending: true },
          { field: 'n', descending: false },
        ],
      }),
    ).toEqual(['a2', 'a3', 'a1']);
    expect(
      await ids({ orderBy: [{ field: 'keys', descending: false }] }),
    ).toEqual(['a1', 'a2', 'a3']);
  });

  it('orders mixed types by type rank and booleans by value', async () => {
    const store = memoryStore([
      { path: ['c', 's'], body: { v: 'a' } },
      { path: ['c', 'n'], body: { v: 1 } },
      { path: ['c', 't'], body: { v: true } },
      { path: ['c', 'f'], body: { v: false } },
      { path: ['c', 'z'], body: { v: null } },
      { path: ['c', 'm'], body: { v: { a: 1 } } },
    ]);
    const rows = await memoryReadTx(store).query<{ id: string }>({
      collection: ['c'],
      where: [],
      orderBy: [{ field: 'v', descending: false }],
      limit: null,
    });
    expect(rows.map((row) => row.id)).toEqual(['z', 'f', 't', 'n', 's', 'm']);
  });
});

describe('applyWrites', () => {
  it('applies set, create, update (dotted) and delete as one plan', () => {
    const store = memoryStore([
      { path: ['a', '1'], body: { x: 1, nested: { keep: true, change: 1 } } },
      { path: ['a', '2'], body: { y: 1 } },
    ]);
    applyWrites(store, [
      WriteOp.update(['a', '1'], {
        'nested.change': 2,
        'fresh.leaf': 'new',
        x: 5,
      }),
      WriteOp.create(['a', '3'], { z: 1 }),
      WriteOp.set(['a', '2'], { y: 2 }),
      WriteOp.remove(['a', '4']),
    ]);
    expect(store.get('a/1')).toEqual({
      x: 5,
      nested: { keep: true, change: 2 },
      fresh: { leaf: 'new' },
    });
    expect(store.get('a/2')).toEqual({ y: 2 });
    expect(store.get('a/3')).toEqual({ z: 1 });
    applyWrites(store, [WriteOp.remove(['a', '3'])]);
    expect(store.has('a/3')).toBe(false);
  });

  it('replaces a non-map value on a dotted path with a map', () => {
    const store = memoryStore([{ path: ['a', '1'], body: { leaf: [1] } }]);
    applyWrites(store, [WriteOp.update(['a', '1'], { 'leaf.inner': 1 })]);
    expect(store.get('a/1')).toEqual({ leaf: { inner: 1 } });
  });

  it('sees its own earlier writes inside the plan', () => {
    const store = memoryStore();
    applyWrites(store, [
      WriteOp.create(['a', '1'], { n: 1 }),
      WriteOp.update(['a', '1'], { n: 2 }),
    ]);
    expect(store.get('a/1')).toEqual({ n: 2 });
    expect(() =>
      applyWrites(store, [
        WriteOp.remove(['a', '1']),
        WriteOp.update(['a', '1'], { n: 3 }),
      ]),
    ).toThrow(/NOT_FOUND/);
  });

  it('is all-or-nothing: ALREADY_EXISTS and NOT_FOUND leave the store untouched', () => {
    const store = memoryStore([{ path: ['a', '1'], body: { n: 1 } }]);
    expect(() =>
      applyWrites(store, [
        WriteOp.set(['a', '2'], { n: 2 }),
        WriteOp.create(['a', '1'], { n: 9 }),
      ]),
    ).toThrow(/ALREADY_EXISTS: a\/1/);
    expect(() =>
      applyWrites(store, [
        WriteOp.set(['a', '2'], { n: 2 }),
        WriteOp.update(['a', '9'], { n: 9 }),
      ]),
    ).toThrow(/NOT_FOUND: a\/9/);
    expect([...store.keys()]).toEqual(['a/1']);
    expect(store.get('a/1')).toEqual({ n: 1 });
  });
});

describe('memoryCommitPlan', () => {
  it('reads, decides, applies the plan and answers the decision without it', async () => {
    const store = memoryStore([{ path: ['counters', 'c'], body: { n: 1 } }]);
    const { commit, plans, transactions } = memoryCommitPlan(store);
    const result = await commit(
      async (tx) => tx.get<{ n: number }>(['counters', 'c']),
      (snapshot) =>
        Result.ok({
          next: (snapshot?.n ?? 0) + 1,
          writes: [
            WriteOp.update(['counters', 'c'], { n: (snapshot?.n ?? 0) + 1 }),
          ],
        }),
    );
    expect(result).toEqual({ ok: true, value: { next: 2 } });
    expect(store.get('counters/c')).toEqual({ n: 2 });
    expect(plans).toEqual([[WriteOp.update(['counters', 'c'], { n: 2 })]]);
    expect(transactions[0]?.reads).toEqual([['counters', 'c']]);
  });

  it('a refusal writes nothing and records no plan', async () => {
    const store = memoryStore();
    const { commit, plans } = memoryCommitPlan(store);
    const result = await commit(
      async () => null,
      () => Result.err({ code: 'booking.slot_unavailable' }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'booking.slot_unavailable' },
    });
    expect(store.size).toBe(0);
    expect(plans).toEqual([]);
  });

  it('a plan the store refuses rejects the promise', async () => {
    const store = memoryStore([{ path: ['a', '1'], body: {} }]);
    const { commit, plans } = memoryCommitPlan(store);
    await expect(
      commit(
        async () => null,
        () => Result.ok({ writes: [WriteOp.create(['a', '1'], {})] }),
      ),
    ).rejects.toThrow(/ALREADY_EXISTS/);
    expect(plans).toEqual([]);
  });
});

describe('memoryTxPorts / recordingTelemetry', () => {
  it('bundles the commit double with pinned primitives, each overridable', async () => {
    const ports = memoryTxPorts(memoryStore());
    expect(ports.nowMs()).toBe(FIXTURE_NOW_MS);
    expect(ports.nextId()).toBe('id-1');
    expect(ports.hash('x')).toBe(fixtureHash('x'));
    await ports.commit(
      async () => null,
      () => Result.ok({ writes: [WriteOp.set(['a', '1'], {})] }),
    );
    expect(ports.plans).toHaveLength(1);
    expect(ports.transactions).toHaveLength(1);
    const custom = memoryTxPorts(memoryStore(), {
      nowMs: pinnedNowMs(1),
      nextId: sequentialIds('x'),
      hash: () => 'h',
    });
    expect([custom.nowMs(), custom.nextId(), custom.hash('y')]).toEqual([
      1,
      'x-1',
      'h',
    ]);
  });

  it('records log lines and tracked errors, absent fields as null', () => {
    const telemetry = recordingTelemetry();
    telemetry.log('warn', 'booking.rejected', {
      code: 'booking.outside_window',
    });
    telemetry.log('info', 'tick');
    const failure = new Error('boom');
    telemetry.trackError(failure, { pipeline: 'book' });
    telemetry.trackError('plain');
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: 'booking.rejected',
        fields: { code: 'booking.outside_window' },
      },
      { level: 'info', msg: 'tick', fields: null },
    ]);
    expect(telemetry.errors).toEqual([
      { error: failure, context: { pipeline: 'book' } },
      { error: 'plain', context: null },
    ]);
  });
});

describe('fixture builders', () => {
  it('the appointment agrees with its seat, busy key and day', () => {
    const appointment = appointmentFixture();
    const seat = appointment.seats[0] as Seat;
    expect(appointment.timeInterval).toEqual(Seat.interval(seat));
    expect(appointment.timeInterval.startMs).toBe(fixtureTodayAt(10));
    expect(appointment.busyKeys).toEqual([
      BusyKey.of(seat.barberId, FIXTURE_TODAY),
    ]);
    expect(appointment.barberIds).toEqual([FIXTURE_IDS.barber]);
    expect(
      ZonedTimeSystem.dayKeyOf(
        appointment.timeInterval.startMs,
        dayTableFixture(),
      ),
    ).toBe(FIXTURE_TODAY);
    expect(appointmentFixture({ revision: 4 }).revision).toBe(4);
  });

  it('the catalogue fixtures cross-reference the same ids', () => {
    const barber = barberFixture();
    const location = locationFixture();
    const service = serviceFixture();
    expect(barber.locationIds).toEqual([location.id]);
    expect(service.locationIds).toEqual([location.id]);
    expect(service.offerings[0]?.barberId).toBe(barber.id);
    expect(location.openingHours).toHaveLength(7);
    expect(location.zone).toBe(FIXTURE_ZONE);
    expect(barberFixture({ sortOrder: 3 }).sortOrder).toBe(3);
    expect(locationFixture({ mapUrl: 'https://maps.example' }).mapUrl).toBe(
      'https://maps.example',
    );
    expect(serviceFixture({ popular: true }).popular).toBe(true);
    expect(textFixture('Cut')).toEqual({ bg: 'Cut', en: 'Cut' });
  });

  it('the scheduling fixtures describe Ivan today', () => {
    const schedule = barberScheduleFixture();
    expect(schedule.versions[0]?.segments.map((s) => s.weekday)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(barberBusyDayFixture().id).toBe(
      BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY),
    );
    expect(barberBusyDayFixture().blocks[0]).toMatchObject({
      startMinutes: 600,
      endMinutes: 630,
    });
    expect(scheduleExceptionFixture().effect).toEqual({ kind: 'closed' });
    expect(
      barberScheduleFixture({ turnaroundMinutes: 5 }).turnaroundMinutes,
    ).toBe(5);
    expect(barberBusyDayFixture({ blocks: [] }).blocks).toEqual([]);
    expect(scheduleExceptionFixture({ zone: 'UTC' }).zone).toBe('UTC');
  });

  it('the user fixture is a registered, active client', () => {
    const user = userFixture();
    expect(user.registration).toEqual({ kind: 'registered' });
    expect(user.accountStatus).toEqual({ kind: 'active' });
    expect(user.roles).toEqual(['client']);
    expect(userFixture({ email: null }).email).toBeNull();
  });

  it('every fixture survives deepFreeze (no builder shares a mutable value)', () => {
    const a = deepFreeze(appointmentFixture());
    const b = appointmentFixture();
    expect(Object.isFrozen(b)).toBe(false);
    expect(b).toEqual(a);
  });
});
