import { describe, expect, it } from 'vitest';
import {
  Actor,
  BarberLifecycle,
  BarberStatus,
  Role,
  SystemSource,
} from '@core/components';
import {
  BarberId,
  LocalDate,
  LogEvent,
  Result,
  UserId,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import {
  type Barber,
  BARBER_LINK_DOC,
  Collections,
  Subcollections,
  type User,
} from '@core/entities';
import type { AuthSessionRevokePorts, CommitPlan } from '@core/ports';
import {
  auditRowsOf,
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  recordingSessionRevokePorts,
  recordingTelemetry,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { closeBarberPeriod } from './close-barber-period.pipeline';
import { closeEndedPeriods } from './close-ended-periods.pipeline';

/*
 * The close of a barber's working period (team onboarding D10):
 * `closeBarberPeriod` — one record, its account, lock and roster in ONE
 * commit, then the revoke and its marker — and `closeEndedPeriods`, the
 * daily run over every record that is due.
 */

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const STEFAN = BarberId.of('stefan');
const CENTER = FIXTURE_IDS.location;
const NOW = FIXTURE_NOW_UTC_MS;
const TODAY = FIXTURE_TODAY;
const YESTERDAY = LocalDate.addDays(TODAY, -1);
const JOB = Actor.system(SystemSource.ScheduledJob);

const accountOf = (
  barberId: BarberId,
  roles: readonly Role[] = [Role.Client, Role.Barber],
): User =>
  registeredUserFixture({
    id: UserId.of(`u-${barberId}`),
    roles,
    linkedBarberId: barberId,
  });

/** A working barber whose last day was yesterday. */
const ended = (id: BarberId, last: LocalDate = YESTERDAY): Barber =>
  barberFixture({ id, barberLastWorkingLocalDate: last });

const lockPath = (barberId: BarberId): string =>
  `${Collections.Barbers}/${barberId}/${Subcollections.Restricted}/${BARBER_LINK_DOC}`;

type RigOptions = {
  readonly barbers?: readonly Barber[];
  /** The accounts linked to those records, each with its lock. */
  readonly accounts?: readonly User[];
  /** The records that have a roster. */
  readonly rostered?: readonly BarberId[];
  /** How many revokes fail before they start to land. */
  readonly failingRevokes?: number;
  readonly zoneFails?: boolean;
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const store = memoryStore([
    ...(options.barbers ?? [ended(IVAN)]).map((barber) => ({
      path: [Collections.Barbers, barber.id],
      body: bodyOf(barber),
    })),
    ...(options.accounts ?? []).flatMap((account) => [
      { path: [Collections.Users, account.id], body: bodyOf(account) },
      {
        path: [
          Collections.Barbers,
          account.linkedBarberId ?? '',
          Subcollections.Restricted,
          BARBER_LINK_DOC,
        ],
        body: { linkedUserId: account.id },
      },
    ]),
    ...(options.rostered ?? []).map((id) => ({
      path: [Collections.BarberSchedules, id],
      body: bodyOf(barberScheduleFixture({ id })),
    })),
  ]);
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const failing = recordingSessionRevokePorts({ failing: true });
  const landing = recordingSessionRevokePorts();
  const failures = options.failingRevokes ?? 0;
  /** Every account a revoke was asked for, failed or not, in order. */
  const asked: UserId[] = [];
  const revoke: AuthSessionRevokePorts = {
    revokeRefreshTokens: (uid) => {
      asked.push(uid);
      return failing.revoked.length < failures
        ? failing.ports.revokeRefreshTokens(uid)
        : landing.ports.revokeRefreshTokens(uid);
    },
  };
  const ports = {
    ...tx,
    commit: options.commit ? options.commit(tx.commit) : tx.commit,
    ...revoke,
    ...telemetry,
    defaultLocationId: CENTER,
    loadLocation: async (id: typeof CENTER) =>
      options.zoneFails === true
        ? Result.err({
            errorCode: RepositoryErrorCode.ReadFailed,
            path: `${Collections.Locations}/${id}`,
            reason: 'unavailable',
          })
        : Result.ok(id === CENTER ? locationFixture() : null),
  };
  return {
    store,
    tx,
    telemetry,
    asked,
    close: closeBarberPeriod(ports),
    run: closeEndedPeriods(ports),
  };
}

const record = (store: ReturnType<typeof memoryStore>, id: BarberId) =>
  store.get(`${Collections.Barbers}/${id}`);

describe('closeBarberPeriod — one record’s close', () => {
  it('ONE commit: the record DEPARTED, the account a client with no link, the lock released, the roster closed — then the revoke, then its marker', async () => {
    const { store, tx, asked, close } = rig({
      accounts: [accountOf(IVAN)],
      rostered: [IVAN],
    });

    expect(
      unwrapOk(await close({ barberId: IVAN, today: TODAY, actor: JOB })),
    ).toEqual({ closed: true, revokeOwed: false });

    // The close, then the marker: two plans.
    expect(tx.plans).toHaveLength(2);
    expect(record(store, IVAN)).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberStatusChangedAtUtcMs: NOW,
      barberDepartedUserId: 'u-ivan',
      barberSessionsRevokedAtUtcMs: NOW,
      barberKeptAccessUserId: null,
      barberRehireStatus: BarberStatus.Public,
      barberLastWorkingLocalDate: YESTERDAY,
    });
    expect(store.get(`${Collections.Users}/u-ivan`)).toMatchObject({
      roles: [Role.Client],
      linkedBarberId: null,
      profileEditedAtUtcMs: NOW,
    });
    expect(store.get(lockPath(IVAN))).toBeUndefined();
    expect(store.get(`${Collections.BarberSchedules}/${IVAN}`)).toMatchObject({
      versions: [{ effectiveToLocalDate: YESTERDAY }],
    });
    expect(asked).toEqual(['u-ivan']);

    // The close's two rows share its name; the marker's row has its own.
    const rows = auditRowsOf(tx.plans);
    expect(rows.map((row) => row.auditAction)).toEqual([
      'TEAM_BARBER_STATUS_CHANGED',
      'PROFILE_ROLES_CHANGED',
      'TEAM_BARBER_STATUS_CHANGED',
    ]);
    expect(rows[0]?.auditOperationId).toBe(rows[1]?.auditOperationId);
    expect(rows[2]?.auditOperationId).not.toBe(rows[0]?.auditOperationId);
    for (const row of rows) expect(row).toMatchObject(JOB);
  });

  it('revokes only AFTER the roles are written', async () => {
    const store = memoryStore([
      { path: [Collections.Barbers, IVAN], body: bodyOf(ended(IVAN)) },
      { path: [Collections.Users, 'u-ivan'], body: bodyOf(accountOf(IVAN)) },
      {
        path: [
          Collections.Barbers,
          IVAN,
          Subcollections.Restricted,
          BARBER_LINK_DOC,
        ],
        body: { linkedUserId: 'u-ivan' },
      },
    ]);
    const tx = memoryTxPorts(store);
    /** How many plans had landed when the revoke was asked. */
    let plansAtRevoke = -1;
    await closeBarberPeriod({
      ...tx,
      ...recordingTelemetry(),
      revokeRefreshTokens: async () => {
        plansAtRevoke = tx.plans.length;
        return Result.ok(undefined);
      },
    })({ barberId: IVAN, today: TODAY, actor: JOB });
    expect(plansAtRevoke).toBe(1);
  });

  it('a record with no account leaves with nobody to sign out', async () => {
    const { store, tx, asked, close } = rig();
    expect(
      unwrapOk(await close({ barberId: IVAN, today: TODAY, actor: JOB })),
    ).toEqual({ closed: true, revokeOwed: false });
    expect(tx.plans).toHaveLength(1);
    expect(asked).toEqual([]);
    expect(record(store, IVAN)).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberDepartedUserId: null,
    });
  });

  it('a revoke that fails leaves the record owing: departed, the marker unset, logged — and the next run ends the sessions and marks it, writing nothing else', async () => {
    const { store, tx, telemetry, asked, close } = rig({
      accounts: [accountOf(IVAN)],
      failingRevokes: 1,
    });

    expect(
      unwrapOk(await close({ barberId: IVAN, today: TODAY, actor: JOB })),
    ).toEqual({ closed: true, revokeOwed: true });
    expect(record(store, IVAN)).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberDepartedUserId: 'u-ivan',
      barberSessionsRevokedAtUtcMs: null,
    });
    expect(
      telemetry.lines.filter(
        (line) => line.msg === LogEvent.TeamSessionsNotRevoked,
      ),
    ).toEqual([
      {
        level: 'error',
        msg: LogEvent.TeamSessionsNotRevoked,
        fields: { barberId: IVAN, errorCode: 'PIPELINE_UNAVAILABLE' },
      },
    ]);

    const before = tx.plans.length;
    expect(
      unwrapOk(await close({ barberId: IVAN, today: TODAY, actor: JOB })),
    ).toEqual({ closed: false, revokeOwed: false });
    expect(asked).toEqual(['u-ivan', 'u-ivan']);
    expect(record(store, IVAN)).toMatchObject({
      barberSessionsRevokedAtUtcMs: NOW,
    });
    // The second run: an empty close, then the marker alone.
    expect(tx.plans.slice(before).map((plan) => plan.length)).toEqual([0, 2]);

    // Settled: a third run asks nobody and writes nothing.
    await close({ barberId: IVAN, today: TODAY, actor: JOB });
    expect(asked).toHaveLength(2);
    expect(tx.plans.at(-1)).toEqual([]);
  });

  it('an admin’s roles are left alone, and nobody is signed out', async () => {
    const { store, asked, close } = rig({
      accounts: [accountOf(IVAN, [Role.Barber, Role.Admin])],
    });
    await close({ barberId: IVAN, today: TODAY, actor: JOB });
    expect(store.get(`${Collections.Users}/u-ivan`)).toMatchObject({
      roles: [Role.Barber, Role.Admin],
      linkedBarberId: null,
    });
    expect(store.get(lockPath(IVAN))).toBeUndefined();
    expect(record(store, IVAN)).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberDepartedUserId: null,
    });
    expect(asked).toEqual([]);
  });

  it('writes nothing for a period that has not ended, a record that is gone, and one that left already', async () => {
    const working = rig({ barbers: [ended(IVAN, TODAY)] });
    expect(
      unwrapOk(
        await working.close({ barberId: IVAN, today: TODAY, actor: JOB }),
      ),
    ).toEqual({ closed: false, revokeOwed: false });
    expect(working.tx.plans).toEqual([[]]);

    const gone = rig({ barbers: [] });
    expect(
      unwrapOk(await gone.close({ barberId: IVAN, today: TODAY, actor: JOB })),
    ).toEqual({ closed: false, revokeOwed: false });

    const left = rig({
      barbers: [
        barberFixture(
          { id: IVAN, barberLastWorkingLocalDate: YESTERDAY },
          BarberLifecycle.depart(NOW, null, BarberStatus.Public),
        ),
      ],
    });
    await left.close({ barberId: IVAN, today: TODAY, actor: JOB });
    expect(left.tx.plans).toEqual([[]]);
    expect(left.asked).toEqual([]);
  });

  it('derives the same plan when the transaction re-runs (contention)', async () => {
    let decisions: readonly (readonly unknown[])[] = [];
    const { tx, close } = rig({
      accounts: [accountOf(IVAN)],
      commit: (commit) => {
        const contended = contendedCommit(commit);
        decisions = contended.decisions;
        return contended.commit;
      },
    });
    await close({ barberId: IVAN, today: TODAY, actor: JOB });
    expect(decisions[0]).toEqual(decisions[1]);
    expect(tx.plans[0]).toEqual(decisions[1]);
  });
});

