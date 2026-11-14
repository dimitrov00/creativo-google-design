import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  AuditAction,
  BarberLinkRequest,
  Email,
  type Role,
  Role as RoleTag,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
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
import {
  BARBER_LINK_DOC,
  Collections,
  Subcollections,
  type User,
} from '@core/entities';
import type { AuthSessionRevokePorts, CommitPlan } from '@core/ports';
import { AuditSystem } from '@core/systems';
import {
  auditRowsOf,
  barberFixture,
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
const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const OTHER = UserId.of('u-other');

/** `barbers/{id}/restricted/link`, as a path. */
const lockPath = (barberId: BarberId) => [
  Collections.Barbers,
  barberId,
  Subcollections.Restricted,
  BARBER_LINK_DOC,
];
const lockKey = (barberId: BarberId) => lockPath(barberId).join('/');

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
  /** The barber records stored (default `ivan` and `niko`). */
  readonly barbers?: readonly BarberId[];
  /** The record locks stored, each naming its account. */
  readonly locks?: readonly (readonly [BarberId, UserId])[];
};

/** The ports over a store holding `caller` and `target` (`null`: no document). */
function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const target = options.target === undefined ? STORED_TARGET : options.target;
  const seeded = [
    ...[caller, target].flatMap((user) =>
      user === null
        ? []
        : [{ path: [Collections.Users, user.id], body: bodyOf(user) }],
    ),
    ...(options.barbers ?? [IVAN, NIKO]).map((id) => ({
      path: [Collections.Barbers, id],
      body: bodyOf(barberFixture({ id })),
    })),
    ...(options.locks ?? []).map(([barberId, linkedUserId]) => ({
      path: lockPath(barberId),
      body: { linkedUserId },
    })),
  ];
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

/**
 * The call: a `SET` to `ivan` when the set holds the barber role (granting
 * it needs a record), else `KEEP` — so each roles case keeps its intent;
 * a link case names its own request.
 */
const call = (
  extra: Partial<SetRolesCommand> = {},
  link: BarberLinkRequest | null = null,
): SetRolesCommand => {
  const roles = extra.roles ?? [RoleTag.Barber, RoleTag.Client];
  return {
    adminUserId: ADMIN,
    adminRoles: [RoleTag.Admin],
    targetUserId: TARGET,
    roles,
    operationId: OP,
    ...(link ??
      (roles.includes(RoleTag.Barber)
        ? BarberLinkRequest.set(IVAN)
        : BarberLinkRequest.KEEP)),
    ...extra,
  } as SetRolesCommand;
};
/** A stored barber, linked to `linked` (or not). */
const storedBarber = (linked: BarberId | null): User =>
  registeredUserFixture({
    id: TARGET,
    roles: [RoleTag.Barber],
    linkedBarberId: linked,
  });

