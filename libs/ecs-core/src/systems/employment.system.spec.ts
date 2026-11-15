import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  BarberLifecycle,
  BarberStatus,
  BookingLifecycle,
  EmploymentOutlook,
  LeftoverBookings,
  Role,
  ScheduleVersion,
  SystemSource,
  WriteAction,
  type WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  OperationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  BARBER_LINK_DOC,
  type Barber,
  type BarberLink,
  Collections,
  Subcollections,
} from '@core/entities';
import {
  appointmentFixture,
  barberBusyDayFixture,
  barberFixture,
  barberScheduleFixture,
  deepFreeze,
  FIXTURE_NOW_UTC_MS,
  localDate,
  minute,
  registeredUserFixture,
  unwrapOk,
} from '@core/testing';
import {
  type EmploymentContext,
  type EmploymentFacts,
  EmploymentSystem,
} from './employment.system';

/*
 * EmploymentSystem — the end of a barber's working period (team onboarding
 * D10): which records are due, what a roster looks like after its barber's
 * last day, and the ONE plan a close writes.
 */

const IVAN = BarberId.of('ivan');
const ACCOUNT = UserId.of('u-ivan');
const NOW = FIXTURE_NOW_UTC_MS;
const TODAY = localDate('2026-11-16');
const LAST = localDate('2026-11-15');
const OPERATION = OperationId.of('operation-close-000001');
const hash = (input: string): string => `h(${input})`;

const context: EmploymentContext = {
  today: TODAY,
  nowUtcMs: NOW,
  operationId: OPERATION,
  actor: Actor.system(SystemSource.ScheduledJob),
};

/** Ivan, working, with a last day set. */
const leaving = (
  over: Parameters<typeof barberFixture>[0] = {},
  lifecycle: BarberLifecycle = BarberLifecycle.live(BarberStatus.Public, NOW),
): Barber =>
  barberFixture(
    { id: IVAN, barberLastWorkingLocalDate: LAST, ...over },
    lifecycle,
  );

const lock: BarberLink = { id: BARBER_LINK_DOC, linkedUserId: ACCOUNT };
const account = (roles: readonly Role[] = [Role.Client, Role.Barber]) =>
  registeredUserFixture({ id: ACCOUNT, roles, linkedBarberId: IVAN });

const version = (
  seq: number,
  from: string,
  to: string | null,
): ScheduleVersion => ({
  ...(barberScheduleFixture().versions[0] as ScheduleVersion),
  seq,
  effectiveFromLocalDate: localDate(from),
  effectiveToLocalDate: to === null ? null : localDate(to),
});

const facts = (over: Partial<EmploymentFacts> = {}): EmploymentFacts => ({
  barber: leaving(),
  lock: null,
  account: null,
  schedule: null,
  ...over,
});

/** The plan's writes at a path, by its joined name. */
const at = (writes: readonly WriteOp[], path: string): readonly WriteOp[] =>
  writes.filter((write) => write.path.join('/') === path);
const LOCK_PATH = `${Collections.Barbers}/${IVAN}/${Subcollections.Restricted}/${BARBER_LINK_DOC}`;
const RECORD_PATH = `${Collections.Barbers}/${IVAN}`;
const ACCOUNT_PATH = `${Collections.Users}/${ACCOUNT}`;
const ROSTER_PATH = `${Collections.BarberSchedules}/${IVAN}`;
/** The audit rows a plan creates, as their actions. */
const rows = (writes: readonly WriteOp[]): readonly unknown[] =>
  writes
    .filter((write) => write.path[0] === Collections.AuditLog)
    .map((write) =>
      write.writeAction === WriteAction.Create
        ? write.body['auditAction']
        : null,
    );

