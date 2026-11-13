import { describe, expect, it } from 'vitest';
import {
  Actor,
  DayExceptionsEdit,
  ExceptionEffectRule,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  BusyKey,
  type LocalDate,
  OperationId,
  ScheduleExceptionId,
  UserId,
} from '@core/primitives';
import { Collections, type ScheduleException } from '@core/entities';
import {
  bodyOf,
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  scheduleExceptionFixture,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import {
  DayExceptionWriteSystem,
  type DayExceptionsWrite,
} from './day-exception-write.system';

const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const OP = OperationId.of('operation-0123456789ab');
const actor = Actor.admin(UserId.of('u-admin'));
const D1 = localDate('2026-12-24');
const D2 = localDate('2026-12-25');
const D3 = localDate('2026-12-31');

const day = (barberId: BarberId, localDate: LocalDate): ScheduleException =>
  scheduleExceptionFixture({
    id: ScheduleExceptionId.of(BusyKey.of(barberId, localDate)),
    barberId,
    localDate,
  });
const path = (barberId: BarberId, localDate: LocalDate) => [
  Collections.ScheduleExceptions,
  BusyKey.of(barberId, localDate),
];

const write = (
  days: readonly (readonly [BarberId, LocalDate])[],
  stored: DayExceptionsWrite['stored'],
  merged: DayExceptionsWrite['merged'],
): DayExceptionsWrite => ({
  edit: DayExceptionsEdit.Block,
  keys: days.map(([barberId, localDate]) => BusyKey.of(barberId, localDate)),
  stored,
  merged,
  actor,
  nowUtcMs: FIXTURE_NOW_UTC_MS,
  operationId: OP,
});

/** The row of one barber's changed days, as `createsOf` writes it. */
const rowOf = (barberId: BarberId, days: readonly LocalDate[]) => {
  const plan = AuditSystem.planTeamDayExceptions(
    barberId,
    DayExceptionsEdit.Block,
    days,
    actor,
    FIXTURE_NOW_UTC_MS,
    OP,
  );
  return WriteOp.create(
    [Collections.AuditLog, AuditEntryId.of(fixtureHash(plan.idBasis))],
    plan.row,
  );
};

describe('DayExceptionWriteSystem.writesOf', () => {
  it('sets a new day whole — the entity minus its id — beside ONE row', () => {
    expect(
      DayExceptionWriteSystem.writesOf(
        write([[IVAN, D1]], [null], [day(IVAN, D1)]),
        fixtureHash,
      ),
    ).toEqual([
      WriteOp.set(path(IVAN, D1), bodyOf(day(IVAN, D1))),
      rowOf(IVAN, [D1]),
    ]);
  });

  it('removes a day that holds nothing any more, and leaves alone one that held nothing and still does', () => {
    expect(
      DayExceptionWriteSystem.writesOf(
        write(
          [
            [IVAN, D1],
            [IVAN, D2],
          ],
          [day(IVAN, D1), null],
          [null, null],
        ),
        fixtureHash,
      ),
    ).toEqual([WriteOp.remove(path(IVAN, D1)), rowOf(IVAN, [D1])]);
  });

  it('writes only the days that really change — a day left exactly as it was is not written', () => {
    const changed = {
      ...day(IVAN, D2),
      ...ExceptionEffectRule.rostered(),
      dayBreakRanges: [],
    };
    const writes = DayExceptionWriteSystem.writesOf(
      write(
        [
          [IVAN, D1],
          [IVAN, D2],
        ],
        [day(IVAN, D1), day(IVAN, D2)],
        // The first as stored (another object, the same body); the second changed.
        [{ ...day(IVAN, D1) }, changed],
      ),
      fixtureHash,
    );
    expect(writes).toEqual([
      WriteOp.set(path(IVAN, D2), bodyOf(changed)),
      rowOf(IVAN, [D2]),
    ]);
  });

  it('gives each barber ONE row spanning their changed days, ascending — whatever order the days came in', () => {
    const writes = DayExceptionWriteSystem.writesOf(
      write(
        [
          [IVAN, D3],
          [NIKO, D2],
          [IVAN, D1],
        ],
        [null, null, null],
        [day(IVAN, D3), day(NIKO, D2), day(IVAN, D1)],
      ),
      fixtureHash,
    );
    expect(writes.slice(3)).toEqual([rowOf(IVAN, [D1, D3]), rowOf(NIKO, [D2])]);
    expect(rowOf(IVAN, [D1, D3]).body).toMatchObject({
      auditAction: 'TEAM_DAY_EXCEPTIONS_CHANGED',
      resourceId: `barbers/${IVAN}`,
      auditOperationId: OP,
      dayExceptionsEdit: 'BLOCK',
      dayExceptionsFromLocalDate: D1,
      dayExceptionsToLocalDate: D3,
      dayExceptionsDayCount: 2,
    });
  });

  it('plans NOTHING when no day changes — a save of what is there, a replay', () => {
    expect(
      DayExceptionWriteSystem.writesOf(
        write([[IVAN, D1]], [day(IVAN, D1)], [day(IVAN, D1)]),
        fixtureHash,
      ),
    ).toEqual([]);
    expect(
      DayExceptionWriteSystem.writesOf(write([], [], []), fixtureHash),
    ).toEqual([]);
  });

  it('treats lists that are not parallel, and a body for another day, as defects', () => {
    expect(() =>
      DayExceptionWriteSystem.writesOf(
        write([[IVAN, D1]], [null], []),
        fixtureHash,
      ),
    ).toThrow();
    expect(() =>
      DayExceptionWriteSystem.writesOf(
        write([[IVAN, D1]], [null], [day(IVAN, D2)]),
        fixtureHash,
      ),
    ).toThrow();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const act = deepFreeze(
      write(
        [
          [IVAN, D1],
          [NIKO, D2],
        ],
        [null, day(NIKO, D2)],
        [day(IVAN, D1), null],
      ),
    );
    expect(DayExceptionWriteSystem.writesOf(act, fixtureHash)).toEqual(
      DayExceptionWriteSystem.writesOf(act, fixtureHash),
    );
  });
});
