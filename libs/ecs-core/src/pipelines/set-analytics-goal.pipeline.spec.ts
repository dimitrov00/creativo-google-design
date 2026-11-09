import { describe, expect, it } from 'vitest';
import {
  Actor,
  AnalyticsGoal,
  AuditAction,
  Role,
  WriteAction,
} from '@core/components';
import { AnalyticsErrorCode, RepositoryErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import {
  AnalyticsGoalKey,
  BarberId,
  LogEvent,
  MonthKey,
  OperationId,
  type PriceCents,
  Result,
  UserId,
} from '@core/primitives';
import type { CommitPlan } from '@core/ports';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  auditRowsOf,
  blockedUserFixture,
  contendedCommit,
  locationFixture,
  memoryAnalyticsReadPorts,
  memoryDefaultLocationPorts,
  memoryProfileLoadPorts,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  type SetAnalyticsGoalCommand,
  type SetAnalyticsGoalPorts,
  setAnalyticsGoal,
} from './set-analytics-goal.pipeline';

/* The clock: Monday 28 September 2026, 09:00 in Sofia (FIXTURE_NOW) — the
 * current month is September, the next October. Two barber records, Ivan
 * and Niko; one shop. */

const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const SEPTEMBER = MonthKey.of('2026-09');
const OCTOBER = MonthKey.of('2026-10');
const OP = OperationId.of('operation-0123456789ab');
const cents = (raw: number): PriceCents => raw as PriceCents;

