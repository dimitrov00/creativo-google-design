import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  GovernedCollection,
  Role,
  StaffPermissions,
} from '@core/components';
import { BarberId, type Result, UserId } from '@core/primitives';
import { Collections, STAFF_PERMISSIONS_DOC } from '@core/entities';
import {
  auditDocumentChange,
  listTeam,
  setAnalyticsGoal,
  setRosterWeek,
  setStaffPermissions,
  staffAnalytics,
} from '@core/pipelines';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  barberFixture,
  barberScheduleFixture,
  locationFixture,
  memoryFlagsPorts,
  pinnedNowUtcMs,
  recordingTelemetry,
  registeredUserFixture,
  sequentialIds,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestorePorts } from '../adapters/firestore-ports';
import { bodyOf } from '../adapters/store-answer';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeSetAnalyticsGoal,
  decodeStaffAnalytics,
} from '../wire/analytics.wire';
import { decodeSetStaffPermissions } from '../wire/governance.wire';
import { decodeSetRosterWeek } from '../wire/roster.wire';
import { decodeListTeam } from '../wire/team.wire';
import {
  CapacitySource,
  decodeCapacityEvent,
  decodeDocumentChangeEvent,
} from '../wire/triggers.wire';
import { refusalOf, type WireRequest } from '../wire/wire-read';

/**
 * STAFF PERMISSIONS, THROUGH THE CALLABLE EDGE, against the REAL Firestore
 * emulator (`docs/designs/staff-permissions.md`, stage A, exit test 5).
 * Each call runs as its export runs it — the wire's decoder over a verified
 * token, then the pipeline over the real commit and settings adapters, a
 * refusal as the `HttpsError` the edge throws:
 *
 * - a content editor's token, once the owner gives that level the team,
 *   gets the whole Team list from `listTeam`;
 * - the front desk, narrowed on hours, is refused on the NEXT
 *   `setRosterWeek` with the same token — nobody signed out;
 * - a hand-written bad cell refuses its level and still admits the admin;
 * - one save writes ONE `TEAM_PERMISSIONS_CHANGED` row, the settings
 *   trigger plans no second one, and no capacity rebuild is started;
 * - an admin linked as a barber reads their own analytics, and sets their
 *   own goal, with a token that does not yet say `barber`.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-staff-permissions';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/* The clock: Monday 28 September 2026, 09:00 in Sofia. */
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('b-niko');
const CENTRE = FIXTURE_IDS.location;
const EVENT_TIME = '2026-09-28T06:00:00.000Z';
const PERMISSIONS = `${Collections.Settings}/${STAFF_PERMISSIONS_DOC}`;

