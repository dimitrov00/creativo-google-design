import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  AuditAction,
  Email,
  type Role,
  Role as RoleTag,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  LogEvent,
  OperationId,
  Result,
  UserId,
} from '@core/primitives';
import {
  GovernanceError,
  GovernanceErrorCode,
  RepositoryError,
} from '@core/errors';
import { Collections, type User } from '@core/entities';
import type { AuthSessionRevokePorts, CommitPlan } from '@core/ports';
import { AuditSystem } from '@core/systems';
import {
  auditRowsOf,
  blockedUserFixture,
  bodyOf,
  contendedCommit,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  provisionedUserFixture,
  recordingSessionRevokePorts,
  recordingTelemetry,
  registeredUserFixture,
  unwrapOk,
} from '@core/testing';
import {
  admitRolesCaller,
  type SetRolesCommand,
  setRoles,
} from './set-roles.pipeline';

/*
 * `setRoles` (security hardening S-WS-E, S-DEP-6): the caller gate on the
 * verified token first, then ONE commit that reads `users/{caller}` and
 * `users/{target}` and asks `RoleAssignmentSystem.decide` — a changed set
 * plans the `users` update (`roles` + the `profileEditedAtUtcMs` marker,
 * S-RU-12) and its ONE `PROFILE_ROLES_CHANGED` row; then, after the
 * commit and also when nothing changed, the target's sessions revoked
 * (S-RU-10, S-L-15, S-L-26). The failed revoke lives here, not in the
 * integration spec: the Auth emulator cannot make the Admin revoke fail.
 */

const ADMIN = UserId.of('u-admin');
const TARGET = UserId.of('u-client');
const OP = OperationId.of('op-roles-1');

/** The stored caller: a registered, active admin. */
const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [RoleTag.Admin],
});

/** The stored target: a registered client. */
const STORED_TARGET: User = registeredUserFixture({ id: TARGET });

/** PII sentinels on the stored target — a scan proves none reaches a log line or the row. */
const SENTINEL_TARGET: User = registeredUserFixture({
  id: TARGET,
  firstName: 'Sentinel Firstname',
  lastName: 'Sentinel Lastname',
  email: Email.of('sentinel@example.invalid'),
});

type RigOptions = {
  readonly caller?: User | null;
  readonly target?: User | null;
  /** How many revokes fail before one succeeds (each answers `PIPELINE_UNAVAILABLE`). */
  readonly failingRevokes?: number;
  /** Wraps the commit (a contention re-run). */
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

/** The ports over a store holding `caller` and `target` (`null`: no document). */
function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const target = options.target === undefined ? STORED_TARGET : options.target;
  const seeded = [caller, target].flatMap((user) =>
    user === null
      ? []
      : [{ path: [Collections.Users, user.id], body: bodyOf(user) }],
  );
  const store = memoryStore(seeded);
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const failing = recordingSessionRevokePorts({ failing: true });
  const revoke = recordingSessionRevokePorts();
  const failures = options.failingRevokes ?? 0;
  /** Every uid asked, failed or not, in order. */
  const asked: UserId[] = [];
  /** The number of plans committed when each revoke was asked — the order proof. */
  const plansAtRevoke: number[] = [];
  const revokePorts: AuthSessionRevokePorts = {
    revokeRefreshTokens: (uid) => {
      asked.push(uid);
      plansAtRevoke.push(tx.plans.length);
      return failing.revoked.length < failures
        ? failing.ports.revokeRefreshTokens(uid)
        : revoke.ports.revokeRefreshTokens(uid);
    },
  };
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  const run = setRoles({ ...tx, commit, ...telemetry, ...revokePorts });
  return { store, tx, telemetry, revoke, asked, plansAtRevoke, run };
}

const call = (extra: Partial<SetRolesCommand> = {}): SetRolesCommand => ({
  adminUserId: ADMIN,
  adminRoles: [RoleTag.Admin],
  targetUserId: TARGET,
  roles: [RoleTag.Barber, RoleTag.Client],
  operationId: OP,
  ...extra,
});

