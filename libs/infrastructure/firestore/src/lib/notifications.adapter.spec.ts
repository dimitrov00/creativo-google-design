import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { NotificationId, Result, UserId } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { utcMs } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { inboxPorts } = await import('./notifications.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;
const GEORGI = UserId.of('u-georgi');
const READ_AT = utcMs('2026-10-09T10:00:00+03:00');
const INBOX = 'users/u-georgi/notifications';

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

/** A delivered notification, unread unless told. */
const note = (sentAtUtcMs: number, readAtUtcMs: number | null = null) => ({
  sentAtUtcMs,
  readAtUtcMs,
  notificationTopic: 'WAITLIST_MATCH',
});

describe('inboxPorts.observeInbox', () => {
  it('reads the newest 50 of the person’s own inbox, newest first, live', () => {
    const fake = new FakeFirestore({
      [`${INBOX}/n1`]: note(100),
      [`${INBOX}/n2`]: note(200, 250),
      'users/u-martin/notifications/n3': note(300),
    });

    const inbox = recorded(inboxPorts(asDb(fake)).observeInbox(GEORGI));
    fake.set(`${INBOX}/n4`, note(400));

    expect(inbox.seen).toEqual([
      Result.ok([
        { id: 'n2', ...note(200, 250) },
        { id: 'n1', ...note(100) },
      ]),
      Result.ok([
        { id: 'n4', ...note(400) },
        { id: 'n2', ...note(200, 250) },
        { id: 'n1', ...note(100) },
      ]),
    ]);
    expect(fake.reads[0]).toEqual({
      kind: 'listen',
      path: INBOX,
      constraints: ['orderBy sentAtUtcMs desc', 'limit 50'],
    });
  });
});

describe('inboxPorts.markNotificationRead — the read stamp only', () => {
  it('stamps one notification with readAtUtcMs and nothing else', async () => {
    const fake = new FakeFirestore({ [`${INBOX}/n1`]: note(100) });

    const answer = await inboxPorts(asDb(fake)).markNotificationRead(
      GEORGI,
      NotificationId.of('n1'),
      READ_AT,
    );

    expect(answer).toEqual(Result.ok(undefined));
    expect(fake.writes).toEqual([
      { kind: 'update', path: `${INBOX}/n1`, data: { readAtUtcMs: READ_AT } },
    ]);
    expect(fake.documentAt(`${INBOX}/n1`)).toEqual(note(100, READ_AT));
  });

  it('answers a failed stamp as REPOSITORY_WRITE_FAILED, never a rejection', async () => {
    const answer = await inboxPorts(
      asDb(new FakeFirestore()),
    ).markNotificationRead(GEORGI, NotificationId.of('gone'), READ_AT);

    expect(answer).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: `${INBOX}/gone`,
        reason: 'not-found',
      }),
    );
  });
});
