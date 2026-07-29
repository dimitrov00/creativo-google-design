import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { Notification, NotificationId, unreadCount } from './notification';

const at = (iso: string) => {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('bad fixture timestamp');
  return result.value;
};

const SENT = at('2026-07-29T09:00:00Z');
const LATER = at('2026-07-29T11:00:00Z');
const EARLIER = at('2026-07-29T08:00:00Z');

function valid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ntf_1',
    kind: 'appointment_reminder' as const,
    title: 'Часът ви е утре в 14:30',
    sentAt: SENT,
    ...overrides,
  };
}

const unwrap = (result: { isSuccess(): boolean; value?: Notification }) => {
  if (!result.isSuccess())
    throw new Error('unexpected failure in test fixture');
  return result.value as Notification;
};

describe('Notification.create', () => {
  it('accepts a delivered, unread notification', () => {
    const notification = unwrap(Notification.create(valid()));
    expect(notification.isUnread()).toBe(true);
    expect(notification.readAt).toBeNull();
    expect(notification.body).toBeNull();
  });

  it('rejects an empty id or a blank title', () => {
    expect(Notification.create(valid({ id: '  ' })).isFailure()).toBe(true);
    expect(Notification.create(valid({ title: '   ' })).isFailure()).toBe(true);
  });

  it('rejects a receipt that predates the message', () => {
    const result = Notification.create(valid({ readAt: EARLIER }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'notifications.notification.read_before_sent',
      );
    }
  });

  it('collects every invalid field at once', () => {
    const result = Notification.create(
      valid({ id: '', title: '', readAt: EARLIER }),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) expect(result.error.length).toBe(3);
  });

  it('trims a body down to null rather than keeping whitespace', () => {
    expect(unwrap(Notification.create(valid({ body: '  ' }))).body).toBeNull();
  });
});

describe('Notification.markRead', () => {
  it('returns a NEW read instance, leaving the original untouched', () => {
    const unread = unwrap(Notification.create(valid()));
    const read = unread.markRead(LATER);
    expect(read).not.toBe(unread);
    expect(read.isUnread()).toBe(false);
    expect(read.readAt).toBe(LATER);
    // Immutability is the point — a signal holding the old one is unmoved.
    expect(unread.isUnread()).toBe(true);
  });

  it('does not move an existing receipt when marked twice', () => {
    const read = unwrap(Notification.create(valid())).markRead(LATER);
    const again = read.markRead(at('2026-07-29T23:00:00Z'));
    expect(again).toBe(read);
    expect(again.readAt).toBe(LATER);
  });
});

describe('unreadCount', () => {
  it('counts only the unread ones', () => {
    const a = unwrap(Notification.create(valid({ id: 'a' })));
    const b = unwrap(Notification.create(valid({ id: 'b' })));
    expect(unreadCount([a, b, b.markRead(LATER)])).toBe(2);
  });

  it('is zero for an empty or fully-read inbox', () => {
    const read = unwrap(Notification.create(valid())).markRead(LATER);
    expect(unreadCount([])).toBe(0);
    expect(unreadCount([read])).toBe(0);
  });
});

describe('NotificationId', () => {
  it('rejects blank and compares by value', () => {
    expect(NotificationId.create('  ').isFailure()).toBe(true);
    const a = NotificationId.create('ntf_1');
    const b = NotificationId.create('ntf_1');
    expect(a.isSuccess() && b.isSuccess() && a.value.equals(b.value)).toBe(
      true,
    );
  });
});
