import type { DayKey } from '../components/day-key.data';
import type {
  NotificationKind,
  NotificationPayload,
} from '../components/notification-payload.data';
import type { WaitlistRequestId } from './waitlist-request.entity';

export type NotificationId = string & { readonly __brand: unique symbol };
export const NotificationId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): NotificationId => raw as NotificationId,
} as const;

/**
 * `users/{uid}/notifications/{id}` — one delivered message in its
 * recipient's inbox (owner-read, never queried across users, TTL-purged on
 * the adapter-stamped root `purgeAt` = `sentAtMs` + 90 d). Read state lives
 * here: "unread" is `readAtMs === null`, the question every badge asks
 * (NotificationSystem `unreadCount`, `markRead`).
 *
 * Declared changes (§2.6, §9 D20): the formatted Bulgarian `title`/`body`/
 * `deepLink` are replaced by `payload` — facts the UI words from i18n;
 * `requestId`/`dayKey` (the dedup query keys, index #15) are an explicit
 * `null` instead of omitted; the stored `id` duplicate is dropped, and
 * there is no `userId` — the path names the owner. ISO → `*Ms`.
 */
export type NotificationEntity = {
  readonly id: NotificationId;
  /** The same tag as `payload.kind`, at the root as the query key. */
  readonly kind: NotificationKind;
  /** The waitlist request a `waitlist_match` answers; `null` otherwise. */
  readonly requestId: WaitlistRequestId | null;
  /** The day a `waitlist_match` names; `null` otherwise. */
  readonly dayKey: DayKey | null;
  readonly payload: NotificationPayload;
  readonly sentAtMs: number;
  /** `null` = unread. Never before `sentAtMs`. */
  readonly readAtMs: number | null;
};