describe('EmploymentSystem.outlookOf — where a period stands today', () => {
  const working = BarberLifecycle.live(BarberStatus.Public, NOW);

  it('for a working record: OPEN with no last day, ENDS while the last day is today or ahead, ENDED once it is behind', () => {
    expect(EmploymentSystem.outlookOf(working, null, TODAY)).toBe(
      EmploymentOutlook.Open,
    );
    expect(EmploymentSystem.outlookOf(working, TODAY, TODAY)).toBe(
      EmploymentOutlook.Ends,
    );
    expect(
      EmploymentSystem.outlookOf(working, localDate('2027-01-31'), TODAY),
    ).toBe(EmploymentOutlook.Ends);
    expect(EmploymentSystem.outlookOf(working, LAST, TODAY)).toBe(
      EmploymentOutlook.Ended,
    );
    expect(
      EmploymentSystem.outlookOf(
        BarberLifecycle.live(BarberStatus.StaffOnly, NOW),
        LAST,
        TODAY,
      ),
    ).toBe(EmploymentOutlook.Ended);
  });

  it('is OPEN whatever the last day for a record in preparation — it has never worked — and for one that has left', () => {
    for (const lifecycle of [
      BarberLifecycle.draft(NOW, BarberStatus.Public),
      BarberLifecycle.depart(NOW, null, BarberStatus.Public),
    ]) {
      for (const last of [null, LAST, TODAY, localDate('2027-01-31')]) {
        expect(
          EmploymentSystem.outlookOf(lifecycle, last, TODAY),
          `${lifecycle.barberStatus} ${String(last)}`,
        ).toBe(EmploymentOutlook.Open);
      }
    }
  });
});

describe('EmploymentSystem.isDue — a period has ended', () => {
  it('once the last day is BEFORE today: the barber works their last day through', () => {
    expect(EmploymentSystem.isDue(leaving(), TODAY)).toBe(true);
    // Today is the last day: still working.
    expect(EmploymentSystem.isDue(leaving(), LAST)).toBe(false);
    expect(
      EmploymentSystem.isDue(
        leaving({ barberLastWorkingLocalDate: localDate('2026-12-31') }),
        TODAY,
      ),
    ).toBe(false);
  });

  it('never with no last day, and never for a record that has left already', () => {
    expect(
      EmploymentSystem.isDue(
        leaving({ barberLastWorkingLocalDate: null }),
        TODAY,
      ),
    ).toBe(false);
    expect(
      EmploymentSystem.isDue(
        leaving({}, BarberLifecycle.depart(NOW, null, BarberStatus.Public)),
        TODAY,
      ),
    ).toBe(false);
  });

  it('for a staff-only record as for a public one — and never for a record in preparation: it has not worked, and is deleted, not closed', () => {
    expect(
      EmploymentSystem.isDue(
        leaving({}, BarberLifecycle.live(BarberStatus.StaffOnly, NOW)),
        TODAY,
      ),
    ).toBe(true);
    expect(
      EmploymentSystem.isDue(
        leaving({}, BarberLifecycle.draft(NOW, BarberStatus.Public)),
        TODAY,
      ),
    ).toBe(false);
  });
});

describe('EmploymentSystem.dueOf — what a run works on', () => {
  it('lists the ended periods and the departures that still owe a revoke, in the order given', () => {
    const working = barberFixture({ id: BarberId.of('niko') });
    const ended = leaving();
    const owes = leaving(
      { id: BarberId.of('stefan') },
      BarberLifecycle.depart(NOW, ACCOUNT, BarberStatus.Public),
    );
    const settled = leaving(
      { id: BarberId.of('martin') },
      BarberLifecycle.revoked(
        BarberLifecycle.depart(NOW, ACCOUNT, BarberStatus.Public),
        NOW,
      ),
    );
    expect(
      EmploymentSystem.dueOf([working, ended, owes, settled], TODAY),
    ).toEqual([IVAN, BarberId.of('stefan')]);
    expect(EmploymentSystem.dueOf([], TODAY)).toEqual([]);
  });
});

describe('EmploymentSystem.rosterAfter — a roster once its barber has left', () => {
  it('closes the version in force on the last day there, and drops every later one', () => {
    const before = [
      version(1, '2026-01-01', '2026-06-30'),
      version(2, '2026-07-01', null),
      version(3, '2026-12-01', null),
    ];
    const after = EmploymentSystem.rosterAfter(before, LAST);
    expect(after).toEqual([
      before[0],
      { ...before[1], effectiveToLocalDate: LAST },
    ]);
    // A version that ended already is the version itself.
    expect(after[0]).toBe(before[0]);
  });

  it('answers the versions themselves where nothing moved, and none for a roster that began after the last day', () => {
    const closed = [version(1, '2026-01-01', '2026-11-15')];
    expect(EmploymentSystem.rosterAfter(closed, LAST)[0]).toBe(closed[0]);
    expect(
      EmploymentSystem.rosterAfter([version(1, '2026-12-01', null)], LAST),
    ).toEqual([]);
  });

  it('shortens a version that ends after the last day', () => {
    expect(
      EmploymentSystem.rosterAfter(
        [version(1, '2026-01-01', '2026-12-31')],
        LAST,
      ),
    ).toEqual([
      { ...version(1, '2026-01-01', '2026-12-31'), effectiveToLocalDate: LAST },
    ]);
  });
});

