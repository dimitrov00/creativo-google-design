import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  BarberStatus,
  BlockReason,
  DayExceptionsEdit,
  type DayExceptionsRequest,
  type DocBody,
  ExceptionEffectRule,
  MinuteRange,
  Role,
  WriteOp,
} from '@core/components';
import {
  BarberId,
  BusyKey,
  ExceptionEffect,
  type LocalDate,
  LocationId,
  OperationId,
  Result,
  ScheduleExceptionId,
  UserId,
} from '@core/primitives';
import {
  AccessErrorCode,
  RepositoryError,
  SchedulingErrorCode,
} from '@core/errors';
import {
  type Barber,
  Collections,
  type ScheduleException,
  type ShopLocation,
  STAFF_PERMISSIONS_DOC,
  type User,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import {
  auditRowsOf,
  barberFixture,
  bodyOf,
  contendedCommit,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  minute,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  type SetDayExceptionsCommand,
  setDayExceptions,
} from './set-day-exceptions.pipeline';

/*
 * `setDayExceptions` (team onboarding D5, O4): the staff schedule's four
 * pens behind one callable. The shops' zones read first; then ONE
 * transaction that reads the caller, the barbers and the days, judges who
 * may on the stored account, runs the pen's own merge and writes the
 * changed days beside ONE row per barber.
 */

const CALLER = UserId.of('u-desk');
const OP = OperationId.of('operation-days-012345678');
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const CENTER = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');
const DAY = localDate('2026-12-24');
const NEXT = localDate('2026-12-25');

/** The hour from `hour` o'clock. */
const wall = (hour: number): MinuteRange =>
  MinuteRange.of(minute(hour * 60), endMinute(hour * 60 + 60));
const keyOf = (barberId: BarberId, day: LocalDate) => BusyKey.of(barberId, day);
const dayPath = (barberId: BarberId, day: LocalDate) => [
  Collections.ScheduleExceptions,
  keyOf(barberId, day),
];
const pathKey = (barberId: BarberId, day: LocalDate) =>
  dayPath(barberId, day).join('/');

/** A day as the pens write it. */
const dayOf = (
  barberId: BarberId,
  day: LocalDate,
  effect: ExceptionEffectRule,
  locationId: LocationId = CENTER,
): ScheduleException => ({
  id: ScheduleExceptionId.of(keyOf(barberId, day)),
  barberId,
  localDate: day,
  utcEpochMs: ZonedTimeSystem.startOfLocalDay(day, FIXTURE_TIME_ZONE),
  locationId,
  ...effect,
  dayBreakRanges: null,
});

/** The front desk: changes any barber's days. */
const DESK: User = registeredUserFixture({
  id: CALLER,
  roles: [Role.Receptionist],
});
/** Ivan's own account. */
const IVAN_ACCOUNT: User = registeredUserFixture({
  id: CALLER,
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});

const PERMISSIONS = [Collections.Settings, STAFF_PERMISSIONS_DOC];
const NOT_STAFF = { errorCode: AccessErrorCode.NotStaff };
const DENIED = {
  errorCode: AccessErrorCode.Denied,
  staffCapability: 'TIME_OFF',
};
const OWN_ONLY = {
  errorCode: AccessErrorCode.OwnOnly,
  staffCapability: 'TIME_OFF',
};

type RigOptions = {
  readonly caller?: User | null;
  /** The stored `settings/staffPermissions` body; none by default — no document. */
  readonly permissions?: DocBody;
  /** The barber records (default Ivan and Niko, both at the centre shop). */
  readonly barbers?: readonly Barber[];
  readonly shops?: readonly ShopLocation[];
  readonly days?: readonly ScheduleException[];
  readonly commit?: (commit: CommitPlan) => CommitPlan;
  /** A location read that fails. */
  readonly locationFailure?: RepositoryError;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? DESK : options.caller;
  const shops = options.shops ?? [
    locationFixture(),
    locationFixture({ id: MLADOST }),
  ];
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...(options.barbers ?? [barberFixture(), barberFixture({ id: NIKO })]).map(
      (barber) => ({
        path: [Collections.Barbers, barber.id],
        body: bodyOf(barber),
      }),
    ),
    ...(options.days ?? []).map((day) => ({
      path: [Collections.ScheduleExceptions, day.id],
      body: bodyOf(day),
    })),
  ]);
  const tx = memoryTxPorts(store);
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  const asked: LocationId[] = [];
  const run = setDayExceptions({
    ...tx,
    commit,
    loadLocation: async (id) => {
      asked.push(id);
      if (options.locationFailure) return Result.err(options.locationFailure);
      return Result.ok(shops.find((shop) => shop.id === id) ?? null);
    },
  });
  return { store, tx, asked, run };
}

