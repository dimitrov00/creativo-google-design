import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BarberStatus,
  BlockReason,
  MinuteRange,
  Role,
  RosterBreak,
  ShiftSegment,
  WriteOp,
} from '@core/components';
import { type Barber, Collections, type User } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import {
  BarberId,
  LocationId,
  OperationId,
  UserId,
  Weekday,
} from '@core/primitives';
import {
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
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
  type SetRosterWeekCommand,
  setRosterWeek,
} from './set-roster-week.pipeline';

/*
 * The hours editor's save — ONE transaction: the caller's account, the
 * barber record, the roster and the shop read; who may judged on the
 * stored account (team onboarding D5: the front desk and the owners any
 * barber's, a barber only their own); the week judged and standing from
 * the day on; the roster written whole, stamped with the act. The fixture
 * clock reads 2026-09-28 at the fixture shop.
 */

const CALLER = UserId.of('u-desk');
const OP = OperationId.of('operation-hours-01234567');
const IVAN = FIXTURE_IDS.barber;
const CENTER = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');
const ROSTER = [Collections.BarberSchedules, IVAN];
const SHOP = [Collections.Locations, CENTER];
const MONDAY = ShiftSegment.of(
  Weekday.Mon,
  CENTER,
  minute(540),
  endMinute(1080),
);
const LUNCH = RosterBreak.of(
  Weekday.Mon,
  MinuteRange.of(minute(780), endMinute(840)),
);

/** The front desk: edits any barber's hours. */
const DESK: User = registeredUserFixture({
  id: CALLER,
  roles: [Role.Receptionist],
});
const DEPARTED: Barber = barberFixture(
  {},
  {
    barberStatus: BarberStatus.Departed,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDepartedUserId: null,
    barberSessionsRevokedAtUtcMs: null,
    barberRehireStatus: BarberStatus.Public,
  },
);

type RigOptions = {
  readonly caller?: User | null;
  /** The barber record (default Ivan, at the centre shop); `null`: none. */
  readonly barber?: Barber | null;
  readonly withRoster?: boolean;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? DESK : options.caller;
  const barber =
    options.barber === undefined ? barberFixture() : options.barber;
  const store = memoryStore([
    { path: SHOP, body: bodyOf(locationFixture()) },
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...(barber === null
      ? []
      : [{ path: [Collections.Barbers, barber.id], body: bodyOf(barber) }]),
    ...(options.withRoster === false
      ? []
      : [{ path: ROSTER, body: bodyOf(barberScheduleFixture()) }]),
  ]);
  const tx = memoryTxPorts(store);
  return { store, tx, run: setRosterWeek(tx) };
}

const week: SetRosterWeekCommand = {
  barberId: IVAN,
  locationId: CENTER,
  fromLocalDate: localDate('2026-09-28'),
  segments: [MONDAY],
  breaks: [LUNCH],
  callerUserId: CALLER,
  operationId: OP,
};

