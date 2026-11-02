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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firstValueFrom, skip } from 'rxjs';
import { BlockKind, BookingPolicy, MinuteRange } from '@core/components';
import {
  BarberId,
  BusyKey,
  CapacityMonthId,
  ExceptionEffect,
  LocationId,
  Result,
  ScheduleExceptionId,
} from '@core/primitives';
import { RepositoryErrorCode, SchedulingErrorCode } from '@core/errors';
import type { ScheduleException } from '@core/entities';
import { moveScheduleBlock } from '@core/pipelines';
import {
  FIXTURE_TIME_ZONE,
  at,
  localDate,
  recordingTelemetry,
  until,
  utcMs,
} from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { guardedReads } from './observe';
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

/** The stored busy day — the whole body the busy-day guard admits. */
const BUSY = {
  barberId: 'ivan',
  localDate: '2026-10-12',
  utcEpochMs: utcMs('2026-10-12T00:00:00+03:00'),
  blocks: [{ startMinutes: 600, endMinutes: 645, blockKind: BlockKind.Busy }],
};

describe('schedulingReadPorts and scheduleExceptionPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;
  // The reads go through the REAL guard, as the composition root binds it
  // (OR-33): every document seeded here is admitted, so nothing is reported.
  let telemetry = recordingTelemetry();

  const readsFor = (context: RulesTestContext) =>
    schedulingReadPorts(modularFirestore(context), guardedReads(telemetry));
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

  describe('moveScheduleBlock, an edited block in one real transaction', () => {
    const SHOP = LocationId.of('loc-center');
    const NIKO = BarberId.of('niko');
    const MONDAY_DAY = localDate('2026-10-12');
    const TUESDAY_DAY = localDate('2026-10-13');
    const TUESDAY = BusyKey.of(IVAN, TUESDAY_DAY);
    const NIKOS_MONDAY = BusyKey.of(NIKO, MONDAY_DAY);
    const OLD = MinuteRange.of(at(10), until(11));
    const NEW = MinuteRange.of(at(14), until(15));
    const lift = { barberId: IVAN, localDate: MONDAY_DAY, range: OLD };
    const write = (
      ranges: readonly MinuteRange[],
      localDates: readonly ReturnType<typeof localDate>[],
      barberId = IVAN,
    ) => ({
      barberId,
      locationId: SHOP,
      timeZone: FIXTURE_TIME_ZONE,
      ranges,
      localDates,
    });
    /** A day's stored body, read past the rules. */
    const storedDay = async (key: BusyKey) => {
      let body: object | undefined;
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDoc(
          doc(modularFirestore(ctx), 'scheduleExceptions', key),
        );
        body = snap.data();
      });
      return body;
    };
    const blockedBody = (
      barberId: BarberId,
      day: ReturnType<typeof localDate>,
      utc: string,
      range: MinuteRange,
    ) => ({
      barberId,
      localDate: day,
      utcEpochMs: utcMs(utc),
      locationId: SHOP,
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range],
    });
    const OLD_BODY = blockedBody(
      IVAN,
      MONDAY_DAY,
      '2026-10-12T00:00:00+03:00',
      OLD,
    );

    it('moves a block inside its day, on one document', async () => {
      const answer = await moveScheduleBlock(writesFor(barber()))({
        lift,
        writes: [write([NEW], [MONDAY_DAY])],
      });
      expect(answer).toEqual(Result.ok(undefined));
      expect(await storedDay(MONDAY)).toEqual(
        blockedBody(IVAN, MONDAY_DAY, '2026-10-12T00:00:00+03:00', NEW),
      );
    });

    it('moves a block to another day: the old day deleted, the new one written', async () => {
      const answer = await moveScheduleBlock(writesFor(barber()))({
        lift,
        writes: [write([NEW], [TUESDAY_DAY])],
      });
      expect(answer).toEqual(Result.ok(undefined));
      expect(await storedDay(MONDAY)).toBeUndefined();
      expect(await storedDay(TUESDAY)).toEqual(
        blockedBody(IVAN, TUESDAY_DAY, '2026-10-13T00:00:00+03:00', NEW),
      );
    });

    it('moves a block across two chairs in one write', async () => {
      const answer = await moveScheduleBlock(writesFor(barber()))({
        lift,
        writes: [write([NEW], [MONDAY_DAY]), write([NEW], [MONDAY_DAY], NIKO)],
      });
      expect(answer).toEqual(Result.ok(undefined));
      expect(await storedDay(MONDAY)).toEqual(
        blockedBody(IVAN, MONDAY_DAY, '2026-10-12T00:00:00+03:00', NEW),
      );
      expect(await storedDay(NIKOS_MONDAY)).toEqual(
        blockedBody(NIKO, MONDAY_DAY, '2026-10-12T00:00:00+03:00', NEW),
      );
    });

    it('leaves the old block intact when the decision refuses a written day', async () => {
      // A range with no minute in it is no block: the merge refuses it.
      const answer = await moveScheduleBlock(writesFor(barber()))({
        lift,
        writes: [write([MinuteRange.of(at(14), until(14))], [TUESDAY_DAY])],
      });
      expect(answer.ok).toBe(false);
      expect(!answer.ok && answer.error.errorCode).toBe(
        SchedulingErrorCode.ScheduleExceptionEmptyRanges,
      );
      expect(await storedDay(MONDAY)).toEqual(OLD_BODY);
      expect(await storedDay(TUESDAY)).toBeUndefined();
    });

    it('leaves the old block intact when the rules refuse the write', async () => {
      const answer = await moveScheduleBlock(
        writesFor(
          testEnv.authenticatedContext('copy-1', {
            roles: ['content_manager'],
          }),
        ),
      )({ lift, writes: [write([NEW], [TUESDAY_DAY])] });
      expect(answer.ok).toBe(false);
      expect(!answer.ok && answer.error.errorCode).toBe(
        RepositoryErrorCode.WriteFailed,
      );
      expect(await storedDay(MONDAY)).toEqual(OLD_BODY);
      expect(await storedDay(TUESDAY)).toBeUndefined();
    });
  });
});
