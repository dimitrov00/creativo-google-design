import { describe, expect, it } from 'vitest';
import {
  Actor,
  ClientPrivacyCall,
  FlagName,
  RedemptionCount,
  Role,
  WriteAction,
} from '@core/components';
import { PrivacyError, RepositoryError } from '@core/errors';
import {
  AuditEntryId,
  CustomerId,
  InvitationId,
  LogEvent,
  OperationId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { type AuditEntry, Collections, type Invitation } from '@core/entities';
import {
  auditRowsOf,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  fixtureWalkInHash,
  memoryAuditReadPorts,
  memoryCallerRolesPorts,
  memoryClientFootprintPorts,
  memoryClientStatsReadPorts,
  memoryFlagsPorts,
  memoryLoyaltyAccountReadPorts,
  memoryStore,
  memoryTxPorts,
  OTHER_SENTINELS,
  PRIVACY_SENTINELS,
  type PrivacyWorld,
  privacyWorld,
  recordingTelemetry,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { ClientExportSystem, EXPORT_MAX_DOCUMENTS } from '@core/systems';
import {
  type ExportClientDataCommand,
  type ExportClientDataPorts,
  exportClientData,
} from './export-client-data.pipeline';

/* `exportClientData` (audit-hardening Phase 3, WS-C): the gate before any
 * read, the footprint read outside a transaction, the pure decision, ONE
 * commit of ONE row (none on a replay), a log line of ids and counts. Over
 * the privacy world of `@core/testing` and a pinned clock. */

const OPERATION = OperationId.of('op-export-0001');

/** The members that read the person's data — recorded by name, in call order. */
const READS = new Set([
  'loadCallerRoles',
  'loadClientRecord',
  'loadProfile',
  'listClientVisits',
  'loadVisitNotes',
  'listPhotosOfClient',
  'listVisitPhotos',
  'listClientGrants',
  'listClientVouchers',
  'listClientJournal',
  'listAccountNotifications',
  'listAccountWaitlist',
  'listAccountInvitations',
  'loadLoyaltyAccount',
  'listBadgeProgress',
  'listSeasonProgress',
  'loadClientStats',
  'loadClientMoney',
  'pageAuditByTargetCustomer',
  'pageAuditByTargetUser',
]);

type Rig = {
  readonly world: PrivacyWorld;
  readonly ports: ExportClientDataPorts;
  readonly tx: ReturnType<typeof memoryTxPorts>;
  readonly telemetry: ReturnType<typeof recordingTelemetry>;
  readonly reads: readonly string[];
  readonly run: (
    cmd?: Partial<ExportClientDataCommand>,
  ) => ReturnType<ReturnType<typeof exportClientData>>;
};

function rig(
  overrides: Partial<ExportClientDataPorts> = {},
  options: {
    readonly flagOn?: boolean;
    readonly auditRows?: readonly AuditEntry[];
    readonly world?: PrivacyWorld;
    readonly store?: ReturnType<typeof memoryStore>;
  } = {},
): Rig {
  const world = options.world ?? privacyWorld();
  const tx = memoryTxPorts(options.store ?? memoryStore());
  const telemetry = recordingTelemetry();
  const reads: string[] = [];
  const base: ExportClientDataPorts = {
    commit: tx.commit,
    nowUtcMs: tx.nowUtcMs,
    hash: tx.hash,
    walkInHash: fixtureWalkInHash,
    ...memoryCallerRolesPorts(world.roles),
    ...memoryFlagsPorts(
      options.flagOn === false ? [] : [FlagName.ClientPrivacy],
    ),
    ...memoryClientFootprintPorts(world.state),
    ...memoryLoyaltyAccountReadPorts(world.loyalty),
    ...memoryClientStatsReadPorts(world.stats),
    ...memoryAuditReadPorts(options.auditRows ?? world.auditRows),
    log: telemetry.log,
    trackError: telemetry.trackError,
    ...overrides,
  };
  const ports = Object.fromEntries(
    Object.entries(base).map(([name, member]) => [
      name,
      typeof member === 'function' && READS.has(name)
        ? (...args: unknown[]) => {
            reads.push(name);
            return (member as (...input: unknown[]) => unknown)(...args);
          }
        : member,
    ]),
  ) as ExportClientDataPorts;
  return {
    world,
    ports,
    tx,
    telemetry,
    reads,
    run: (cmd = {}) =>
      exportClientData(ports)({
        callerUserId: world.admin,
        callerRoles: [Role.Admin],
        customerId: world.person.customerId,
        operationId: OPERATION,
        ...cmd,
      }),
  };
}

function ownRowIdOf(customerId: CustomerId, operationId = OPERATION) {
  return AuditEntryId.of(
    fixtureHash(ClientExportSystem.rowIdBasis(customerId, operationId)),
  );
}

describe('exportClientData — the gate, before any read', () => {
  it('the flag off → PRIVACY_UNAVAILABLE, nothing read, nothing committed', async () => {
    const r = rig({}, { flagOn: false });
    expect(unwrapErr(await r.run())).toEqual(PrivacyError.unavailable());
    expect(r.reads).toEqual([]);
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('a token that is not the admin’s (a sysadmin) → PRIVACY_FORBIDDEN before the stored roles are read', async () => {
    const r = rig();
    expect(
      unwrapErr(
        await r.run({
          callerUserId: r.world.sysadmin,
          callerRoles: [Role.Sysadmin],
        }),
      ),
    ).toEqual(PrivacyError.forbidden());
    expect(r.reads).toEqual([]);
  });

  it('stored roles that are not the admin’s (the claims said admin) → PRIVACY_FORBIDDEN, no footprint read', async () => {
    const r = rig();
    expect(
      unwrapErr(
        await r.run({
          callerUserId: r.world.barber,
          callerRoles: [Role.Admin],
        }),
      ),
    ).toEqual(PrivacyError.forbidden());
    expect(r.reads).toEqual(['loadCallerRoles']);
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('a failed stored-roles read answers that failure', async () => {
    const failure = RepositoryError.readFailed(
      'users/u-privacy-admin',
      'unavailable',
    );
    const r = rig({ loadCallerRoles: async () => Result.err(failure) });
    expect(unwrapErr(await r.run())).toEqual(failure);
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('an unknown record → PRIVACY_CLIENT_NOT_FOUND, nothing else read, nothing committed', async () => {
    const r = rig();
    expect(
      unwrapErr(await r.run({ customerId: CustomerId.of('cus_nobody') })),
    ).toEqual(PrivacyError.clientNotFound());
    expect(r.reads).toEqual(['loadCallerRoles', 'loadClientRecord']);
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('a record whose userId its id does not derive from → PRIVACY_ACCOUNT_LINK_MISMATCH before any uid-keyed read, nothing committed (P3-RU-37 (h))', async () => {
    const world = privacyWorld();
    // P's record naming Q's account: a corrupt or foreign link.
    const corrupt = {
      ...world.personFootprint.record,
      userId: world.other.userId,
    };
    const r = rig(
      { loadClientRecord: async () => Result.ok(corrupt) },
      { world },
    );
    expect(unwrapErr(await r.run())).toEqual(
      PrivacyError.accountLinkMismatch(),
    );
    expect(r.reads).toEqual(['loadCallerRoles', 'loadClientRecord']);
    expect(r.tx.transactions).toHaveLength(0);
    expect(r.telemetry.lines).toEqual([]);
  });

  it('a record that links its own account (the forUser id) and a walk-in with none both pass the link', async () => {
    const r = rig();
    unwrapOk(await r.run());
    expect(r.reads).toContain('loadProfile');
    const walkIn = rig();
    unwrapOk(await walkIn.run({ customerId: walkIn.world.walkIn.customerId }));
    expect(walkIn.reads).not.toContain('loadProfile');
  });

  it('a failed record read answers that failure', async () => {
    const failure = RepositoryError.malformed('customers/x', 'displayName');
    const r = rig({ loadClientRecord: async () => Result.err(failure) });
    expect(unwrapErr(await r.run())).toEqual(failure);
  });
});

describe('exportClientData — the answer and its ONE row', () => {
  it('answers P’s canonical bundle and commits exactly one PRIVACY_CLIENT_EXPORTED row', async () => {
    const r = rig();
    const answer = unwrapOk(await r.run());
    const ownRowId = ownRowIdOf(r.world.person.customerId);
    const expected = unwrapOk(
      ClientExportSystem.exportOf(
        r.world.personFootprint,
        FIXTURE_NOW_UTC_MS,
        ownRowId,
        fixtureWalkInHash,
      ),
    );
    expect(answer).toEqual({
      clientExportVersion: ClientPrivacyCall.EXPORT_VERSION,
      exportedCustomerId: r.world.person.customerId,
      exportedAtUtcMs: FIXTURE_NOW_UTC_MS,
      exportDocumentCount: expected.documentCount,
      exportByteCount: expected.byteCount,
      exportJson: expected.json,
    });
    // The answer decodes as the web reads it.
    expect(ClientPrivacyCall.decodeExported(answer)).toEqual(Result.ok(answer));
    expect(r.tx.plans).toHaveLength(1);
    const [plan] = r.tx.plans;
    expect(plan).toHaveLength(1);
    expect(plan?.[0]?.writeAction).toBe(WriteAction.Create);
    expect(auditRowsOf(r.tx.plans)).toEqual([
      {
        id: ownRowId,
        ...ClientExportSystem.planClientExported(
          r.world.person.customerId,
          expected,
          Actor.admin(r.world.admin),
          OPERATION,
          FIXTURE_NOW_UTC_MS,
        ).row,
      },
    ]);
  });

  it('credits the row to the admin by the STORED roles', async () => {
    const r = rig();
    await r.run({ callerRoles: [Role.Admin, Role.Barber] });
    const [row] = auditRowsOf(r.tx.plans);
    expect(row?.actorRole).toBe(Actor.admin(r.world.admin).actorRole);
    expect(row && 'actorAdminUserId' in row ? row.actorAdminUserId : null).toBe(
      r.world.admin,
    );
  });

  it('logs ONE info line of ids and counts — no sentinel, no part of the bundle', async () => {
    const r = rig();
    const answer = unwrapOk(await r.run());
    expect(r.telemetry.lines).toEqual([
      {
        level: 'info',
        msg: LogEvent.PrivacyClientExported,
        fields: {
          customerId: r.world.person.customerId,
          exportDocumentCount: answer.exportDocumentCount,
          exportByteCount: answer.exportByteCount,
        },
      },
    ]);
    const logged = JSON.stringify(r.telemetry.lines);
    for (const value of [
      ...Object.values(PRIVACY_SENTINELS),
      ...Object.values(OTHER_SENTINELS),
    ]) {
      expect(logged).not.toContain(value);
    }
    expect(logged).not.toContain('exportJson');
    expect(logged).not.toContain(answer.exportJson);
  });

  it('a replay of the same operation commits nothing and answers the same bytes', async () => {
    const store = memoryStore();
    const first = rig({}, { store });
    const answer = unwrapOk(await first.run());
    const [row] = auditRowsOf(first.tx.plans);
    if (row === undefined) throw new Error('the first call wrote no row');
    // The replay reads the first call's row back through the timeline.
    const replay = rig(
      {},
      { store, world: first.world, auditRows: [...first.world.auditRows, row] },
    );
    expect(unwrapOk(await replay.run())).toEqual(answer);
    expect(replay.tx.transactions).toHaveLength(1);
    expect(auditRowsOf(replay.tx.plans)).toEqual([]);
    expect(store.has(`${Collections.AuditLog}/${row.id}`)).toBe(true);
  });

  it('another operation is another row', async () => {
    const store = memoryStore();
    const first = rig({}, { store });
    unwrapOk(await first.run());
    const second = rig({}, { store, world: first.world });
    unwrapOk(
      await second.run({ operationId: OperationId.of('op-export-0002') }),
    );
    expect(auditRowsOf(second.tx.plans).map((row) => row.id)).toEqual([
      ownRowIdOf(
        first.world.person.customerId,
        OperationId.of('op-export-0002'),
      ),
    ]);
  });

  it('a failed commit answers its failure and logs nothing', async () => {
    const failure = RepositoryError.writeFailed('auditLog/x', 'unavailable');
    const r = rig({ commit: async () => Result.err(failure) });
    expect(unwrapErr(await r.run())).toEqual(failure);
    expect(r.telemetry.lines).toEqual([]);
  });
});

describe('exportClientData — the reads', () => {
  it('reads each list with the cap + 1, the notes and photos of the sole-subject visits only', async () => {
    const limits = new Map<string, number>();
    const visitIds: string[][] = [];
    const world = privacyWorld();
    const footprint = memoryClientFootprintPorts(world.state);
    const r = rig(
      {
        listClientVisits: async (customerId, limit) => {
          limits.set('listClientVisits', limit);
          return footprint.listClientVisits(customerId, limit);
        },
        listClientJournal: async (customerId, limit) => {
          limits.set('listClientJournal', limit);
          return footprint.listClientJournal(customerId, limit);
        },
        loadVisitNotes: async (ids) => {
          visitIds.push([...ids]);
          return footprint.loadVisitNotes(ids);
        },
        listVisitPhotos: async (ids, limit) => {
          visitIds.push([...ids]);
          limits.set('listVisitPhotos', limit);
          return footprint.listVisitPhotos(ids, limit);
        },
      },
      { world },
    );
    unwrapOk(await r.run());
    expect([...limits.values()]).toEqual([
      EXPORT_MAX_DOCUMENTS + 1,
      EXPORT_MAX_DOCUMENTS + 1,
      EXPORT_MAX_DOCUMENTS + 1,
    ]);
    expect(visitIds).toEqual([[world.visits.solo.id], [world.visits.solo.id]]);
  });

  it('a record that links no account reads no account-keyed list and no account timeline', async () => {
    const r = rig();
    unwrapOk(await r.run({ customerId: r.world.walkIn.customerId }));
    for (const port of [
      'loadProfile',
      'listAccountNotifications',
      'listAccountWaitlist',
      'listAccountInvitations',
      'pageAuditByTargetUser',
    ]) {
      expect(r.reads).not.toContain(port);
    }
    // W sat one visit alone — its notes and photos are asked for.
    expect(r.reads).toContain('loadVisitNotes');
  });

  it('with no visit the person sat alone, no note and no visit photo is read', async () => {
    const r = rig();
    unwrapOk(await r.run({ customerId: r.world.other.customerId }));
    expect(r.reads).not.toContain('loadVisitNotes');
    expect(r.reads).not.toContain('listVisitPhotos');
  });

  it.each([
    'loadProfile',
    'listClientVisits',
    'loadVisitNotes',
    'listPhotosOfClient',
    'listVisitPhotos',
    'listClientGrants',
    'listClientVouchers',
    'loadLoyaltyAccount',
    'listBadgeProgress',
    'listSeasonProgress',
    'loadClientStats',
    'loadClientMoney',
    'listClientJournal',
    'listAccountNotifications',
    'listAccountWaitlist',
    'listAccountInvitations',
    'pageAuditByTargetCustomer',
    'pageAuditByTargetUser',
  ] as const)(
    'a failed %s answers that failure — no row, no log line',
    async (port) => {
      const failure = RepositoryError.readFailed(port, 'unavailable');
      const r = rig({ [port]: async () => Result.err(failure) });
      expect(unwrapErr(await r.run())).toEqual(failure);
      expect(r.tx.transactions).toHaveLength(0);
      expect(r.telemetry.lines).toEqual([]);
    },
  );

  it('a failed list read answers that failure, nothing committed', async () => {
    const failure = RepositoryError.readFailed('invitations', 'unavailable');
    const r = rig({ listAccountInvitations: async () => Result.err(failure) });
    expect(unwrapErr(await r.run())).toEqual(failure);
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('pages the audit rows filed against the record and the account until nothing is older', async () => {
    const world = privacyWorld();
    const template = world.personFootprint.auditRows[0];
    if (template === undefined) throw new Error('no fixture row');
    const many: AuditEntry[] = [];
    for (let i = 0; i < 1_200; i++) {
      many.push({
        ...template,
        id: AuditEntryId.of(`row-many-${String(i).padStart(4, '0')}`),
        recordedAtUtcMs: UtcEpochMs.plusMs(
          FIXTURE_NOW_UTC_MS,
          -(i + 1) * 60_000,
        ),
      });
    }
    const r = rig({}, { world, auditRows: [...world.auditRows, ...many] });
    const answer = unwrapOk(await r.run());
    expect(
      r.reads.filter((port) => port === 'pageAuditByTargetCustomer').length,
    ).toBeGreaterThan(2);
    const bundle = JSON.parse(answer.exportJson) as { auditLog: AuditEntry[] };
    expect(bundle.auditLog).toHaveLength(1_200 + 3);
  });

  it('a cursor that is not older than the last one is a failed read of auditLog, never a loop', async () => {
    const world = privacyWorld();
    const row = world.personFootprint.auditRows[0];
    if (row === undefined) throw new Error('no fixture row');
    const r = rig(
      {
        pageAuditByTargetCustomer: async () =>
          Result.ok({ rows: [row], cursor: FIXTURE_NOW_UTC_MS }),
      },
      { world },
    );
    expect(unwrapErr(await r.run())).toEqual(
      RepositoryError.readFailed(Collections.AuditLog, 'cursor-stalled'),
    );
    expect(r.tx.transactions).toHaveLength(0);
  });
});

describe('exportClientData — the cap', () => {
  it('a list past the cap → PRIVACY_EXPORT_TOO_LARGE, no row, no log line', async () => {
    const world = privacyWorld();
    const r = rig(
      {
        listAccountInvitations: async (userId, limit) => {
          const many: Invitation[] = [];
          for (let i = 0; i < limit; i++) {
            many.push({
              id: InvitationId.of(`inv-${i}`),
              inviterUserId: userId,
              inviterName: 'x',
              redemptionCount: RedemptionCount.zero(),
              createdAtUtcMs: FIXTURE_NOW_UTC_MS,
            });
          }
          return Result.ok(many);
        },
      },
      { world },
    );
    const refused = unwrapErr(await r.run());
    expect(refused).toMatchObject({
      errorCode: PrivacyError.exportTooLarge(0, 0).errorCode,
      exportByteCount: 0,
    });
    expect(
      'exportDocumentCount' in refused ? refused.exportDocumentCount : 0,
    ).toBeGreaterThan(EXPORT_MAX_DOCUMENTS);
    expect(r.tx.transactions).toHaveLength(0);
    expect(r.telemetry.lines).toEqual([]);
  });

  it('audit rows past the cap stop the paging and refuse — never a truncated bundle', async () => {
    const world = privacyWorld();
    const template = world.personFootprint.auditRows[0];
    if (template === undefined) throw new Error('no fixture row');
    const many: AuditEntry[] = [];
    for (let i = 0; i <= EXPORT_MAX_DOCUMENTS; i++) {
      many.push({
        ...template,
        id: AuditEntryId.of(`row-cap-${i}`),
        recordedAtUtcMs: UtcEpochMs.plusMs(
          FIXTURE_NOW_UTC_MS,
          -(i + 1) * 1_000,
        ),
      });
    }
    const r = rig({}, { world, auditRows: many });
    const refused = unwrapErr(await r.run());
    expect(refused).toMatchObject({
      errorCode: PrivacyError.exportTooLarge(0, 0).errorCode,
      exportByteCount: 0,
    });
    // It stopped once the cap was passed: the account's timeline was never read.
    expect(r.reads).not.toContain('pageAuditByTargetUser');
    expect(r.tx.transactions).toHaveLength(0);
  });
});