describe('EmploymentSystem — the bookings a last day leaves behind', () => {
  const NIKO = BarberId.of('niko');
  const busy = (day: string, blocks?: readonly never[]) =>
    barberBusyDayFixture({
      barberId: IVAN,
      localDate: localDate(day),
      ...(blocks === undefined ? {} : { blocks }),
    });
  const visit = (
    id: string,
    day: string,
    over: Parameters<typeof appointmentFixture>[0] = {},
  ) =>
    appointmentFixture({
      id: AppointmentId.of(id),
      localDate: localDate(day),
      barberIds: [IVAN],
      ...over,
    });

  it('keysAfter names every busy day after the last day that holds a block, in the order given', () => {
    expect(
      EmploymentSystem.keysAfter(
        [
          // On the last day itself: worked, not left behind.
          busy('2026-11-15'),
          busy('2026-11-17'),
          // A day the projection keeps with nothing on it.
          busy('2026-11-18', []),
          busy('2026-12-02'),
        ],
        LAST,
      ),
    ).toEqual([
      BusyKey.of(IVAN, localDate('2026-11-17')),
      BusyKey.of(IVAN, localDate('2026-12-02')),
    ]);
    expect(EmploymentSystem.keysAfter([], LAST)).toEqual([]);
  });

  it('leftoverOf counts the live visits that seat the barber after the last day — each once — and the days they fall on, oldest first', () => {
    expect(
      EmploymentSystem.leftoverOf(
        [
          visit('a-2', '2026-12-02'),
          visit('a-1', '2026-11-17'),
          visit('a-3', '2026-11-17', {
            lifecycle: BookingLifecycle.pending(NOW),
          }),
          // The same visit answered twice (a party seated across two days' reads).
          visit('a-1', '2026-11-17'),
        ],
        IVAN,
        LAST,
      ),
    ).toEqual({
      leftoverCount: 3,
      leftoverLocalDates: ['2026-11-17', '2026-12-02'],
    });
  });

  it('leaves out a visit on the last day itself, a cancelled or finished one, and a colleague’s', () => {
    expect(
      EmploymentSystem.leftoverOf(
        [
          visit('a-last', '2026-11-15'),
          visit('a-done', '2026-11-17', {
            lifecycle: BookingLifecycle.complete(NOW),
          }),
          visit('a-gone', '2026-11-17', {
            lifecycle: BookingLifecycle.noShow(NOW),
          }),
          visit('a-niko', '2026-11-17', { barberIds: [NIKO] }),
        ],
        IVAN,
        LAST,
      ),
    ).toEqual(LeftoverBookings.NONE);
    expect(EmploymentSystem.leftoverOf([], IVAN, LAST)).toBe(
      LeftoverBookings.NONE,
    );
  });

  it('leftoverVisitsOf answers the visits themselves, each once, by day and then by start', () => {
    const early = visit('a-early', '2026-11-17', { startMinutes: minute(540) });
    const late = visit('a-late', '2026-11-17', { startMinutes: minute(900) });
    const next = visit('a-next', '2026-12-02');
    const left = EmploymentSystem.leftoverVisitsOf(
      [next, late, early, late, visit('a-last', '2026-11-15')],
      IVAN,
      LAST,
    );
    expect(left).toEqual([early, late, next]);
    // The entities as they were read: nothing copied, nothing re-shaped.
    expect(left[0]).toBe(early);
  });

  it('counts a visit the barber shares with a colleague once', () => {
    expect(
      EmploymentSystem.leftoverOf(
        [visit('a-pair', '2026-11-20', { barberIds: [NIKO, IVAN] })],
        IVAN,
        LAST,
      ).leftoverCount,
    ).toBe(1);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const visits = deepFreeze([
      visit('a-1', '2026-11-17'),
      visit('a-2', '2026-12-02'),
    ]);
    expect(EmploymentSystem.leftoverOf(visits, IVAN, LAST)).toEqual(
      EmploymentSystem.leftoverOf(visits, IVAN, LAST),
    );
    expect(EmploymentSystem.leftoverVisitsOf(visits, IVAN, LAST)).toEqual(
      EmploymentSystem.leftoverVisitsOf(visits, IVAN, LAST),
    );
    const days = deepFreeze([busy('2026-11-17')]);
    expect(EmploymentSystem.keysAfter(days, LAST)).toEqual(
      EmploymentSystem.keysAfter(days, LAST),
    );
  });
});

