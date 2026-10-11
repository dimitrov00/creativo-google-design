import type { NotificationPayload } from '@core/components';
import type { NotificationId, UtcEpochMs } from '@core/primitives';

/**
 * `users/{uid}/notifications/{id}` — one delivered message in its
 * recipient's inbox (owner-read, never queried across users, TTL-purged on
 * the adapter-stamped root `purgeAt` = `sentAtUtcMs` + 90 d). Read state
 * lives here: "unread" is `readAtUtcMs === null`, the question every badge
 * asks (NotificationSystem `unreadCount`, `markRead`). Named
 * `InboxNotification` because `Notification` shadows the DOM global (F-17).
 *
 * The archetype (Law 6): the stamps beside the `NotificationPayload` slice
 * — today's root `kind` duplicate, `requestId`, `dayKey` and the nested
 * `payload` all fold into it, so the dedup query keys are the payload's
 * own `notificationTopic` + `waitlistRequestId` (WAITLIST_MATCH only). No
 * `userId`: the path names the owner, an ACCOUNT (D29).
 */
export type InboxNotification = {
  readonly id: NotificationId;
  readonly sentAtUtcMs: UtcEpochMs;
  /** `null` = unread. Never before `sentAtUtcMs`. */
  readonly readAtUtcMs: UtcEpochMs | null;
} & NotificationPayload;
