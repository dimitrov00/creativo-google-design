import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  DayExceptionsEdit,
  type DayExceptionsRequest,
  GovernedCollection,
  MinuteRange,
  Role,
} from '@core/components';
import {
  BarberId,
  BusyKey,
  ExceptionEffect,
  type LocalDate,
  OperationId,
  UserId,
} from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import { StoredDocumentSystem } from '@core/systems';
import { auditDocumentChange, setDayExceptions } from '@core/pipelines';
import {
  barberFixture,
  bodyOf,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  locationFixture,
  minute,
  pinnedNowUtcMs,
  recordingTelemetry,
  registeredUserFixture,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreCatalogPorts } from '../adapters/firestore-catalog.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { decodeDocumentChangeEvent } from '../wire/triggers.wire';

/**
 * `setDayExceptions` against the REAL Firestore emulator (team onboarding
 * O4), over the real commit adapter and the real location read: the staff
 * schedule's pens behind one callable.
 *
 * - a series is written in ONE commit with ONE `TEAM_DAY_EXCEPTIONS_CHANGED`
 *   row, credited to the caller — the documents exactly the flat public
 *   effect, no eighth field; a replay writes nothing;
 * - a block moves across two barbers in one commit — the old day deleted,
 *   the new one written, one row each;
 * - a barber changes their own days and is refused a colleague's, with
 *   nothing written;
 * - the governed trigger still audits each day document, now credited to
 *   the Admin SDK: the callable's row is the one that names the person.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-day-exceptions';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const DESK = UserId.of('u-desk');
const IVAN_ACCOUNT = UserId.of('u-ivan');
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const CENTER = FIXTURE_IDS.location;
const D1 = localDate('2026-12-24');
const D2 = localDate('2026-12-25');
const LUNCH = MinuteRange.of(minute(13 * 60), endMinute(14 * 60));
const LATER = MinuteRange.of(minute(15 * 60), endMinute(16 * 60));

describe('setDayExceptions (emulator)', () => {
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
    await Promise.all([
      db
        .doc(`${Collections.Users}/${DESK}`)
        .set(
          bodyOf(
            registeredUserFixture({ id: DESK, roles: [Role.Receptionist] }),
          ),
        ),
      db.doc(`${Collections.Users}/${IVAN_ACCOUNT}`).set(
        bodyOf(
          registeredUserFixture({
            id: IVAN_ACCOUNT,
            roles: [Role.Barber],
            linkedBarberId: IVAN,
          }),
        ),
      ),
      db.doc(`${Collections.Barbers}/${IVAN}`).set(bodyOf(barberFixture())),
      db
        .doc(`${Collections.Barbers}/${NIKO}`)
        .set(bodyOf(barberFixture({ id: NIKO }))),
      db
        .doc(`${Collections.Locations}/${CENTER}`)
        .set(bodyOf(locationFixture())),
    ]);
  });

  const run = (
    request: DayExceptionsRequest,
    callerUserId: UserId,
    operation: string,
  ) => {
    const telemetry = recordingTelemetry();
    return setDayExceptions({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      hash: sha256Hex,
      loadLocation: firestoreCatalogPorts(db).loadLocation,
    })({ ...request, callerUserId, operationId: OperationId.of(operation) });
  };

  const day = (barberId: BarberId, localDate: LocalDate) =>
    db.doc(
      `${Collections.ScheduleExceptions}/${BusyKey.of(barberId, localDate)}`,
    );
  /** Every `auditLog` body, by action then resource. */
  const auditRows = async (): Promise<readonly Record<string, unknown>[]> =>
    (await db.collection(Collections.AuditLog).get()).docs
      .map((doc) => doc.data())
      .sort((a, b) =>
        `${String(a['auditAction'])}${String(a['resourceId'])}`.localeCompare(
          `${String(b['auditAction'])}${String(b['resourceId'])}`,
        ),
      );

  it('writes a series in one commit with ONE row credited to the caller — the documents the flat public effect; a replay writes nothing', async () => {
    const series: DayExceptionsRequest = {
      dayExceptionsEdit: DayExceptionsEdit.Block,
      barberId: IVAN,
      locationId: CENTER,
      ranges: [LUNCH],
      localDates: [D1, D2],
    };
    expect(await run(series, DESK, 'operation-days-012345678')).toEqual({
      ok: true,
      value: { barberIds: [IVAN] },
    });

    for (const localDate of [D1, D2]) {
      const stored = (await day(IVAN, localDate).get()).data() ?? {};
      expect(stored).toMatchObject({
        barberId: IVAN,
        localDate,
        locationId: CENTER,
        exceptionEffect: ExceptionEffect.Blocked,
        exceptionRanges: [LUNCH],
        dayBreakRanges: null,
      });
      // The seven keys of the entity, and no other: geometry only.
      expect(Object.keys(stored).sort()).toEqual([
        'barberId',
        'dayBreakRanges',
        'exceptionEffect',
        'exceptionRanges',
        'localDate',
        'locationId',
        'utcEpochMs',
      ]);
    }
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.TeamDayExceptionsChanged,
      ...Actor.forCaller(DESK, [Role.Receptionist]),
      resourceId: `barbers/${IVAN}`,
      auditOperationId: 'operation-days-012345678',
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      dayExceptionsEdit: 'BLOCK',
      dayExceptionsFromLocalDate: D1,
      dayExceptionsToLocalDate: D2,
      dayExceptionsDayCount: 2,
    });

    // The same act again: the days already say so — nothing written, no row.
    expect((await run(series, DESK, 'operation-days-012345678')).ok).toBe(true);
    expect(await auditRows()).toHaveLength(1);
  });

  it('moves a block across two barbers in one commit: the old day deleted, the new one written, one row each', async () => {
    await run(
      {
        dayExceptionsEdit: DayExceptionsEdit.Block,
        barberId: IVAN,
        locationId: CENTER,
        ranges: [LUNCH],
        localDates: [D1],
      },
      DESK,
      'operation-days-seed00001',
    );
    const moved = await run(
      {
        dayExceptionsEdit: DayExceptionsEdit.Move,
        liftBarberId: IVAN,
        liftLocalDate: D1,
        liftRange: LUNCH,
        writes: [
          {
            barberId: NIKO,
            locationId: CENTER,
            ranges: [LATER],
            localDates: [D1],
          },
        ],
      },
      DESK,
      'operation-days-move00001',
    );
    expect(moved).toEqual({ ok: true, value: { barberIds: [IVAN, NIKO] } });
    expect((await day(IVAN, D1).get()).exists).toBe(false);
    expect((await day(NIKO, D1).get()).data()?.['exceptionRanges']).toEqual([
      LATER,
    ]);
    const moves = (await auditRows()).filter(
      (row) => row['dayExceptionsEdit'] === 'MOVE',
    );
    expect(moves.map((row) => row['resourceId'])).toEqual([
      `barbers/${IVAN}`,
      `barbers/${NIKO}`,
    ]);
  });

  it('lets a barber change their own days, and refuses them a colleague’s — nothing written', async () => {
    const own = await run(
      {
        dayExceptionsEdit: DayExceptionsEdit.Block,
        barberId: IVAN,
        locationId: CENTER,
        ranges: [],
        localDates: [D1],
      },
      IVAN_ACCOUNT,
      'operation-days-own000001',
    );
    expect(own.ok).toBe(true);
    expect((await day(IVAN, D1).get()).data()?.['exceptionEffect']).toBe(
      ExceptionEffect.Closed,
    );

    const colleague = await run(
      {
        dayExceptionsEdit: DayExceptionsEdit.Block,
        barberId: NIKO,
        locationId: CENTER,
        ranges: [],
        localDates: [D1],
      },
      IVAN_ACCOUNT,
      'operation-days-other0001',
    );
    expect(colleague).toEqual({
      ok: false,
      error: { errorCode: SchedulingErrorCode.RosterForbidden },
    });
    expect((await day(NIKO, D1).get()).exists).toBe(false);
    expect(await auditRows()).toHaveLength(1);
  });

  it('the governed trigger still audits the day document, credited to the Admin SDK — beside the callable’s row that names the person', async () => {
    const before = await day(IVAN, D1).get();
    await run(
      {
        dayExceptionsEdit: DayExceptionsEdit.Block,
        barberId: IVAN,
        locationId: CENTER,
        ranges: [],
        localDates: [D1],
      },
      DESK,
      'operation-days-trig00001',
    );
    const after = await day(IVAN, D1).get();
    const telemetry = recordingTelemetry();
    const audited = await auditDocumentChange({
      ...firestoreAuditPorts(db, telemetry),
      hash: sha256Hex,
      nowUtcMs: pinnedNowUtcMs(),
    })(
      decodeDocumentChangeEvent(GovernedCollection.ScheduleExceptions, {
        id: 'evt-day-exception',
        time: '2026-11-13T07:00:00.000Z',
        params: { docId: BusyKey.of(IVAN, D1) },
        data: { before, after },
        authType: 'service_account',
      }),
    );
    expect(audited).toEqual({ ok: true, value: { rows: 1 } });
    const rows = await auditRows();
    expect(rows.map((row) => row['auditAction'])).toEqual([
      AuditAction.GovernedDocCreated,
      AuditAction.TeamDayExceptionsChanged,
    ]);
    expect(rows[1]).toMatchObject(Actor.forCaller(DESK, [Role.Receptionist]));
  });
});