describe('EmploymentSystem.lingerCandidates / lingeringOn — the leavers a schedule still keeps a column for', () => {
  const ON = localDate('2026-11-16');
  /** A record that left, its last working day `last`. */
  const left = (id: string, last: string | null) =>
    barberFixture(
      {
        id: BarberId.of(id),
        barberLastWorkingLocalDate: last === null ? null : localDate(last),
      },
      BarberLifecycle.depart(NOW, null, BarberStatus.Public),
    );

  it('names the records that have left within the horizon — never one that works, one in preparation, or one that left with no last day', () => {
    const recent = left('recent', '2026-11-10');
    const edge = left('edge', '2025-10-12');
    const candidates = EmploymentSystem.lingerCandidates(
      [
        barberFixture({
          id: BarberId.of('works'),
          barberLastWorkingLocalDate: localDate('2026-11-10'),
        }),
        recent,
        left('long-gone', '2025-10-11'),
        left('no-day', null),
        edge,
        barberFixture(
          {
            id: BarberId.of('draft'),
            barberLastWorkingLocalDate: localDate('2026-11-10'),
          },
          BarberLifecycle.draft(NOW, BarberStatus.Public),
        ),
      ],
      ON,
    );
    // 400 days back from today is 2025-10-12: that day still counts.
    expect(candidates).toEqual([recent, edge]);
  });

  it('keeps a column for a leaver booked on one of the days shown, in the order given — and for no other', () => {
    const stefan = left('stefan', '2026-11-10');
    const georgi = left('georgi', '2026-11-12');
    const held = new Set([
      BusyKey.of(stefan.id, localDate('2026-11-18')),
      BusyKey.of(georgi.id, localDate('2026-12-02')),
    ]);

    expect(
      EmploymentSystem.lingeringOn([stefan, georgi], held, [
        localDate('2026-11-17'),
        localDate('2026-11-18'),
      ]),
    ).toEqual([stefan]);
    expect(
      EmploymentSystem.lingeringOn([stefan, georgi], held, [
        localDate('2026-11-18'),
        localDate('2026-12-02'),
      ]),
    ).toEqual([stefan, georgi]);
    expect(
      EmploymentSystem.lingeringOn([stefan, georgi], held, [
        localDate('2026-11-19'),
      ]),
    ).toEqual([]);
    expect(EmploymentSystem.lingeringOn([stefan], new Set(), [])).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const leavers = deepFreeze([left('stefan', '2026-11-10')]);
    const days = deepFreeze([localDate('2026-11-18')]);
    const held = new Set([
      BusyKey.of(BarberId.of('stefan'), localDate('2026-11-18')),
    ]);
    expect(EmploymentSystem.lingerCandidates(leavers, ON)).toEqual(
      EmploymentSystem.lingerCandidates(leavers, ON),
    );
    expect(EmploymentSystem.lingeringOn(leavers, held, days)).toEqual(
      EmploymentSystem.lingeringOn(leavers, held, days),
    );
  });
});

