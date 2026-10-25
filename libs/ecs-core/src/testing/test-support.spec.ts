import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Result,
  Weekday,
  LocalDate,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { BookingErrorCode, RepositoryErrorCode } from '@core/errors';
import { WriteOp } from '@core/components';
import { QueryOp } from '@core/entities';
import type { QuerySpec } from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIELD_SET_AND_DELETED,
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  draftPersonKey,
  endMinute,
  localDate,
  minute,
  trackMinute,
  pinnedNowUtcMs,
  utcMs,
  applyWrites,
  fixtureHash,
  memoryCommitPlan,
  memoryReadTx,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  sequentialIds,
  textFixture,
  unwrapErr,
  unwrapOk,
  offsetIso,
} from './test-support';
import { deepFreeze } from './deep-freeze';

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
  /** 2026-09-28 00:00 EEST = 2026-09-27T21:00:00Z — the fixture day's start. */
  const FIXTURE_DAY_START_UTC_MS = 1_790_542_800_000;

  it('the literal fixture instants agree with ZonedTimeSystem', () => {
    expect(LocalDate.weekday(FIXTURE_TODAY)).toBe(Weekday.Mon);
    expect(
      ZonedTimeSystem.startOfLocalDay(FIXTURE_TODAY, FIXTURE_TIME_ZONE),
    ).toBe(FIXTURE_DAY_START_UTC_MS);
    // An ordinary day: 24 hours to the next local midnight, no switch.
    expect(
      ZonedTimeSystem.startOfLocalDay(
        LocalDate.addDays(FIXTURE_TODAY, 1),
        FIXTURE_TIME_ZONE,
      ) - FIXTURE_DAY_START_UTC_MS,
    ).toBe(24 * 3_600_000);
    expect(FIXTURE_NOW_UTC_MS - FIXTURE_DAY_START_UTC_MS).toBe(9 * 3_600_000);
    expect(
      ZonedTimeSystem.toLocal(FIXTURE_NOW_UTC_MS, FIXTURE_TIME_ZONE).localDate,
    ).toBe(FIXTURE_TODAY);
    expect(FIXTURE_TIME_ZONE).toBe('Europe/Sofia');
  });

  it('sequentialIds is deterministic', () => {
    const next = sequentialIds('appt');
    expect([next(), next()]).toEqual(['appt-1', 'appt-2']);
    expect(sequentialIds()()).toBe('id-1');
  });

  it('textFixture fills both locales', () => {
    expect(textFixture('Cut')).toEqual({ bg: 'Cut', en: 'Cut' });
    expect(textFixture('Cut', 'Подстригване')).toEqual({
      bg: 'Подстригване',
      en: 'Cut',
    });
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

  it('reads ROOT keys only — a discriminator at the root matches, a dotted path names no root key', async () => {
    const store = memoryStore([
      {
        path: ['appointments', 'f1'],
        body: { bookingStatus: 'CONFIRMED', utcEpochMs: 20 },
      },
      {
        path: ['appointments', 'f2'],
        body: { bookingStatus: 'CANCELLED', utcEpochMs: 10 },
      },
      {
        path: ['appointments', 'f3'],
        body: { bookingStatus: 'CONFIRMED', utcEpochMs: 5 },
      },
    ]);
    const flat = async (spec: Partial<QuerySpec>) =>
      (await memoryReadTx(store).query<{ id: string }>(query(spec))).map(
        (row) => row.id,
      );
    expect(
      await flat({
        where: [{ field: 'bookingStatus', op: QueryOp.Eq, value: 'CONFIRMED' }],
        orderBy: [{ field: 'utcEpochMs', descending: false }],
      }),
    ).toEqual(['f3', 'f1']);
    expect(
      await flat({
        where: [
          { field: 'bookingStatus.kind', op: QueryOp.Eq, value: 'confirmed' },
        ],
      }),
    ).toEqual([]);
  });

  it('walks no dotted path and compares maps by value', async () => {
    expect(
      await ids({
        where: [{ field: 'status.kind', op: QueryOp.Eq, value: 'confirmed' }],
      }),
    ).toEqual([]);
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

describe('the flatten-pass time fixtures (flatten-spec §2.2)', () => {
  it('pins now as the fixture shop sees it — 2026-09-28 09:00 EEST', () => {
    expect(FIXTURE_TIME_ZONE).toBe('Europe/Sofia');
    // 2026-09-28T06:00:00Z.
    expect(FIXTURE_NOW_UTC_MS).toBe(1_790_575_200_000);
    expect(FIXTURE_NOW).toEqual({
      localDate: FIXTURE_TODAY,
      currentMinute: 540,
      utcEpochMs: FIXTURE_NOW_UTC_MS,
    });
  });

  it('builds branded literals and throws on a broken one', () => {
    expect(localDate('2026-10-07')).toBe('2026-10-07');
    expect(minute(600)).toBe(600);
    expect(endMinute(1440)).toBe(1440);
    expect(utcMs('2026-09-28T09:00:00+03:00')).toBe(FIXTURE_NOW_UTC_MS);
    expect(() => localDate('2026-02-30')).toThrow(/broken fixture/);
    expect(() => minute(1440)).toThrow(/broken fixture/);
    expect(() => endMinute(0)).toThrow(/broken fixture/);
    expect(() => utcMs('2026-09-28T09:00:00')).toThrow(/broken fixture/);
  });

  it('builds the pass D literals: a track minute past midnight and a draft key as spelled', () => {
    expect(trackMinute(0)).toBe(0);
    expect(trackMinute(1455)).toBe(1455);
    expect(() => trackMinute(-1)).toThrow(/broken fixture/);
    expect(() => trackMinute(1.5)).toThrow(/broken fixture/);
    expect(draftPersonKey('guest-Мария')).toBe('guest-Мария');
    expect(draftPersonKey('primary')).toBe('primary');
  });

  it('pinnedNowUtcMs is deterministic', () => {
    expect(pinnedNowUtcMs()()).toBe(FIXTURE_NOW_UTC_MS);
  });
});

/*
 * `offsetIso` — the spelling the zoned-time system no longer owns (pass E,
 * E-6): its two describes of `zoned-time.system.spec.ts` restated here, same
 * literals, same property. Every instant is a LITERAL epoch-ms constant (its
 * UTC reading in the comment).
 */
describe('offsetIso — an instant on the zone’s clock, with its offset', () => {
  const zone = (raw: string): TimeZone =>
    unwrapOk(ZonedTimeSystem.checkZone(raw));
  const SOFIA_TZ = zone('Europe/Sofia');
  const KOLKATA_TZ = zone('Asia/Kolkata');
  const UTC_TZ = zone('UTC');
  const SAO_PAULO_TZ = zone('America/Sao_Paulo');
  const LORD_HOWE_TZ = zone('Australia/Lord_Howe');
  /** A literal epoch-ms constant as the brand. */
  const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

  const SOFIA_0801_0900 = 1_785_564_000_000; // 2026-08-01T06:00Z
  const SOFIA_1025_0330_SECOND = 1_792_891_800_000; // 2026-10-25T01:30Z (+02:00)
  const UTC_0729_START = 1_785_283_200_000; // 2026-07-29T00:00Z
  const KOLKATA_0730_0915 = 1_785_383_100_000; // 2026-07-30T03:45Z

  it('spells the instant as ZonedDateTime.toISO() did in the shop’s zone', () => {
    // 2026-10-10T11:00:00.000Z — Sofia summer (EEST, +03:00).
    expect(offsetIso(at(1_791_630_000_000), SOFIA_TZ)).toBe(
      '2026-10-10T14:00:00.000+03:00',
    );
    // 2026-12-01T08:30:15.007Z — Sofia winter (EET, +02:00); seconds and ms kept.
    expect(offsetIso(at(1_796_113_815_007), SOFIA_TZ)).toBe(
      '2026-12-01T10:30:15.007+02:00',
    );
  });

  it('names each occurrence of the repeated hour by its own offset', () => {
    // 2026-10-25T00:30Z and 01:30Z both read 03:30 in Sofia.
    expect(offsetIso(at(1_792_888_200_000), SOFIA_TZ)).toBe(
      '2026-10-25T03:30:00.000+03:00',
    );
    expect(offsetIso(at(1_792_891_800_000), SOFIA_TZ)).toBe(
      '2026-10-25T03:30:00.000+02:00',
    );
  });

  it('writes a non-hour, a negative and a zero offset as ±HH:MM', () => {
    // 2026-10-10T00:00Z.
    expect(offsetIso(at(1_791_590_400_000), KOLKATA_TZ)).toBe(
      '2026-10-10T05:30:00.000+05:30',
    );
    expect(offsetIso(at(1_791_590_400_000), UTC_TZ)).toBe(
      '2026-10-10T00:00:00.000+00:00',
    );
    // 2026-10-10T02:00Z is the previous evening in São Paulo (-03:00).
    expect(offsetIso(at(1_791_597_600_000), SAO_PAULO_TZ)).toBe(
      '2026-10-09T23:00:00.000-03:00',
    );
    // Before the epoch: the millisecond is still the positive remainder.
    expect(offsetIso(at(-1), UTC_TZ)).toBe('1969-12-31T23:59:59.999+00:00');
  });

  it('reads back through parseOffsetIso as the same instant', () => {
    for (const epochMs of [1_791_630_000_000, 1_792_891_800_000]) {
      const iso = offsetIso(at(epochMs), SOFIA_TZ);
      expect(unwrapOk(ZonedTimeSystem.parseOffsetIso(iso))).toBe(epochMs);
    }
  });

  it('an unknown zone throws — a broken fixture', () => {
    expect(() => offsetIso(at(0), 'Not/AZone' as TimeZone)).toThrow();
  });

  it('is byte-identical to the legacy ZonedDateTime.toISO()', () => {
    expect(offsetIso(at(SOFIA_0801_0900), SOFIA_TZ)).toBe(
      '2026-08-01T09:00:00.000+03:00',
    );
    expect(offsetIso(at(SOFIA_1025_0330_SECOND), SOFIA_TZ)).toBe(
      '2026-10-25T03:30:00.000+02:00',
    );
    expect(offsetIso(at(UTC_0729_START), UTC_TZ)).toBe(
      '2026-07-29T00:00:00.000+00:00',
    );
    expect(offsetIso(at(KOLKATA_0730_0915), KOLKATA_TZ)).toBe(
      '2026-07-30T09:15:00.000+05:30',
    );
  });

  it('spells the wall clock toLocal reads and round-trips through parseOffsetIso (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.constantFrom(
          SOFIA_TZ,
          KOLKATA_TZ,
          UTC_TZ,
          SAO_PAULO_TZ,
          LORD_HOWE_TZ,
        ),
        (ms, tz) => {
          const instant = at(ms);
          const iso = offsetIso(instant, tz);
          const wall = ZonedTimeSystem.toLocal(instant, tz);
          expect(iso.slice(0, 10)).toBe(wall.localDate);
          expect(
            Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)),
          ).toBe(wall.minute);
          expect(unwrapOk(ZonedTimeSystem.parseOffsetIso(iso))).toBe(ms);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('applyWrites', () => {
  it('applies set, create, update (root fields) and delete as one plan', () => {
    const store = memoryStore([
      { path: ['a', '1'], body: { x: 1, nested: { keep: true, change: 1 } } },
      { path: ['a', '2'], body: { y: 1 } },
    ]);
    applyWrites(store, [
      WriteOp.update(['a', '1'], {
        nested: { change: 2 },
        x: 5,
      }),
      WriteOp.create(['a', '3'], { z: 1 }),
      WriteOp.set(['a', '2'], { y: 2 }),
      WriteOp.remove(['a', '4']),
    ]);
    // A root field is replaced whole — never merged into (Law 5).
    expect(store.get('a/1')).toEqual({ x: 5, nested: { change: 2 } });
    expect(store.get('a/2')).toEqual({ y: 2 });
    expect(store.get('a/3')).toEqual({ z: 1 });
    applyWrites(store, [WriteOp.remove(['a', '3'])]);
    expect(store.has('a/3')).toBe(false);
  });

  it('writes a key with a dot as ONE root field named with the dot — never a nested map (Law 5)', () => {
    const store = memoryStore([
      { path: ['a', '1'], body: { leaf: { inner: 0, keep: true } } },
    ]);
    applyWrites(store, [WriteOp.update(['a', '1'], { 'leaf.inner': 1 })]);
    expect(store.get('a/1')).toEqual({
      leaf: { inner: 0, keep: true },
      'leaf.inner': 1,
    });
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

  it('removes deleteFields at the root — a variant transition leaves one variant (Law 6)', () => {
    const store = memoryStore([
      {
        path: ['a', '1'],
        body: { bookingStatus: 'CONFIRMED', confirmedAtUtcMs: 1, keep: true },
      },
    ]);
    const before = store.get('a/1') ?? {};
    const after = {
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: 2,
      keep: true,
    };
    expect(
      applyWrites(store, [
        WriteOp.transition(
          ['a', '1'],
          { bookingStatus: 'CANCELLED', cancelledAtUtcMs: 2 },
          WriteOp.variantFieldsToDelete(before, after),
        ),
      ]),
    ).toEqual({ ok: true, value: undefined });
    expect(store.get('a/1')).toEqual(after);
  });

  it('refuses a key both set and deleted as a value, applying nothing', () => {
    const store = memoryStore([{ path: ['a', '1'], body: { n: 1 } }]);
    expect(
      applyWrites(store, [
        WriteOp.set(['a', '2'], { n: 2 }),
        WriteOp.transition(['a', '1'], { n: 2 }, ['n']),
      ]),
    ).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'a/1',
        reason: FIELD_SET_AND_DELETED,
      },
    });
    expect([...store.keys()]).toEqual(['a/1']);
    expect(store.get('a/1')).toEqual({ n: 1 });
  });

  it('is all-or-nothing: ALREADY_EXISTS answers as a value, NOT_FOUND throws; the store is untouched', () => {
    const store = memoryStore([{ path: ['a', '1'], body: { n: 1 } }]);
    expect(
      applyWrites(store, [
        WriteOp.set(['a', '2'], { n: 2 }),
        WriteOp.create(['a', '1'], { n: 9 }),
      ]),
    ).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.AlreadyExists,
        path: 'a/1',
        reason: null,
      },
    });
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
      () => Result.err({ errorCode: BookingErrorCode.SlotUnavailable }),
    );
    expect(result).toEqual({
      ok: false,
      error: { errorCode: BookingErrorCode.SlotUnavailable },
    });
    expect(store.size).toBe(0);
    expect(plans).toEqual([]);
  });

  it('a Create over an existing document answers ALREADY_EXISTS as a value and applies nothing', async () => {
    const store = memoryStore([{ path: ['a', '1'], body: { n: 1 } }]);
    const { commit, plans } = memoryCommitPlan(store);
    const result = await commit(
      async () => null,
      () =>
        Result.ok({
          writes: [
            WriteOp.set(['a', '2'], { n: 2 }),
            WriteOp.create(['a', '1'], { n: 9 }),
          ],
        }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        errorCode: 'REPOSITORY_ALREADY_EXISTS',
        path: 'a/1',
        reason: null,
      },
    });
    expect([...store.keys()]).toEqual(['a/1']);
    expect(store.get('a/1')).toEqual({ n: 1 });
    expect(plans).toEqual([]);
  });

  it('a key both set and deleted answers field-set-and-deleted as a value and applies nothing', async () => {
    const store = memoryStore([{ path: ['a', '1'], body: { n: 1 } }]);
    const { commit, plans } = memoryCommitPlan(store);
    const result = await commit(
      async () => null,
      () =>
        Result.ok({
          writes: [WriteOp.transition(['a', '1'], { n: 2 }, ['n'])],
        }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'a/1',
        reason: 'field-set-and-deleted',
      },
    });
    expect(store.get('a/1')).toEqual({ n: 1 });
    expect(plans).toEqual([]);
  });

  it('a plan the store cannot apply (NOT_FOUND) rejects the promise', async () => {
    const store = memoryStore();
    const { commit, plans } = memoryCommitPlan(store);
    await expect(
      commit(
        async () => null,
        () => Result.ok({ writes: [WriteOp.update(['a', '1'], { n: 1 })] }),
      ),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(store.size).toBe(0);
    expect(plans).toEqual([]);
  });
});

