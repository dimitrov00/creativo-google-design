import { describe, expect, it } from 'vitest';
import { NotificationPayload } from '@core/components';
import type { InboxNotification } from '@core/entities';
import {
  AppointmentId,
  NotificationId,
  type UtcEpochMs,
} from '@core/primitives';
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
 * `NotificationId` equality (a brand is a string). The `markRead` and
 * `readBeforeSent` cases went with their verbs (OR-19).
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

/** The fixture read at `atUtcMs` — what the receipt writes, on the struct. */
function readAt(
  notification: InboxNotification,
  atUtcMs: UtcEpochMs,
): InboxNotification {
  return { ...notification, readAtUtcMs: atUtcMs };
}

describe('NotificationSystem — a delivered notification', () => {
  it('accepts a delivered, unread notification', () => {
    const notification = valid();
    expect(NotificationSystem.isUnread(notification)).toBe(true);
    expect(notification.readAtUtcMs).toBeNull();
    expect(NotificationSystem.isUnread(readAt(notification, LATER))).toBe(
      false,
    );
  });
});

describe('NotificationSystem.unreadCount', () => {
  it('counts only the unread ones', () => {
    const a = valid({ id: NotificationId.of('a') });
    const b = valid({ id: NotificationId.of('b') });
    expect(NotificationSystem.unreadCount([a, b, readAt(b, LATER)])).toBe(2);
  });

  it('is zero for an empty or fully-read inbox', () => {
    expect(NotificationSystem.unreadCount([])).toBe(0);
    expect(NotificationSystem.unreadCount([readAt(valid(), LATER)])).toBe(0);
  });
});

/*
 * The inbox page's one-shot receipt (OR-19): on entry it snapshots the
 * unread ids and stamps them all with one instant, clamped so it never
 * predates a message it reads (DEP-F14: `readBeforeSent`'s refusal is
 * replaced by the clamp; `markRead` by the batch).
 */
describe('NotificationSystem.unreadIds', () => {
  it('names the unread ones, in the inbox’s order', () => {
    const inbox = [
      valid({ id: NotificationId.of('c') }),
      readAt(valid({ id: NotificationId.of('b') }), LATER),
      valid({ id: NotificationId.of('a') }),
    ];
    expect(NotificationSystem.unreadIds(inbox)).toEqual(['c', 'a']);
  });

  it('names none for an empty or fully-read inbox — no receipt is written', () => {
    expect(NotificationSystem.unreadIds([])).toEqual([]);
    expect(NotificationSystem.unreadIds([readAt(valid(), LATER)])).toEqual([]);
  });
});

describe('NotificationSystem.receiptAt', () => {
  it('stamps now when every unread message was sent before it', () => {
    expect(
      NotificationSystem.receiptAt(
        [valid(), valid({ sentAtUtcMs: EARLIER })],
        LATER,
      ),
    ).toBe(LATER);
  });

  it('never predates a message it reads: a reader clock behind the writer’s stamps the newest sentAt', () => {
    const newest = utcMs('2026-07-29T12:00:00Z');
    expect(
      NotificationSystem.receiptAt(
        [
          valid(),
          valid({ sentAtUtcMs: newest }),
          valid({ sentAtUtcMs: EARLIER }),
        ],
        LATER,
      ),
    ).toBe(newest);
    // AT the instant of sending holds.
    expect(NotificationSystem.receiptAt([valid()], SENT)).toBe(SENT);
    expect(NotificationSystem.receiptAt([valid()], EARLIER)).toBe(SENT);
  });

  it('is now when nothing is unread', () => {
    expect(NotificationSystem.receiptAt([], EARLIER)).toBe(EARLIER);
  });
});

describe('NotificationSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const inbox = deepFreeze([valid(), readAt(valid(), LATER)]);
    const run = () => [
      NotificationSystem.unreadCount(inbox),
      NotificationSystem.unreadIds(inbox),
      NotificationSystem.receiptAt(inbox, EARLIER),
    ];
    expect(run()).toEqual(run());
    expect(inbox[0]?.readAtUtcMs).toBeNull();
  });
});