describe('closeEndedPeriods — the daily run', () => {
  it('closes every record whose last day is behind the shop’s today, and leaves the rest working', async () => {
    const { store, asked, run } = rig({
      barbers: [
        ended(IVAN),
        // Works the last day through.
        ended(NIKO, TODAY),
        barberFixture({ id: STEFAN }),
      ],
      accounts: [accountOf(IVAN), accountOf(NIKO)],
    });

    expect(unwrapOk(await run())).toEqual({
      closedBarberIds: [IVAN],
      revokeOwedBarberIds: [],
      failedBarberIds: [],
    });
    expect(record(store, IVAN)?.['barberStatus']).toBe(BarberStatus.Departed);
    expect(record(store, NIKO)?.['barberStatus']).toBe(BarberStatus.Public);
    expect(record(store, STEFAN)?.['barberStatus']).toBe(BarberStatus.Public);
    expect(asked).toEqual(['u-ivan']);
    expect(store.get(`${Collections.Users}/u-niko`)).toMatchObject({
      roles: [Role.Client, Role.Barber],
    });
  });

  it('catches up a run that was missed: a last day long behind today still closes', async () => {
    const { store, run } = rig({
      barbers: [ended(IVAN, LocalDate.addDays(TODAY, -40))],
    });
    expect(unwrapOk(await run()).closedBarberIds).toEqual([IVAN]);
    expect(record(store, IVAN)?.['barberStatus']).toBe(BarberStatus.Departed);
  });

  it('a second run changes nothing', async () => {
    const { tx, asked, run } = rig({ accounts: [accountOf(IVAN)] });
    await run();
    const written = tx.plans.filter((plan) => plan.length > 0).length;
    expect(unwrapOk(await run())).toEqual({
      closedBarberIds: [],
      revokeOwedBarberIds: [],
      failedBarberIds: [],
    });
    expect(tx.plans.filter((plan) => plan.length > 0)).toHaveLength(written);
    expect(asked).toEqual(['u-ivan']);
  });

  it('a revoke that failed is retried by the next run', async () => {
    const { store, asked, run } = rig({
      accounts: [accountOf(IVAN)],
      failingRevokes: 1,
    });
    expect(unwrapOk(await run())).toEqual({
      closedBarberIds: [IVAN],
      revokeOwedBarberIds: [IVAN],
      failedBarberIds: [],
    });
    expect(unwrapOk(await run())).toEqual({
      closedBarberIds: [],
      revokeOwedBarberIds: [],
      failedBarberIds: [],
    });
    expect(asked).toEqual(['u-ivan', 'u-ivan']);
    expect(record(store, IVAN)).toMatchObject({
      barberSessionsRevokedAtUtcMs: NOW,
    });
  });

  it('isolates a failure: one record that cannot be written is logged, and the rest still close', async () => {
    let commits = 0;
    const { store, telemetry, run } = rig({
      barbers: [ended(IVAN), ended(NIKO)],
      commit: (commit) => (read, decide) => {
        commits += 1;
        // The list is the first commit; Ivan's close is the second.
        return commits === 2
          ? Promise.resolve(
              Result.err({
                errorCode: RepositoryErrorCode.WriteFailed,
                path: `${Collections.Barbers}/${IVAN}`,
                reason: 'aborted',
              }),
            )
          : commit(read, decide);
      },
    });

    expect(unwrapOk(await run())).toEqual({
      closedBarberIds: [NIKO],
      revokeOwedBarberIds: [],
      failedBarberIds: [IVAN],
    });
    expect(record(store, IVAN)?.['barberStatus']).toBe(BarberStatus.Public);
    expect(record(store, NIKO)?.['barberStatus']).toBe(BarberStatus.Departed);
    expect(telemetry.lines).toContainEqual({
      level: 'error',
      msg: LogEvent.TeamPeriodCloseFailed,
      fields: { barberId: IVAN, error: RepositoryErrorCode.WriteFailed },
    });
  });

  it('a shop clock that cannot be read is the run’s store failure: nothing is read or written', async () => {
    const { tx, run } = rig({ zoneFails: true });
    expect(unwrapErr(await run()).errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
    expect(tx.plans).toEqual([]);
  });
});