const call = (
  request: DayExceptionsRequest,
  extra: Partial<SetDayExceptionsCommand> = {},
): SetDayExceptionsCommand =>
  ({
    callerUserId: CALLER,
    operationId: OP,
    ...request,
    ...extra,
  }) as SetDayExceptionsCommand;

const block = (
  localDates: readonly LocalDate[],
  ranges: readonly MinuteRange[] = [],
  barberId: BarberId = IVAN,
  locationId: LocationId = CENTER,
): DayExceptionsRequest.Block => ({
  dayExceptionsEdit: DayExceptionsEdit.Block,
  barberId,
  locationId,
  ranges,
  localDates,
});

describe('setDayExceptions', () => {
  describe('a block', () => {
    it('stands a day down whole: the day SET, beside ONE row on the barber — in one plan', async () => {
      const { store, tx, run } = rig();
      const answer = await run(call(block([DAY])));
      expect(answer).toEqual(Result.ok({ barberIds: [IVAN] }));
      // The callable answers this value as it is: exactly the wire's keys.
      expect(Object.keys(unwrapOk(answer))).toEqual(['barberIds']);

      const closed = dayOf(IVAN, DAY, ExceptionEffectRule.closed());
      expect(tx.plans).toHaveLength(1);
      expect(tx.plans[0]?.[0]).toEqual(
        WriteOp.set(dayPath(IVAN, DAY), bodyOf(closed)),
      );
      expect(store.get(pathKey(IVAN, DAY))).toEqual(bodyOf(closed));
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(tx.plans[0]).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        auditAction: 'TEAM_DAY_EXCEPTIONS_CHANGED',
        resourceId: `barbers/${IVAN}`,
        auditOperationId: OP,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        ...Actor.forCaller(CALLER, [Role.Receptionist]),
        dayExceptionsEdit: 'BLOCK',
        dayExceptionsFromLocalDate: DAY,
        dayExceptionsToLocalDate: DAY,
        dayExceptionsDayCount: 1,
      });
    });

    it('reads the shop’s zone first, then the caller, the owner’s cells, the barber and the day inside one transaction', async () => {
      const { tx, asked, run } = rig();
      await run(call(block([DAY, NEXT])));
      expect(asked).toEqual([CENTER]);
      expect(tx.transactions).toHaveLength(1);
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, CALLER],
        PERMISSIONS,
        [Collections.Barbers, IVAN],
        dayPath(IVAN, DAY),
        dayPath(IVAN, NEXT),
      ]);
    });

    it('writes a series in one commit with ONE row spanning its days', async () => {
      const days = [DAY, NEXT, localDate('2026-12-31')];
      const { store, tx, run } = rig();
      await run(call(block(days, [wall(13)])));
      expect(tx.plans).toHaveLength(1);
      for (const day of days) {
        expect(store.get(pathKey(IVAN, day))).toMatchObject({
          exceptionEffect: ExceptionEffect.Blocked,
          exceptionRanges: [wall(13)],
        });
      }
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        dayExceptionsFromLocalDate: DAY,
        dayExceptionsToLocalDate: '2026-12-31',
        dayExceptionsDayCount: 3,
      });
    });

    it('merges a range into the blocks a day already holds — the pen’s own arithmetic', async () => {
      const { store, run } = rig({
        days: [
          dayOf(IVAN, DAY, unwrapOk(ExceptionEffectRule.blocked([wall(10)]))),
        ],
      });
      await run(call(block([DAY], [wall(13)])));
      expect(store.get(pathKey(IVAN, DAY))?.['exceptionRanges']).toEqual([
        wall(10),
        wall(13),
      ]);
    });

    it('writes nothing for a day that already says so — and so for the replay of an act that landed', async () => {
      const { store, tx, run } = rig();
      await run(call(block([DAY])));
      const written = store.get(pathKey(IVAN, DAY));
      expect(await run(call(block([DAY])))).toEqual(
        Result.ok({ barberIds: [IVAN] }),
      );
      expect(tx.plans[1]).toEqual([]);
      expect(store.get(pathKey(IVAN, DAY))).toEqual(written);
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
    });

    it('refuses a range that leaves a day nothing to block, and writes nothing', async () => {
      const { tx, run } = rig({
        days: [dayOf(IVAN, DAY, ExceptionEffectRule.closed())],
      });
      // Lifting a range from a day off whole is the pen's own refusal.
      const refused = await run(
        call({
          dayExceptionsEdit: DayExceptionsEdit.Clear,
          barberId: IVAN,
          localDate: DAY,
          range: wall(10),
        }),
      );
      expect(unwrapErr(refused).errorCode).toBe(
        SchedulingErrorCode.ScheduleExceptionEmptyRanges,
      );
      expect(tx.plans).toEqual([]);
    });
  });

  describe('the other pens', () => {
    it('clears a whole day: the document removed beside its row; no shop is read', async () => {
      const { store, tx, asked, run } = rig({
        days: [dayOf(IVAN, DAY, ExceptionEffectRule.closed())],
      });
      await run(
        call({
          dayExceptionsEdit: DayExceptionsEdit.Clear,
          barberId: IVAN,
          localDate: DAY,
          range: null,
        }),
      );
      expect(asked).toEqual([]);
      expect(tx.plans[0]?.[0]).toEqual(WriteOp.remove(dayPath(IVAN, DAY)));
      expect(store.has(pathKey(IVAN, DAY))).toBe(false);
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        dayExceptionsEdit: 'CLEAR',
        dayExceptionsDayCount: 1,
      });
    });

    it('moves a block onto another barber in ONE commit: the old range lifted, the new day written, one row each', async () => {
      const { store, tx, run } = rig({
        days: [
          dayOf(IVAN, DAY, unwrapOk(ExceptionEffectRule.blocked([wall(10)]))),
        ],
      });
      const answer = await run(
        call({
          dayExceptionsEdit: DayExceptionsEdit.Move,
          liftBarberId: IVAN,
          liftLocalDate: DAY,
          liftRange: wall(10),
          writes: [
            {
              barberId: NIKO,
              locationId: CENTER,
              ranges: [wall(11)],
              localDates: [DAY],
            },
          ],
        }),
      );
      expect(answer).toEqual(Result.ok({ barberIds: [IVAN, NIKO] }));
      expect(tx.plans).toHaveLength(1);
      expect(store.has(pathKey(IVAN, DAY))).toBe(false);
      expect(store.get(pathKey(NIKO, DAY))?.['exceptionRanges']).toEqual([
        wall(11),
      ]);
      const rows = auditRowsOf(tx.plans);
      expect(rows.map((row) => row.resourceId)).toEqual([
        `barbers/${IVAN}`,
        `barbers/${NIKO}`,
      ]);
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, CALLER],
        PERMISSIONS,
        [Collections.Barbers, IVAN],
        [Collections.Barbers, NIKO],
        dayPath(IVAN, DAY),
        dayPath(NIKO, DAY),
      ]);
    });

    it('says a day’s breaks for that day alone, and hands the day back to the roster', async () => {
      const { store, tx, run } = rig();
      const breaks = (
        ranges: readonly MinuteRange[] | null,
        operationId: OperationId,
      ) =>
        run(
          call(
            {
              dayExceptionsEdit: DayExceptionsEdit.DayBreaks,
              barberId: IVAN,
              locationId: CENTER,
              localDate: DAY,
              ranges,
            },
            { operationId },
          ),
        );
      await breaks([wall(14)], OP);
      expect(store.get(pathKey(IVAN, DAY))).toMatchObject({
        exceptionEffect: ExceptionEffect.Rostered,
        dayBreakRanges: [wall(14)],
      });
      await breaks(null, OperationId.of('operation-days-back00001'));
      expect(store.has(pathKey(IVAN, DAY))).toBe(false);
      expect(
        auditRowsOf(tx.plans).map((row) =>
          'dayExceptionsEdit' in row ? row.dayExceptionsEdit : null,
        ),
      ).toEqual(['DAY_BREAKS', 'DAY_BREAKS']);
    });
  });

  describe('who may', () => {
    it('lets a barber change their own days — the record their stored account is linked to', async () => {
      const { tx, run } = rig({ caller: IVAN_ACCOUNT });
      expect((await run(call(block([DAY])))).ok).toBe(true);
      expect(auditRowsOf(tx.plans)[0]).toMatchObject(
        Actor.forCaller(CALLER, [Role.Barber]),
      );
    });

    it('refuses a barber a colleague’s days — a block, a clear, and a move onto them — nothing written', async () => {
      const refused: readonly DayExceptionsRequest[] = [
        block([DAY], [], NIKO),
        {
          dayExceptionsEdit: DayExceptionsEdit.Clear,
          barberId: NIKO,
          localDate: DAY,
          range: null,
        },
        {
          dayExceptionsEdit: DayExceptionsEdit.Move,
          liftBarberId: IVAN,
          liftLocalDate: DAY,
          liftRange: wall(10),
          writes: [
            {
              barberId: NIKO,
              locationId: CENTER,
              ranges: [wall(11)],
              localDates: [DAY],
            },
          ],
        },
      ];
      for (const request of refused) {
        const { store, tx, run } = rig({
          caller: IVAN_ACCOUNT,
          days: [
            dayOf(IVAN, DAY, unwrapOk(ExceptionEffectRule.blocked([wall(10)]))),
            dayOf(NIKO, DAY, ExceptionEffectRule.closed()),
          ],
        });
        expect(unwrapErr(await run(call(request)))).toEqual(OWN_ONLY);
        expect(tx.plans).toEqual([]);
        expect(store.has(pathKey(IVAN, DAY))).toBe(true);
        expect(store.has(pathKey(NIKO, DAY))).toBe(true);
      }
    });

    it('follows the owner’s cells: barbers let into each other’s days move a block onto a colleague; a narrowed level is refused', async () => {
      const move: DayExceptionsRequest = {
        dayExceptionsEdit: DayExceptionsEdit.Move,
        liftBarberId: IVAN,
        liftLocalDate: DAY,
        liftRange: wall(10),
        writes: [
          {
            barberId: NIKO,
            locationId: CENTER,
            ranges: [wall(11)],
            localDates: [DAY],
          },
        ],
      };
      const days = [
        dayOf(IVAN, DAY, unwrapOk(ExceptionEffectRule.blocked([wall(10)]))),
      ];
      // Widened: the owner lets barbers block time for each other.
      const widened = rig({
        caller: IVAN_ACCOUNT,
        days,
        permissions: { barberTimeOffScope: 'ALL' },
      });
      expect((await widened.run(call(move))).ok).toBe(true);
      expect(widened.store.has(pathKey(NIKO, DAY))).toBe(true);

      // Narrowed: the front desk, and a barber's own days.
      const desk = rig({ permissions: { receptionistTimeOffScope: 'NONE' } });
      expect(unwrapErr(await desk.run(call(block([DAY]))))).toEqual(DENIED);
      expect(desk.tx.plans).toEqual([]);
      const own = rig({
        caller: IVAN_ACCOUNT,
        permissions: { barberTimeOffScope: 'NONE' },
      });
      expect(unwrapErr(await own.run(call(block([DAY]))))).toEqual(DENIED);

      // A cell nobody could save refuses its level; the admin is admitted still.
      const permissions = { receptionistTimeOffScope: 'EVERYONE' };
      expect(
        unwrapErr(await rig({ permissions }).run(call(block([DAY])))),
      ).toEqual(DENIED);
      const admin = rig({
        permissions,
        caller: registeredUserFixture({ id: CALLER, roles: [Role.Admin] }),
      });
      expect((await admin.run(call(block([DAY])))).ok).toBe(true);
    });

    it('refuses the content editor, a blocked account and one that is gone', async () => {
      const refused: [User | null, object][] = [
        [
          registeredUserFixture({ id: CALLER, roles: [Role.ContentManager] }),
          DENIED,
        ],
        [
          registeredUserFixture({
            id: CALLER,
            roles: [Role.Admin],
            ...AccountLifecycle.block(BlockReason.Manual, null),
          }),
          NOT_STAFF,
        ],
        [null, NOT_STAFF],
      ];
      for (const [caller, refusal] of refused) {
        const { tx, run } = rig({ caller });
        expect(unwrapErr(await run(call(block([DAY]))))).toEqual(refusal);
        expect(tx.plans).toEqual([]);
      }
    });

    it('refuses days for an id with no barber record, and for a barber who has left', async () => {
      const missing = rig({ barbers: [] });
      expect(unwrapErr(await missing.run(call(block([DAY]))))).toEqual({
        errorCode: SchedulingErrorCode.RosterInvalidInput,
        field: 'barberId',
      });
      const left = rig({
        barbers: [
          barberFixture(
            {},
            {
              barberStatus: BarberStatus.Departed,
              barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
              barberDepartedUserId: null,
              barberSessionsRevokedAtUtcMs: null,
              barberRehireStatus: BarberStatus.Public,
            },
          ),
        ],
      });
      expect(unwrapErr(await left.run(call(block([DAY]))))).toEqual({
        errorCode: SchedulingErrorCode.RosterDeparted,
        barberId: IVAN,
      });
      expect([...missing.tx.plans, ...left.tx.plans]).toEqual([]);
    });
  });

  describe('where', () => {
    it('refuses a day filed at a shop the barber does not work at, naming it', async () => {
      const { tx, run } = rig();
      expect(
        unwrapErr(await run(call(block([DAY], [], IVAN, MLADOST)))),
      ).toEqual({
        errorCode: SchedulingErrorCode.RosterOutsideShops,
        locationId: MLADOST,
      });
      expect(tx.plans).toEqual([]);
    });

    it('files a day at any shop for a barber of every shop', async () => {
      const { store, run } = rig({
        barbers: [barberFixture({ locationIds: [] })],
      });
      expect((await run(call(block([DAY], [], IVAN, MLADOST)))).ok).toBe(true);
      expect(store.get(pathKey(IVAN, DAY))?.['locationId']).toBe(MLADOST);
    });

    it('refuses a shop that is not there before any transaction, and answers a failed read as it failed', async () => {
      const gone = rig({ shops: [] });
      expect(unwrapErr(await gone.run(call(block([DAY]))))).toEqual({
        errorCode: SchedulingErrorCode.RosterInvalidInput,
        field: 'locationId',
      });
      expect(gone.tx.transactions).toHaveLength(0);

      const failure = RepositoryError.readFailed('locations/x', 'unavailable');
      const failed = rig({ locationFailure: failure });
      expect(unwrapErr(await failed.run(call(block([DAY]))))).toEqual(failure);
      expect(failed.tx.transactions).toHaveLength(0);
    });
  });

  it('derives the same plan when the transaction re-runs (contention)', async () => {
    let decisions: readonly (readonly WriteOp[])[] = [];
    const { tx, run } = rig({
      commit: (commit) => {
        const contended = contendedCommit(commit);
        decisions = contended.decisions;
        return contended.commit;
      },
    });
    await run(call(block([DAY, NEXT], [wall(13)])));
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toEqual(decisions[1]);
    expect(tx.plans).toEqual([decisions[1]]);
  });
});