describe('memoryTxPorts / recordingTelemetry', () => {
  it('bundles the commit double with pinned primitives, each overridable', async () => {
    const ports = memoryTxPorts(memoryStore());
    expect(ports.nowUtcMs()).toBe(FIXTURE_NOW_UTC_MS);
    expect(ports.nextId()).toBe('id-1');
    expect(ports.hash('x')).toBe(fixtureHash('x'));
    await ports.commit(
      async () => null,
      () => Result.ok({ writes: [WriteOp.set(['a', '1'], {})] }),
    );
    expect(ports.plans).toHaveLength(1);
    expect(ports.transactions).toHaveLength(1);
    const custom = memoryTxPorts(memoryStore(), {
      nowUtcMs: pinnedNowUtcMs(unwrapOk(UtcEpochMs.of(1))),
      nextId: sequentialIds('x'),
      hash: () => 'h',
    });
    expect([custom.nowUtcMs(), custom.nextId(), custom.hash('y')]).toEqual([
      1,
      'x-1',
      'h',
    ]);
  });

  it('records log lines and tracked errors, absent fields as null', () => {
    const telemetry = recordingTelemetry();
    telemetry.log('warn', 'booking.rejected', {
      errorCode: BookingErrorCode.SlotUnavailable,
    });
    telemetry.log('info', 'tick');
    const failure = new Error('boom');
    telemetry.trackError(failure, { pipeline: 'book' });
    telemetry.trackError('plain');
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: 'booking.rejected',
        fields: { errorCode: BookingErrorCode.SlotUnavailable },
      },
      { level: 'info', msg: 'tick', fields: null },
    ]);
    expect(telemetry.errors).toEqual([
      { error: failure, context: { pipeline: 'book' } },
      { error: 'plain', context: null },
    ]);
  });
});
