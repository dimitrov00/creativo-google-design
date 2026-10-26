import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  Combinability,
  CouponExpiryRule,
  CouponStatus,
  CouponValue,
  CustomerOrigin,
  DiscountSource,
  EditCommand,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiry,
  GrantExpiryTerms,
  GrantLifecycle,
  Role,
  type BookingCall,
} from '@core/components';
import {
  AppointmentId,
  BookingStatus,
  BusyKey,
  CouponGrantId,
  CouponId,
  GrantStatus,
  SeatId,
} from '@core/primitives';
import { StaffEditErrorCode } from '@core/errors';
import {
  type Appointment,
  type Coupon,
  type CouponGrant,
  Collections,
} from '@core/entities';
import { StoredDocumentSystem } from '@core/systems';
import { editAppointment, transitionAppointment } from '@core/pipelines';
import {
  appointmentFixture,
  at,
  barberFixture,
  barberScheduleFixture,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  locationFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
  seatFixture,
  serviceFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { sha256Hex, walkInKeyPorts } from '../adapters/crypto.adapter';
import { firestoreAccountPorts } from '../adapters/firestore-accounts.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreCouponPorts } from '../adapters/firestore-coupons.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * ONE SINGLE-USE REWARD, TWO VISITS, against the REAL Firestore emulator
 * (OR-13, DEP-F10): the save that puts a coupon grant on a bill burns it in
 * the same transaction that writes the bill, so a second visit asking for
 * it is refused as `grant` — sequentially, and in the race no fake can
 * stage, two saves at once. The no-show that releases the first visit's
 * holdings (DEP-F10b) gives it back, and the second visit may then take it.
 *
 * Emulator-only by construction (the same guard as the seed and the other
 * suites), with its own demo project so the wipe between tests never
 * touches the dev stack's data.
 */
const PROJECT_ID = 'demo-functions-coupon-grant-burn';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** Thursday of the week the pinned Monday 09:00 opens. */
const THURSDAY = localDate('2026-10-01');
const RECEPTION = Actor.staff(FIXTURE_IDS.client, [Role.Receptionist]);
const FIRST = FIXTURE_IDS.appointment;
const SECOND = AppointmentId.of('appt-2');
const GRANT = CouponGrantId.of('grant-free-cut');
const COUPON = CouponId.of('coupon-free-cut');
const GRANT_PATH = `${Collections.CouponGrants}/${GRANT}`;

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const thursdayAt = (hour: number) =>
  utcMs(`2026-10-01T${String(hour).padStart(2, '0')}:00:00.000+03:00`);

/** The client's cut with Ivan on Thursday at 10:00 — and, as SECOND, another at 12:00. */
function visit(
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    localDate: THURSDAY,
    utcEpochMs: thursdayAt(10),
    busyKeys: [BusyKey.of(FIXTURE_IDS.barber, THURSDAY)],
    ...extra,
  });
}

/** «Безплатно подстригване», one use, held by the visits' client record. */
const REWARD: CouponGrant = {
  id: GRANT,
  customerId: FIXTURE_IDS.customer,
  holderUserId: FIXTURE_IDS.client,
  couponId: COUPON,
  grantedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
  ...CouponValue.freeService(),
  ...GrantLifecycle.active(
    GrantCapacityTerms.singleUse(),
    GrantExpiryTerms.none(),
  ),
};

const FREE_CUT: Coupon = {
  id: COUPON,
  name: 'Безплатно подстригване',
  code: null,
  combinability: Combinability.Stackable,
  usageLimit: null,
  couponStatus: CouponStatus.Enabled,
  couponOccasion: null,
  ...CouponValue.freeService(),
  ...CouponExpiryRule.never(),
};

const APPLY_REWARD: BookingCall.EditCommand = {
  editCommand: EditCommand.Discounts,
  discounts: [{ discountSource: DiscountSource.Grant, grantId: GRANT }],
};

