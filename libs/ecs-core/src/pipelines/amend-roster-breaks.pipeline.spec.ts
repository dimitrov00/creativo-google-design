import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  type DocBody,
  MinuteRange,
  Role,
  RosterBreak,
  WriteOp,
} from '@core/components';
import {
  type Barber,
  Collections,
  STAFF_PERMISSIONS_DOC,
  type User,
} from '@core/entities';
import { AccessErrorCode, SchedulingErrorCode } from '@core/errors';
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
  type AmendRosterBreaksCommand,
  amendRosterBreaks,
} from './amend-roster-breaks.pipeline';

/*
 * A chair's standing breaks changed «from this day on» — ONE transaction:
 * the caller's account and the owner's cells, the barber record, the
 * roster and the shop read; who may judged on the stored account against
 * `HOURS` (staff permissions P6); the versions
 * revised from the day on by `RosterBreakSystem.amend`; the roster's
 * `versions` written whole, stamped with the act. The fixture clock reads
 * 2026-09-28 (a Monday) at the fixture shop.
 */

const CALLER = UserId.of('u-desk');
const OP = OperationId.of('operation-break-01234567');
const IVAN = FIXTURE_IDS.barber;
const LUNCH = MinuteRange.of(minute(780), endMinute(840));
const ROSTER = [Collections.BarberSchedules, IVAN];
const SHOP = [Collections.Locations, FIXTURE_IDS.location];

/** The front desk: changes any barber's breaks. */
const DESK: User = registeredUserFixture({
  id: CALLER,
  roles: [Role.Receptionist],
});

const PERMISSIONS = [Collections.Settings, STAFF_PERMISSIONS_DOC];
const DENIED = { errorCode: AccessErrorCode.Denied, staffCapability: 'HOURS' };

type RigOptions = {
  readonly caller?: User | null;
  /** The stored `settings/staffPermissions` body; none by default — no document. */
  readonly permissions?: DocBody;
  readonly barber?: Barber | null;
  readonly withRoster?: boolean;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? DESK : options.caller;
  const barber =
    options.barber === undefined ? barberFixture() : options.barber;
  const store = memoryStore([
    { path: SHOP, body: bodyOf(locationFixture()) },
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
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
  return { store, tx, run: amendRosterBreaks(tx) };
}

const weekdayLunch: AmendRosterBreaksCommand = {
  barberId: IVAN,
  locationId: FIXTURE_IDS.location,
  fromLocalDate: localDate('2026-09-28'),
  weekdays: [Weekday.Mon, Weekday.Tue, Weekday.Wed, Weekday.Thu, Weekday.Fri],
  before: null,
  after: LUNCH,
  callerUserId: CALLER,
  operationId: OP,
};

describe('amendRosterBreaks', () => {
  it('adds a weekday lunch from today on in ONE roster write, stamped with the act', async () => {
    const { tx, run } = rig();
    expect(unwrapOk(await run(weekdayLunch))).toEqual({ barberId: IVAN });
    expect(tx.plans).toHaveLength(1);
    const [write] = tx.plans[0] as readonly WriteOp[];
    expect(write).toEqual(
      WriteOp.update(ROSTER, {
        versions: expect.any(Array),
        writeOperationId: OP,
      }),
    );
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, CALLER],
      PERMISSIONS,
      [Collections.Barbers, IVAN],
      ROSTER,
      SHOP,
    ]);
  });

  it('keeps the weeks before the day as they were', async () => {
    const { store, run } = rig();
    unwrapOk(await run(weekdayLunch));
    const versions = store.get(ROSTER.join('/'))?.['versions'] as readonly {
      readonly effectiveFromLocalDate: string;
      readonly breaks: readonly RosterBreak[];
    }[];
    expect(versions.map((v) => v.effectiveFromLocalDate)).toEqual([
      '2026-01-01',
      '2026-09-28',
    ]);
    expect(versions[0]?.breaks).toEqual([]);
    expect(versions[1]?.breaks).toHaveLength(5);
  });

  it('refuses a day already past at the shop, and writes nothing', async () => {
    const { tx, run } = rig();
    const refused = await run({
      ...weekdayLunch,
      fromLocalDate: localDate('2026-09-27'),
    });
    expect(unwrapErr(refused).errorCode).toBe(
      SchedulingErrorCode.RosterBreakInPast,
    );
    expect(tx.plans).toEqual([]);
  });

  it('refuses a chair with no roster, and a shop that is not there', async () => {
    expect(
      unwrapErr(await rig({ withRoster: false }).run(weekdayLunch)).errorCode,
    ).toBe(SchedulingErrorCode.RosterMissing);
    expect(
      unwrapErr(
        await rig().run({
          ...weekdayLunch,
          locationId: LocationId.of('loc-gone'),
        }),
      ).errorCode,
    ).toBe(SchedulingErrorCode.RosterInvalidInput);
  });

  describe('who may', () => {
    it('lets a barber change their own breaks, and refuses them a colleague’s — nothing written', async () => {
      const own = rig({
        caller: registeredUserFixture({
          id: CALLER,
          roles: [Role.Barber],
          linkedBarberId: IVAN,
        }),
      });
      expect((await own.run(weekdayLunch)).ok).toBe(true);

      const refused: [User | null, object][] = [
        [
          registeredUserFixture({
            id: CALLER,
            roles: [Role.Barber],
            linkedBarberId: BarberId.of('niko'),
          }),
          { errorCode: AccessErrorCode.OwnOnly, staffCapability: 'HOURS' },
        ],
        [
          registeredUserFixture({ id: CALLER, roles: [Role.ContentManager] }),
          DENIED,
        ],
        [null, { errorCode: AccessErrorCode.NotStaff }],
      ];
      for (const [caller, refusal] of refused) {
        const { tx, run } = rig({ caller });
        expect(unwrapErr(await run(weekdayLunch))).toEqual(refusal);
        expect(tx.plans).toEqual([]);
      }
    });

    it('follows the owner’s cells — the same `HOURS` capability as the week: narrowed is refused, widened admitted', async () => {
      const narrowed = rig({ permissions: { receptionistHoursScope: 'NONE' } });
      expect(unwrapErr(await narrowed.run(weekdayLunch))).toEqual(DENIED);
      expect(narrowed.tx.plans).toEqual([]);
      const widened = rig({
        caller: registeredUserFixture({
          id: CALLER,
          roles: [Role.Barber],
          linkedBarberId: BarberId.of('niko'),
        }),
        permissions: { barberHoursScope: 'ALL' },
      });
      expect((await widened.run(weekdayLunch)).ok).toBe(true);
    });

    it('refuses an id with no barber record, and a barber who has left', async () => {
      expect(unwrapErr(await rig({ barber: null }).run(weekdayLunch))).toEqual({
        errorCode: SchedulingErrorCode.RosterInvalidInput,
        field: 'barberId',
      });
      const left = rig({
        barber: barberFixture(
          {},
          {
            barberStatus: BarberStatus.Departed,
            barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
            barberDepartedUserId: null,
            barberSessionsRevokedAtUtcMs: null,
            barberRehireStatus: BarberStatus.Public,
          },
        ),
      });
      expect(unwrapErr(await left.run(weekdayLunch))).toEqual({
        errorCode: SchedulingErrorCode.RosterDeparted,
        barberId: IVAN,
      });
      expect(left.tx.plans).toEqual([]);
    });
  });
});
