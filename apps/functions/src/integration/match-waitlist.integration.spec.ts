import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  BookingPolicy,
  DayWindows,
  MinuteRange,
  NotificationTopic,
  WaitlistLifecycle,
} from '@core/components';
import {
  CartLineId,
  Result,
  SeatKeyText,
  UtcEpochMs,
  WaitlistRequestId,
  WaitlistStatus,
} from '@core/primitives';
import {
  Collections,
  Subcollections,
  type WaitlistRequest,
} from '@core/entities';
import { StoredDocumentSystem, ZonedTimeSystem } from '@core/systems';
import { matchWaitlist } from '@core/pipelines';
import {
  barberFixture,
  barberScheduleFixture,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  localDate,
  locationFixture,
  minute,
  pinnedNowUtcMs,
  recordingTelemetry,
  serviceFixture,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCatalogPorts } from '../adapters/firestore-catalog.adapter';
import { firestoreNotificationPorts } from '../adapters/firestore-notifications.adapter';
import { firestoreSchedulePorts } from '../adapters/firestore-schedules.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { firestoreWaitlistPorts } from '../adapters/firestore-waitlist.adapter';

/**
 * The waitlist matcher against the REAL Firestore emulator: a match is ONE
 * plan whose request read and notification `Create` share a transaction, so
 * two deliveries of one freed day overlapping — a redelivered trigger, two
 * busy writes of one afternoon — notify the person ONCE: the loser re-reads
 * a request no longer `OPEN`, or meets the deterministic notification id
 * already there.
 *
 * Emulator-only by construction: refuses to run without a local
 * `FIRESTORE_EMULATOR_HOST`, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-match-waitlist';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const OWNER = FIXTURE_IDS.client;
/** Tuesday, a day ahead of the pinned Monday 09:00. */
const DAY = localDate('2026-09-29');
const REQUEST = WaitlistRequestId.of('wl_integration');

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const request: WaitlistRequest = {
  id: REQUEST,
  ownerUserId: OWNER,
  locationId: null,
  localDates: [DAY],
  utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, FIXTURE_TIME_ZONE),
  createdAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -86_400_000),
  cartSeats: [
    {
      seatKey: SeatKeyText.of('self'),
      lines: [
        {
          lineId: CartLineId.of('line-1'),
          seatKey: SeatKeyText.of('self'),
          serviceId: FIXTURE_IDS.service,
          variantId: null,
          barberId: null,
          locationId: null,
        },
      ],
    },
  ],
  cartNextSequence: 1,
  flexibleDays: [
    DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(720))]),
  ],
  ...WaitlistLifecycle.open(UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -86_400_000)),
};

describe('matchWaitlist (emulator)', () => {
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
        bodyOf(serviceFixture({ offerings: [] })),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
      [`${Collections.WaitlistRequests}/${REQUEST}`, bodyOf(request)],
    ];
    for (const [path, body] of writes) await db.doc(path).set(body);
  });

  /**
   * The matcher over the production adapters, as the composition root wires
   * it — the shop's zone read off the seeded default location (4A-11), the
   * catalogue adapter's `loadLocation`.
   */
  function run() {
    const telemetry = recordingTelemetry();
    return matchWaitlist({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      hash: sha256Hex,
      ...firestoreWaitlistPorts(db),
      ...firestoreSchedulePorts(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      ...firestoreCatalogPorts(db),
      ...firestoreNotificationPorts(db),
      nowUtcMs: pinnedNowUtcMs(),
      ...telemetry,
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
      defaultLocationId: FIXTURE_IDS.location,
    });
  }

  const command = { localDate: DAY };

  async function inbox() {
    return (
      await db
        .collection(
          `${Collections.Users}/${OWNER}/${Subcollections.Notifications}`,
        )
        .get()
    ).docs.map((doc) => doc.data());
  }

  it('notifies once across two overlapping deliveries of one freed day', async () => {
    const [first, second] = await Promise.all([run()(command), run()(command)]);
    const told = [first, second].flatMap((answer) =>
      answer.ok ? answer.value.notifiedRequestIds : [],
    );
    expect(told).toEqual([REQUEST]);
    const notifications = await inbox();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      notificationTopic: NotificationTopic.WaitlistMatch,
      waitlistRequestId: REQUEST,
      localDate: DAY,
      startMinutes: 600,
      sentAtUtcMs: FIXTURE_NOW_UTC_MS,
      readAtUtcMs: null,
    });
    // The TTL root, stamped by the commit plan (F1-7).
    expect(notifications[0]?.['purgeAt']).toBeDefined();
    const stored = (
      await db.collection(Collections.WaitlistRequests).doc(REQUEST).get()
    ).data();
    expect(stored?.['waitlistStatus']).toBe(WaitlistStatus.Matched);
  });

  it('tells nobody again on a later redelivery — the request is no longer OPEN', async () => {
    await run()(command);
    const again = await run()(command);
    expect(again).toEqual({
      ok: true,
      value: {
        notifiedRequestIds: [],
        expiredRequestIds: [],
        failures: [],
        attemptFailure: null,
      },
    });
    expect(await inbox()).toHaveLength(1);
  });
});
