import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  NotificationId,
  RepositoryErrorCode,
  Result,
  UserId,
} from '@core/primitives';
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

describe('inboxPorts.markNotificationRead and markAllNotificationsRead — the read stamp only', () => {
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

  it('stamps every UNREAD notification at once, leaving a read one’s stamp alone', async () => {
    const fake = new FakeFirestore({
      [`${INBOX}/n1`]: note(100),
      [`${INBOX}/n2`]: note(200, 250),
      [`${INBOX}/n3`]: note(300),
    });

    const answer = await inboxPorts(asDb(fake)).markAllNotificationsRead(
      GEORGI,
      READ_AT,
    );

    expect(answer).toEqual(Result.ok(undefined));
    expect(fake.reads[0]?.constraints).toEqual([
      'readAtUtcMs == null',
      'limit 400',
    ]);
    expect(fake.writes.map((write) => write.path)).toEqual([
      `${INBOX}/n1`,
      `${INBOX}/n3`,
    ]);
    expect(fake.documentAt(`${INBOX}/n2`)).toEqual(note(200, 250));
  });

  it('works through a backlog in batches of 400 until a short batch says nothing is left', async () => {
    const backlog: Record<string, object> = {};
    for (let i = 0; i < 401; i++) backlog[`${INBOX}/n${i}`] = note(i);
    const fake = new FakeFirestore(backlog);

    const answer = await inboxPorts(asDb(fake)).markAllNotificationsRead(
      GEORGI,
      READ_AT,
    );

    expect(answer).toEqual(Result.ok(undefined));
    expect(fake.reads).toHaveLength(2);
    expect(fake.writes).toHaveLength(401);
  });

  it('answers nothing to receipt with no write at all', async () => {
    const fake = new FakeFirestore({ [`${INBOX}/n1`]: note(100, 150) });

    await inboxPorts(asDb(fake)).markAllNotificationsRead(GEORGI, READ_AT);

    expect(fake.writes).toEqual([]);
  });

  it('turns a refused receipt into REPOSITORY_WRITE_FAILED', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const answer = await inboxPorts(asDb(fake)).markAllNotificationsRead(
      GEORGI,
      READ_AT,
    );

    expect(answer).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: INBOX,
        reason: 'permission-denied',
      }),
    );
  });
});