const ADMIN = registeredUserFixture({
  id: UserId.of('u-admin'),
  roles: [Role.Admin],
});
const ADMIN_BARBER = registeredUserFixture({
  id: UserId.of('u-owner'),
  roles: [Role.Admin, Role.Barber],
  linkedBarberId: NIKO,
});
const IVAN_USER = registeredUserFixture({
  id: UserId.of('u-ivan'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});
const UNLINKED = registeredUserFixture({
  id: UserId.of('u-new-barber'),
  roles: [Role.Barber],
});
const BLOCKED = blockedUserFixture({
  id: UserId.of('u-blocked'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});
const RECEPTIONIST = registeredUserFixture({
  id: UserId.of('u-desk'),
  roles: [Role.Receptionist],
});
const USERS = [ADMIN, ADMIN_BARBER, IVAN_USER, UNLINKED, BLOCKED, RECEPTIONIST];

function call(
  overrides: Partial<SetAnalyticsGoalCommand> = {},
): SetAnalyticsGoalCommand {
  return {
    callerUserId: IVAN_USER.id,
    scopeBarberId: null,
    goalMonth: SEPTEMBER,
    goalLowCents: cents(180_000),
    goalHighCents: cents(220_000),
    operationId: OP,
    ...overrides,
  };
}

function rig(commit?: CommitPlan) {
  const store = memoryStore();
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const analytics = memoryAnalyticsReadPorts({
    barberIds: [NIKO, IVAN],
    locations: [locationFixture()],
  });
  const ports: SetAnalyticsGoalPorts = {
    ...tx,
    ...(commit === undefined ? {} : { commit }),
    ...analytics.ports,
    ...memoryProfileLoadPorts(USERS),
    ...memoryDefaultLocationPorts(FIXTURE_IDS.location),
    log: telemetry.log,
  };
  return { store, tx, telemetry, run: setAnalyticsGoal(ports) };
}

describe('setAnalyticsGoal — a barber’s own month goal (CUJ 6)', () => {
  it('writes analyticsGoals/{barberId__month} — the entity minus id, EUR, the caller and the clock — and answers the key and the stamp', async () => {
    const { store, tx, run } = rig();
    const answer = unwrapOk(await run(call()));
    const key = AnalyticsGoalKey.of(IVAN, SEPTEMBER);
    expect(answer).toEqual({
      goalKey: key,
      goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(key).toBe('b-ivan__2026-09');
    const body = store.get(`${Collections.AnalyticsGoals}/${key}`);
    expect(body).toEqual({
      barberId: IVAN,
      goalMonth: SEPTEMBER,
      goalLowCents: 180_000,
      goalHighCents: 220_000,
      currency: 'EUR',
      goalSetByUserId: IVAN_USER.id,
      goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(AnalyticsGoal.is(body)).toBe(true);
    // One plan: the goal SET and its row, nothing read inside the transaction.
    expect(tx.plans).toHaveLength(1);
    expect(tx.plans[0]?.map((op) => op.writeAction)).toEqual([
      WriteAction.Set,
      WriteAction.Create,
    ]);
  });

  it('writes ONE ANALYTICS_GOAL_SET row credited to the barber — the key, scope, month, both bounds and the operation id', async () => {
    const { tx, run } = rig();
    await run(call());
    const rows = auditRowsOf(tx.plans);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.AnalyticsGoalSet,
      resourceId: 'analyticsGoals/b-ivan__2026-09',
      goalKey: 'b-ivan__2026-09',
      goalScopeBarberId: IVAN,
      goalMonth: SEPTEMBER,
      goalLowCents: 180_000,
      goalHighCents: 220_000,
      auditOperationId: OP,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      ...Actor.forCaller(IVAN_USER.id, [Role.Barber]),
    });
  });

  it('is deterministic under contention: both runs of decide plan the same writes, row id included', async () => {
    const base = rig();
    const contended = contendedCommit(base.tx.commit);
    const { run } = rig(contended.commit);
    await run(call());
    expect(contended.decisions).toHaveLength(2);
    expect(contended.decisions[0]).toEqual(contended.decisions[1]);
  });

  it('a barber naming their own record sets the same goal as naming none; a later set overwrites the month', async () => {
    const { store, run } = rig();
    await run(call({ scopeBarberId: IVAN }));
    await run(
      call({
        goalLowCents: cents(200_000),
        goalHighCents: cents(250_000),
        operationId: OperationId.of('operation-0123456789ac'),
      }),
    );
    expect(store.size).toBe(1 + 2); // the goal, and two rows
    expect(
      store.get(`${Collections.AnalyticsGoals}/b-ivan__2026-09`),
    ).toMatchObject({ goalLowCents: 200_000, goalHighCents: 250_000 });
  });

  it('admits the next month too, and logs the set without the bounds', async () => {
    const { telemetry, run } = rig();
    const answer = unwrapOk(await run(call({ goalMonth: OCTOBER })));
    expect(answer.goalKey).toBe('b-ivan__2026-10');
    expect(telemetry.lines).toEqual([
      {
        level: 'info',
        msg: LogEvent.AnalyticsGoalSet,
        fields: {
          uid: IVAN_USER.id,
          scope: IVAN,
          month: OCTOBER,
          key: 'b-ivan__2026-10',
        },
      },
    ]);
  });

  it('keys the row by the stamp when the call sent no operation id', async () => {
    const { tx, run } = rig();
    await run(call({ operationId: null }));
    expect(auditRowsOf(tx.plans)[0]).toMatchObject({ auditOperationId: null });
  });
});

describe('setAnalyticsGoal — removing a goal (owner 2026-11-09)', () => {
  it('no range removes the month’s goal and writes ONE ANALYTICS_GOAL_CLEARED row, the key, scope and month', async () => {
    const { store, tx, telemetry, run } = rig();
    unwrapOk(await run(call()));
    const key = AnalyticsGoalKey.of(IVAN, SEPTEMBER);
    expect(
      store.get(`${Collections.AnalyticsGoals}/${key}`),
    ).not.toBeUndefined();
    const answer = unwrapOk(
      await run(call({ goalLowCents: null, goalHighCents: null })),
    );
    expect(answer).toEqual({
      goalKey: key,
      goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(store.get(`${Collections.AnalyticsGoals}/${key}`)).toBeUndefined();
    const rows = auditRowsOf(tx.plans.slice(1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.AnalyticsGoalCleared,
      resourceId: 'analyticsGoals/b-ivan__2026-09',
      goalKey: key,
      goalScopeBarberId: IVAN,
      goalMonth: SEPTEMBER,
      auditOperationId: OP,
    });
    expect(
      telemetry.lines.some(
        (line) =>
          line.msg === LogEvent.AnalyticsGoalCleared &&
          line.fields?.['key'] === key,
      ),
    ).toBe(true);
  });

  it('refuses one bound without the other, naming the missing one, writing nothing', async () => {
    const { tx, run } = rig();
    expect(unwrapErr(await run(call({ goalHighCents: null })))).toEqual({
      errorCode: AnalyticsErrorCode.GoalInvalidRange,
      field: 'goalHighCents',
    });
    expect(unwrapErr(await run(call({ goalLowCents: null })))).toEqual({
      errorCode: AnalyticsErrorCode.GoalInvalidRange,
      field: 'goalLowCents',
    });
    expect(tx.plans).toHaveLength(0);
  });
});

describe('setAnalyticsGoal — the admin’s shop goal', () => {
  it('an admin naming no scope sets shop__{month}, credited as the admin', async () => {
    const { store, tx, run } = rig();
    const answer = unwrapOk(await run(call({ callerUserId: ADMIN.id })));
    expect(answer.goalKey).toBe('shop__2026-09');
    expect(
      store.get(`${Collections.AnalyticsGoals}/shop__2026-09`),
    ).toMatchObject({ barberId: null, goalSetByUserId: ADMIN.id });
    expect(auditRowsOf(tx.plans)[0]).toMatchObject({
      goalScopeBarberId: null,
      ...Actor.admin(ADMIN.id),
    });
  });

  it('an admin whose account is linked to a record may set that record’s goal, and no other barber’s (ANALYTICS_GOAL_FORBIDDEN)', async () => {
    const { telemetry, run } = rig();
    const own = unwrapOk(
      await run(call({ callerUserId: ADMIN_BARBER.id, scopeBarberId: NIKO })),
    );
    expect(own.goalKey).toBe('b-niko__2026-09');
    for (const caller of [ADMIN, ADMIN_BARBER]) {
      const refused = unwrapErr(
        await run(call({ callerUserId: caller.id, scopeBarberId: IVAN })),
      );
      expect(refused.errorCode).toBe(AnalyticsErrorCode.GoalForbidden);
    }
    expect(
      telemetry.lines.filter(
        (line) => line.msg === LogEvent.AnalyticsGoalRefused,
      ),
    ).toHaveLength(2);
  });
});

describe('setAnalyticsGoal — the refusals', () => {
  it('judges the caller by the visibility table first (v1’s codes), writing nothing', async () => {
    const { store, run } = rig();
    const codeOf = async (cmd: SetAnalyticsGoalCommand) =>
      unwrapErr(await run(cmd)).errorCode;
    // No record, a blocked account, a role outside analytics.
    expect(await codeOf(call({ callerUserId: UserId.of('u-nobody') }))).toBe(
      AnalyticsErrorCode.Forbidden,
    );
    expect(await codeOf(call({ callerUserId: BLOCKED.id }))).toBe(
      AnalyticsErrorCode.Forbidden,
    );
    expect(await codeOf(call({ callerUserId: RECEPTIONIST.id }))).toBe(
      AnalyticsErrorCode.Forbidden,
    );
    // A barber with no record, a barber naming a colleague, an admin naming an unknown record.
    expect(await codeOf(call({ callerUserId: UNLINKED.id }))).toBe(
      AnalyticsErrorCode.BarberNotLinked,
    );
    expect(await codeOf(call({ scopeBarberId: NIKO }))).toBe(
      AnalyticsErrorCode.Forbidden,
    );
    expect(
      await codeOf(
        call({ callerUserId: ADMIN.id, scopeBarberId: BarberId.of('b-ghost') }),
      ),
    ).toBe(AnalyticsErrorCode.ScopeUnknown);
    expect(store.size).toBe(0);
  });

  it('refuses a range that is no range through AnalyticsGoal.rangeOf, the field named', async () => {
    const { store, run } = rig();
    expect(unwrapErr(await run(call({ goalLowCents: cents(0) })))).toEqual({
      errorCode: AnalyticsErrorCode.GoalInvalidRange,
      field: 'goalLowCents',
    });
    expect(
      unwrapErr(await run(call({ goalHighCents: cents(179_999) }))),
    ).toEqual({
      errorCode: AnalyticsErrorCode.GoalInvalidRange,
      field: 'goalHighCents',
    });
    expect(store.size).toBe(0);
  });

  it('refuses a month other than the current or the next on the shop’s clock — a past month, two months on, a year away', async () => {
    const { store, run } = rig();
    for (const month of ['2026-08', '2026-11', '2027-09', '2025-09']) {
      expect(
        unwrapErr(await run(call({ goalMonth: MonthKey.of(month) }))),
      ).toEqual({
        errorCode: AnalyticsErrorCode.GoalInvalidRange,
        field: 'goalMonth',
      });
    }
    expect(store.size).toBe(0);
  });

  it('answers a store failure as the commit answers it', async () => {
    const failing: CommitPlan = async () =>
      Result.err({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'analyticsGoals/b-ivan__2026-09',
        reason: 'unavailable',
      });
    const { run } = rig(failing);
    expect(unwrapErr(await run(call())).errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
  });
});