describe('EmploymentSystem.rosterOnReturn — the week a barber last worked, standing again', () => {
  const START = localDate('2026-12-01');

  it('keeps the history and appends the last version’s week from the new start, open-ended, under the next seq', () => {
    const before = [
      version(1, '2026-01-01', '2026-06-30'),
      version(2, '2026-07-01', '2026-11-15'),
    ];
    const after = EmploymentSystem.rosterOnReturn(before, START);
    expect(after).toEqual([
      before[0],
      before[1],
      {
        ...before[1],
        seq: 3,
        effectiveFromLocalDate: START,
        effectiveToLocalDate: null,
      },
    ]);
    // What was worked before stays the version itself.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('closes a version still open the day before the new start', () => {
    const open = [version(1, '2026-01-01', null)];
    expect(EmploymentSystem.rosterOnReturn(open, START)).toEqual([
      { ...open[0], effectiveToLocalDate: localDate('2026-11-30') },
      { ...open[0], seq: 2, effectiveFromLocalDate: START },
    ]);
  });

  it('has no week to bring back for a roster with no version', () => {
    expect(EmploymentSystem.rosterOnReturn([], START)).toEqual([]);
  });

  it('a roster closed by a leave and reopened by a return covers no day twice, and none in between', () => {
    const worked = [version(1, '2026-01-01', null)];
    const closed = EmploymentSystem.rosterAfter(worked, LAST);
    const back = EmploymentSystem.rosterOnReturn(closed, START);
    expect(
      back.map((v) => [v.effectiveFromLocalDate, v.effectiveToLocalDate]),
    ).toEqual([
      ['2026-01-01', LAST],
      [START, null],
    ]);
    expect(unwrapOk(ScheduleVersion.history(back))).toEqual(back);
  });

  it('rosterWritesOnReturn sets the roster whole under the act’s name; nothing for no roster or no version', () => {
    const schedule = barberScheduleFixture({
      id: IVAN,
      versions: [version(1, '2026-01-01', '2026-11-15')],
    });
    const [write] = EmploymentSystem.rosterWritesOnReturn(
      schedule,
      START,
      OPERATION,
    );
    expect(write?.path).toEqual([Collections.BarberSchedules, IVAN]);
    expect(write?.writeAction === WriteAction.Set && write.body).toMatchObject({
      turnaroundMinutes: schedule.turnaroundMinutes,
      versions: [
        schedule.versions[0],
        { seq: 2, effectiveFromLocalDate: START, effectiveToLocalDate: null },
      ],
      writeOperationId: OPERATION,
    });
    expect(write?.writeAction === WriteAction.Set && 'id' in write.body).toBe(
      false,
    );
    expect(
      EmploymentSystem.rosterWritesOnReturn(null, START, OPERATION),
    ).toEqual([]);
    expect(
      EmploymentSystem.rosterWritesOnReturn(
        barberScheduleFixture({ id: IVAN, versions: [] }),
        START,
        OPERATION,
      ),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze([version(1, '2026-01-01', '2026-11-15')]);
    expect(EmploymentSystem.rosterOnReturn(frozen, START)).toEqual(
      EmploymentSystem.rosterOnReturn(frozen, START),
    );
  });
});

describe('EmploymentSystem.close — one record’s close', () => {
  it('a record with no account: set whole as DEPARTED beside ONE status row, nobody to sign out', () => {
    const close = EmploymentSystem.close(facts(), context, hash);
    expect(close.closed).toBe(true);
    expect(close.revokeUserId).toBeNull();
    const [record] = at(close.writes, RECORD_PATH);
    expect(record?.writeAction).toBe(WriteAction.Set);
    expect(
      record?.writeAction === WriteAction.Set && record.body,
    ).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberStatusChangedAtUtcMs: NOW,
      barberDepartedUserId: null,
      barberSessionsRevokedAtUtcMs: null,
      barberRehireStatus: BarberStatus.Public,
      // The period is the record's history: it stays.
      barberLastWorkingLocalDate: LAST,
      writeOperationId: OPERATION,
    });
    expect(rows(close.writes)).toEqual([AuditAction.TeamBarberStatusChanged]);
    expect(close.writes).toHaveLength(2);
  });

  it('the linked account loses its staff roles and its link, the lock is released, and its sessions are to be ended', () => {
    const close = EmploymentSystem.close(
      facts({
        lock,
        account: account([Role.Client, Role.Barber, Role.Receptionist]),
      }),
      context,
      hash,
    );
    expect(close.revokeUserId).toBe(ACCOUNT);
    const [record] = at(close.writes, RECORD_PATH);
    expect(
      record?.writeAction === WriteAction.Set && record.body,
    ).toMatchObject({
      barberDepartedUserId: ACCOUNT,
    });
    const [user] = at(close.writes, ACCOUNT_PATH);
    expect(user?.writeAction).toBe(WriteAction.Update);
    expect(user?.writeAction === WriteAction.Update && user.fields).toEqual({
      profileEditedAtUtcMs: NOW,
      roles: [Role.Client],
      linkedBarberId: null,
    });
    expect(at(close.writes, LOCK_PATH).map((w) => w.writeAction)).toEqual([
      WriteAction.Delete,
    ]);
    expect([...rows(close.writes)].sort()).toEqual(
      [
        AuditAction.ProfileRolesChanged,
        AuditAction.TeamBarberStatusChanged,
      ].sort(),
    );
  });

  it('an account left with no role is a client again', () => {
    const close = EmploymentSystem.close(
      facts({ lock, account: account([Role.Barber]) }),
      context,
      hash,
    );
    const [user] = at(close.writes, ACCOUNT_PATH);
    expect(
      user?.writeAction === WriteAction.Update && user.fields,
    ).toMatchObject({ roles: [Role.Client] });
  });

  it('an admin’s roles are left alone: the link and the lock go, the record names nobody to sign out', () => {
    const close = EmploymentSystem.close(
      facts({ lock, account: account([Role.Barber, Role.Admin]) }),
      context,
      hash,
    );
    expect(close.closed).toBe(true);
    expect(close.revokeUserId).toBeNull();
    const [record] = at(close.writes, RECORD_PATH);
    expect(
      record?.writeAction === WriteAction.Set && record.body,
    ).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberDepartedUserId: null,
    });
    const [user] = at(close.writes, ACCOUNT_PATH);
    expect(user?.writeAction === WriteAction.Update && user.fields).toEqual({
      profileEditedAtUtcMs: NOW,
      linkedBarberId: null,
    });
    expect(at(close.writes, LOCK_PATH)).toHaveLength(1);
  });

  it('a lock whose account is gone is released all the same', () => {
    const close = EmploymentSystem.close(facts({ lock }), context, hash);
    expect(close.revokeUserId).toBeNull();
    expect(at(close.writes, LOCK_PATH).map((w) => w.writeAction)).toEqual([
      WriteAction.Delete,
    ]);
    expect(at(close.writes, ACCOUNT_PATH)).toEqual([]);
  });

  it('closes the roster on the last day under the close’s name; removes one with no version left; leaves a closed one alone', () => {
    const open = barberScheduleFixture({ id: IVAN });
    const closed = EmploymentSystem.close(
      facts({ schedule: open }),
      context,
      hash,
    );
    const [roster] = at(closed.writes, ROSTER_PATH);
    expect(
      roster?.writeAction === WriteAction.Set && roster.body,
    ).toMatchObject({
      versions: [{ ...open.versions[0], effectiveToLocalDate: LAST }],
      writeOperationId: OPERATION,
    });
    expect(roster?.writeAction === WriteAction.Set && 'id' in roster.body).toBe(
      false,
    );

    const later = barberScheduleFixture({
      id: IVAN,
      versions: [version(1, '2026-12-01', null)],
    });
    expect(
      at(
        EmploymentSystem.close(facts({ schedule: later }), context, hash)
          .writes,
        ROSTER_PATH,
      ).map((w) => w.writeAction),
    ).toEqual([WriteAction.Delete]);

    const already = barberScheduleFixture({
      id: IVAN,
      versions: [version(1, '2026-01-01', '2026-11-15')],
    });
    expect(
      at(
        EmploymentSystem.close(facts({ schedule: already }), context, hash)
          .writes,
        ROSTER_PATH,
      ),
    ).toEqual([]);
  });

  it('a staff-only record leaves, and a rehire returns it to staff-only', () => {
    const close = EmploymentSystem.close(
      facts({
        barber: leaving({}, BarberLifecycle.live(BarberStatus.StaffOnly, NOW)),
      }),
      context,
      hash,
    );
    const [record] = at(close.writes, RECORD_PATH);
    expect(
      record?.writeAction === WriteAction.Set && record.body,
    ).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberRehireStatus: BarberStatus.StaffOnly,
    });
  });

  it('a record in preparation is never closed, whatever its last day: its account, lock and roster stay', () => {
    expect(
      EmploymentSystem.close(
        facts({
          barber: leaving({}, BarberLifecycle.draft(NOW, BarberStatus.Public)),
          lock,
          account: account(),
          schedule: barberScheduleFixture({ id: IVAN }),
        }),
        context,
        hash,
      ),
    ).toEqual({ closed: false, revokeUserId: null, writes: [] });
  });

  it('writes nothing for a record that is gone, one whose period has not ended, and one that left already', () => {
    const nothing = { closed: false, revokeUserId: null, writes: [] };
    expect(
      EmploymentSystem.close(facts({ barber: null }), context, hash),
    ).toEqual(nothing);
    // An extension made just before the run wins.
    expect(
      EmploymentSystem.close(
        facts({
          barber: leaving({
            barberLastWorkingLocalDate: localDate('2026-12-31'),
          }),
          lock,
          account: account(),
        }),
        context,
        hash,
      ),
    ).toEqual(nothing);
    expect(
      EmploymentSystem.close(
        facts({
          barber: leaving(
            {},
            BarberLifecycle.depart(NOW, null, BarberStatus.Public),
          ),
        }),
        context,
        hash,
      ),
    ).toEqual(nothing);
  });

  it('names the account an earlier close still owes a revoke, and writes nothing', () => {
    expect(
      EmploymentSystem.close(
        facts({
          barber: leaving(
            {},
            BarberLifecycle.depart(NOW, ACCOUNT, BarberStatus.Public),
          ),
        }),
        context,
        hash,
      ),
    ).toEqual({ closed: false, revokeUserId: ACCOUNT, writes: [] });
  });

  it('credits both rows to whoever closes, under the close’s one name', () => {
    const admin = Actor.admin(UserId.of('u-owner'));
    const close = EmploymentSystem.close(
      facts({ lock, account: account() }),
      { ...context, actor: admin },
      hash,
    );
    const audit = close.writes.filter(
      (write) => write.path[0] === Collections.AuditLog,
    );
    expect(audit).toHaveLength(2);
    for (const row of audit) {
      expect(row.writeAction === WriteAction.Create && row.body).toMatchObject({
        ...admin,
        auditOperationId: OPERATION,
        recordedAtUtcMs: NOW,
      });
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(
      facts({
        lock,
        account: account(),
        schedule: barberScheduleFixture({ id: IVAN }),
      }),
    );
    expect(EmploymentSystem.close(frozen, context, hash)).toEqual(
      EmploymentSystem.close(frozen, context, hash),
    );
  });
});