describe('setRosterWeek', () => {
  it('writes the roster whole, the week standing from the day on, stamped with the act', async () => {
    const { tx, store, run } = rig();
    expect(unwrapOk(await run(week))).toEqual({ barberId: IVAN });
    expect(tx.plans).toHaveLength(1);
    expect(tx.plans[0]).toEqual([
      WriteOp.set(ROSTER, {
        turnaroundMinutes: barberScheduleFixture().turnaroundMinutes,
        versions: expect.any(Array),
        writeOperationId: OP,
      }),
    ]);
    const versions = store.get(ROSTER.join('/'))?.['versions'] as readonly {
      readonly effectiveFromLocalDate: string;
      readonly breaks: readonly unknown[];
    }[];
    expect(versions.map((v) => v.effectiveFromLocalDate)).toEqual([
      '2026-01-01',
      '2026-09-28',
    ]);
    expect(versions[1]?.breaks).toEqual([LUNCH]);
  });

  it('reads the caller’s account, the barber record, the roster and the shop — in one round trip', async () => {
    const { tx, run } = rig();
    await run(week);
    expect(tx.transactions).toHaveLength(1);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, CALLER],
      [Collections.Barbers, IVAN],
      ROSTER,
      SHOP,
    ]);
  });

  it('starts a roster for a chair with none', async () => {
    const { store, run } = rig({ withRoster: false });
    unwrapOk(await run(week));
    expect(store.get(ROSTER.join('/'))).toMatchObject({
      turnaroundMinutes: 0,
      writeOperationId: OP,
    });
  });

  it('refuses a break outside the shifts, and writes nothing', async () => {
    const { tx, run } = rig();
    const refused = await run({
      ...week,
      breaks: [
        RosterBreak.of(
          Weekday.Tue,
          MinuteRange.of(minute(780), endMinute(840)),
        ),
      ],
    });
    expect(unwrapErr(refused).errorCode).toBe(
      SchedulingErrorCode.RosterBreakOutsideShift,
    );
    expect(tx.plans).toEqual([]);
  });

  describe('who may', () => {
    it('lets a barber save their own hours — the record their stored account is linked to', async () => {
      const { tx, run } = rig({
        caller: registeredUserFixture({
          id: CALLER,
          roles: [Role.Barber],
          linkedBarberId: IVAN,
        }),
      });
      expect((await run(week)).ok).toBe(true);
      expect(tx.plans).toHaveLength(1);
    });

    it('refuses a barber a colleague’s hours, an unlinked barber, the content editor, a blocked account and one that is gone — nothing written', async () => {
      const refused: readonly (User | null)[] = [
        registeredUserFixture({
          id: CALLER,
          roles: [Role.Barber],
          linkedBarberId: BarberId.of('niko'),
        }),
        registeredUserFixture({ id: CALLER, roles: [Role.Barber] }),
        registeredUserFixture({ id: CALLER, roles: [Role.ContentManager] }),
        registeredUserFixture({
          id: CALLER,
          roles: [Role.Admin],
          ...AccountLifecycle.block(BlockReason.Manual, null),
        }),
        null,
      ];
      for (const caller of refused) {
        const { tx, store, run } = rig({ caller });
        expect(unwrapErr(await run(week))).toEqual({
          errorCode: SchedulingErrorCode.RosterForbidden,
        });
        expect(tx.plans).toEqual([]);
        expect(store.get(ROSTER.join('/'))).toEqual(
          bodyOf(barberScheduleFixture()),
        );
      }
    });

    it('refuses hours for an id with no barber record, and for a barber who has left', async () => {
      const missing = rig({ barber: null });
      expect(unwrapErr(await missing.run(week))).toEqual({
        errorCode: SchedulingErrorCode.RosterInvalidInput,
        field: 'barberId',
      });
      const left = rig({ barber: DEPARTED });
      expect(unwrapErr(await left.run(week))).toEqual({
        errorCode: SchedulingErrorCode.RosterDeparted,
        barberId: IVAN,
      });
      expect([...missing.tx.plans, ...left.tx.plans]).toEqual([]);
    });
  });

  describe('where', () => {
    const friday = ShiftSegment.of(
      Weekday.Fri,
      MLADOST,
      minute(540),
      endMinute(1080),
    );

    it('refuses a shift at a shop the barber does not work at, naming it — and writes nothing', async () => {
      const { tx, run } = rig();
      expect(
        unwrapErr(
          await run({ ...week, segments: [MONDAY, friday], breaks: [] }),
        ),
      ).toEqual({
        errorCode: SchedulingErrorCode.RosterOutsideShops,
        locationId: MLADOST,
      });
      expect(tx.plans).toEqual([]);
    });

    it('takes a shift at any shop for a barber of every shop, and at each of a barber’s two', async () => {
      for (const locationIds of [[], [CENTER, MLADOST]]) {
        const { tx, run } = rig({ barber: barberFixture({ locationIds }) });
        expect(
          (await run({ ...week, segments: [MONDAY, friday], breaks: [] })).ok,
        ).toBe(true);
        expect(tx.plans).toHaveLength(1);
      }
    });
  });
});
