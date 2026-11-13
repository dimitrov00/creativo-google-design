import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  BarberActivation,
  BarberEdit,
  BarberStatus,
  GovernedCollection,
  OfferingsEdit,
  Role,
  StaffSetupItem,
} from '@core/components';
import { BarberId, OperationId, ServiceId, UserId } from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import { BARBER_LINK_DOC, Collections, Subcollections } from '@core/entities';
import { StoredDocumentSystem } from '@core/systems';
import {
  activateBarber,
  addBarber,
  auditDocumentChange,
  deleteDraftBarber,
  editBarber,
  setBarberOfferings,
} from '@core/pipelines';
import {
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  locationFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
  registeredUserFixture,
  serviceFixture,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { decodeDocumentChangeEvent } from '../wire/triggers.wire';

/**
 * The barber record's four callables against the REAL Firestore emulator
 * (team onboarding D5, D9, D10, D12), over the real commit adapter — the
 * whole-collection reads inside the transaction included:
 *
 * - `addBarber` writes the `DRAFT` under the act's own id with exactly ONE
 *   `TEAM_BARBER_ADDED` row in the same commit; a replay writes nothing;
 *   the governed trigger, handed the write's before / after image, plans
 *   NO second row (the write stamped its operation);
 * - `editBarber` sets the record whole beside ONE row;
 * - `setBarberOfferings` copies a colleague's terms onto the services the
 *   colleague performs, each stamped with the act, beside ONE row on the
 *   barber; the governed trigger over a stamped service write plans none;
 * - `activateBarber` answers what a draft still misses, then takes it live
 *   — the stored document exactly the live variant;
 * - `deleteDraftBarber` removes the record with its roster, its lock, the
 *   account's link and its offerings — and the trigger still audits the
 *   deletion, which stamps nothing.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-team-barber';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const ADMIN = UserId.of('u-admin');
const NEWCOMER = UserId.of('u-newcomer');
const ADD = OperationId.of('operation-add-0123456789');
const NEW = BarberId.of(ADD);
const CENTER = FIXTURE_IDS.location;
const CALLER = { callerUserId: ADMIN, callerRoles: [Role.Admin] } as const;
const EVENT_TIME = '2026-11-13T07:00:00.000Z';

describe('the team callables (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await db
      .doc(`${Collections.Users}/${ADMIN}`)
      .set(bodyOf(registeredUserFixture({ id: ADMIN, roles: [Role.Admin] })));
    await db
      .doc(`${Collections.Locations}/${CENTER}`)
      .set(bodyOf(locationFixture()));
  });

  /** The ports every team pipeline takes, over the real commit adapter. */
  const ports = () => ({
    commit: firestoreCommitPlan(
      db,
      StoredDocumentSystem.guardOf,
      recordingTelemetry().log,
    ),
    nowUtcMs: pinnedNowUtcMs(),
    hash: sha256Hex,
    defaultLocationId: CENTER,
  });

  const add = () =>
    addBarber(ports())({
      ...CALLER,
      operationId: ADD,
      name: { bg: 'Сентинел Име', en: null },
      locationIds: [CENTER],
      barberStartsLocalDate: localDate('2026-01-01'),
      barberLastWorkingLocalDate: null,
      barberDraftTargetStatus: BarberStatus.Public,
      barberJoinsAnyPool: true,
    });

  const record = () => db.doc(`${Collections.Barbers}/${NEW}`);
  const lock = () =>
    db.doc(
      `${Collections.Barbers}/${NEW}/${Subcollections.Restricted}/${BARBER_LINK_DOC}`,
    );
  /** Every `auditLog` body, oldest first. */
  const auditRows = async (): Promise<readonly Record<string, unknown>[]> =>
    (await db.collection(Collections.AuditLog).get()).docs
      .map((doc) => doc.data())
      .sort((a, b) =>
        String(a['auditAction']).localeCompare(String(b['auditAction'])),
      );

  /** The governed trigger over one `barbers` write, handed both sides as the platform does. */
  async function triggerOver(
    write: () => Promise<unknown>,
    eventId: string,
  ): Promise<unknown> {
    const before = await record().get();
    await write();
    const after = await record().get();
    const telemetry = recordingTelemetry();
    return auditDocumentChange({
      ...firestoreAuditPorts(db, telemetry),
      hash: sha256Hex,
      nowUtcMs: pinnedNowUtcMs(),
    })(
      decodeDocumentChangeEvent(GovernedCollection.Barbers, {
        id: eventId,
        time: EVENT_TIME,
        params: { docId: NEW },
        data: { before, after },
        authType: 'service_account',
      }),
    );
  }

  it('adds a DRAFT under the act’s own id with ONE row in the same commit; a replay writes nothing; the trigger plans no second row', async () => {
    const audited = await triggerOver(async () => {
      expect(await add()).toEqual({ ok: true, value: { barberId: NEW } });
    }, 'evt-team-add');

    expect((await record().get()).data()).toMatchObject({
      barberStatus: BarberStatus.Draft,
      barberDraftTargetStatus: BarberStatus.Public,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      name: { bg: 'Сентинел Име', en: 'Сентинел Име' },
      locationIds: [CENTER],
      sortOrder: 1,
      writeOperationId: ADD,
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.TeamBarberAdded,
      ...Actor.admin(ADMIN),
      resourceId: `barbers/${NEW}`,
      auditOperationId: ADD,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      teamBarberStatusFrom: null,
      teamBarberStatusTo: BarberStatus.Draft,
    });
    expect(JSON.stringify(rows)).not.toContain('Сентинел');

    // The write stamped its operation: the callable's row is the only one.
    expect(audited).toEqual({ ok: true, value: { rows: 0 } });
    expect(await auditRows()).toHaveLength(1);

    // The same act again: the record its first run wrote, nothing new.
    expect(await add()).toEqual({ ok: true, value: { barberId: NEW } });
    expect(await auditRows()).toHaveLength(1);
    expect((await db.collection(Collections.Barbers).get()).size).toBe(1);
  });

  it('edits a part whole beside ONE row, and refuses a caller whose stored role is gone', async () => {
    await add();
    const operationId = OperationId.of('operation-edit-012345678');
    expect(
      await editBarber(ports())({
        ...CALLER,
        operationId,
        barberId: NEW,
        barberEdit: BarberEdit.Access,
        barberStatus: BarberStatus.StaffOnly,
      }),
    ).toEqual({ ok: true, value: { barberId: NEW } });
    expect((await record().get()).data()).toMatchObject({
      barberStatus: BarberStatus.Draft,
      barberDraftTargetStatus: BarberStatus.StaffOnly,
      writeOperationId: operationId,
    });
    const rows = await auditRows();
    expect(rows.map((row) => row['auditAction'])).toEqual([
      AuditAction.TeamBarberAdded,
      AuditAction.TeamBarberStatusChanged,
    ]);
    expect(rows[1]).toMatchObject({
      auditOperationId: operationId,
      teamBarberFields: ['barberDraftTargetStatus'],
    });

    // The token still says admin; the stored account no longer does.
    await db
      .doc(`${Collections.Users}/${ADMIN}`)
      .update({ roles: [Role.Barber] });
    const refused = await editBarber(ports())({
      ...CALLER,
      operationId: OperationId.of('operation-edit-refused01'),
      barberId: NEW,
      barberEdit: BarberEdit.Pool,
      barberJoinsAnyPool: false,
    });
    expect(refused).toEqual({
      ok: false,
      error: { errorCode: TeamErrorCode.Forbidden },
    });
    expect(await auditRows()).toHaveLength(2);
  });

  it('copies a colleague’s prices: each service stamped with the act beside ONE row on the barber; the trigger plans no second row; a replay writes nothing', async () => {
    await add();
    const ivan = barberFixture();
    await db.doc(`${Collections.Barbers}/${ivan.id}`).set(bodyOf(ivan));
    // Ivan performs the cut; nobody is listed for the shave.
    const cut = db.doc(`${Collections.Services}/${FIXTURE_IDS.service}`);
    await cut.set(bodyOf(serviceFixture()));
    const shaveId = ServiceId.of('svc-shave');
    const shave = db.doc(`${Collections.Services}/${shaveId}`);
    await shave.set(bodyOf(serviceFixture({ id: shaveId, offerings: [] })));

    const operationId = OperationId.of('operation-copy-012345678');
    const copy = () =>
      setBarberOfferings(ports())({
        ...CALLER,
        operationId,
        barberId: NEW,
        offeringsEdit: OfferingsEdit.Copy,
        copyFromBarberId: ivan.id,
      });

    const before = await cut.get();
    expect(await copy()).toEqual({ ok: true, value: { barberId: NEW } });
    const after = await cut.get();

    const source = serviceFixture().offerings[0];
    expect(after.data()).toMatchObject({
      offerings: [source, { ...source, barberId: NEW }],
      writeOperationId: operationId,
    });
    // A service the colleague does not perform is not written at all.
    expect((await shave.get()).data()).toEqual(
      bodyOf(serviceFixture({ id: shaveId, offerings: [] })),
    );

    const rows = await auditRows();
    expect(rows.map((row) => row['auditAction'])).toEqual([
      AuditAction.TeamBarberAdded,
      AuditAction.TeamBarberOfferingsChanged,
    ]);
    expect(rows[1]).toMatchObject({
      ...Actor.admin(ADMIN),
      resourceId: `barbers/${NEW}`,
      auditOperationId: operationId,
      teamOfferingServiceIds: [FIXTURE_IDS.service],
      teamOfferingsCopiedFromBarberId: ivan.id,
    });

    // The governed trigger over the stamped service write plans no row.
    const telemetry = recordingTelemetry();
    const audited = await auditDocumentChange({
      ...firestoreAuditPorts(db, telemetry),
      hash: sha256Hex,
      nowUtcMs: pinnedNowUtcMs(),
    })(
      decodeDocumentChangeEvent(GovernedCollection.Services, {
        id: 'evt-team-offerings',
        time: EVENT_TIME,
        params: { docId: FIXTURE_IDS.service },
        data: { before, after },
        authType: 'service_account',
      }),
    );
    expect(audited).toEqual({ ok: true, value: { rows: 0 } });

    // The same act again: nothing to change, nothing written.
    expect(await copy()).toEqual({ ok: true, value: { barberId: NEW } });
    expect(await auditRows()).toHaveLength(2);
  });

  it('answers what a draft still misses, then takes it live — the stored document exactly the live variant', async () => {
    await add();
    const activate = (operation: string) =>
      activateBarber(ports())({
        ...CALLER,
        operationId: OperationId.of(operation),
        barberId: NEW,
      });
    expect(await activate('operation-live-000000001')).toEqual({
      ok: true,
      value: {
        barberId: NEW,
        barberActivation: BarberActivation.NotReady,
        staffSetupItem: StaffSetupItem.Services,
      },
    });

    // The two items a new record lacks: a service that lists it, and hours.
    const offering = serviceFixture().offerings[0];
    await db.doc(`${Collections.Services}/${FIXTURE_IDS.service}`).set(
      bodyOf(
        serviceFixture({
          offerings:
            offering === undefined ? [] : [{ ...offering, barberId: NEW }],
        }),
      ),
    );
    await db
      .doc(`${Collections.BarberSchedules}/${NEW}`)
      .set(bodyOf(barberScheduleFixture({ id: NEW })));

    expect(await activate('operation-live-000000002')).toEqual({
      ok: true,
      value: { barberId: NEW, barberActivation: BarberActivation.Activated },
    });
    const stored = (await record().get()).data() ?? {};
    expect(stored).toMatchObject({
      barberStatus: BarberStatus.Public,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(Object.keys(stored)).not.toContain('barberDraftTargetStatus');
    expect((await auditRows()).map((row) => row['auditAction'])).toEqual([
      AuditAction.TeamBarberAdded,
      AuditAction.TeamBarberStatusChanged,
    ]);

    // Idempotent: a live record is unchanged, and no third row is written.
    expect(await activate('operation-live-000000003')).toEqual({
      ok: true,
      value: { barberId: NEW, barberActivation: BarberActivation.Unchanged },
    });
    expect(await auditRows()).toHaveLength(2);

    // A record that has been live is no draft to delete.
    expect(
      await deleteDraftBarber(ports())({
        ...CALLER,
        operationId: OperationId.of('operation-del-0000000001'),
        barberId: NEW,
      }),
    ).toEqual({
      ok: false,
      error: { errorCode: TeamErrorCode.NotDraft, barberId: NEW },
    });
    expect((await record().get()).exists).toBe(true);
  });

  it('deletes a draft with its roster, lock, link and offerings in one commit — and the trigger still audits the deletion', async () => {
    await add();
    const offering = serviceFixture().offerings[0];
    const service = db.doc(`${Collections.Services}/${FIXTURE_IDS.service}`);
    await service.set(
      bodyOf(
        serviceFixture({
          offerings:
            offering === undefined ? [] : [{ ...offering, barberId: NEW }],
        }),
      ),
    );
    const roster = db.doc(`${Collections.BarberSchedules}/${NEW}`);
    await roster.set(bodyOf(barberScheduleFixture({ id: NEW })));
    const account = db.doc(`${Collections.Users}/${NEWCOMER}`);
    await account.set(
      bodyOf(
        registeredUserFixture({
          id: NEWCOMER,
          roles: [Role.Barber],
          linkedBarberId: NEW,
        }),
      ),
    );
    await lock().set({ linkedUserId: NEWCOMER });

    const operationId = OperationId.of('operation-del-0123456789');
    const audited = await triggerOver(async () => {
      expect(
        await deleteDraftBarber(ports())({
          ...CALLER,
          operationId,
          barberId: NEW,
        }),
      ).toEqual({ ok: true, value: { barberId: NEW } });
    }, 'evt-team-delete');

    expect((await record().get()).exists).toBe(false);
    expect((await roster.get()).exists).toBe(false);
    expect((await lock().get()).exists).toBe(false);
    expect((await account.get()).data()).toMatchObject({
      roles: [Role.Barber],
      linkedBarberId: null,
    });
    expect((await service.get()).data()?.['offerings']).toEqual([]);

    // The callable's row, credited to the admin — and the trigger's own:
    // a deletion stamps nothing, so it is never skipped.
    expect(audited).toEqual({ ok: true, value: { rows: 1 } });
    const rows = await auditRows();
    expect(rows.map((row) => row['auditAction'])).toEqual([
      AuditAction.GovernedDocDeleted,
      AuditAction.TeamBarberAdded,
      AuditAction.TeamBarberDeleted,
    ]);
    expect(rows[2]).toMatchObject({
      ...Actor.admin(ADMIN),
      auditOperationId: operationId,
      resourceId: `barbers/${NEW}`,
      teamBarberStatusFrom: BarberStatus.Draft,
      teamBarberStatusTo: null,
    });

    // The second tap finds no record.
    expect(
      await deleteDraftBarber(ports())({
        ...CALLER,
        operationId,
        barberId: NEW,
      }),
    ).toEqual({
      ok: false,
      error: { errorCode: TeamErrorCode.BarberNotFound, barberId: NEW },
    });
  });
});