const OWNER = registeredUserFixture({
  id: UserId.of('u-owner'),
  roles: [Role.Admin],
  firstName: 'Петър',
  lastName: 'Собственик',
});
const DESK = registeredUserFixture({
  id: UserId.of('u-desk'),
  roles: [Role.Receptionist],
});
const EDITOR = registeredUserFixture({
  id: UserId.of('u-editor'),
  roles: [Role.ContentManager],
});
const IVAN_USER = registeredUserFixture({
  id: UserId.of('u-ivan'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
});

/** A verified token: the uid and the roles claim it was minted with. */
type Token = { readonly uid: string; readonly roles: readonly string[] };
const OWNER_TOKEN: Token = { uid: OWNER.id, roles: ['admin'] };
const DESK_TOKEN: Token = { uid: DESK.id, roles: ['receptionist'] };
const EDITOR_TOKEN: Token = { uid: EDITOR.id, roles: ['content_manager'] };

/** What a caller gets back: the answer, or the status and details the edge throws. */
type Answered<Out> =
  | { readonly answer: Out }
  | { readonly status: string; readonly details: unknown };

describe('staff permissions, through the callable edge (emulator)', () => {
  let db: Firestore;
  let operationSeq = 0;
  /** A fresh act name — each save and each roster write is its own act. */
  const operation = (): string =>
    `operation-perm-${String(++operationSeq).padStart(10, '0')}`;

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
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const put = (collection: string, entity: { readonly id: string }) =>
      db.collection(collection).doc(entity.id).set(bodyOf(entity));
    await Promise.all([
      put(Collections.Locations, locationFixture()),
      put(Collections.Barbers, barberFixture({ id: IVAN })),
      put(Collections.Barbers, barberFixture({ id: NIKO })),
      put(Collections.BarberSchedules, barberScheduleFixture({ id: IVAN })),
      put(Collections.BarberSchedules, barberScheduleFixture({ id: NIKO })),
      put(Collections.Users, OWNER),
      put(Collections.Users, DESK),
      put(Collections.Users, EDITOR),
      put(Collections.Users, IVAN_USER),
    ]);
  });

  /** The server's ports over the emulator: the real commit, settings and analytics adapters. */
  const ports = () => {
    const telemetry = recordingTelemetry();
    return {
      ...firestorePorts(
        db,
        {
          nowUtcMs: pinnedNowUtcMs(),
          nextId: sequentialIds('id'),
          hash: sha256Hex,
        },
        telemetry,
      ),
      ...telemetry,
      ...memoryFlagsPorts(),
      defaultLocationId: CENTRE,
    };
  };

  /**
   * One call as its export runs it: the decoder over the verified token,
   * then the pipeline — a refusal projected exactly as the edge throws it.
   */
  async function through<Cmd, Out, E extends { readonly errorCode: string }>(
    decode: (request: WireRequest) => Result<Cmd, EdgeError>,
    run: (cmd: Cmd) => Promise<Result<Out, E>>,
    data: unknown,
    token: Token,
  ): Promise<Answered<Out>> {
    const thrown = (error: EdgeError): Answered<Out> => {
      const https = toHttpsError(error);
      return { status: https.code, details: https.details };
    };
    const decoded = decode({
      data,
      auth: { uid: token.uid, token: { roles: token.roles } },
    });
    if (!decoded.ok) return thrown(decoded.error);
    const result = await run(decoded.value);
    return result.ok
      ? { answer: result.value }
      : thrown(refusalOf(result.error) as EdgeError);
  }

  /** The owner's save, through the edge. */
  const save = (
    changes: readonly {
      readonly staffCapability: string;
      readonly role: string;
      readonly accessScope: string;
    }[],
    token: Token = OWNER_TOKEN,
    operationId: string = operation(),
  ) =>
    through(
      decodeSetStaffPermissions,
      setStaffPermissions(ports()),
      { changes, operationId },
      token,
    );

  /** Ivan's week, Monday 09:00–18:00 at the centre, from today on. */
  const week = (token: Token, barberId: BarberId = IVAN) =>
    through(
      decodeSetRosterWeek,
      setRosterWeek(ports()),
      {
        barberId,
        locationId: CENTRE,
        fromLocalDate: '2026-09-28',
        segments: [
          {
            weekday: 1,
            locationId: CENTRE,
            startMinutes: 540,
            endMinutes: 1080,
          },
        ],
        breaks: [],
        operationId: operation(),
      },
      token,
    );

  const team = (token: Token) =>
    through(decodeListTeam, listTeam(ports()), {}, token);

  const report = (token: Token, scopeBarberIds: readonly BarberId[]) =>
    through(
      decodeStaffAnalytics,
      staffAnalytics(ports()),
      {
        scopeBarberIds,
        scopeLocationIds: [],
        fromLocalDate: '2026-09-01',
        toLocalDate: null,
        analyticsSpan: 'MONTH',
        analyticsComparison: 'PREVIOUS',
      },
      token,
    );

  /** Every `auditLog` body. */
  const auditRows = async (): Promise<readonly Record<string, unknown>[]> =>
    (await db.collection(Collections.AuditLog).get()).docs.map((doc) =>
      doc.data(),
    );

  /** The settings trigger over one write of the permissions document, handed both sides as the platform does. */
  async function settingsTriggerOver(
    write: () => Promise<unknown>,
    eventId: string,
  ): Promise<void> {
    const before = await db.doc(PERMISSIONS).get();
    await write();
    const after = await db.doc(PERMISSIONS).get();
    const telemetry = recordingTelemetry();
    await auditDocumentChange({
      ...firestoreAuditPorts(db, telemetry),
      hash: sha256Hex,
      nowUtcMs: pinnedNowUtcMs(),
    })(
      decodeDocumentChangeEvent(GovernedCollection.Settings, {
        id: eventId,
        time: EVENT_TIME,
        params: { docId: STAFF_PERMISSIONS_DOC },
        data: { before, after },
        authType: 'service_account',
      }),
    );
  }

  const denied = (staffCapability: string) => ({
    status: 'permission-denied',
    details: { errorCode: 'ACCESS_DENIED', staffCapability },
  });

  it('a content editor’s token, given the team, gets the whole Team list — and before that, the barber records only', async () => {
    // By default the content editor edits every profile: the records, no account.
    const before = await team(EDITOR_TOKEN);
    expect(before).toMatchObject({
      answer: {
        members: [
          { barberId: IVAN, memberUserId: null, memberRoles: [] },
          { barberId: NIKO, memberUserId: null, memberRoles: [] },
        ],
      },
    });
    expect(JSON.stringify(before)).not.toContain(IVAN_USER.id);

    expect(
      await save([
        {
          staffCapability: 'TEAM_MANAGE',
          role: 'content_manager',
          accessScope: 'ALL',
        },
      ]),
    ).toEqual({
      answer: {
        changes: [
          {
            staffCapability: 'TEAM_MANAGE',
            role: 'content_manager',
            accessScopeFrom: 'NONE',
            accessScopeTo: 'ALL',
          },
        ],
      },
    });

    // The same token, the next call: every row — the accounts beside the
    // records, then the staff accounts linked to no record.
    const after = await team(EDITOR_TOKEN);
    if (!('answer' in after)) throw new Error(JSON.stringify(after));
    expect(after.answer.members[0]).toMatchObject({
      barberId: IVAN,
      memberUserId: IVAN_USER.id,
      memberRoles: [Role.Barber],
    });
    expect(
      after.answer.members
        .filter((member) => !('barberId' in member))
        .map((member) => member.memberUserId)
        .sort(),
    ).toEqual([DESK.id, EDITOR.id, OWNER.id].sort());
  });

  it('the front desk, narrowed on hours, is refused on the next setRosterWeek with the same token — and admitted again when it is given back', async () => {
    expect(await week(DESK_TOKEN)).toEqual({ answer: { barberId: IVAN } });

    await save([
      { staffCapability: 'HOURS', role: 'receptionist', accessScope: 'NONE' },
    ]);
    const roster = db.doc(`${Collections.BarberSchedules}/${IVAN}`);
    const stamped = (await roster.get()).data()?.['writeOperationId'];
    expect(await week(DESK_TOKEN)).toEqual(denied('HOURS'));
    // Nothing was written by the refused call.
    expect((await roster.get()).data()?.['writeOperationId']).toBe(stamped);
    // The owner is never narrowed.
    expect(await week(OWNER_TOKEN)).toEqual({ answer: { barberId: IVAN } });

    await save([
      { staffCapability: 'HOURS', role: 'receptionist', accessScope: 'ALL' },
    ]);
    expect(await week(DESK_TOKEN)).toEqual({ answer: { barberId: IVAN } });
    // Back at the default, the cell is stored as "follows the default".
    expect((await db.doc(PERMISSIONS).get()).data()).toMatchObject({
      receptionistHoursScope: null,
    });
  });

  it('a hand-written bad cell refuses its level and still admits the admin; one save repairs it', async () => {
    await db
      .doc(PERMISSIONS)
      .set({ receptionistHoursScope: 'EVERYONE', barberHoursScope: 7 });
    expect(await week(DESK_TOKEN)).toEqual(denied('HOURS'));
    expect(await week({ uid: IVAN_USER.id, roles: ['barber'] })).toEqual(
      denied('HOURS'),
    );
    expect(await week(OWNER_TOKEN)).toEqual({ answer: { barberId: IVAN } });

    // The owner sees the row as "nobody" and puts it back.
    expect(
      await save([
        { staffCapability: 'HOURS', role: 'receptionist', accessScope: 'ALL' },
      ]),
    ).toEqual({
      answer: {
        changes: [
          {
            staffCapability: 'HOURS',
            role: 'receptionist',
            accessScopeFrom: 'NONE',
            accessScopeTo: 'ALL',
          },
        ],
      },
    });
    expect(await week(DESK_TOKEN)).toEqual({ answer: { barberId: IVAN } });
    // The whole body was written: every cell, valid, and the stamp.
    const stored = (await db.doc(PERMISSIONS).get()).data() ?? {};
    expect(Object.keys(stored).sort()).toEqual(
      [...Object.keys(StaffPermissions.UNSET), 'writeOperationId'].sort(),
    );
    expect(stored).toMatchObject({
      receptionistHoursScope: null,
      barberHoursScope: 'NONE',
    });
  });

  it('one save writes ONE TEAM_PERMISSIONS_CHANGED row, the settings trigger plans no second row, and no capacity rebuild is started', async () => {
    const operationId = operation();
    await settingsTriggerOver(
      () =>
        save(
          [
            {
              staffCapability: 'HOURS',
              role: 'receptionist',
              accessScope: 'NONE',
            },
            { staffCapability: 'TIME_OFF', role: 'barber', accessScope: 'ALL' },
          ],
          OWNER_TOKEN,
          operationId,
        ),
      'evt-permissions-save',
    );

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.TeamPermissionsChanged,
      resourceId: PERMISSIONS,
      auditOperationId: operationId,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      ...Actor.admin(OWNER.id),
      permissionChanges: [
        {
          staffCapability: 'HOURS',
          role: 'receptionist',
          accessScopeFrom: 'ALL',
          accessScopeTo: 'NONE',
        },
        {
          staffCapability: 'TIME_OFF',
          role: 'barber',
          accessScopeFrom: 'OWN',
          accessScopeTo: 'ALL',
        },
      ],
    });
    expect((await db.doc(PERMISSIONS).get()).data()).toMatchObject({
      receptionistHoursScope: 'NONE',
      barberTimeOffScope: 'ALL',
      writeOperationId: operationId,
    });

    // The capacity trigger listens on every settings document; a write of
    // this one decodes to no rebuild — and the policy's still to a sweep.
    expect(
      decodeCapacityEvent(CapacitySource.Settings, {
        docId: STAFF_PERMISSIONS_DOC,
      }),
    ).toBeNull();
    expect(
      decodeCapacityEvent(CapacitySource.Settings, { docId: 'bookingPolicy' }),
    ).not.toBeNull();
    expect((await db.collection(Collections.Capacity).get()).size).toBe(0);

    // A replay of the same save changes nothing: no write, no row.
    await settingsTriggerOver(
      () =>
        save(
          [
            {
              staffCapability: 'HOURS',
              role: 'receptionist',
              accessScope: 'NONE',
            },
          ],
          OWNER_TOKEN,
          operationId,
        ),
      'evt-permissions-replay',
    );
    expect(await auditRows()).toHaveLength(1);

    // A write no callable stamped — the console — IS the trigger's to audit.
    await settingsTriggerOver(
      () => db.doc(PERMISSIONS).update({ barberHoursScope: 'ALL' }),
      'evt-permissions-console',
    );
    const after = await auditRows();
    expect(after).toHaveLength(2);
    expect(after.map((row) => row['auditAction']).sort()).toEqual(
      [
        AuditAction.GovernedDocUpdated,
        AuditAction.TeamPermissionsChanged,
      ].sort(),
    );
  });

  it('refuses every caller but a stored, active admin — whatever the token says — and writes nothing', async () => {
    const hours = [
      { staffCapability: 'HOURS', role: 'receptionist', accessScope: 'NONE' },
    ];
    // The front desk's own token never reaches the payload.
    expect(await save(hours, DESK_TOKEN)).toEqual({
      status: 'permission-denied',
      details: { errorCode: 'GOVERNANCE_PERMISSIONS_FORBIDDEN' },
    });
    // A token that still says admin, on an account that no longer is one.
    expect(await save(hours, { uid: DESK.id, roles: ['admin'] })).toEqual({
      status: 'permission-denied',
      details: { errorCode: 'GOVERNANCE_PERMISSIONS_FORBIDDEN' },
    });
    // A cell named twice, and one that is not on offer, refuse the whole save.
    expect(
      await save([
        ...hours,
        { staffCapability: 'HOURS', role: 'receptionist', accessScope: 'ALL' },
      ]),
    ).toEqual({
      status: 'invalid-argument',
      details: {
        errorCode: 'GOVERNANCE_PERMISSIONS_INVALID',
        field: 'changes',
      },
    });
    expect(
      await save([
        { staffCapability: 'TEAM_MANAGE', role: 'admin', accessScope: 'NONE' },
      ]),
    ).toEqual({
      status: 'failed-precondition',
      details: {
        errorCode: 'GOVERNANCE_PERMISSIONS_NOT_OFFERED',
        staffCapability: 'TEAM_MANAGE',
        role: 'admin',
        accessScope: 'NONE',
      },
    });
    expect((await db.doc(PERMISSIONS).get()).exists).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  it('an admin linked as a barber reads their own analytics and sets their own goal with a token that lacks `barber`', async () => {
    // What `setRoles` leaves when the owner says «Това съм аз»: the stored
    // account is a barber's too; their token still says admin alone.
    await db
      .doc(`${Collections.Users}/${OWNER.id}`)
      .update({ roles: [Role.Barber, Role.Admin], linkedBarberId: IVAN });

    const own = await report(OWNER_TOKEN, [IVAN]);
    expect(own).toMatchObject({ answer: { reportScopeBarberId: IVAN } });
    // …and, an admin still, the shop.
    expect(await report(OWNER_TOKEN, [])).toMatchObject({
      answer: { reportScopeBarberId: null },
    });

    // Their own record's goal is theirs to set — a colleague's is nobody's.
    const goal = (scopeBarberId: BarberId) =>
      through(
        decodeSetAnalyticsGoal,
        setAnalyticsGoal(ports()),
        {
          scopeBarberId,
          goalMonth: '2026-09',
          goalLowCents: 180_000,
          goalHighCents: 220_000,
          operationId: operation(),
        },
        OWNER_TOKEN,
      );
    expect(await goal(IVAN)).toMatchObject({
      answer: { goalKey: `${IVAN}__2026-09` },
    });
    expect(await goal(NIKO)).toEqual({
      status: 'permission-denied',
      details: { errorCode: 'ANALYTICS_GOAL_FORBIDDEN' },
    });

    // The reverse: a barber's token on an account whose numbers the owner
    // took away is refused, on the stored cells.
    await save([
      { staffCapability: 'ANALYTICS', role: 'barber', accessScope: 'NONE' },
    ]);
    expect(await report({ uid: IVAN_USER.id, roles: ['barber'] }, [])).toEqual(
      denied('ANALYTICS'),
    );
    // A client's token never reaches the pipeline.
    expect(await report({ uid: IVAN_USER.id, roles: ['client'] }, [])).toEqual({
      status: 'permission-denied',
      details: { errorCode: 'ACCESS_NOT_STAFF' },
    });
  });
});