describe('EmploymentSystem.revoked — the marker of a revoke that succeeded', () => {
  const owes = leaving(
    {},
    BarberLifecycle.depart(NOW, ACCOUNT, BarberStatus.Public),
  );
  const later: EmploymentContext = {
    ...context,
    nowUtcMs: UtcEpochMs.plusMs(NOW, 5_000),
    operationId: OperationId.of('operation-close-000002'),
  };

  it('sets the marker on a departure that owed one, beside its own row, and moves nothing else', () => {
    const writes = EmploymentSystem.revoked(owes, later, hash);
    const [record] = at(writes, RECORD_PATH);
    expect(
      record?.writeAction === WriteAction.Set && record.body,
    ).toMatchObject({
      barberStatus: BarberStatus.Departed,
      // The departure's own stamp.
      barberStatusChangedAtUtcMs: NOW,
      barberDepartedUserId: ACCOUNT,
      barberSessionsRevokedAtUtcMs: later.nowUtcMs,
    });
    expect(rows(writes)).toEqual([AuditAction.TeamBarberStatusChanged]);
  });

  it('writes nothing for a record gone, one that works, and one whose marker is set', () => {
    expect(EmploymentSystem.revoked(null, later, hash)).toEqual([]);
    expect(
      EmploymentSystem.revoked(barberFixture({ id: IVAN }), later, hash),
    ).toEqual([]);
    expect(EmploymentSystem.revoked(settledOf(owes), later, hash)).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(owes);
    expect(EmploymentSystem.revoked(frozen, later, hash)).toEqual(
      EmploymentSystem.revoked(frozen, later, hash),
    );
  });
});

/** The departure with its marker set, as the first marker write leaves it. */
function settledOf(barber: Barber): Barber {
  return leaving(
    {},
    BarberLifecycle.revoked(
      BarberLifecycle.depart(
        barber.barberStatusChangedAtUtcMs,
        ACCOUNT,
        BarberStatus.Public,
      ),
      NOW,
    ),
  );
}
