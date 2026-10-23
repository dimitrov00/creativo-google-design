import { describe, expect, it } from 'vitest';
import { NotificationPayload } from '@core/components';
import type { InboxNotification } from '@core/entities';
import { AppointmentId, NotificationId } from '@core/primitives';
import { deepFreeze, localDate, minute, utcMs } from '@core/testing';
import { NotificationSystem } from './notification.system';

/*
 * The cases of the legacy notifications `notification.spec.ts` (deleted in
 * Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED
 * while it still ran against `Notification`'s shim, and re-targeted to the flat
 * `InboxNotification`: instants are `UtcEpochMs`, a receipt is `readAtUtcMs`,
 * the payload sits at the root. Not copied: the blank id and blank title cases
 * (the id is guarded at the edge before `NotificationId.of`; a notification
 * carries facts, not a title — §9 D20), the body trim (no body any more) and
 * `NotificationId` equality (a brand is a string).
 */

const SENT = utcMs('2026-07-29T09:00:00Z');
const LATER = utcMs('2026-07-29T11:00:00Z');
const EARLIER = utcMs('2026-07-29T08:00:00Z');

function valid(overrides: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: NotificationId.of('ntf_1'),
    ...NotificationPayload.appointmentReminder(
      AppointmentId.of('appt-1'),
      // 2026-07-30T11:30:00Z — 14:30 on the shop's clock.
      localDate('2026-07-30'),
      minute(14 * 60 + 30),
    ),
    sentAtUtcMs: SENT,
    readAtUtcMs: null,
    ...overrides,
  } as InboxNotification;
}

describe('NotificationSystem — a delivered notification', () => {
  it('accepts a delivered, unread notification', () => {
    const notification = valid();
    expect(NotificationSystem.isUnread(notification)).toBe(true);
    expect(notification.readAtUtcMs).toBeNull();
    expect(NotificationSystem.readBeforeSent(notification)).toBeNull();
  });

  it('rejects a receipt that predates the message', () => {
    expect(
      NotificationSystem.readBeforeSent(valid({ readAtUtcMs: EARLIER })),
    ).toEqual({
      errorCode: 'ENGAGEMENT_NOTIFICATION_READ_BEFORE_SENT',
      sentAtUtcMs: SENT,
      readAtUtcMs: EARLIER,
    });
    // A receipt at the very instant of sending holds.
    expect(
      NotificationSystem.readBeforeSent(valid({ readAtUtcMs: SENT })),
    ).toBeNull();
  });
});

describe('NotificationSystem.markRead', () => {
  it('returns a NEW read struct, leaving the original untouched', () => {
    const unread = valid();
    const read = NotificationSystem.markRead(unread, LATER);
    expect(read).not.toBe(unread);
    expect(NotificationSystem.isUnread(read)).toBe(false);
    expect(read.readAtUtcMs).toBe(LATER);
    // Immutability is the point — a signal holding the old one is unmoved.
    expect(NotificationSystem.isUnread(unread)).toBe(true);
  });

  it('does not move an existing receipt when marked twice', () => {
    const read = NotificationSystem.markRead(valid(), LATER);
    const again = NotificationSystem.markRead(
      read,
      utcMs('2026-07-29T23:00:00Z'),
    );
    expect(again).toBe(read);
    expect(again.readAtUtcMs).toBe(LATER);
  });
});

describe('NotificationSystem.unreadCount', () => {
  it('counts only the unread ones', () => {
    const a = valid({ id: NotificationId.of('a') });
    const b = valid({ id: NotificationId.of('b') });
    expect(
      NotificationSystem.unreadCount([
        a,
        b,
        NotificationSystem.markRead(b, LATER),
      ]),
    ).toBe(2);
  });

  it('is zero for an empty or fully-read inbox', () => {
    const read = NotificationSystem.markRead(valid(), LATER);
    expect(NotificationSystem.unreadCount([])).toBe(0);
    expect(NotificationSystem.unreadCount([read])).toBe(0);
  });
});

describe('NotificationSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const inbox = deepFreeze([valid(), valid({ readAtUtcMs: LATER })]);
    const run = () => [
      NotificationSystem.unreadCount(inbox),
      NotificationSystem.markRead(inbox[0] as InboxNotification, LATER),
      NotificationSystem.readBeforeSent(inbox[1] as InboxNotification),
    ];
    expect(run()).toEqual(run());
    expect(inbox[0]?.readAtUtcMs).toBeNull();
  });
});
