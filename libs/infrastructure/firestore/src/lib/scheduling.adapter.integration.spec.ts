import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { firstValueFrom, skip } from 'rxjs';
import { BlockKind, BookingPolicy, MinuteRange } from '@core/components';
import {
  BarberId,
  BusyKey,
  MonthKey,
  ExceptionEffect,
  LocationId,
  Result,
  ScheduleExceptionId,
} from '@core/primitives';
import type { ScheduleException } from '@core/entities';
import { at, localDate, recordingTelemetry, until, utcMs } from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { guardedReads } from './observe';
import { schedulingReadPorts } from './scheduling.adapter';

const IVAN = BarberId.of('ivan');
const MONDAY = BusyKey.of(IVAN, localDate('2026-10-12'));

/** One barber's Monday with `ranges` blocked out. */
function blocked(
  ranges: readonly MinuteRange[] = [MinuteRange.of(at(10), until(11))],
): ScheduleException {
  return {
    id: ScheduleExceptionId.of(MONDAY),
    barberId: IVAN,
    localDate: localDate('2026-10-12'),
    utcEpochMs: utcMs('2026-10-12T00:00:00+03:00'),
    locationId: LocationId.of('loc-center'),
    exceptionEffect: ExceptionEffect.Blocked,
    exceptionRanges: ranges,
    dayBreakRanges: null,
  };
}

function bodyOf(exception: ScheduleException): object {
  const { id, ...body } = exception;
  expect(id).toBe(MONDAY);
  return body;
}

/** The stored busy day — the whole body the busy-day guard admits. */
const BUSY = {
  barberId: 'ivan',
  localDate: '2026-10-12',
  utcEpochMs: utcMs('2026-10-12T00:00:00+03:00'),
  blocks: [{ startMinutes: 600, endMinutes: 645, blockKind: BlockKind.Busy }],
};

describe('schedulingReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;
  // The reads go through the REAL guard, as the composition root binds it
  // (OR-33): every document seeded here is admitted, so nothing is reported.
  let telemetry = recordingTelemetry();

  const readsFor = (context: RulesTestContext) =>
    schedulingReadPorts(modularFirestore(context), guardedReads(telemetry));

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-scheduling');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  afterEach(() => {
    expect(telemetry.lines).toEqual([]);
  });

  beforeEach(async () => {
    telemetry = recordingTelemetry();
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      await setDoc(doc(db, 'barberBusy', MONDAY), BUSY);
      await setDoc(doc(db, 'scheduleExceptions', MONDAY), bodyOf(blocked()));
      await setDoc(doc(db, 'barberSchedules', 'ivan'), {
        turnaroundMinutes: 5,
        versions: [],
      });
      await setDoc(doc(db, 'locations', 'loc-center'), {
        timeZone: 'Europe/Sofia',
        locationStatus: 'ACTIVE',
        sortOrder: 1,
      });
      await setDoc(doc(db, 'capacity', '2026-10'), {
        month: '2026-10',
        entries: [],
      });
    });
  });

  it('lets an anonymous visitor read every stream /book needs, on the first emission', async () => {
    const ports = readsFor(testEnv.unauthenticatedContext());

    const busy = await firstValueFrom(ports.observeBusyDay(MONDAY));
    const exception = await firstValueFrom(ports.observeExceptions(MONDAY));
    const schedule = await firstValueFrom(ports.observeSchedule(IVAN));
    const shop = await firstValueFrom(
      ports.observeLocation(LocationId.of('loc-center')),
    );
    const month = await firstValueFrom(
      ports.observeCapacityMonth(MonthKey.of('2026-10')),
    );

    expect(busy).toEqual(Result.ok({ id: MONDAY, ...BUSY }));
    expect(exception).toEqual(Result.ok(blocked()));
    expect(schedule.ok && schedule.value?.turnaroundMinutes).toBe(5);
    expect(shop.ok && shop.value?.timeZone).toBe('Europe/Sofia');
    expect(month).toEqual(
      Result.ok({ id: '2026-10', month: '2026-10', entries: [] }),
    );
  });

  it('starts the policy on the defaults, then reads the tenant’s document over them', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), 'settings', 'bookingPolicy'), {
        horizonMonths: 6,
      });
    });
    const policy = readsFor(testEnv.unauthenticatedContext()).observePolicy();

    expect(await firstValueFrom(policy)).toEqual(
      Result.ok(BookingPolicy.DEFAULT),
    );
    expect(await firstValueFrom(policy.pipe(skip(1)))).toEqual(
      Result.ok({ ...BookingPolicy.DEFAULT, horizonMonths: 6 }),
    );
  });

  it('RULES: the busy projection and the capacity rollup are world-readable and client-write-closed', async () => {
    const clientDb = modularFirestore(
      testEnv.authenticatedContext('u-georgi', { roles: ['client'] }),
    );

    await expect(
      setDoc(doc(clientDb, 'capacity', '2026-10'), {
        month: '2026-10',
        entries: [],
      }),
    ).rejects.toBeTruthy();
    await expect(
      setDoc(doc(clientDb, 'barberBusy', MONDAY), BUSY),
    ).rejects.toBeTruthy();
  });

  it('RULES: a day exception is world-readable and has no client writer — the barber, the front desk and the admin included (team onboarding O4)', async () => {
    for (const roles of [
      ['client'],
      ['content_manager'],
      ['barber'],
      ['receptionist'],
      ['admin'],
      ['sysadmin'],
    ]) {
      const db = modularFirestore(
        testEnv.authenticatedContext('u-anyone', { roles }),
      );
      const day = doc(db, 'scheduleExceptions', MONDAY);
      await expect(
        setDoc(day, bodyOf(blocked())),
        roles.join(),
      ).rejects.toBeTruthy();
      await expect(deleteDoc(day), roles.join()).rejects.toBeTruthy();
    }
    // Untouched: the day reads back as seeded.
    expect(
      await firstValueFrom(
        readsFor(testEnv.unauthenticatedContext()).observeExceptions(MONDAY),
      ),
    ).toEqual(Result.ok(blocked()));
  });
});
