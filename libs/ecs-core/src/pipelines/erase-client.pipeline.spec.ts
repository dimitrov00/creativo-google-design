import { describe, expect, it } from 'vitest';
import {
  AccountStatus,
  AuditAction,
  BookingContact,
  E164,
  ErasureCensus,
  ErasureStatus,
  FlagName,
  PrivacyMarker,
  RedemptionCount,
  Role,
  SeatLabel,
  SeatOccupant,
  type DocBody,
  type WriteOp,
} from '@core/components';
import { PrivacyError, RepositoryError } from '@core/errors';
import {
  AppointmentId,
  AppointmentPhotoId,
  CustomerId,
  InvitationId,
  LogEvent,
  OperationId,
  Result,
  SeatId,
  type UserId,
} from '@core/primitives';
import {
  type Appointment,
  type AuditEntry,
  Collections,
  type Invitation,
  Subcollections,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import {
  ClientErasureSystem,
  ERASURE_CHUNK_SIZE,
  ERASURE_MAX_DOCUMENTS,
} from '@core/systems';
import {
  bodyOf,
  appointmentFixture,
  customerFixture,
  type ErasureStores,
  type ErasureStoresScript,
  FIXTURE_NOW_UTC_MS,
  fixtureWalkInHash,
  footprintStoreOf,
  type MemoryStore,
  memoryAuthEraserPorts,
  memoryAuthRolesPorts,
  memoryCallerRolesPorts,
  memoryErasureStores,
  memoryFlagsPorts,
  memoryObjectEraserPorts,
  memoryTxPorts,
  OTHER_SENTINELS,
  PERSONS_PARTY_SELF_SEAT,
  personsParty,
  PRIVACY_SENTINELS,
  type PrivacyWorld,
  privacyWorld,
  recordingTelemetry,
  seatFixture,
  storeClientFootprintPorts,
  unwrapErr,
  unwrapOk,
  withSeatRemoved,
} from '@core/testing';
import type { StepBudget } from './continue-policy-recompute.pipeline';
import {
  type EraseClientPorts,
  eraseClient,
  previewClientErasure,
} from './erase-client.pipeline';
import type { ClientPrivacyCommand } from './export-client-data.pipeline';

/* `previewClientErasure` and `eraseClient` (audit-hardening Phase 3 WS-D):
 * the gate before any write, the caps, the OTP sweep before the stamp, the
 * stamp before every unit, dirty-only chunks, the objects before their
 * documents, the Auth user, the completion last; a spent budget, a failing
 * object or Auth delete resumed by the next call into the SAME final state;
 * an ERASED record re-swept. Over the privacy world of `@core/testing`, a
 * store the erasure's own commits write and the footprint reads read back,
 * and a pinned clock. */

const OPERATION = OperationId.of('op-erase-0001');
const unbounded: StepBudget = { spent: () => false };
const COMMIT_FAILURE = RepositoryError.writeFailed('auditLog', 'unavailable');
const spentAtOnce: StepBudget = { spent: () => true };

/** Every personal value of P a scan must not find — the voucher code is money, kept by design. */
const P_SENTINELS = Object.entries(PRIVACY_SENTINELS)
  .filter(([key]) => key !== 'voucherCode')
  .map(([, value]) => value);

type Rig = {
  readonly world: PrivacyWorld;
  readonly store: MemoryStore;
  readonly stores: ErasureStores;
  readonly tx: ReturnType<typeof memoryTxPorts>;
  readonly telemetry: ReturnType<typeof recordingTelemetry>;
  readonly ports: EraseClientPorts;
  readonly erase: (
    cmd?: Partial<ClientPrivacyCommand>,
    budget?: StepBudget,
  ) => ReturnType<ReturnType<typeof eraseClient>>;
  readonly preview: (
    cmd?: Partial<ClientPrivacyCommand>,
  ) => ReturnType<ReturnType<typeof previewClientErasure>>;
};

/** The object paths of the world's photos and P's avatar, as Storage holds them. */
function objectsOf(world: PrivacyWorld): readonly string[] {
  return [
    ...world.state.photos.map((photo) => photo.path),
    `avatars/${world.person.userId}/avatar.jpg`,
  ];
}

function rig(
  options: {
    readonly world?: PrivacyWorld;
    readonly store?: MemoryStore;
    readonly stores?: ErasureStores;
    readonly script?: ErasureStoresScript;
    readonly flagOn?: boolean;
    readonly overrides?: Partial<EraseClientPorts>;
    /** Runs before the `index`-th commit of the rig (0-based) — a concurrent writer. */
    readonly beforeCommit?: (index: number, store: MemoryStore) => void;
    /** The `index`-th commit fails as the store would (`REPOSITORY_WRITE_FAILED`). */
    readonly failCommitAt?: number;
  } = {},
): Rig {
  const world = options.world ?? privacyWorld();
  const store = options.store ?? footprintStoreOf(world.state);
  const stores =
    options.stores ??
    memoryErasureStores({
      authUsers: new Map<UserId, readonly Role[]>([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: objectsOf(world),
    });
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  // Every commit that lands is logged into the eraser doubles' ONE call log,
  // by the collections its plan writes — so a spec reads the whole order.
  let commits = 0;
  const commit: CommitPlan = (read, decide) => {
    const index = commits++;
    options.beforeCommit?.(index, store);
    if (options.failCommitAt === index) {
      return Promise.resolve(Result.err(COMMIT_FAILURE));
    }
    return tx.commit(read, (snapshot) => {
      const decided = decide(snapshot);
      if (decided.ok) {
        const collections: string[] = [];
        for (const op of decided.value.writes) {
          const collection = op.path[0] ?? '';
          if (!collections.includes(collection)) collections.push(collection);
        }
        stores.calls.push(`commit:${collections.join('+')}`);
      }
      return decided;
    });
  };
  const ports: EraseClientPorts = {
    commit,
    nowUtcMs: tx.nowUtcMs,
    hash: tx.hash,
    walkInHash: fixtureWalkInHash,
    ...memoryCallerRolesPorts(world.roles),
    ...memoryFlagsPorts(
      options.flagOn === false ? [] : [FlagName.ClientPrivacy],
    ),
    ...storeClientFootprintPorts(store),
    ...memoryAuthRolesPorts(stores, options.script),
    ...memoryAuthEraserPorts(stores, options.script),
    ...memoryObjectEraserPorts(stores, options.script),
    log: telemetry.log,
    trackError: telemetry.trackError,
    ...options.overrides,
  };
  const command = (
    cmd: Partial<ClientPrivacyCommand>,
  ): ClientPrivacyCommand => ({
    callerUserId: world.admin,
    callerRoles: [Role.Admin],
    customerId: world.person.customerId,
    operationId: OPERATION,
    ...cmd,
  });
  return {
    world,
    store,
    stores,
    tx,
    telemetry,
    ports,
    erase: (cmd = {}, budget = unbounded) =>
      eraseClient(ports)(command(cmd), budget),
    preview: (cmd = {}) => previewClientErasure(ports)(command(cmd)),
  };
}

/** The store as sorted entries — two runs that end alike compare equal. */
function snapshotOf(store: MemoryStore): readonly [string, unknown][] {
  return [...store.entries()]
    .map(([key, body]): [string, unknown] => [key, structuredClone(body)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every stored audit row, as `{ id, ...body }`. */
function rowsOf(store: MemoryStore): readonly AuditEntry[] {
  const rows: AuditEntry[] = [];
  for (const [key, body] of store) {
    if (key.startsWith(`${Collections.AuditLog}/`)) {
      rows.push({
        id: key.slice(Collections.AuditLog.length + 1),
        ...body,
      } as unknown as AuditEntry);
    }
  }
  return rows;
}

function rowsNamed(store: MemoryStore, action: AuditAction) {
  return rowsOf(store).filter((row) => row.auditAction === action);
}

/** P's footprint census after a complete erasure: nothing personal, the visits, Q's contact and the journal retained. */
const RESIDUE: ErasureCensus = {
  ...ErasureCensus.EMPTY,
  erasureVisitCount: 2,
  erasureContactKeptCount: 1,
  erasureJournalCount: 2,
};

/** P's footprint census before: as `client-erasure.system.spec.ts` derives it. */
const BEFORE: ErasureCensus = {
  erasureRecordCount: 1,
  erasureAccountCount: 1,
  erasureContactCount: 1,
  erasureLabelCount: 0,
  erasureNoteCount: 2,
  erasurePhotoCount: 3,
  erasureDocumentCount: 2,
  erasurePseudonymCount: 2,
  erasureVisitCount: 2,
  erasureContactKeptCount: 1,
  erasureJournalCount: 2,
};

/** One full erasure of P on a fresh rig — the final state the resumed runs must reach. */
async function oneShot(): Promise<Rig> {
  const r = rig();
  unwrapOk(await r.erase());
  return r;
}

describe('eraseClient — the gate, before any write', () => {
  it('the flag off → PRIVACY_UNAVAILABLE: nothing read, nothing written, nothing deleted', async () => {
    const r = rig({ flagOn: false });
    const before = snapshotOf(r.store);
    expect(unwrapErr(await r.erase())).toEqual(PrivacyError.unavailable());
    expect(r.tx.transactions).toHaveLength(0);
    expect(r.stores.calls).toEqual([]);
    expect(snapshotOf(r.store)).toEqual(before);
  });

  it('a token that is not the admin’s (a sysadmin) → PRIVACY_FORBIDDEN', async () => {
    const r = rig();
    expect(
      unwrapErr(
        await r.erase({
          callerUserId: r.world.sysadmin,
          callerRoles: [Role.Sysadmin],
        }),
      ),
    ).toEqual(PrivacyError.forbidden());
    expect(r.stores.calls).toEqual([]);
  });

  it('stored roles that are not the admin’s (the claims said admin) → PRIVACY_FORBIDDEN', async () => {
    const r = rig();
    expect(
      unwrapErr(
        await r.erase({
          callerUserId: r.world.barber,
          callerRoles: [Role.Admin],
        }),
      ),
    ).toEqual(PrivacyError.forbidden());
    expect(r.tx.transactions).toHaveLength(0);
    expect(r.stores.calls).toEqual([]);
  });

  it('an unknown record → PRIVACY_CLIENT_NOT_FOUND', async () => {
    const r = rig();
    expect(
      unwrapErr(await r.erase({ customerId: CustomerId.of('cus_nobody') })),
    ).toEqual(PrivacyError.clientNotFound());
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('a userId the record id does not derive from → PRIVACY_ACCOUNT_LINK_MISMATCH before any uid-keyed read; the account and the Auth user untouched', async () => {
    const r = rig();
    const key = `${Collections.Customers}/${r.world.person.customerId}`;
    r.store.set(key, { ...r.store.get(key), userId: r.world.other.userId });
    const before = snapshotOf(r.store);
    let profileReads = 0;
    const reading = rig({
      world: r.world,
      store: r.store,
      stores: r.stores,
      overrides: {
        loadProfile: async (userId) => {
          profileReads++;
          return storeClientFootprintPorts(r.store).loadProfile(userId);
        },
      },
    });
    expect(unwrapErr(await reading.erase())).toEqual(
      PrivacyError.accountLinkMismatch(),
    );
    expect(profileReads).toBe(0);
    expect(r.stores.calls).toEqual([]);
    expect(reading.tx.transactions).toHaveLength(0);
    expect(snapshotOf(r.store)).toEqual(before);
    expect(r.stores.authUsers.has(r.world.other.userId)).toBe(true);
  });

  it('a staff role in the STORED account → PRIVACY_ERASURE_STAFF_ACCOUNT: nothing written, the Auth user kept', async () => {
    const r = rig();
    const key = `${Collections.Users}/${r.world.person.userId}`;
    r.store.set(key, { ...r.store.get(key), roles: [Role.Barber] });
    const before = snapshotOf(r.store);
    expect(unwrapErr(await r.erase())).toEqual(
      PrivacyError.erasureStaffAccount(),
    );
    expect(r.tx.transactions).toHaveLength(0);
    expect(snapshotOf(r.store)).toEqual(before);
    expect(r.stores.calls).toEqual([`loadAuthRoles:${r.world.person.userId}`]);
    expect(r.stores.authUsers.has(r.world.person.userId)).toBe(true);
  });

  it('a staff claim ONLY in Auth, with no users document → refused all the same (an operator’s Auth account is never deleted)', async () => {
    const r = rig();
    r.store.delete(`${Collections.Users}/${r.world.person.userId}`);
    r.stores.authUsers.set(r.world.person.userId, [Role.Admin]);
    expect(unwrapErr(await r.erase())).toEqual(
      PrivacyError.erasureStaffAccount(),
    );
    expect(r.tx.transactions).toHaveLength(0);
    expect(r.stores.authUsers.get(r.world.person.userId)).toEqual([Role.Admin]);
  });

  it('a failed Auth roles read answers its code-only failure, before any write', async () => {
    const r = rig({ script: { authRolesFailing: true } });
    const refused = unwrapErr(await r.erase());
    expect(refused.errorCode).toBe('PIPELINE_UNAVAILABLE');
    expect(r.tx.transactions).toHaveLength(0);
  });

  it('a list past ERASURE_MAX_DOCUMENTS → PRIVACY_ERASURE_TOO_LARGE with the count it reached: no write, no delete', async () => {
    const world = privacyWorld();
    const r = rig({
      world,
      overrides: {
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
    });
    const before = snapshotOf(r.store);
    expect(unwrapErr(await r.erase())).toEqual(
      PrivacyError.erasureTooLarge(ERASURE_MAX_DOCUMENTS + 1),
    );
    expect(r.tx.transactions).toHaveLength(0);
    expect(snapshotOf(r.store)).toEqual(before);
    expect(r.stores.calls).toEqual([`loadAuthRoles:${world.person.userId}`]);
  });
});

describe('eraseClient — one call, start to finish', () => {
  it('answers ERASED and done, with the residue: nothing personal left, the visits, Q’s contact and the journal retained', async () => {
    const r = await oneShot();
    const again = rig({ world: r.world, store: r.store, stores: r.stores });
    // A second call of the act answers the same, and writes nothing.
    expect(unwrapOk(await again.erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
  });

  it('the order: the OTP and contact sweeps BEFORE the stamp, the stamp before every unit, the objects before their documents, the Auth user, the completion last', async () => {
    const r = rig();
    const answer = unwrapOk(await r.erase());
    expect(answer).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // the tag, whether it is done and the eleven counts in census order —
    // nothing else.
    expect(Object.keys(answer)).toEqual([
      'erasureStatus',
      'erasureDone',
      ...Object.keys(ErasureCensus.EMPTY),
    ]);
    const shot = r.world.state.photos.find((p) => p.id === 'photo-p-shot');
    const nobody = r.world.state.photos.find((p) => p.id === 'photo-p-nobody');
    const library = r.world.state.photos.find(
      (p) => p.id === 'photo-p-library',
    );
    const uid = r.world.person.userId;
    expect(r.stores.calls).toEqual([
      `loadAuthRoles:${uid}`,
      `commit:${Collections.Otps}`,
      // The solo visit's contact carries P's values: swept before the stamp,
      // with the act's SWEPT row (P3-DEP-33, P3-DEP-34).
      `commit:${Collections.Appointments}+${Collections.AuditLog}`,
      `commit:${Collections.Customers}+${Collections.Users}+${Collections.AuditLog}`,
      // The visits' unit: only the notes are left to remove.
      `commit:${Collections.AppointmentNotes}`,
      `deleteStoredObject:${shot?.path}`,
      `deleteStoredObject:${nobody?.path}`,
      // The kept LIBRARY object's label, before its document (P3-DEP-31).
      `clearStoredLabel:${library?.path}`,
      `commit:${Collections.AppointmentPhotos}`,
      `commit:${Collections.Users}+${Collections.WaitlistRequests}`,
      `commit:${Collections.Invitations}`,
      `commit:${Collections.ImpersonationSessions}`,
      `deleteStoredPrefix:avatars/${uid}/`,
      `deleteAuthUser:${uid}`,
      `commit:${Collections.Customers}+${Collections.AuditLog}`,
    ]);
  });

  it('every personal value of P is gone from every document; the record and the account are tombstones under the erasure’s id', async () => {
    const r = await oneShot();
    const json = JSON.stringify(snapshotOf(r.store));
    for (const sentinel of P_SENTINELS) expect(json).not.toContain(sentinel);
    const p = r.world.person;
    expect(r.store.get(`${Collections.Customers}/${p.customerId}`)).toEqual({
      userId: p.userId,
      displayName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
      searchName: '',
      searchPrefixes: [],
      createdAtUtcMs: r.world.personFootprint.record.createdAtUtcMs,
      customerOrigin: r.world.personFootprint.record.customerOrigin,
      writeOperationId: OPERATION,
      erasureStatus: ErasureStatus.Erased,
      erasureStartedAtUtcMs: FIXTURE_NOW_UTC_MS,
      erasedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(r.store.get(`${Collections.Users}/${p.userId}`)).toMatchObject({
      firstName: PrivacyMarker.TEXT,
      lastName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
      birthDate: null,
      searchName: null,
      searchPrefixes: [],
      roles: [Role.Client],
      accountStatus: AccountStatus.Erased,
      accountErasedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    // The visit keeps everything but P's contact, and names the erasure.
    expect(
      r.store.get(`${Collections.Appointments}/${r.world.visits.solo.id}`),
    ).toMatchObject({ ...BookingContact.NONE, writeOperationId: OPERATION });
    // The Auth user and P's objects are gone; the shop's library picture stays.
    expect(r.stores.authUsers.has(p.userId)).toBe(false);
    const library = r.world.state.photos.find(
      (photo) => photo.id === 'photo-p-library',
    );
    expect([...r.stores.objects].sort()).toEqual(
      [
        library?.path,
        r.world.state.photos.find((photo) => photo.id === 'photo-q-shot')?.path,
        r.world.state.photos.find((photo) => photo.id === 'photo-party-nobody')
          ?.path,
      ].sort(),
    );
    // The party's note (P3-RU-33) and the library photo's DOCUMENT are gone too.
    expect(
      r.store.has(`${Collections.AppointmentNotes}/${r.world.visits.party.id}`),
    ).toBe(false);
    expect(
      r.store.has(`${Collections.AppointmentPhotos}/photo-p-library`),
    ).toBe(false);
  });

  it('visits, money, the journal, Q’s documents and every earlier audit row are kept byte for byte', async () => {
    const world = privacyWorld();
    const before = footprintStoreOf(world.state);
    const r = rig({ world });
    unwrapOk(await r.erase());
    const kept = [...before.keys()].filter(
      (key) =>
        key.startsWith(`${Collections.CouponGrants}/`) ||
        key.startsWith(`${Collections.GiftVouchers}/`) ||
        key.startsWith(`${Collections.ClientJournal}/`) ||
        key === `${Collections.Appointments}/${world.visits.party.id}` ||
        key === `${Collections.Appointments}/${world.visits.walkInParty.id}` ||
        key.includes(world.other.userId) ||
        key.includes(world.other.customerId) ||
        key.endsWith('-q') ||
        key.endsWith('-q-phone') ||
        key.endsWith('photo-q-shot') ||
        key.endsWith('photo-party-nobody'),
    );
    expect(kept.length).toBeGreaterThan(10);
    for (const key of kept) expect(r.store.get(key)).toEqual(before.get(key));
    // The solo visit: only the contact and the call that wrote it changed.
    const solo = `${Collections.Appointments}/${world.visits.solo.id}`;
    expect(r.store.get(solo)).toEqual({
      ...before.get(solo),
      ...BookingContact.NONE,
      writeOperationId: OPERATION,
    });
  });

  it('exactly one SWEPT row (the sweep before the stamp), one STARTED row (the census BEFORE) and one ERASED row (the residue), each crediting the admin and naming the record', async () => {
    const r = await oneShot();
    const swept = rowsNamed(r.store, AuditAction.PrivacyClientErasureSwept);
    const started = rowsNamed(r.store, AuditAction.PrivacyClientErasureStarted);
    const erased = rowsNamed(r.store, AuditAction.PrivacyClientErased);
    expect(swept).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(erased).toHaveLength(1);
    // The solo visit's contact was cleared by the sweep (P3-DEP-34): its row
    // carries the same census BEFORE, under the act's id (P3-DEP-33).
    expect(swept[0]).toMatchObject({
      ...BEFORE,
      actorRole: 'ADMIN',
      actorAdminUserId: r.world.admin,
      auditTarget: 'CUSTOMER',
      targetCustomerId: r.world.person.customerId,
      auditOperationId: OPERATION,
    });
    expect(started[0]).toMatchObject({
      ...BEFORE,
      actorRole: 'ADMIN',
      actorAdminUserId: r.world.admin,
      auditTarget: 'CUSTOMER',
      targetCustomerId: r.world.person.customerId,
      auditOperationId: OPERATION,
    });
    expect(erased[0]).toMatchObject({
      ...RESIDUE,
      auditOperationId: OPERATION,
    });
    expect(rowsOf(r.store)).toHaveLength(3);
    const rows = JSON.stringify(rowsOf(r.store));
    for (const sentinel of [
      ...P_SENTINELS,
      ...Object.values(OTHER_SENTINELS),
    ]) {
      expect(rows).not.toContain(sentinel);
    }
  });

  it('logs ONE step line and, on completion, ONE erased line — ids, tags and counts only', async () => {
    const r = await oneShot();
    expect(r.telemetry.lines).toEqual([
      {
        level: 'info',
        msg: LogEvent.PrivacyErasureStep,
        fields: {
          customerId: r.world.person.customerId,
          erasureStatus: ErasureStatus.Erased,
          erasureDone: true,
          ...RESIDUE,
        },
      },
      {
        level: 'info',
        msg: LogEvent.PrivacyClientErased,
        fields: { customerId: r.world.person.customerId, ...RESIDUE },
      },
    ]);
    const logged = JSON.stringify(r.telemetry.lines);
    for (const sentinel of Object.values(PRIVACY_SENTINELS)) {
      expect(logged).not.toContain(sentinel);
    }
  });

  it('the challenges under P’s contact are swept; Q’s stay', async () => {
    const r = await oneShot();
    expect(r.store.has(`${Collections.Otps}/otp-p-phone`)).toBe(false);
    expect(r.store.has(`${Collections.Otps}/otp-q-phone`)).toBe(true);
  });

  it('a commit that fails answers its failure; the record keeps where it stood, and the next call resumes', async () => {
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const stores = memoryErasureStores({
      authUsers: new Map([[world.person.userId, [Role.Client]]]),
      objects: objectsOf(world),
    });
    const failing = rig({
      world,
      store,
      stores,
      overrides: {
        commit: async () =>
          Result.err(RepositoryError.writeFailed('otps', 'unavailable')),
      },
    });
    expect((await failing.erase()).ok).toBe(false);
    expect(
      store.get(`${Collections.Customers}/${world.person.customerId}`),
    ).toMatchObject({ erasureStatus: ErasureStatus.None });
    const resumed = rig({ world, store, stores });
    expect(unwrapOk(await resumed.erase()).erasureDone).toBe(true);
  });
});

describe('eraseClient — resumable: every interruption finishes in the SAME final state', () => {
  it('a budget spent right after the stamp → ERASING, not done; the next call completes, ONE STARTED and ONE ERASED row', async () => {
    const reference = await oneShot();
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const stores = memoryErasureStores({
      authUsers: new Map([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: objectsOf(world),
    });
    const first = rig({ world, store, stores });
    const partial = unwrapOk(await first.erase({}, spentAtOnce));
    expect(partial.erasureStatus).toBe(ErasureStatus.Erasing);
    expect(partial.erasureDone).toBe(false);
    expect(ClientErasureSystem.isComplete(partial)).toBe(false);
    // The first unit always runs; the Auth user waits for the units.
    expect(stores.authUsers.has(world.person.userId)).toBe(true);
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toEqual([]);
    const second = rig({ world, store, stores });
    expect(unwrapOk(await second.erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(snapshotOf(store)).toEqual(snapshotOf(reference.store));
    expect([...stores.objects].sort()).toEqual(
      [...reference.stores.objects].sort(),
    );
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureStarted),
    ).toHaveLength(1);
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toHaveLength(1);
  });

  it('a failing object delete → ERASING, not done, the photo documents kept for a resume; the next call completes', async () => {
    const reference = await oneShot();
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const stores = memoryErasureStores({
      authUsers: new Map([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: objectsOf(world),
    });
    const shot = world.state.photos.find(
      (photo) => photo.id === 'photo-p-shot',
    );
    const first = rig({
      world,
      store,
      stores,
      script: { failingPaths: [shot?.path ?? ''] },
    });
    const partial = unwrapOk(await first.erase());
    expect(partial).toMatchObject({
      erasureStatus: ErasureStatus.Erasing,
      erasureDone: false,
      erasurePhotoCount: 3,
    });
    expect(store.has(`${Collections.AppointmentPhotos}/photo-p-shot`)).toBe(
      true,
    );
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toEqual([]);
    const second = rig({ world, store, stores });
    expect(unwrapOk(await second.erase()).erasureDone).toBe(true);
    expect(snapshotOf(store)).toEqual(snapshotOf(reference.store));
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toHaveLength(1);
  });

  it('a failing Auth delete answers its error; the record stays ERASING; the next call completes', async () => {
    const reference = await oneShot();
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const stores = memoryErasureStores({
      authUsers: new Map([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: objectsOf(world),
    });
    const first = rig({
      world,
      store,
      stores,
      script: { authDeleteFailing: true },
    });
    const refused = unwrapErr(await first.erase());
    expect(refused).toMatchObject({ errorCode: 'PIPELINE_UNAVAILABLE' });
    expect(JSON.stringify(refused)).not.toContain(PRIVACY_SENTINELS.phone);
    expect(
      store.get(`${Collections.Customers}/${world.person.customerId}`),
    ).toMatchObject({ erasureStatus: ErasureStatus.Erasing });
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toEqual([]);
    expect(first.telemetry.lines).toEqual([]);
    const second = rig({ world, store, stores });
    expect(unwrapOk(await second.erase()).erasureDone).toBe(true);
    expect(snapshotOf(store)).toEqual(snapshotOf(reference.store));
  });
});

describe('eraseClient — an ERASED record (P3-L-19)', () => {
  it('with nothing left to sweep: no commit at all — a second call is a no-op', async () => {
    const r = await oneShot();
    const before = snapshotOf(r.store);
    const commits = r.tx.transactions.length;
    const again = rig({ world: r.world, store: r.store, stores: r.stores });
    const answer = unwrapOk(
      await again.erase({ operationId: OperationId.of('op-erase-0002') }),
    );
    expect(answer).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(again.tx.transactions).toHaveLength(0);
    expect(r.tx.transactions).toHaveLength(commits);
    expect(snapshotOf(r.store)).toEqual(before);
    // The second call only re-ran the idempotent deletes: no commit.
    expect(r.stores.calls.slice(15)).toEqual([
      `loadAuthRoles:${r.world.person.userId}`,
      `deleteStoredPrefix:avatars/${r.world.person.userId}/`,
      `deleteAuthUser:${r.world.person.userId}`,
    ]);
  });

  it('a note written on an OLD visit after completion is removed, with ONE RESWEPT row (the census before); a replay of that act adds none', async () => {
    const r = await oneShot();
    const noteKey = `${Collections.AppointmentNotes}/${r.world.visits.solo.id}`;
    const note = {
      text: PRIVACY_SENTINELS.note,
      authorUserId: r.world.barber,
      writtenAtUtcMs: FIXTURE_NOW_UTC_MS,
    };
    r.store.set(noteKey, note);
    const resweep = OperationId.of('op-resweep-0001');
    const sweep = rig({ world: r.world, store: r.store, stores: r.stores });
    expect(unwrapOk(await sweep.erase({ operationId: resweep }))).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(r.store.has(noteKey)).toBe(false);
    const rows = rowsNamed(r.store, AuditAction.PrivacyClientErasureReswept);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ...RESIDUE,
      erasureNoteCount: 1,
      auditOperationId: resweep,
    });
    // The same act again, after yet another note: swept, but no second row.
    r.store.set(noteKey, note);
    const replay = rig({ world: r.world, store: r.store, stores: r.stores });
    unwrapOk(await replay.erase({ operationId: resweep }));
    expect(r.store.has(noteKey)).toBe(false);
    expect(
      rowsNamed(r.store, AuditAction.PrivacyClientErasureReswept),
    ).toHaveLength(1);
    // Never a second STARTED or ERASED row.
    expect(
      rowsNamed(r.store, AuditAction.PrivacyClientErasureStarted),
    ).toHaveLength(1);
    expect(rowsNamed(r.store, AuditAction.PrivacyClientErased)).toHaveLength(1);
  });
});

describe('eraseClient — the units', () => {
  /** A walk-in X with `count` visits seating X alone; each named and noted when `dirty`. */
  function walkInWorld(count: number, dirty: boolean) {
    const world = privacyWorld();
    const phone = E164.of('+359880000321');
    const x = CustomerId.forWalkIn(phone, fixtureWalkInHash);
    const store = footprintStoreOf({
      records: [
        customerFixture({
          id: x,
          userId: null,
          displayName: 'Walkin Many',
          phone,
          email: null,
          searchName: 'walkin many',
          searchPrefixes: ['w', 'wa'],
        }),
      ],
    });
    for (let i = 0; i < count; i++) {
      const id = AppointmentId.of(`appt-x-${String(i).padStart(3, '0')}`);
      const body = bodyOf(
        appointmentFixture({
          id,
          ownerUserId: null,
          ownerCustomerId: null,
          subjectUserIds: [],
          subjectCustomerIds: [x],
          seats: [
            seatFixture({
              seatId: SeatId.of(`seat-x-${i}`),
              occupant: SeatOccupant.walkIn(
                x,
                dirty
                  ? SeatLabel.of('Walkin Many')
                  : PrivacyMarker.seatLabel(1),
              ),
            }),
          ],
          ...(dirty ? { contactName: 'Walkin Many', contactPhone: phone } : {}),
        }),
      );
      store.set(`${Collections.Appointments}/${id}`, body);
      if (dirty) {
        store.set(`${Collections.AppointmentNotes}/${id}`, {
          text: 'walkin note',
          authorUserId: world.barber,
          writtenAtUtcMs: FIXTURE_NOW_UTC_MS,
        });
      }
    }
    return { world, store, x };
  }

  it('only dirty visits are chunked — a clean history of 3 × ERASURE_CHUNK_SIZE visits plans no visit commit', async () => {
    const { world, store, x } = walkInWorld(3 * ERASURE_CHUNK_SIZE, false);
    const r = rig({ world, store });
    expect(unwrapOk(await r.erase({ customerId: x }))).toMatchObject({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      erasureVisitCount: 3 * ERASURE_CHUNK_SIZE,
    });
    const touched = r.tx.plans.flat().map((op: WriteOp) => op.path[0]);
    expect(touched).not.toContain(Collections.Appointments);
    // The stamp and the completion — nothing else.
    expect(r.tx.plans).toHaveLength(2);
  });

  it('no plan exceeds 2 × ERASURE_CHUNK_SIZE + 1 operations; 30 dirty visits take two sweep commits and two visit commits', async () => {
    const { world, store, x } = walkInWorld(30, true);
    const r = rig({ world, store });
    expect(unwrapOk(await r.erase({ customerId: x })).erasureDone).toBe(true);
    for (const plan of r.tx.plans) {
      expect(plan.length).toBeLessThanOrEqual(2 * ERASURE_CHUNK_SIZE + 1);
    }
    // Before the stamp, the contacts carrying X's phone (P3-DEP-34): 25 and
    // the act's SWEPT row, then 5 (P3-DEP-33).
    const sweepCommits = r.tx.plans.filter(
      (plan) =>
        plan.some((op) => op.path[0] === Collections.Appointments) &&
        !plan.some((op) => op.path[0] === Collections.AppointmentNotes),
    );
    expect(sweepCommits.map((plan) => plan.length)).toEqual([26, 5]);
    // After it, the visits' units: each visit's label and note.
    const visitCommits = r.tx.plans.filter((plan) =>
      plan.some((op) => op.path[0] === Collections.AppointmentNotes),
    );
    expect(visitCommits.map((plan) => plan.length)).toEqual([50, 10]);
    const json = JSON.stringify(snapshotOf(store));
    expect(json).not.toContain('Walkin Many');
    expect(json).not.toContain('walkin note');
    expect(json).not.toContain('+359880000321');
  });

  it('a record with no footprint at all: the stamp, then the completion — nothing else read or written', async () => {
    const world = privacyWorld();
    const lone = CustomerId.forWalkIn('+359880000654', fixtureWalkInHash);
    const store = footprintStoreOf({
      records: [
        customerFixture({
          id: lone,
          userId: null,
          displayName: 'Walkin Lone',
          phone: E164.of('+359880000654'),
        }),
      ],
    });
    const r = rig({ world, store });
    expect(unwrapOk(await r.erase({ customerId: lone }))).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...ErasureCensus.EMPTY,
    });
    expect(r.tx.plans).toHaveLength(2);
    expect(JSON.stringify(snapshotOf(store))).not.toContain('Walkin Lone');
  });

  it('a linked uid whose users document is gone while its Auth user exists → PRIVACY_ERASURE_STAFF_ACCOUNT: nothing written, the Auth user kept (P3-DEP-29 — production never sets custom claims)', async () => {
    const r = rig();
    const uid = r.world.person.userId;
    r.store.delete(`${Collections.Users}/${uid}`);
    // Production's shape: the Auth user carries no custom claims.
    r.stores.authUsers.set(uid, []);
    const before = snapshotOf(r.store);
    expect(unwrapErr(await r.erase())).toEqual(
      PrivacyError.erasureStaffAccount(),
    );
    expect(unwrapErr(await r.preview())).toEqual(
      PrivacyError.erasureStaffAccount(),
    );
    expect(r.tx.transactions).toHaveLength(0);
    expect(snapshotOf(r.store)).toEqual(before);
    expect(r.stores.authUsers.has(uid)).toBe(true);
    expect(r.stores.calls).not.toContain(`deleteAuthUser:${uid}`);
  });

  it('a linked uid whose users document AND Auth user are gone: the record alone is stripped; the uid-keyed steps still run (inbox, avatar, the idempotent Auth delete)', async () => {
    const r = rig();
    const uid = r.world.person.userId;
    r.store.delete(`${Collections.Users}/${uid}`);
    r.stores.authUsers.delete(uid);
    expect(unwrapOk(await r.erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(r.store.has(`${Collections.Users}/${uid}`)).toBe(false);
    expect(r.stores.authUsers.has(uid)).toBe(false);
    expect(r.stores.calls).toContain(`deleteAuthUser:${uid}`);
    expect(r.stores.calls).toContain(`deleteStoredPrefix:avatars/${uid}/`);
    expect(r.store.has(`${Collections.WaitlistRequests}/wl-p`)).toBe(false);
    const started = rowsNamed(r.store, AuditAction.PrivacyClientErasureStarted);
    expect(started[0]).toMatchObject({ erasureAccountCount: 0 });
  });

  it('a walk-in record links no account: no account read, no Auth or avatar call', async () => {
    const r = rig();
    unwrapOk(await r.erase({ customerId: r.world.walkIn.customerId }));
    expect(
      r.stores.calls.filter((call) => !call.startsWith('commit:')),
    ).toEqual([]);
  });
});

describe('eraseClient — a visit that kept P’s contact without seating P (P3-DEP-28)', () => {
  /** P's contact values on a visit — what no kept appointment may hold once P is erased. */
  const P_CONTACT: readonly string[] = [
    PRIVACY_SENTINELS.name,
    PRIVACY_SENTINELS.phone,
    PRIVACY_SENTINELS.email,
    PRIVACY_SENTINELS.contactNote,
  ];

  /**
   * The world plus `count` copies of P's party [SELF P, COMPANION Q] after
   * the desk removed P's seat — `withSeatRemoved`, the edit pipeline's own
   * write: the mirrors name Q alone, the contact is still P's.
   */
  function withRemoved(count = 1) {
    const world = privacyWorld();
    const base = withSeatRemoved(personsParty(world), PERSONS_PARTY_SELF_SEAT);
    const removed: Appointment[] = [base];
    for (let i = 1; i < count; i++) {
      removed.push({
        ...base,
        id: AppointmentId.of(`appt-p-removed-${String(i).padStart(2, '0')}`),
      });
    }
    const store = footprintStoreOf({
      ...world.state,
      visits: [...world.state.visits, ...removed],
    });
    const stores = memoryErasureStores({
      authUsers: new Map<UserId, readonly Role[]>([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: objectsOf(world),
    });
    return { world, store, stores, removed };
  }

  /** The stored appointments that still hold one of P's contact values. */
  function holdingP(store: MemoryStore): readonly string[] {
    const out: string[] = [];
    for (const [key, body] of store) {
      if (!key.startsWith(`${Collections.Appointments}/`)) continue;
      const json = JSON.stringify(body);
      if (P_CONTACT.some((value) => json.includes(value))) out.push(key);
    }
    return out;
  }

  it('the visit seats Q alone — the footprint’s subject read never finds it', () => {
    const { removed } = withRemoved();
    expect(removed[0]?.subjectCustomerIds).not.toContain(
      privacyWorld().person.customerId,
    );
    expect(removed[0]?.contactPhone).toBe(PRIVACY_SENTINELS.phone);
  });

  it('clears its contact BEFORE the stamp: the STARTED row counts it, the ERASED row certifies no residue, no kept visit holds P’s contact', async () => {
    const { world, store, stores, removed } = withRemoved();
    const r = rig({ world, store, stores });
    expect(unwrapOk(await r.erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    const visit = removed[0] as Appointment;
    // Only its contact cleared, under the erasure's id; Q's seat, the ids,
    // the times and the money kept.
    expect(store.get(`${Collections.Appointments}/${visit.id}`)).toEqual({
      ...bodyOf(visit),
      ...BookingContact.NONE,
      writeOperationId: OPERATION,
    });
    // The sweep's commit (the visits and the act's SWEPT row) came before the stamp.
    const sweep = stores.calls.indexOf(
      `commit:${Collections.Appointments}+${Collections.AuditLog}`,
    );
    const stamp = stores.calls.indexOf(
      `commit:${Collections.Customers}+${Collections.Users}+${Collections.AuditLog}`,
    );
    expect(sweep).toBeGreaterThan(-1);
    expect(sweep).toBeLessThan(stamp);
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureStarted),
    ).toMatchObject([
      {
        erasureContactCount: BEFORE.erasureContactCount + 1,
        erasureContactKeptCount: BEFORE.erasureContactKeptCount,
        erasureVisitCount: BEFORE.erasureVisitCount,
      },
    ]);
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toHaveLength(1);
    expect(holdingP(store)).toEqual([]);
    // ONE SWEPT row names the act the visit's writeOperationId names (P3-DEP-33).
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureSwept),
    ).toMatchObject([
      {
        erasureContactCount: BEFORE.erasureContactCount + 1,
        auditOperationId: OPERATION,
      },
    ]);
  });

  it('the preview counts its contact — and writes nothing', async () => {
    const { world, store, stores } = withRemoved();
    const r = rig({ world, store, stores });
    const before = snapshotOf(store);
    expect(unwrapOk(await r.preview())).toMatchObject({
      erasureStatus: ErasureStatus.None,
      erasureContactCount: BEFORE.erasureContactCount + 1,
      erasureVisitCount: BEFORE.erasureVisitCount,
    });
    expect(snapshotOf(store)).toEqual(before);
  });

  it('a budget spent after the sweep: the stamp, then no unit; the next call ends in the SAME state as one straight call — no residue, no second ERASED row', async () => {
    const straight = withRemoved();
    unwrapOk(
      await rig({
        world: straight.world,
        store: straight.store,
        stores: straight.stores,
      }).erase(),
    );
    const { world, store, stores } = withRemoved();
    const partial = unwrapOk(
      await rig({ world, store, stores }).erase({}, spentAtOnce),
    );
    expect(partial).toMatchObject({
      erasureStatus: ErasureStatus.Erasing,
      erasureDone: false,
    });
    // Every contact carrying P's values went with the sweep, the solo
    // visit's included (P3-DEP-34) — nothing waits for a unit.
    expect(holdingP(store)).toEqual([]);
    expect(unwrapOk(await rig({ world, store, stores }).erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(snapshotOf(store)).toEqual(snapshotOf(straight.store));
    // Once more: nothing left, nothing written.
    const done = snapshotOf(store);
    unwrapOk(await rig({ world, store, stores }).erase());
    expect(snapshotOf(store)).toEqual(done);
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toHaveLength(1);
  });

  it('a budget spent DURING the sweep stamps nothing — NONE, not done; the next call finds the rest by value, then completes', async () => {
    const { world, store, stores } = withRemoved(ERASURE_CHUNK_SIZE + 1);
    const partial = unwrapOk(
      await rig({ world, store, stores }).erase({}, spentAtOnce),
    );
    expect(partial).toMatchObject({
      erasureStatus: ErasureStatus.None,
      erasureDone: false,
    });
    expect(rowsNamed(store, AuditAction.PrivacyClientErasureStarted)).toEqual(
      [],
    );
    // One chunk swept (the solo visit and 24 of the 26): two still hold P's contact.
    expect(holdingP(store)).toHaveLength(2);
    // The chunk that landed carries the act's ONE SWEPT row — the census
    // BEFORE: the solo's contact and the 26 (P3-DEP-33).
    const sweptRow = {
      erasureContactCount: BEFORE.erasureContactCount + ERASURE_CHUNK_SIZE + 1,
      auditOperationId: OPERATION,
    };
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureSwept),
    ).toMatchObject([sweptRow]);
    const done = unwrapOk(await rig({ world, store, stores }).erase());
    expect(done).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(holdingP(store)).toEqual([]);
    // The resumed call of the same act plans no second SWEPT row.
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureSwept),
    ).toMatchObject([sweptRow]);
    // The STARTED row counts what was left at the stamp — the two the second
    // call swept, not the 25 the first did (plan §7 item 28): those are on
    // the SWEPT row above.
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureStarted),
    ).toMatchObject([{ erasureContactCount: 2 }]);
    expect(rowsNamed(store, AuditAction.PrivacyClientErased)).toHaveLength(1);
  });

  it('a stamp commit that fails after the sweep answers its failure and leaves the record NONE — the cleared visit’s writeOperationId joins exactly ONE SWEPT row (P3-DEP-33)', async () => {
    const { world, store, stores, removed } = withRemoved();
    // 0: the OTP sweep, 1: the contact sweep, 2: the stamp.
    const r = rig({ world, store, stores, failCommitAt: 2 });
    expect(unwrapErr(await r.erase())).toEqual(COMMIT_FAILURE);
    expect(stores.calls).toContain(
      `commit:${Collections.Appointments}+${Collections.AuditLog}`,
    );
    expect(stores.calls).not.toContain(
      `commit:${Collections.Customers}+${Collections.Users}+${Collections.AuditLog}`,
    );
    expect(
      store.get(`${Collections.Customers}/${world.person.customerId}`),
    ).toMatchObject({ erasureStatus: ErasureStatus.None });
    const visit = store.get(
      `${Collections.Appointments}/${(removed[0] as Appointment).id}`,
    );
    expect(visit).toMatchObject({
      ...BookingContact.NONE,
      writeOperationId: OPERATION,
    });
    const joined = rowsOf(store).filter(
      (row) => row.auditOperationId === visit?.['writeOperationId'],
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      auditAction: AuditAction.PrivacyClientErasureSwept,
      auditOperationId: OPERATION,
      actorRole: 'ADMIN',
      actorAdminUserId: world.admin,
      auditTarget: 'CUSTOMER',
      targetCustomerId: world.person.customerId,
      ...BEFORE,
      erasureContactCount: BEFORE.erasureContactCount + 1,
    });
  });

  it('a new act after that failure (a re-minted operation id) completes; its STARTED row counts only what was left — the first act’s SWEPT row holds the swept contacts (plan §7 item 28)', async () => {
    const { world, store, stores } = withRemoved();
    unwrapErr(await rig({ world, store, stores, failCommitAt: 2 }).erase());
    const next = OperationId.of('op-erase-0002');
    expect(
      unwrapOk(
        await rig({ world, store, stores }).erase({ operationId: next }),
      ),
    ).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(holdingP(store)).toEqual([]);
    // A straight run's STARTED row counts BEFORE + 1 contacts; this one 0 —
    // the solo's and the removed visit's contacts were swept by the first act.
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureStarted),
    ).toMatchObject([{ erasureContactCount: 0, auditOperationId: next }]);
    // The first act's SWEPT row accounts for them; the new act swept nothing.
    expect(
      rowsNamed(store, AuditAction.PrivacyClientErasureSwept),
    ).toMatchObject([
      {
        erasureContactCount: BEFORE.erasureContactCount + 1,
        auditOperationId: OPERATION,
      },
    ]);
  });

  it('a visit edited meanwhile to another person’s contact is re-decided in the sweep’s transaction — kept', async () => {
    const { world, store, stores, removed } = withRemoved();
    const visit = removed[0] as Appointment;
    const path = `${Collections.Appointments}/${visit.id}`;
    const r = rig({
      world,
      store,
      stores,
      // Before the sweep's commit (after the OTP sweep's), the desk retypes the contact.
      beforeCommit: (index, at) => {
        if (index !== 1) return;
        at.set(path, {
          ...at.get(path),
          contactName: OTHER_SENTINELS.name,
          contactPhone: OTHER_SENTINELS.phone,
          contactEmail: null,
          contactNote: null,
        });
      },
    });
    unwrapOk(await r.erase());
    expect(store.get(path)).toMatchObject({
      contactName: OTHER_SENTINELS.name,
      contactPhone: OTHER_SENTINELS.phone,
    });
  });
});

describe('eraseClient — P’s seat removed while the erasure is in flight (P3-DEP-34)', () => {
  /** P's contact values on a visit — what no kept appointment may hold once P is erased. */
  const P_CONTACT: readonly string[] = [
    PRIVACY_SENTINELS.name,
    PRIVACY_SENTINELS.phone,
    PRIVACY_SENTINELS.email,
    PRIVACY_SENTINELS.contactNote,
  ];

  /** The world plus P's own party [SELF P, COMPANION Q], P's contact on it. */
  function withParty() {
    const world = privacyWorld();
    const party = personsParty(world);
    const store = footprintStoreOf({
      ...world.state,
      visits: [...world.state.visits, party],
    });
    const stores = memoryErasureStores({
      authUsers: new Map<UserId, readonly Role[]>([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: objectsOf(world),
    });
    return { world, store, stores, party };
  }

  /** The stored appointments that still hold one of P's contact values. */
  function holdingP(store: MemoryStore): readonly string[] {
    const out: string[] = [];
    for (const [key, body] of store) {
      if (!key.startsWith(`${Collections.Appointments}/`)) continue;
      const json = JSON.stringify(body);
      if (P_CONTACT.some((value) => json.includes(value))) out.push(key);
    }
    return out;
  }

  /**
   * The desk's `REMOVE_SEAT` of P's seat on the party, as the edit pipeline
   * writes it (`withSeatRemoved`), run ONCE before the first commit `when`
   * accepts — a concurrent writer.
   */
  function removalWhen(
    world: PrivacyWorld,
    party: Appointment,
    when: (index: number, record: DocBody | undefined) => boolean,
  ) {
    let done = false;
    return (index: number, at: MemoryStore) => {
      if (done) return;
      const record = at.get(
        `${Collections.Customers}/${world.person.customerId}`,
      );
      if (!when(index, record)) return;
      done = true;
      const path = `${Collections.Appointments}/${party.id}`;
      const stored = { id: party.id, ...at.get(path) } as Appointment;
      at.set(path, bodyOf(withSeatRemoved(stored, PERSONS_PARTY_SELF_SEAT)));
    };
  }

  const afterStamp = (_index: number, record: DocBody | undefined) =>
    record?.['erasureStatus'] === ErasureStatus.Erasing;
  const beforeAnyCommit = (index: number) => index === 0;

  it.each([
    ['after the stamp, before the visits’ unit', afterStamp],
    [
      'after the outside read, before any commit (the record NONE)',
      beforeAnyCommit,
    ],
  ] as const)(
    'removed %s: the call certifies ERASED and no kept visit holds P’s contact',
    async (_when, when) => {
      const { world, store, stores, party } = withParty();
      const r = rig({
        world,
        store,
        stores,
        beforeCommit: removalWhen(world, party, when),
      });
      expect(unwrapOk(await r.erase())).toEqual({
        erasureStatus: ErasureStatus.Erased,
        erasureDone: true,
        ...RESIDUE,
      });
      const stored = store.get(`${Collections.Appointments}/${party.id}`);
      // The seat is gone (the desk's edit) and the contact with it (the sweep).
      expect(stored?.['subjectCustomerIds']).not.toContain(
        world.person.customerId,
      );
      expect(stored).toMatchObject(BookingContact.NONE);
      expect(holdingP(store)).toEqual([]);
    },
  );

  it.each([
    ['after the stamp, before the visits’ unit', afterStamp],
    [
      'after the outside read, before any commit (the record NONE)',
      beforeAnyCommit,
    ],
  ] as const)(
    'removed %s, then the visits’ unit fails: the next call certifies ERASED and no kept visit holds P’s contact',
    async (_when, when) => {
      const { world, store, stores, party } = withParty();
      // 0: the OTP sweep, 1: the contact sweep, 2: the stamp, 3: the visits.
      const first = rig({
        world,
        store,
        stores,
        beforeCommit: removalWhen(world, party, when),
        failCommitAt: 3,
      });
      expect(unwrapErr(await first.erase())).toEqual(COMMIT_FAILURE);
      expect(
        store.get(`${Collections.Customers}/${world.person.customerId}`),
      ).toMatchObject({ erasureStatus: ErasureStatus.Erasing });
      const second = rig({ world, store, stores });
      expect(unwrapOk(await second.erase())).toEqual({
        erasureStatus: ErasureStatus.Erased,
        erasureDone: true,
        ...RESIDUE,
      });
      expect(holdingP(store)).toEqual([]);
    },
  );
});

describe('eraseClient — the photos a staff member writes (P3-DEP-30, P3-DEP-31)', () => {
  const MEDIA = 'media/services/cover.jpg';

  function photoWorld(
    extra: (
      world: PrivacyWorld,
    ) => readonly PrivacyWorld['state']['photos'][number][],
    labels: (world: PrivacyWorld) => ReadonlyMap<string, string> = () =>
      new Map(),
    script: ErasureStoresScript = {},
  ) {
    const world = privacyWorld();
    const store = footprintStoreOf({
      ...world.state,
      photos: [...world.state.photos, ...extra(world)],
    });
    const stores = memoryErasureStores({
      authUsers: new Map<UserId, readonly Role[]>([
        [world.person.userId, [Role.Client]],
        [world.other.userId, [Role.Client]],
      ]),
      objects: [...objectsOf(world), MEDIA],
      labels: labels(world),
    });
    return { world, store, stores, script };
  }

  const photoOf = (world: PrivacyWorld, id: string) => {
    const found = world.state.photos.find((photo) => photo.id === id);
    if (found === undefined) throw new Error(`no fixture photo ${id}`);
    return found;
  };

  it('a SHOT document naming P whose path is the shop’s media, or empty: Storage is never handed it; it and its chunk-mates are removed; ERASED and done', async () => {
    const { world, store, stores } = photoWorld((w) => [
      {
        ...photoOf(w, 'photo-p-shot'),
        id: AppointmentPhotoId.of('photo-forged-media'),
        path: MEDIA,
      },
      {
        ...photoOf(w, 'photo-p-shot'),
        id: AppointmentPhotoId.of('photo-forged-empty'),
        path: '',
      },
    ]);
    const r = rig({ world, store, stores });
    expect(unwrapOk(await r.erase())).toMatchObject({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      erasurePhotoCount: 0,
    });
    const deleted = stores.calls.filter((call) =>
      call.startsWith('deleteStoredObject:'),
    );
    expect(deleted).toEqual([
      `deleteStoredObject:${photoOf(world, 'photo-p-shot').path}`,
      `deleteStoredObject:${photoOf(world, 'photo-p-nobody').path}`,
    ]);
    expect(stores.objects.has(MEDIA)).toBe(true);
    for (const id of [
      'photo-forged-media',
      'photo-forged-empty',
      'photo-p-shot',
      'photo-p-nobody',
      'photo-p-library',
    ]) {
      expect(store.has(`${Collections.AppointmentPhotos}/${id}`), id).toBe(
        false,
      );
    }
  });

  it('the kept LIBRARY object loses its clientLabel BEFORE its document goes — the object stays; Q’s label is untouched', async () => {
    const { world, store, stores } = photoWorld(
      () => [],
      (w) =>
        new Map([
          [photoOf(w, 'photo-p-library').path, PRIVACY_SENTINELS.label],
          [photoOf(w, 'photo-q-shot').path, OTHER_SENTINELS.label],
        ]),
    );
    const library = photoOf(world, 'photo-p-library').path;
    unwrapOk(await rig({ world, store, stores }).erase());
    expect(stores.objects.has(library)).toBe(true);
    expect(stores.labels.has(library)).toBe(false);
    expect([...stores.labels]).toEqual([
      [photoOf(world, 'photo-q-shot').path, OTHER_SENTINELS.label],
    ]);
    const cleared = stores.calls.indexOf(`clearStoredLabel:${library}`);
    expect(cleared).toBeGreaterThan(-1);
    expect(cleared).toBeLessThan(
      stores.calls.indexOf(`commit:${Collections.AppointmentPhotos}`),
    );
  });

  it('a failing label clear keeps the chunk’s documents for a resume — ERASING, not done; the next call completes', async () => {
    const { world, store, stores } = photoWorld(
      () => [],
      (w) => new Map([[photoOf(w, 'photo-p-library').path, 'x']]),
    );
    const library = photoOf(world, 'photo-p-library').path;
    const partial = unwrapOk(
      await rig({
        world,
        store,
        stores,
        script: { failingPaths: [library] },
      }).erase(),
    );
    expect(partial).toMatchObject({
      erasureStatus: ErasureStatus.Erasing,
      erasureDone: false,
    });
    expect(store.has(`${Collections.AppointmentPhotos}/photo-p-library`)).toBe(
      true,
    );
    expect(unwrapOk(await rig({ world, store, stores }).erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(stores.labels.has(library)).toBe(false);
  });
});

describe('previewClientErasure — read-only (P3-L-17)', () => {
  it('answers the tag, the census BEFORE and the sibling walk-in records that exist — and writes nothing', async () => {
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const sibling = CustomerId.forWalkIn(
      PRIVACY_SENTINELS.phone,
      fixtureWalkInHash,
    );
    const body = bodyOf(
      customerFixture({
        id: sibling,
        userId: null,
        displayName: 'Shares a phone',
        phone: PRIVACY_SENTINELS.phone,
      }),
    );
    store.set(`${Collections.Customers}/${sibling}`, body);
    const r = rig({ world, store });
    const before = snapshotOf(store);
    const preview = unwrapOk(await r.preview());
    expect(preview).toEqual({
      erasureStatus: ErasureStatus.None,
      erasureSiblingCustomerIds: [sibling],
      ...BEFORE,
    });
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // the tag, the sibling ids and the eleven counts in census order —
    // nothing else.
    expect(Object.keys(preview)).toEqual([
      'erasureStatus',
      'erasureSiblingCustomerIds',
      ...Object.keys(ErasureCensus.EMPTY),
    ]);
    expect(r.tx.transactions).toHaveLength(0);
    expect(snapshotOf(store)).toEqual(before);
    expect(r.stores.calls).toEqual([`loadAuthRoles:${world.person.userId}`]);
    expect(r.telemetry.lines).toEqual([]);
  });

  it('an ERASING record names no sibling — its contact values are gone', async () => {
    const r = rig();
    unwrapOk(await r.erase({}, spentAtOnce));
    const preview = unwrapOk(await r.preview());
    expect(preview.erasureStatus).toBe(ErasureStatus.Erasing);
    expect(preview.erasureSiblingCustomerIds).toEqual([]);
    expect(preview.erasureRecordCount).toBe(0);
  });

  it('refuses as the erasure would: the flag, a link mismatch, a staff account, a list past the cap', async () => {
    expect(unwrapErr(await rig({ flagOn: false }).preview())).toEqual(
      PrivacyError.unavailable(),
    );
    const mismatch = rig();
    const key = `${Collections.Customers}/${mismatch.world.person.customerId}`;
    mismatch.store.set(key, {
      ...mismatch.store.get(key),
      userId: mismatch.world.other.userId,
    });
    expect(unwrapErr(await mismatch.preview())).toEqual(
      PrivacyError.accountLinkMismatch(),
    );
    const staff = rig();
    staff.stores.authUsers.set(staff.world.person.userId, [Role.Receptionist]);
    expect(unwrapErr(await staff.preview())).toEqual(
      PrivacyError.erasureStaffAccount(),
    );
    const large = rig({
      overrides: {
        listClientVisits: async (customerId, limit) => {
          const visits = [];
          for (let i = 0; i < limit; i++) {
            visits.push(
              appointmentFixture({
                id: AppointmentId.of(`appt-many-${i}`),
                subjectCustomerIds: [customerId],
              }),
            );
          }
          return Result.ok(visits);
        },
      },
    });
    expect(unwrapErr(await large.preview())).toEqual(
      PrivacyError.erasureTooLarge(ERASURE_MAX_DOCUMENTS + 1),
    );
  });
});

describe('the notifications path', () => {
  it('P’s inbox lives under users/{uid}/notifications and is emptied', async () => {
    const r = await oneShot();
    const prefix = `${Collections.Users}/${r.world.person.userId}/${Subcollections.Notifications}/`;
    expect([...r.store.keys()].filter((key) => key.startsWith(prefix))).toEqual(
      [],
    );
    const qPrefix = `${Collections.Users}/${r.world.other.userId}/${Subcollections.Notifications}/`;
    expect(
      [...r.store.keys()].filter((key) => key.startsWith(qPrefix)),
    ).toHaveLength(1);
  });
});

describe('eraseClient — every failure is answered, never swallowed', () => {
  const READ_PORTS = [
    'loadCallerRoles',
    'loadClientRecord',
    'loadProfile',
    'listClientVisits',
    'loadVisitNotes',
    'listPhotosOfClient',
    'listVisitPhotos',
    'listClientJournal',
    'listAccountNotifications',
    'listAccountWaitlist',
    'listAccountInvitations',
    'listAccountSessions',
    'listOtpsByDestination',
  ] as const;

  it.each(READ_PORTS)(
    'a failed %s answers that failure — no commit, no delete',
    async (port) => {
      const failure = RepositoryError.readFailed(port, 'unavailable');
      const r = rig({ overrides: { [port]: async () => Result.err(failure) } });
      const before = snapshotOf(r.store);
      expect(unwrapErr(await r.erase())).toEqual(failure);
      expect(r.tx.transactions).toHaveLength(0);
      expect(snapshotOf(r.store)).toEqual(before);
      expect(
        r.stores.calls.filter((call) => call.startsWith('delete')),
      ).toEqual([]);
    },
  );

  it.each([
    'listPhotosOfClient',
    'listVisitPhotos',
    'listClientJournal',
    'listAccountNotifications',
    'listAccountWaitlist',
    'listAccountSessions',
    'listOtpsByDestination',
  ] as const)(
    '%s past the cap → PRIVACY_ERASURE_TOO_LARGE before any write',
    async (port) => {
      const world = privacyWorld();
      const samples = new Map<string, unknown>([
        ['listPhotosOfClient', world.state.photos[0]],
        ['listVisitPhotos', world.state.photos[0]],
        ['listClientJournal', world.state.journal[0]],
        ['listAccountNotifications', world.personFootprint.notifications[0]],
        ['listAccountWaitlist', world.state.waitlist[0]],
        ['listAccountSessions', world.state.sessions[0]],
        ['listOtpsByDestination', world.state.otps[0]],
      ]);
      const r = rig({
        world,
        overrides: {
          [port]: async (_key: unknown, limit: number) =>
            Result.ok(new Array(limit).fill(samples.get(port))),
        },
      });
      const before = snapshotOf(r.store);
      expect(unwrapErr(await r.erase())).toEqual(
        PrivacyError.erasureTooLarge(ERASURE_MAX_DOCUMENTS + 1),
      );
      expect(r.tx.transactions).toHaveLength(0);
      expect(snapshotOf(r.store)).toEqual(before);
    },
  );

  // 0: the OTP sweep, 1: the contact sweep (the solo visit, P3-DEP-34),
  // 2: the stamp, 3: the visits, 4: the photos, 5: the removals, 6 and 7:
  // the marks, 8: the completion.
  // The last column: the contacts the resumed act's STARTED row counts. A
  // stamp that failed AFTER the sweep leaves the solo visit's contact swept,
  // so the next call's census — what is left at its stamp — has one fewer;
  // the act's SWEPT row holds it (plan §7 item 28). Every other state is
  // the one straight call's.
  it.each([
    ['the contact sweep', 1, ErasureStatus.None, BEFORE.erasureContactCount],
    ['the stamp', 2, ErasureStatus.None, BEFORE.erasureContactCount - 1],
    ['the visits’ unit', 3, ErasureStatus.Erasing, BEFORE.erasureContactCount],
    ['the photos’ unit', 4, ErasureStatus.Erasing, BEFORE.erasureContactCount],
    [
      'the removals’ unit',
      5,
      ErasureStatus.Erasing,
      BEFORE.erasureContactCount,
    ],
    ['the marks’ unit', 6, ErasureStatus.Erasing, BEFORE.erasureContactCount],
    ['the completion', 8, ErasureStatus.Erasing, BEFORE.erasureContactCount],
  ] as const)(
    'a failed commit of %s answers its failure; the record stays where it stood; the next call completes',
    async (_step, index, status, startedContacts) => {
      const reference = await oneShot();
      const world = privacyWorld();
      const store = footprintStoreOf(world.state);
      const stores = memoryErasureStores({
        authUsers: new Map([
          [world.person.userId, [Role.Client]],
          [world.other.userId, [Role.Client]],
        ]),
        objects: objectsOf(world),
      });
      const failing = rig({ world, store, stores, failCommitAt: index });
      expect(unwrapErr(await failing.erase())).toEqual(COMMIT_FAILURE);
      expect(
        store.get(`${Collections.Customers}/${world.person.customerId}`),
      ).toMatchObject({ erasureStatus: status });
      expect(failing.telemetry.lines).toEqual([]);
      const resumed = rig({ world, store, stores });
      expect(unwrapOk(await resumed.erase()).erasureDone).toBe(true);
      const expected = snapshotOf(reference.store).map(
        ([key, body]): [string, unknown] =>
          (body as DocBody)['auditAction'] ===
          AuditAction.PrivacyClientErasureStarted
            ? [
                key,
                {
                  ...(body as DocBody),
                  erasureContactCount: startedContacts,
                },
              ]
            : [key, body],
      );
      expect(snapshotOf(store)).toEqual(expected);
      expect(
        rowsNamed(store, AuditAction.PrivacyClientErasureSwept),
      ).toMatchObject([{ ...BEFORE, auditOperationId: OPERATION }]);
    },
  );

  it('a failed RESWEPT commit answers its failure', async () => {
    const r = await oneShot();
    r.store.set(`${Collections.AppointmentNotes}/${r.world.visits.solo.id}`, {
      text: PRIVACY_SENTINELS.note,
      authorUserId: r.world.barber,
      writtenAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    const sweep = rig({
      world: r.world,
      store: r.store,
      stores: r.stores,
      // 0: the note's unit, 1: the RESWEPT row
      failCommitAt: 1,
    });
    expect(
      unwrapErr(
        await sweep.erase({ operationId: OperationId.of('op-resweep-0002') }),
      ),
    ).toEqual(COMMIT_FAILURE);
    expect(rowsNamed(r.store, AuditAction.PrivacyClientErasureReswept)).toEqual(
      [],
    );
  });

  it.each([
    ['the stamp', 2],
    // 7 is the last unit: the record is gone when the residue is re-read.
    ['the residue re-read', 7],
    ['the completion', 8],
  ] as const)(
    'a record gone before %s’s transaction → PRIVACY_CLIENT_NOT_FOUND, nothing of that commit written',
    async (_step, index) => {
      const r = rig({
        beforeCommit: (at, store) => {
          if (at === index) {
            store.delete(
              `${Collections.Customers}/${privacyWorld().person.customerId}`,
            );
          }
        },
      });
      expect(unwrapErr(await r.erase())).toEqual(PrivacyError.clientNotFound());
      expect(rowsNamed(r.store, AuditAction.PrivacyClientErased)).toEqual([]);
    },
  );

  it('a walk-in record gone before the stamp’s transaction → PRIVACY_CLIENT_NOT_FOUND', async () => {
    const world = privacyWorld();
    const r = rig({
      world,
      beforeCommit: (at, store) => {
        // 0: W's contact sweep (its staff party carries W's phone), 1: the stamp.
        if (at === 1) {
          store.delete(`${Collections.Customers}/${world.walkIn.customerId}`);
        }
      },
    });
    expect(
      unwrapErr(await r.erase({ customerId: world.walkIn.customerId })),
    ).toEqual(PrivacyError.clientNotFound());
  });

  it('a concurrent act stamped first: this call plans no second STARTED row and carries on to the end', async () => {
    const world = privacyWorld();
    const r = rig({
      world,
      beforeCommit: (at, store) => {
        // 2: this call's stamp (after its OTP and contact sweeps).
        if (at !== 2) return;
        // The other act's stamp: the record ERASING and the account ERASED, both stripped.
        const key = `${Collections.Customers}/${world.person.customerId}`;
        store.set(key, {
          ...store.get(key),
          displayName: PrivacyMarker.TEXT,
          phone: null,
          email: null,
          searchName: '',
          searchPrefixes: [],
          erasureStatus: ErasureStatus.Erasing,
          erasureStartedAtUtcMs: FIXTURE_NOW_UTC_MS,
        });
        const user = `${Collections.Users}/${world.person.userId}`;
        store.set(user, {
          ...store.get(user),
          firstName: PrivacyMarker.TEXT,
          lastName: PrivacyMarker.TEXT,
          phone: null,
          email: null,
          birthDate: null,
          searchName: null,
          searchPrefixes: [],
          accountStatus: AccountStatus.Erased,
          accountErasedAtUtcMs: FIXTURE_NOW_UTC_MS,
        });
      },
    });
    const answer = unwrapOk(await r.erase());
    expect(answer.erasureStatus).toBe(ErasureStatus.Erased);
    expect(rowsNamed(r.store, AuditAction.PrivacyClientErasureStarted)).toEqual(
      [],
    );
    expect(rowsNamed(r.store, AuditAction.PrivacyClientErased)).toHaveLength(1);
  });

  it('a concurrent act completed first: this call plans no second ERASED row, answers ERASED and done, and logs no completion', async () => {
    const world = privacyWorld();
    const r = rig({
      world,
      beforeCommit: (at, store) => {
        // 8: this call's completion.
        if (at !== 8) return;
        const key = `${Collections.Customers}/${world.person.customerId}`;
        store.set(key, {
          ...store.get(key),
          erasureStatus: ErasureStatus.Erased,
          erasedAtUtcMs: FIXTURE_NOW_UTC_MS,
        });
      },
    });
    expect(unwrapOk(await r.erase())).toEqual({
      erasureStatus: ErasureStatus.Erased,
      erasureDone: true,
      ...RESIDUE,
    });
    expect(rowsNamed(r.store, AuditAction.PrivacyClientErased)).toEqual([]);
    expect(r.telemetry.lines.map((line) => line.msg)).toEqual([
      LogEvent.PrivacyErasureStep,
    ]);
  });

  it('an invitation gone before its mark: the mark is decided on what is still there', async () => {
    const world = privacyWorld();
    const r = rig({
      world,
      beforeCommit: (at, store) => {
        // 6: the invitations' marks
        if (at === 6) store.delete(`${Collections.Invitations}/inv-p`);
      },
    });
    expect(unwrapOk(await r.erase()).erasureDone).toBe(true);
    expect(r.store.has(`${Collections.Invitations}/inv-p`)).toBe(false);
  });

  it('a failed avatar delete → ERASING, not done (the Auth user is deleted all the same); the next call completes', async () => {
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const stores = memoryErasureStores({
      authUsers: new Map([[world.person.userId, [Role.Client]]]),
      objects: objectsOf(world),
    });
    const avatar = `avatars/${world.person.userId}/avatar.jpg`;
    const first = rig({
      world,
      store,
      stores,
      script: { failingPaths: [avatar] },
    });
    expect(unwrapOk(await first.erase())).toMatchObject({
      erasureStatus: ErasureStatus.Erasing,
      erasureDone: false,
    });
    expect(stores.authUsers.has(world.person.userId)).toBe(false);
    expect(stores.objects.has(avatar)).toBe(true);
    const second = rig({ world, store, stores });
    expect(unwrapOk(await second.erase()).erasureDone).toBe(true);
    expect(stores.objects.has(avatar)).toBe(false);
  });

  it.each(['loadClientRecord', 'loadProfile', 'listClientVisits'] as const)(
    'a failed %s at the residue re-read answers that failure — after the units, the record ERASING',
    async (port) => {
      const world = privacyWorld();
      const store = footprintStoreOf(world.state);
      const reads = new Map<string, unknown>(
        Object.entries(storeClientFootprintPorts(store)),
      );
      const original = reads.get(port) as (...input: unknown[]) => unknown;
      const failure = RepositoryError.readFailed(port, 'unavailable');
      let calls = 0;
      const r = rig({
        world,
        store,
        overrides: {
          [port]: async (...args: unknown[]) => {
            calls++;
            if (calls === 2) return Result.err(failure);
            return original(...args);
          },
        },
      });
      expect(unwrapErr(await r.erase())).toEqual(failure);
      expect(
        store.get(`${Collections.Customers}/${world.person.customerId}`),
      ).toMatchObject({ erasureStatus: ErasureStatus.Erasing });
    },
  );

  it('a record gone before the RESWEPT commit plans no row, and is answered as not found', async () => {
    const r = await oneShot();
    r.store.set(`${Collections.AppointmentNotes}/${r.world.visits.solo.id}`, {
      text: PRIVACY_SENTINELS.note,
      authorUserId: r.world.barber,
      writtenAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    const sweep = rig({
      world: r.world,
      store: r.store,
      stores: r.stores,
      beforeCommit: (at, store) => {
        // 0: the note's unit, 1: the RESWEPT row
        if (at === 1) {
          store.delete(`${Collections.Customers}/${r.world.person.customerId}`);
        }
      },
    });
    expect(
      unwrapErr(
        await sweep.erase({ operationId: OperationId.of('op-resweep-0003') }),
      ),
    ).toEqual(PrivacyError.clientNotFound());
    expect(rowsNamed(r.store, AuditAction.PrivacyClientErasureReswept)).toEqual(
      [],
    );
  });

  it('the preview answers a failed sibling read', async () => {
    const world = privacyWorld();
    const store = footprintStoreOf(world.state);
    const reads = storeClientFootprintPorts(store);
    const failure = RepositoryError.readFailed('customers', 'unavailable');
    const r = rig({
      world,
      store,
      overrides: {
        loadClientRecord: async (customerId) =>
          customerId === world.person.customerId
            ? reads.loadClientRecord(customerId)
            : Result.err(failure),
      },
    });
    expect(unwrapErr(await r.preview())).toEqual(failure);
  });
});