describe('a coupon grant is burned by the save that spends it (emulator)', () => {
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
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const writes: readonly (readonly [string, Record<string, unknown>])[] = [
      [
        `${Collections.Locations}/${FIXTURE_IDS.location}`,
        bodyOf(locationFixture()),
      ],
      [`${Collections.Barbers}/${FIXTURE_IDS.barber}`, bodyOf(barberFixture())],
      [
        `${Collections.Services}/${FIXTURE_IDS.service}`,
        bodyOf(serviceFixture()),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
      [
        `${Collections.Customers}/${FIXTURE_IDS.customer}`,
        {
          userId: FIXTURE_IDS.client,
          displayName: 'Ana Petrova',
          phone: null,
          email: null,
          searchName: 'ana petrova',
          searchPrefixes: [],
          createdAtUtcMs: FIXTURE_NOW_UTC_MS,
          customerOrigin: CustomerOrigin.Seed,
        },
      ],
      [`${Collections.Appointments}/${FIRST}`, bodyOf(visit())],
      [
        `${Collections.Appointments}/${SECOND}`,
        bodyOf(
          visit({
            id: SECOND,
            seats: [
              seatFixture({
                seatId: SeatId.of('seat-2'),
                startMinutes: at(12),
              }),
            ],
            startMinutes: at(12),
            endMinutes: endMinute(12 * 60 + 30),
            utcEpochMs: thursdayAt(12),
          }),
        ),
      ],
      [GRANT_PATH, bodyOf(REWARD)],
      [`${Collections.Coupons}/${COUPON}`, bodyOf(FREE_CUT)],
    ];
    for (const [path, body] of writes) await db.doc(path).set(body);
  });

  function ports() {
    const telemetry = recordingTelemetry();
    let minted = 0;
    return {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => `id-${++minted}`,
      hash: sha256Hex,
      // The walk-in key, as the emulator's `.secret.local` holds one (OR-26).
      ...walkInKeyPorts(() => 'walkin-integration-key'),
      ...firestoreSettingsPorts(db),
      ...firestoreCouponPorts(db),
      ...firestoreAccountPorts(db),
      ...firestoreAuditPorts(db, telemetry),
      ...telemetry,
    };
  }

  /** One «Запази» of the bill from the desk. */
  function save(
    appointmentId: AppointmentId,
    commands: readonly BookingCall.EditCommand[] = [APPLY_REWARD],
  ) {
    return editAppointment(ports())({
      appointmentId,
      actorRoles: [Role.Receptionist],
      commands,
      acknowledgedOverlap: false,
      expectedVersion: null,
      operationId: null,
      actor: RECEPTION,
    });
  }

  async function stored(path: string): Promise<Record<string, unknown>> {
    return (await db.doc(path).get()).data() ?? {};
  }

  const billOf = async (appointmentId: AppointmentId) =>
    (await stored(`${Collections.Appointments}/${appointmentId}`))[
      'discounts'
    ] as readonly Record<string, unknown>[];

  const REFUSED = {
    ok: false,
    error: { errorCode: StaffEditErrorCode.InvalidCommand, field: 'grant' },
  };

  it('burns the reward with the bill that spends it, and refuses it to the second visit', async () => {
    const first = await save(FIRST);
    expect(first.ok).toBe(true);
    expect(await stored(GRANT_PATH)).toMatchObject({
      grantStatus: GrantStatus.Used,
      usedAtUtcMs: FIXTURE_NOW_UTC_MS,
      usedNote: `appointment:${FIRST}`,
      // The terms are kept on USED: a give-back restores from the document.
      grantCapacity: GrantCapacity.SingleUse,
      grantExpiry: GrantExpiry.NoExpiry,
    });
    expect(await billOf(FIRST)).toEqual([
      expect.objectContaining({
        discountSource: DiscountSource.Grant,
        discountGrantId: GRANT,
        label: 'Безплатно подстригване',
      }),
    ]);

    const second = await save(SECOND);
    expect(second).toEqual(REFUSED);
    expect(await billOf(SECOND)).toEqual([]);
    expect(
      (await stored(`${Collections.Appointments}/${SECOND}`))['revision'],
    ).toBe(1);

    // The first visit saved again keeps its reward and writes no grant.
    expect((await save(FIRST)).ok).toBe(true);
    expect((await stored(GRANT_PATH))['usedNote']).toBe(`appointment:${FIRST}`);
  });

  it('lets exactly ONE of two saves at once spend it — the transaction is the lock', async () => {
    const [first, second] = await Promise.all([save(FIRST), save(SECOND)]);

    const outcomes = [first, second].map((answer) => answer.ok);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect([first, second].find((answer) => !answer.ok)).toEqual(REFUSED);
    const winner = first.ok ? FIRST : SECOND;
    const loser = first.ok ? SECOND : FIRST;
    expect(await stored(GRANT_PATH)).toMatchObject({
      grantStatus: GrantStatus.Used,
      usedNote: `appointment:${winner}`,
    });
    expect(await billOf(winner)).toHaveLength(1);
    expect(await billOf(loser)).toEqual([]);
  });

  it('gives the reward back when its line leaves the bill, and the other visit may then take it', async () => {
    expect((await save(FIRST)).ok).toBe(true);
    expect(
      (
        await save(FIRST, [
          { editCommand: EditCommand.Discounts, discounts: [] },
        ])
      ).ok,
    ).toBe(true);
    const back = await stored(GRANT_PATH);
    expect(back['grantStatus']).toBe(GrantStatus.Active);
    expect(back).not.toHaveProperty('usedAtUtcMs');

    expect((await save(SECOND)).ok).toBe(true);
    expect((await stored(GRANT_PATH))['usedNote']).toBe(
      `appointment:${SECOND}`,
    );
  });

  it('a no-show releases it (DEP-F10b): the line dropped from the bill, the reward ACTIVE, the second visit takes it', async () => {
    expect((await save(FIRST)).ok).toBe(true);
    const noShow = await transitionAppointment(ports())({
      appointmentId: FIRST,
      to: BookingStatus.NoShow,
      seatId: null,
      reason: null,
      actor: RECEPTION,
    });
    expect(noShow.ok).toBe(true);
    expect(await billOf(FIRST)).toEqual([]);
    expect((await stored(GRANT_PATH))['grantStatus']).toBe(GrantStatus.Active);

    const second = await save(SECOND);
    expect(unwrapOk(second).revision).toBe(2);
    expect((await stored(GRANT_PATH))['usedNote']).toBe(
      `appointment:${SECOND}`,
    );
  });
});
