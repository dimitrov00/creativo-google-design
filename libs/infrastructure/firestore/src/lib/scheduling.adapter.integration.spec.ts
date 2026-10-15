import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firstValueFrom, skip } from 'rxjs';
import { BookingPolicy, MinuteRange } from '@core/components';
import {
  BarberId,
  BusyKey,
  CapacityMonthId,
  ExceptionEffect,
  LocationId,
  RepositoryErrorCode,
  Result,
  ScheduleExceptionId,
} from '@core/primitives';
import type { ScheduleException } from '@core/entities';
import { at, localDate, until, utcMs } from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import {
  scheduleExceptionPorts,
  schedulingReadPorts,
} from './scheduling.adapter';

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
  };
}

function bodyOf(exception: ScheduleException): object {
  const { id, ...body } = exception;
  expect(id).toBe(MONDAY);
  return body;
}

const BUSY = {
  barberId: 'ivan',
  localDate: '2026-10-12',
  utcEpochMs: utcMs('2026-10-12T00:00:00+03:00'),
  blocks: [{ startMinutes: 600, endMinutes: 645 }],
};

describe('schedulingReadPorts and scheduleExceptionPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const readsFor = (context: RulesTestContext) =>
    schedulingReadPorts(modularFirestore(context));
  const writesFor = (context: RulesTestContext) =>
    scheduleExceptionPorts(modularFirestore(context));
  const barber = () =>
    testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] });

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-scheduling');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
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
      ports.observeCapacityMonth(CapacityMonthId.of('2026-10')),
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

  it('writes a barber’s merged block in one transaction, the day reading it back', async () => {
    const merged = blocked([
      MinuteRange.of(at(10), until(11)),
      MinuteRange.of(at(15), until(16)),
    ]);

    const answer = await writesFor(barber()).writeScheduleException(
      [MONDAY],
      (stored) => {
        expect(stored).toEqual([blocked()]);
        return Result.ok([merged]);
      },
    );

    expect(answer).toEqual(Result.ok(undefined));
    expect(
      await firstValueFrom(
        readsFor(testEnv.unauthenticatedContext()).observeExceptions(MONDAY),
      ),
    ).toEqual(Result.ok(merged));
  });

  it('deletes the day the merge empties, and writes nothing on a refusal', async () => {
    const ports = writesFor(barber());

    const refused = await ports.writeScheduleException([MONDAY], () =>
      Result.err({ errorCode: 'REFUSED' } as const),
    );
    expect(refused).toEqual(Result.err({ errorCode: 'REFUSED' }));

    const cleared = await ports.writeScheduleException([MONDAY], () =>
      Result.ok([null]),
    );
    expect(cleared).toEqual(Result.ok(undefined));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(
        doc(modularFirestore(ctx), 'scheduleExceptions', MONDAY),
      );
      expect(snap.exists()).toBe(false);
    });
  });

  it('RULES: a content manager may not touch the roster’s exceptions', async () => {
    const answer = await writesFor(
      testEnv.authenticatedContext('copy-1', { roles: ['content_manager'] }),
    ).writeScheduleException([MONDAY], () => Result.ok([blocked()]));

    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: RepositoryErrorCode.WriteFailed,
      path: 'scheduleExceptions',
    });
  });
});