/** The plan a client → client + barber promotion commits, row under `hash(basis)`. */
function promotionPlan(actor: Actor, operationId: OperationId | null) {
  const assignment = {
    rolesFrom: [RoleTag.Client],
    rolesTo: [RoleTag.Client, RoleTag.Barber],
    rolesChanged: true,
    linkedBarberIdFrom: null,
    linkedBarberIdTo: IVAN,
    linkChanged: true,
    lockReleased: null,
    lockTaken: IVAN,
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
      linkedBarberId: IVAN,
      profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
    }),
    WriteOp.set(lockPath(IVAN), { linkedUserId: TARGET }),
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
          linkedBarberId: IVAN,
          linkChanged: true,
        }),
      );
      // The callable answers this value as it is: exactly the wire's keys.
      expect(Object.keys(unwrapOk(answer))).toEqual([
        'targetUserId',
        'roles',
        'rolesChanged',
        'linkedBarberId',
        'linkChanged',
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
        profileFields: ['roles', 'linkedBarberId'],
        profileLinkedBarberIdFrom: null,
        profileLinkedBarberIdTo: IVAN,
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
          fields: {
            targetUserId: TARGET,
            rolesCount: 2,
            rolesChanged: true,
            linkChanged: true,
          },
        },
        {
          level: 'info',
          msg: LogEvent.RolesSessionsRevoked,
          fields: {
            targetUserId: TARGET,
            rolesChanged: true,
            linkChanged: true,
          },
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
        linkedBarberId: null,
        linkChanged: false,
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
          linkedBarberId: null,
          linkChanged: false,
        }),
      );
      expect(tx.plans).toEqual([[]]);
      expect(auditRowsOf(tx.plans)).toEqual([]);
      expect(revoke.revoked).toEqual([TARGET]);
      expect(telemetry.lines).toEqual([
        {
          level: 'info',
          msg: LogEvent.RolesSessionsRevoked,
          fields: {
            targetUserId: TARGET,
            rolesChanged: false,
            linkChanged: false,
          },
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
          fields: {
            targetUserId: TARGET,
            rolesCount: 2,
            rolesChanged: true,
            linkChanged: true,
          },
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
          linkedBarberId: IVAN,
          linkChanged: false,
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

  describe('the barber link (staff analytics, the setRoles table)', () => {
    it('reads the target, the caller, the SET record and its lock in one round, then the current record’s lock', async () => {
      const { tx, run } = rig({
        target: storedBarber(IVAN),
        locks: [[IVAN, TARGET]],
      });
      unwrapOk(
        await run(
          call({ roles: [RoleTag.Barber] }, BarberLinkRequest.set(NIKO)),
        ),
      );
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        [Collections.Users, TARGET],
        [Collections.Barbers, NIKO],
        lockPath(NIKO),
        lockPath(IVAN),
      ]);
    });

    it('a KEEP call reads no barber record and no lock when the target is unlinked', async () => {
      const { tx, run } = rig();
      unwrapOk(await run(call({ roles: [RoleTag.Client] })));
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        [Collections.Users, TARGET],
      ]);
    });

    it('a link set (roles unchanged): the user field, the new lock and ONE row; the marker stamped; sessions revoked', async () => {
      const { store, tx, revoke, run } = rig({ target: storedBarber(null) });
      const answer = unwrapOk(
        await run(
          call({ roles: [RoleTag.Barber] }, BarberLinkRequest.set(IVAN)),
        ),
      );
      expect(answer).toEqual({
        targetUserId: TARGET,
        roles: [RoleTag.Barber],
        rolesChanged: false,
        linkedBarberId: IVAN,
        linkChanged: true,
      });
      const plan = tx.plans[0] ?? [];
      expect(plan.slice(0, 2)).toEqual([
        WriteOp.update([Collections.Users, TARGET], {
          linkedBarberId: IVAN,
          profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
        WriteOp.set(lockPath(IVAN), { linkedUserId: TARGET }),
      ]);
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        auditAction: AuditAction.ProfileRolesChanged,
        profileFields: ['linkedBarberId'],
        profileRolesFrom: null,
        profileRolesTo: null,
        profileLinkedBarberIdFrom: null,
        profileLinkedBarberIdTo: IVAN,
      });
      expect(store.get(lockKey(IVAN))).toEqual({ linkedUserId: TARGET });
      expect(store.get(`${Collections.Users}/${TARGET}`)?.['roles']).toEqual([
        RoleTag.Barber,
      ]);
      // S-L-15: setRoles revokes after every call, a link-only change included.
      expect(revoke.revoked).toEqual([TARGET]);
    });

    it('a relink: the old lock released, the new one taken, the field moved', async () => {
      const { store, tx, run } = rig({
        target: storedBarber(IVAN),
        locks: [[IVAN, TARGET]],
      });
      unwrapOk(
        await run(
          call({ roles: [RoleTag.Barber] }, BarberLinkRequest.set(NIKO)),
        ),
      );
      expect((tx.plans[0] ?? []).slice(0, 3)).toEqual([
        WriteOp.update([Collections.Users, TARGET], {
          linkedBarberId: NIKO,
          profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
        WriteOp.remove(lockPath(IVAN)),
        WriteOp.set(lockPath(NIKO), { linkedUserId: TARGET }),
      ]);
      expect(store.get(lockKey(IVAN))).toBeUndefined();
      expect(store.get(lockKey(NIKO))).toEqual({ linkedUserId: TARGET });
      expect(
        store.get(`${Collections.Users}/${TARGET}`)?.['linkedBarberId'],
      ).toBe(NIKO);
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        profileLinkedBarberIdFrom: IVAN,
        profileLinkedBarberIdTo: NIKO,
      });
    });

    it('removing the barber role clears the link and releases its lock', async () => {
      const { store, tx, run } = rig({
        target: registeredUserFixture({
          id: TARGET,
          roles: [RoleTag.Client, RoleTag.Barber],
          linkedBarberId: IVAN,
        }),
        locks: [[IVAN, TARGET]],
      });
      const answer = unwrapOk(await run(call({ roles: [RoleTag.Client] })));
      expect(answer).toMatchObject({
        rolesChanged: true,
        linkedBarberId: null,
        linkChanged: true,
      });
      expect((tx.plans[0] ?? []).slice(0, 2)).toEqual([
        WriteOp.update([Collections.Users, TARGET], {
          roles: [RoleTag.Client],
          linkedBarberId: null,
          profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
        WriteOp.remove(lockPath(IVAN)),
      ]);
      expect(store.get(lockKey(IVAN))).toBeUndefined();
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        profileFields: ['roles', 'linkedBarberId'],
        profileLinkedBarberIdFrom: IVAN,
        profileLinkedBarberIdTo: null,
      });
    });

    it('a retry of a committed link finds nothing to do and answers as committed — still revoking (S-L-15)', async () => {
      const { tx, revoke, run } = rig({ target: storedBarber(null) });
      const link = BarberLinkRequest.set(IVAN);
      unwrapOk(await run(call({ roles: [RoleTag.Barber] }, link)));
      const retry = unwrapOk(
        await run(call({ roles: [RoleTag.Barber] }, link)),
      );
      expect(retry).toEqual({
        targetUserId: TARGET,
        roles: [RoleTag.Barber],
        rolesChanged: false,
        linkedBarberId: IVAN,
        linkChanged: false,
      });
      expect(tx.plans[1]).toEqual([]);
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
      expect(revoke.revoked).toEqual([TARGET, TARGET]);
    });

    const linkRefusals: readonly {
      readonly name: string;
      readonly options: RigOptions;
      readonly cmd: SetRolesCommand;
      readonly code: GovernanceErrorCode;
    }[] = [
      {
        name: 'the barber role granted without a link',
        options: {},
        cmd: call({}, BarberLinkRequest.KEEP),
        code: GovernanceErrorCode.RolesBarberLinkRequired,
      },
      {
        name: 'a link to a record that does not exist',
        options: { barbers: [IVAN] },
        cmd: call({}, BarberLinkRequest.set(NIKO)),
        code: GovernanceErrorCode.RolesBarberUnknown,
      },
      {
        name: 'a link on an account that will not be a barber',
        options: {},
        cmd: call({ roles: [RoleTag.Client] }, BarberLinkRequest.set(IVAN)),
        code: GovernanceErrorCode.RolesLinkWithoutBarber,
      },
      {
        name: 'a record whose lock names another account',
        options: { locks: [[IVAN, OTHER]] },
        cmd: call({}, BarberLinkRequest.set(IVAN)),
        code: GovernanceErrorCode.RolesBarberAlreadyLinked,
      },
    ];

    for (const refusal of linkRefusals) {
      it(`${refusal.name} → ${refusal.code}: nothing committed, no revoke`, async () => {
        const { store, tx, revoke, telemetry, run } = rig(refusal.options);
        const answer = await run(refusal.cmd);
        expect(answer.ok).toBe(false);
        if (!answer.ok) expect(answer.error.errorCode).toBe(refusal.code);
        expect(tx.plans).toEqual([]);
        expect(revoke.revoked).toEqual([]);
        expect(store.get(`${Collections.Users}/${TARGET}`)?.['roles']).toEqual([
          RoleTag.Client,
        ]);
        expect(telemetry.lines).toEqual([
          {
            level: 'info',
            msg: LogEvent.RolesChangeRefused,
            fields: { errorCode: refusal.code },
          },
        ]);
      });
    }
  });

  describe('the caller’s own account (staff permissions P9)', () => {
    /** The owner who cuts hair: `barber` beside `admin`, linked to `ivan`. */
    const ownCall = (extra: Partial<SetRolesCommand> = {}) =>
      call({
        targetUserId: ADMIN,
        roles: [RoleTag.Admin, RoleTag.Barber],
        ...extra,
      });

    it('links the admin to a barber record: the roles, the link, the lock and ONE row — and nobody is signed out', async () => {
      const { store, tx, telemetry, asked, run } = rig();
      expect(await run(ownCall())).toEqual(
        Result.ok({
          targetUserId: ADMIN,
          roles: [RoleTag.Barber, RoleTag.Admin],
          rolesChanged: true,
          linkedBarberId: IVAN,
          linkChanged: true,
        }),
      );
      expect(store.get(`${Collections.Users}/${ADMIN}`)).toMatchObject({
        roles: [RoleTag.Barber, RoleTag.Admin],
        linkedBarberId: IVAN,
        profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
      });
      expect(store.get(lockKey(IVAN))).toEqual({ linkedUserId: ADMIN });
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        auditAction: AuditAction.ProfileRolesChanged,
        profileRolesFrom: [RoleTag.Admin],
        profileRolesTo: [RoleTag.Barber, RoleTag.Admin],
        profileLinkedBarberIdTo: IVAN,
        ...Actor.admin(ADMIN),
      });
      // No revoke asked, so no session line either way.
      expect(asked).toEqual([]);
      expect(msgs(telemetry.lines)).toEqual([LogEvent.RolesChanged]);
    });

    it('reads the one account once — it is the caller and the target', async () => {
      const { tx, run } = rig();
      unwrapOk(await run(ownCall()));
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        [Collections.Barbers, IVAN],
        lockPath(IVAN),
      ]);
    });

    it('takes the barber role back off: the link cleared, the lock released, still no revoke', async () => {
      const { store, asked, run } = rig({
        caller: registeredUserFixture({
          id: ADMIN,
          roles: [RoleTag.Barber, RoleTag.Admin],
          linkedBarberId: IVAN,
        }),
        locks: [[IVAN, ADMIN]],
      });
      expect(
        unwrapOk(await run(ownCall({ roles: [RoleTag.Admin] }))),
      ).toMatchObject({
        roles: [RoleTag.Admin],
        rolesChanged: true,
        linkedBarberId: null,
        linkChanged: true,
      });
      expect(store.get(`${Collections.Users}/${ADMIN}`)).toMatchObject({
        roles: [RoleTag.Admin],
        linkedBarberId: null,
      });
      expect(store.get(lockKey(IVAN))).toBeUndefined();
      expect(asked).toEqual([]);
    });

    it('the stored set again commits nothing and revokes nothing', async () => {
      const { tx, asked, telemetry, run } = rig();
      expect(
        unwrapOk(await run(ownCall({ roles: [RoleTag.Admin] }))),
      ).toMatchObject({ rolesChanged: false, linkChanged: false });
      expect(tx.plans).toEqual([[]]);
      expect(asked).toEqual([]);
      expect(telemetry.lines).toEqual([]);
    });

    it('a token admin whose stored account holds no admin is still FORBIDDEN on their own account', async () => {
      const { tx, asked, run } = rig({
        caller: registeredUserFixture({ id: ADMIN, roles: [RoleTag.Barber] }),
      });
      const refused = await run(ownCall());
      expect(!refused.ok && refused.error.errorCode).toBe(
        GovernanceErrorCode.RolesForbidden,
      );
      expect(tx.plans).toEqual([]);
      expect(asked).toEqual([]);
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
        name: 'one’s own roles, a set without admin',
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
