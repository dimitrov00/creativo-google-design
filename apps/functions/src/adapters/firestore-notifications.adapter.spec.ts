import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { NotificationPayload, NotificationTopic } from '@core/components';
import {
  RepositoryError,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import { Collections, Subcollections } from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  minute,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreNotificationPorts } from './firestore-notifications.adapter';

/*
 * The matcher's cross-day cooldown probe, over the in-memory Admin SDK:
 * `notificationTopic ==` ∧ `waitlistRequestId ==` ∧ `sentAtUtcMs >=` on the
 * owner's inbox, `limit 1` (index #15).
 */

const OWNER = FIXTURE_IDS.client;
const REQUEST = WaitlistRequestId.of('wl_1');
const INBOX = `${Collections.Users}/${OWNER}/${Subcollections.Notifications}`;
const SENT = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -2 * 3_600_000);

function seeded() {
  return createProjectionFirestore({
    [`${INBOX}/n1`]: {
      sentAtUtcMs: SENT,
      readAtUtcMs: null,
      ...NotificationPayload.waitlistMatch(REQUEST, FIXTURE_TODAY, minute(600)),
    },
  });
}

const since = (hoursAgo: number) =>
  UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -hoursAgo * 3_600_000);

describe('firestoreNotificationPorts.hasRecentNotification', () => {
  it('finds a notification about the request sent since the cooldown began', async () => {
    const ports = firestoreNotificationPorts(
      seeded().db as unknown as Firestore,
    );
    expect(
      await ports.hasRecentNotification(
        OWNER,
        NotificationTopic.WaitlistMatch,
        REQUEST,
        since(6),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it('finds none before it, for another request, or in another person’s inbox', async () => {
    const ports = firestoreNotificationPorts(
      seeded().db as unknown as Firestore,
    );
    const answers = await Promise.all([
      ports.hasRecentNotification(
        OWNER,
        NotificationTopic.WaitlistMatch,
        REQUEST,
        since(1),
      ),
      ports.hasRecentNotification(
        OWNER,
        NotificationTopic.WaitlistMatch,
        WaitlistRequestId.of('wl_other'),
        since(6),
      ),
      ports.hasRecentNotification(
        UserId.of('u-someone'),
        NotificationTopic.WaitlistMatch,
        REQUEST,
        since(6),
      ),
    ]);
    expect(answers).toEqual([
      { ok: true, value: false },
      { ok: true, value: false },
      { ok: true, value: false },
    ]);
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('10 ABORTED'), { code: 10 });
    });
    const ports = firestoreNotificationPorts(fake.db as unknown as Firestore);
    expect(
      await ports.hasRecentNotification(
        OWNER,
        NotificationTopic.WaitlistMatch,
        REQUEST,
        since(6),
      ),
    ).toEqual({
      ok: false,
      error: RepositoryError.readFailed(INBOX, 'aborted'),
    });
  });
});
