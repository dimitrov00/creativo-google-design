import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  BarberStatus,
  Role,
  SystemSource,
} from '@core/components';
import { BarberId, LocalDate, Result, UserId } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { BARBER_LINK_DOC, Collections, Subcollections } from '@core/entities';
import { StoredDocumentSystem } from '@core/systems';
import { closeEndedPeriods } from '@core/pipelines';
import {
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  locationFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
  registeredUserFixture,
} from '@core/testing';
import { authSessionRevokePorts } from '../adapters/auth-claims.adapter';
import { randomUuid, sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCatalogPorts } from '../adapters/firestore-catalog.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * `closeEndedPeriods` against the REAL Firestore and Auth emulators (team
 * onboarding D10, stage 1b's exit test), over the real commit adapter and
 * the real session revocation, with a pinned now: after the close the
 * record is `DEPARTED`, the linked account is a client with no link, the
 * lock is gone, the roster ends on the last day, the account's
 * `tokensValidAfterTime` moved and the marker is set — each of the three
 * rows credited to the scheduled job. A second run changes nothing. A
 * revoke that fails leaves the record owing, and the next run ends the
 * sessions and marks it.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-close-periods';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
const AUTH_HOST = (process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??=
  '127.0.0.1:9099');
if (!FIRESTORE_HOST.includes('127.0.0.1') || !AUTH_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const ACCOUNT = UserId.of('u-ivan');
const CENTER = FIXTURE_IDS.location;
const YESTERDAY = LocalDate.addDays(FIXTURE_TODAY, -1);
const LOCK = `${Collections.Barbers}/${IVAN}/${Subcollections.Restricted}/${BARBER_LINK_DOC}`;

describe('closeEndedPeriods (emulator)', () => {
  let db: Firestore;
  let auth: Auth;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
    auth = app.auth();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await fetch(
      `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: 'DELETE' },
    );
    // The shop whose clock says what «today» is.
    await db
      .doc(`${Collections.Locations}/${CENTER}`)
      .set(bodyOf(locationFixture()));
    // Ivan worked his last day yesterday; an account signs in as him.
    await db
      .doc(`${Collections.Barbers}/${IVAN}`)
      .set(
        bodyOf(
          barberFixture({ id: IVAN, barberLastWorkingLocalDate: YESTERDAY }),
        ),
      );
    await db
      .doc(`${Collections.BarberSchedules}/${IVAN}`)
      .set(bodyOf(barberScheduleFixture({ id: IVAN })));
    await db.doc(`${Collections.Users}/${ACCOUNT}`).set(
      bodyOf(
        registeredUserFixture({
          id: ACCOUNT,
          roles: [Role.Client, Role.Barber],
          linkedBarberId: IVAN,
        }),
      ),
    );
    await db.doc(LOCK).set({ linkedUserId: ACCOUNT });
    await auth.createUser({ uid: ACCOUNT });
    // Niko works on, with no last day.
    await db
      .doc(`${Collections.Barbers}/${NIKO}`)
      .set(bodyOf(barberFixture({ id: NIKO })));
  });

  /** One run of the daily close; with `revokeFails`, Admin Auth's revoke is not reached and answers a failure. */
  const run = (revokeFails = false) => {
    const telemetry = recordingTelemetry();
    return closeEndedPeriods({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(FIXTURE_NOW_UTC_MS),
      hash: sha256Hex,
      nextId: randomUuid,
      defaultLocationId: CENTER,
      ...firestoreCatalogPorts(db),
      ...(revokeFails
        ? {
            revokeRefreshTokens: async () =>
              Result.err(PipelineError.bare(PipelineErrorCode.Unavailable)),
          }
        : authSessionRevokePorts(auth)),
      ...telemetry,
    })();
  };

  const record = async (barberId: BarberId = IVAN) =>
    (await db.doc(`${Collections.Barbers}/${barberId}`).get()).data() ?? {};
  /** Every `auditLog` row's action, sorted. */
  const auditRows = async () =>
    (await db.collection(Collections.AuditLog).get()).docs.map((doc) =>
      doc.data(),
    );

  it('closes the ended period in one commit, ends the leaver’s sessions and marks it — and a second run changes nothing', async () => {
    expect((await auth.getUser(ACCOUNT)).tokensValidAfterTime).toBeUndefined();

    expect(await run()).toEqual({
      ok: true,
      value: {
        closedBarberIds: [IVAN],
        revokeOwedBarberIds: [],
        failedBarberIds: [],
      },
    });

    // The record left, and says whose access it took and where a rehire returns.
    expect(await record()).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      barberLastWorkingLocalDate: YESTERDAY,
      barberDepartedUserId: ACCOUNT,
      barberSessionsRevokedAtUtcMs: FIXTURE_NOW_UTC_MS,
      barberRehireStatus: BarberStatus.Public,
    });
    // The account is a client again, linked to nothing; the lock is gone.
    expect(
      (await db.doc(`${Collections.Users}/${ACCOUNT}`).get()).data(),
    ).toMatchObject({
      roles: [Role.Client],
      linkedBarberId: null,
      profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect((await db.doc(LOCK).get()).exists).toBe(false);
    // The roster ends on the last day.
    expect(
      (await db.doc(`${Collections.BarberSchedules}/${IVAN}`).get()).data(),
    ).toMatchObject({
      versions: [{ effectiveToLocalDate: YESTERDAY }],
    });
    // The leaver's sessions were ended.
    const revokedAt = (await auth.getUser(ACCOUNT)).tokensValidAfterTime;
    expect(revokedAt).toBeDefined();

    // Three rows, each the scheduled job's: the departure, the account's
    // roles, and the revoke's marker.
    const rows = await auditRows();
    expect(rows.map((row) => row['auditAction']).sort()).toEqual(
      [
        AuditAction.ProfileRolesChanged,
        AuditAction.TeamBarberStatusChanged,
        AuditAction.TeamBarberStatusChanged,
      ].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject(Actor.system(SystemSource.ScheduledJob));
    }
    // Nobody else moved.
    expect(await record(NIKO)).toMatchObject({
      barberStatus: BarberStatus.Public,
    });

    // A second run: nothing to close, nobody to sign out, no new row.
    expect(await run()).toEqual({
      ok: true,
      value: {
        closedBarberIds: [],
        revokeOwedBarberIds: [],
        failedBarberIds: [],
      },
    });
    expect(await auditRows()).toHaveLength(3);
    expect((await auth.getUser(ACCOUNT)).tokensValidAfterTime).toBe(revokedAt);
  });

  it('a revoke that fails leaves the record owing; the next run ends the sessions and marks it', async () => {
    expect(await run(true)).toEqual({
      ok: true,
      value: {
        closedBarberIds: [IVAN],
        revokeOwedBarberIds: [IVAN],
        failedBarberIds: [],
      },
    });
    // The record left and the roles are taken — the sessions are not ended yet.
    expect(await record()).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberDepartedUserId: ACCOUNT,
      barberSessionsRevokedAtUtcMs: null,
    });
    expect(
      (await db.doc(`${Collections.Users}/${ACCOUNT}`).get()).data(),
    ).toMatchObject({ roles: [Role.Client] });
    expect((await auth.getUser(ACCOUNT)).tokensValidAfterTime).toBeUndefined();
    expect(await auditRows()).toHaveLength(2);

    // The next run retries the revoke, and only then writes the marker.
    expect(await run()).toEqual({
      ok: true,
      value: {
        closedBarberIds: [],
        revokeOwedBarberIds: [],
        failedBarberIds: [],
      },
    });
    expect((await auth.getUser(ACCOUNT)).tokensValidAfterTime).toBeDefined();
    expect(await record()).toMatchObject({
      barberSessionsRevokedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(await auditRows()).toHaveLength(3);
  });

  it('a record with no account leaves with nobody to sign out, and one whose last day is today works it through', async () => {
    await db.doc(`${Collections.Barbers}/${NIKO}`).update({
      barberLastWorkingLocalDate: FIXTURE_TODAY,
    });
    await db.doc(LOCK).delete();
    await db.doc(`${Collections.Users}/${ACCOUNT}`).delete();

    expect(await run()).toEqual({
      ok: true,
      value: {
        closedBarberIds: [IVAN],
        revokeOwedBarberIds: [],
        failedBarberIds: [],
      },
    });
    expect(await record()).toMatchObject({
      barberStatus: BarberStatus.Departed,
      barberDepartedUserId: null,
    });
    expect(await record(NIKO)).toMatchObject({
      barberStatus: BarberStatus.Public,
    });
    expect(await auditRows()).toHaveLength(1);
  });
});
