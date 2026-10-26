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

describe('inboxPorts.markNotificationsRead — one batched receipt', () => {
  it('stamps every named notification with the same readAtUtcMs, in ONE commit, and nothing else', async () => {
    const fake = new FakeFirestore({
      [`${INBOX}/n1`]: note(100),
      [`${INBOX}/n2`]: note(200),
      [`${INBOX}/n3`]: note(300),
    });
    const commits = vi.spyOn(fake, 'commit');

    const answer = await inboxPorts(asDb(fake)).markNotificationsRead(
      GEORGI,
      [NotificationId.of('n3'), NotificationId.of('n1')],
      READ_AT,
    );

    expect(answer).toEqual(Result.ok(undefined));
    // One batch: the receipt is one write, never one per row.
    expect(commits).toHaveBeenCalledTimes(1);
    expect(fake.writes).toEqual([
      { kind: 'update', path: `${INBOX}/n3`, data: { readAtUtcMs: READ_AT } },
      { kind: 'update', path: `${INBOX}/n1`, data: { readAtUtcMs: READ_AT } },
    ]);
    expect(fake.documentAt(`${INBOX}/n1`)).toEqual(note(100, READ_AT));
    expect(fake.documentAt(`${INBOX}/n3`)).toEqual(note(300, READ_AT));
    // A notification the receipt does not name keeps its unread state.
    expect(fake.documentAt(`${INBOX}/n2`)).toEqual(note(200));
  });

  it('writes nothing — not even an empty commit — when it names no notification', async () => {
    const fake = new FakeFirestore({ [`${INBOX}/n1`]: note(100) });
    const commits = vi.spyOn(fake, 'commit');

    const answer = await inboxPorts(asDb(fake)).markNotificationsRead(
      GEORGI,
      [],
      READ_AT,
    );

    expect(answer).toEqual(Result.ok(undefined));
    expect(commits).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it('answers a failed batch as REPOSITORY_WRITE_FAILED and writes none of it, never a rejection', async () => {
    const fake = new FakeFirestore({ [`${INBOX}/n1`]: note(100) });

    const answer = await inboxPorts(asDb(fake)).markNotificationsRead(
      GEORGI,
      [NotificationId.of('n1'), NotificationId.of('gone')],
      READ_AT,
    );

    expect(answer).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: INBOX,
        reason: 'not-found',
      }),
    );
    // All or nothing: the stamp the batch could write is not written either.
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(`${INBOX}/n1`)).toEqual(note(100));
  });
});
