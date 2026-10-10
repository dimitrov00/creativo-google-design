import { describe, expect, it } from 'vitest';
import { NotificationPayload } from '../components/notification-payload.data';
import { AppointmentId } from '../entities/appointment.entity';
import {
  NotificationId,
  type NotificationEntity,
} from '../entities/notification.entity';
import { deepFreeze } from '../testing';
import { NotificationSystem } from './notification.system';

/*
 * The cases of libs/domain/notifications/src/lib/notification.spec.ts,
 * COPIED (the legacy spec keeps running against `Notification`'s shim) and
 * re-targeted to the plain `NotificationEntity`: instants are epoch ms, a
 * receipt is `readAtMs`. Not copied: the blank id and blank title cases
 * (the id is guarded at the edge before `NotificationId.of`; a
 * notification carries facts, not a title — §9 D20), the body trim (no
 * body any more) and `NotificationId` equality (a brand is a string).
 */

const at = (iso: string) => Date.parse(iso);

const SENT = at('2026-07-29T09:00:00Z');
const LATER = at('2026-07-29T11:00:00Z');
const EARLIER = at('2026-07-29T08:00:00Z');

function valid(
  overrides: Partial<NotificationEntity> = {},
): NotificationEntity {
  return {
    id: NotificationId.of('ntf_1'),
    kind: 'appointment_reminder',
    requestId: null,
    dayKey: null,
    payload: NotificationPayload.appointmentReminder(
      AppointmentId.of('appt-1'),
      at('2026-07-30T11:30:00Z'),
      'Europe/Sofia',
    ),
    sentAtMs: SENT,
    readAtMs: null,
    ...overrides,
  };
}

describe('NotificationSystem — a delivered notification', () => {
  it('accepts a delivered, unread notification', () => {
    const notification = valid();
    expect(NotificationSystem.isUnread(notification)).toBe(true);
    expect(notification.readAtMs).toBeNull();
    expect(NotificationSystem.readBeforeSent(notification)).toBeNull();
  });

  it('rejects a receipt that predates the message', () => {
    expect(
      NotificationSystem.readBeforeSent(valid({ readAtMs: EARLIER })),
    ).toEqual({
      code: 'engagement.notification.read_before_sent',
      sentAtMs: SENT,
      readAtMs: EARLIER,
    });
    // A receipt at the very instant of sending holds.
    expect(
      NotificationSystem.readBeforeSent(valid({ readAtMs: SENT })),
    ).toBeNull();
  });
});

describe('NotificationSystem.markRead', () => {
  it('returns a NEW read struct, leaving the original untouched', () => {
    const unread = valid();
    const read = NotificationSystem.markRead(unread, LATER);
    expect(read).not.toBe(unread);
    expect(NotificationSystem.isUnread(read)).toBe(false);
    expect(read.readAtMs).toBe(LATER);
    // Immutability is the point — a signal holding the old one is unmoved.
    expect(NotificationSystem.isUnread(unread)).toBe(true);
  });

  it('does not move an existing receipt when marked twice', () => {
    const read = NotificationSystem.markRead(valid(), LATER);
    const again = NotificationSystem.markRead(read, at('2026-07-29T23:00:00Z'));
    expect(again).toBe(read);
    expect(again.readAtMs).toBe(LATER);
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
    const inbox = deepFreeze([valid(), valid({ readAtMs: LATER })]);
    const run = () => [
      NotificationSystem.unreadCount(inbox),
      NotificationSystem.markRead(inbox[0] as NotificationEntity, LATER),
      NotificationSystem.readBeforeSent(inbox[1] as NotificationEntity),
    ];
    expect(run()).toEqual(run());
    expect(inbox[0]?.readAtMs).toBeNull();
  });
});