/** The plan a client → client + barber promotion commits, row under `hash(basis)`. */
function promotionPlan(actor: Actor, operationId: OperationId | null) {
  const assignment = {
    rolesFrom: [RoleTag.Client],
    rolesTo: [RoleTag.Client, RoleTag.Barber],
    rolesChanged: true,
  } as const;
  const row = AuditSystem.planRolesChanged(
    TARGET,
    assignment,
    actor,
    FIXTURE_NOW_UTC_MS,
    operationId,
  );
  return [
    WriteOp.update([Collections.Users, TARGET], {
      roles: [RoleTag.Client, RoleTag.Barber],
      profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
    }),
    WriteOp.create(
      [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
      row.row,
    ),
  ];
}

const msgs = (lines: readonly { readonly msg: string }[]) =>
  lines.map((line) => line.msg);

describe('setRoles', () => {
  describe('a changed set', () => {
    it('commits the users update and its ONE row in one plan, then revokes once, after the commit', async () => {
      const { tx, revoke, plansAtRevoke, run } = rig();
      const answer = await run(call());
      expect(answer).toEqual(
        Result.ok({
          targetUserId: TARGET,
          roles: [RoleTag.Client, RoleTag.Barber],
          rolesChanged: true,
        }),
      );
      // The callable answers this value as it is: exactly the wire's keys.
      expect(Object.keys(unwrapOk(answer))).toEqual([
        'targetUserId',
        'roles',
        'rolesChanged',
      ]);
      expect(tx.plans).toEqual([promotionPlan(Actor.admin(ADMIN), OP)]);
      expect(revoke.revoked).toEqual([TARGET]);
      expect(plansAtRevoke).toEqual([1]);
    });

    it('writes the roles in dictionary order and stamps the marker the profile trigger skips on (S-RU-12)', async () => {
      const { store, run } = rig();
      await run(
        call({ roles: [RoleTag.Barber, RoleTag.Client, RoleTag.Barber] }),
      );
      const body = store.get(`${Collections.Users}/${TARGET}`);
      expect(body?.['roles']).toEqual([RoleTag.Client, RoleTag.Barber]);
      expect(body?.['profileEditedAtUtcMs']).toBe(FIXTURE_NOW_UTC_MS);
      // The stamp moved off the stored `null` — what the profile trigger
      // reads as "audited by a callable" (the integration spec runs it).
      expect(STORED_TARGET.profileEditedAtUtcMs ?? null).toBeNull();
    });

    it('writes ONE PROFILE_ROLES_CHANGED row — the roles as tags, the target, the operation id', async () => {
      const { tx, run } = rig();
      await run(call());
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        auditAction: AuditAction.ProfileRolesChanged,
        profileFields: ['roles'],
        profileRolesFrom: [RoleTag.Client],
        profileRolesTo: [RoleTag.Client, RoleTag.Barber],
        auditOperationId: OP,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      });
    });

    it('credits the STORED roles, never the token’s — a token [admin, barber] against stored [admin] credits [admin] (LS-11)', async () => {
      const { tx, run } = rig();
      await run(call({ adminRoles: [RoleTag.Admin, RoleTag.Barber] }));
      expect(tx.plans).toEqual([promotionPlan(Actor.admin(ADMIN), OP)]);
    });

    it('names no operation id when the call sent none (RU-21)', async () => {
      const { tx, run } = rig();
      await run(call({ operationId: null }));
      expect(tx.plans).toEqual([promotionPlan(Actor.admin(ADMIN), null)]);
    });

    it('logs roles.changed (ids and a count) and roles.sessions_revoked { targetUserId, rolesChanged } — no name, no contact', async () => {
      const { telemetry, run } = rig({ target: SENTINEL_TARGET });
      await run(call());
      expect(telemetry.lines).toEqual([
        {
          level: 'info',
          msg: LogEvent.RolesChanged,
          fields: { targetUserId: TARGET, rolesCount: 2 },
        },
        {
          level: 'info',
          msg: LogEvent.RolesSessionsRevoked,
          fields: { targetUserId: TARGET, rolesChanged: true },
        },
      ]);
      const serialised = JSON.stringify(telemetry.lines);
      for (const sentinel of [
        'Sentinel Firstname',
        'Sentinel Lastname',
        'sentinel@example.invalid',
      ]) {
        expect(serialised).not.toContain(sentinel);
      }
    });

    it('derives the same plan, row id included, when the transaction re-runs (contention)', async () => {
      let decisions: readonly (readonly WriteOp[])[] = [];
      const { tx, run } = rig({
        commit: (commit) => {
          const contended = contendedCommit(commit);
          decisions = contended.decisions;
          return contended.commit;
        },
      });
      await run(call());
      expect(decisions).toHaveLength(2);
      expect(decisions[0]).toEqual(decisions[1]);
      expect(tx.plans).toEqual([decisions[1]]);
    });

    it('demotes as it promotes — barber + client → client', async () => {
      const { tx, run } = rig({
        target: registeredUserFixture({
          id: TARGET,
          roles: [RoleTag.Barber, RoleTag.Client],
        }),
      });
      const answer = await run(call({ roles: [RoleTag.Client] }));
      expect(unwrapOk(answer)).toEqual({
        targetUserId: TARGET,
        roles: [RoleTag.Client],
        rolesChanged: true,
      });
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        // `rolesFrom` is the stored array as stored; `rolesTo` dictionary order.
        profileRolesFrom: [RoleTag.Barber, RoleTag.Client],
        profileRolesTo: [RoleTag.Client],
      });
    });
  });

  describe('an unchanged set', () => {
    it('commits no write and no row, still revokes, and logs the revoke with rolesChanged: false (S-L-15, S-L-26)', async () => {
      const { tx, revoke, telemetry, run } = rig();
      const answer = await run(call({ roles: [RoleTag.Client] }));
      expect(answer).toEqual(
        Result.ok({
          targetUserId: TARGET,
          roles: [RoleTag.Client],
          rolesChanged: false,
        }),
      );
      expect(tx.plans).toEqual([[]]);
      expect(auditRowsOf(tx.plans)).toEqual([]);
      expect(revoke.revoked).toEqual([TARGET]);
      expect(telemetry.lines).toEqual([
        {
          level: 'info',
          msg: LogEvent.RolesSessionsRevoked,
          fields: { targetUserId: TARGET, rolesChanged: false },
        },
      ]);
    });

    it('a replay with the same operation id after success plans no row — the set is already written', async () => {
      const { tx, revoke, run } = rig();
      unwrapOk(await run(call()));
      const replay = await run(call());
      expect(unwrapOk(replay).rolesChanged).toBe(false);
      expect(tx.plans).toHaveLength(2);
      expect(tx.plans[1]).toEqual([]);
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
      expect(revoke.revoked).toEqual([TARGET, TARGET]);
    });
  });

  describe('a failed revoke (S-RU-10)', () => {
    it('answers GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED with the roles committed, and logs roles.sessions_not_revoked', async () => {
      const { store, tx, telemetry, run } = rig({ failingRevokes: 1 });
      const answer = await run(call());
      expect(answer).toEqual(
        Result.err(GovernanceError.rolesSessionsNotRevoked(TARGET)),
      );
      expect(tx.plans).toEqual([promotionPlan(Actor.admin(ADMIN), OP)]);
      expect(store.get(`${Collections.Users}/${TARGET}`)?.['roles']).toEqual([
        RoleTag.Client,
        RoleTag.Barber,
      ]);
      expect(telemetry.lines).toEqual([
        {
          level: 'info',
          msg: LogEvent.RolesChanged,
          fields: { targetUserId: TARGET, rolesCount: 2 },
        },
        {
          level: 'error',
          msg: LogEvent.RolesSessionsNotRevoked,
          fields: { targetUserId: TARGET, errorCode: 'PIPELINE_UNAVAILABLE' },
        },
      ]);
    });

    it('the retry of the same act re-sends the stored set: no second row, and the revoke finishes', async () => {
      const { tx, asked, telemetry, run } = rig({ failingRevokes: 1 });
      const first = await run(call());
      expect(first.ok).toBe(false);
      const retry = await run(call());
      expect(retry).toEqual(
        Result.ok({
          targetUserId: TARGET,
          roles: [RoleTag.Client, RoleTag.Barber],
          rolesChanged: false,
        }),
      );
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
      expect(asked).toEqual([TARGET, TARGET]);
      expect(msgs(telemetry.lines)).toEqual([
        LogEvent.RolesChanged,
        LogEvent.RolesSessionsNotRevoked,
        LogEvent.RolesSessionsRevoked,
      ]);
    });
  });

  describe('refusals commit nothing and never revoke', () => {
    const refusals: readonly {
      readonly name: string;
      readonly options: RigOptions;
      readonly cmd: Partial<SetRolesCommand>;
      readonly code: GovernanceErrorCode;
    }[] = [
      {
        name: 'no session',
        options: {},
        cmd: { adminUserId: null },
        code: GovernanceErrorCode.RolesUnauthenticated,
      },
      {
        name: 'a token holding no admin',
        options: {},
        cmd: { adminRoles: [RoleTag.Barber, RoleTag.Sysadmin] },
        code: GovernanceErrorCode.RolesForbidden,
      },
      {
        name: 'a token admin whose stored roles hold none',
        options: {
          caller: registeredUserFixture({ id: ADMIN, roles: [RoleTag.Barber] }),
        },
        cmd: {},
        code: GovernanceErrorCode.RolesForbidden,
      },
      {
        name: 'a token admin with no stored account',
        options: { caller: null },
        cmd: {},
        code: GovernanceErrorCode.RolesForbidden,
      },
      {
        name: 'a stored admin blocked now',
        options: {
          caller: blockedUserFixture({ id: ADMIN, roles: [RoleTag.Admin] }),
        },
        cmd: {},
        code: GovernanceErrorCode.RolesForbidden,
      },
      {
        name: 'one’s own roles',
        options: {},
        cmd: { targetUserId: ADMIN },
        code: GovernanceErrorCode.RolesSelf,
      },
      {
        name: 'an absent target',
        options: { target: null },
        cmd: {},
        code: GovernanceErrorCode.RolesTargetNotFound,
      },
      {
        name: 'an ERASED target',
        options: {
          target: registeredUserFixture({
            id: TARGET,
            ...AccountLifecycle.erase(FIXTURE_NOW_UTC_MS),
          }),
        },
        cmd: {},
        code: GovernanceErrorCode.RolesTargetErased,
      },
      {
        name: 'a PROVISIONED target',
        options: { target: provisionedUserFixture({ id: TARGET }) },
        cmd: {},
        code: GovernanceErrorCode.RolesTargetNotRegistered,
      },
      {
        name: 'a sysadmin target',
        options: {
          target: registeredUserFixture({
            id: TARGET,
            roles: [RoleTag.Sysadmin],
          }),
        },
        cmd: {},
        code: GovernanceErrorCode.RolesTargetSysadmin,
      },
      {
        name: 'an empty set',
        options: {},
        cmd: { roles: [] },
        code: GovernanceErrorCode.RolesInvalid,
      },
      {
        name: 'the sysadmin requested',
        options: {},
        cmd: { roles: [RoleTag.Client, RoleTag.Sysadmin] },
        code: GovernanceErrorCode.RolesInvalid,
      },
    ];

    for (const refusal of refusals) {
      it(`${refusal.name} → ${refusal.code}`, async () => {
        const { tx, revoke, telemetry, run } = rig(refusal.options);
        const answer = await run(call(refusal.cmd));
        expect(answer.ok).toBe(false);
        if (!answer.ok) expect(answer.error.errorCode).toBe(refusal.code);
        expect(tx.plans).toEqual([]);
        expect(revoke.revoked).toEqual([]);
        expect(telemetry.lines).toEqual([
          {
            level: 'info',
            msg: LogEvent.RolesChangeRefused,
            fields: { errorCode: refusal.code },
          },
        ]);
      });
    }

    it('the token gate refuses before any read', async () => {
      const { tx, run } = rig();
      await run(call({ adminUserId: null }));
      await run(call({ adminRoles: [RoleTag.Client] }));
      expect(tx.transactions).toEqual([]);
    });
  });

  it('a store failure answers as the commit answers it — no refusal line, no revoke', async () => {
    const failed = RepositoryError.writeFailed(null, 'unavailable');
    const { revoke, telemetry, run } = rig({
      commit: () => async () => Result.err(failed),
    });
    expect(await run(call())).toEqual(Result.err(failed));
    expect(revoke.revoked).toEqual([]);
    expect(msgs(telemetry.lines)).toEqual([]);
  });

  describe('admitRolesCaller — the gate the wire shares', () => {
    it('admits a verified uid whose claims hold admin', () => {
      expect(admitRolesCaller(ADMIN, [RoleTag.Barber, RoleTag.Admin])).toEqual(
        Result.ok(ADMIN),
      );
    });

    it('refuses no session, then a token with no admin — the sysadmin included (S-RU-14)', () => {
      expect(admitRolesCaller(null, [RoleTag.Admin])).toEqual(
        Result.err(GovernanceError.rolesUnauthenticated()),
      );
      const roles: readonly Role[] = [RoleTag.Sysadmin];
      expect(admitRolesCaller(ADMIN, roles)).toEqual(
        Result.err(GovernanceError.rolesForbidden(ADMIN)),
      );
    });
  });
});
