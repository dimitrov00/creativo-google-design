import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  BlockKind,
  BookingPolicy,
  CapacityEntry,
  MinuteBlock,
  WriteAction,
} from '@core/components';
import {
  BarberBusyDayId,
  BarberId,
  BusyKey,
  CapacityMonthId,
  type LocalDate,
  LocationId,
  Result,
} from '@core/primitives';
import { type BarberBusyDay, Collections } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import { CapacityTrigger, rebuildCapacity } from '@core/pipelines';
import {
  barberScheduleFixture,
  endMinute,
  FIXTURE_TIME_ZONE,
  localDate,
  locationFixture,
  minute,
  minuteCount,
  pinnedNowUtcMs,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * The capacity rebuild against the REAL Firestore emulator — the lane that
 * exists because merge-vs-replace cannot be faked honestly: the
 * `entries[]` REPLACE-NOT-MERGE oracle. A whole-document `Set` of the full
 * sorted array, so a ghost entry (a shop a day no longer has, a day that
 * emptied) can never survive a rebuild; other barbers' entries stay; the
 * month carries its TTL root `purgeAt` (F1-7, stamped by the commit plan).
 *
 * Emulator-only by construction: refuses to run without a local
 * `FIRESTORE_EMULATOR_HOST`, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-capacity';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const IVAN = BarberId.of('b-ivan');
const PETAR = BarberId.of('b-petar');
const CENTRE = LocationId.of('loc-center');
const GONE = LocationId.of('loc-gone');
/** Monday 3 August 2026, 08:00 on the shop's clock. */
const NOW = utcMs('2026-08-03T08:00:00.000+03:00');
const MONDAY = localDate('2026-08-03');
const AUGUST = CapacityMonthId.of('2026-08');

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
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

function busyDay(day: LocalDate, from: number, to: number): BarberBusyDay {
  return {
    id: BarberBusyDayId.of(BusyKey.of(IVAN, day)),
    barberId: IVAN,
    localDate: day,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(day, FIXTURE_TIME_ZONE),
    blocks: [MinuteBlock.of(minute(from), endMinute(to), BlockKind.Busy)],
  };
}

describe('rebuildCapacity (emulator) — the entries[] replace-not-merge oracle', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await db
      .collection(Collections.Locations)
      .doc(CENTRE)
      .set(bodyOf(locationFixture()));
    await db
      .collection(Collections.BarberSchedules)
      .doc(IVAN)
      .set(bodyOf(barberScheduleFixture({ id: IVAN })));
  });

  function run() {
    return rebuildCapacity({
      commit: firestoreCommitPlan(db),
      nowUtcMs: pinnedNowUtcMs(NOW),
      ...recordingTelemetry(),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([IVAN]),
    });
  }

  const monday = {
    capacityTrigger: CapacityTrigger.Day,
    barberId: IVAN,
    localDate: MONDAY,
    timeZone: FIXTURE_TIME_ZONE,
  } as const;

  async function month(id: CapacityMonthId) {
    return (await db.collection(Collections.Capacity).doc(id).get()).data();
  }

  it('materializes a month from the geometry — busy padded out, Saturday and Sunday off the roster pruned', async () => {
    await db
      .collection(Collections.BarberBusy)
      .doc(BusyKey.of(IVAN, MONDAY))
      .set(bodyOf(busyDay(MONDAY, 600, 660)));
    expect(
      await run()({
        capacityTrigger: CapacityTrigger.Roster,
        barberId: IVAN,
        timeZone: FIXTURE_TIME_ZONE,
      }),
    ).toEqual({ ok: true, value: { rebuiltBarberIds: [IVAN] } });
    const august = await month(AUGUST);
    const entries = august?.['entries'] as readonly CapacityEntry[];
    expect(august?.['month']).toBe(AUGUST);
    // 09:00–18:00 rostered Monday to Friday; Monday 10:00–11:00 busy.
    expect(entries.slice(0, 6)).toEqual([
      entry(MONDAY, IVAN, CENTRE, 480),
      entry(localDate('2026-08-04'), IVAN, CENTRE, 540),
      entry(localDate('2026-08-05'), IVAN, CENTRE, 540),
      entry(localDate('2026-08-06'), IVAN, CENTRE, 540),
      entry(localDate('2026-08-07'), IVAN, CENTRE, 540),
      entry(localDate('2026-08-10'), IVAN, CENTRE, 540),
    ]);
    // Saturday and Sunday: no windows, no entry at all — never a zero.
    expect(
      entries.some(
        (e) => e.localDate === '2026-08-08' || e.localDate === '2026-08-09',
      ),
    ).toBe(false);
    expect(august?.['purgeAt']).toBeDefined();
  });

  it('REPLACES a stale contribution — a ghost shop entry of the day does not survive — and keeps other barbers', async () => {
    await db
      .collection(Collections.Capacity)
      .doc(AUGUST)
      .set({
        month: AUGUST,
        entries: [
          entry(MONDAY, IVAN, GONE, 120),
          entry(MONDAY, PETAR, CENTRE, 300),
        ],
      });
    await run()(monday);
    expect((await month(AUGUST))?.['entries']).toEqual([
      entry(MONDAY, IVAN, CENTRE, 540),
      entry(MONDAY, PETAR, CENTRE, 300),
    ]);
  });

  it('deletes the entry when the day empties, keeping absent-day semantics for the rest of the month', async () => {
    await run()(monday);
    expect((await month(AUGUST))?.['entries']).toEqual([
      entry(MONDAY, IVAN, CENTRE, 540),
    ]);
    // The whole roster window is booked now.
    await db
      .collection(Collections.BarberBusy)
      .doc(BusyKey.of(IVAN, MONDAY))
      .set(bodyOf(busyDay(MONDAY, 540, 1080)));
    await run()(monday);
    const august = await month(AUGUST);
    expect(august?.['entries']).toEqual([]);
    expect(august?.['month']).toBe(AUGUST);
  });

  it('plans one whole-document Set per month — never an update, never a merge', async () => {
    const commit = firestoreCommitPlan(db);
    const kinds: string[] = [];
    await rebuildCapacity({
      commit: (read, decide) =>
        commit(read, (snapshot) => {
          const decision = decide(snapshot);
          if (decision.ok) {
            for (const write of decision.value.writes)
              kinds.push(write.writeAction);
          }
          return decision;
        }),
      nowUtcMs: pinnedNowUtcMs(NOW),
      ...recordingTelemetry(),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      listBarbers: async () => Result.ok([IVAN]),
    })(monday);
    expect(kinds).toEqual([WriteAction.Set]);
  });
});
