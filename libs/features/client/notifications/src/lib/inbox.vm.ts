import type { NotificationTopic } from '@core/components';
import type { NotificationId } from '@core/primitives';
import type { UiIconName } from '@creativo/ui/controls';

/*
 * THE INBOX'S DISPLAY MODEL (OR-19, Law 10.3) — what one row of
 * `/account/notifications` prints, and the one tag-to-glyph table. Filled by
 * `inbox.presenter.ts`; no function lives here.
 */

/**
 * Where a row leads — a router path and its query, plain data the template
 * binds to `routerLink` / `queryParams`. `null` query: the path alone.
 */
export type InboxRouteVm = {
  readonly path: string;
  readonly query: Readonly<Record<string, string>> | null;
};

/** One notification as its row prints it. */
export type InboxRowVm = {
  readonly id: NotificationId;
  /** The topic, for the row's `data-topic` (the e2e contract) — never printed. */
  readonly topic: NotificationTopic;
  /** The leading glyph — the topic's ({@link notificationGlyphs}). */
  readonly glyph: UiIconName;
  /** «Освободи се час». */
  readonly title: string;
  /** «пт, 2 октомври · 10:00»; `null` when the topic has no second line. */
  readonly detail: string | null;
  /** The row's accessible name — «Освободи се час: пт, 2 октомври, 10:00. Запиши се». */
  readonly label: string;
  /** How long ago it was sent, said relatively — «преди 2 ч.». */
  readonly age: string;
  /**
   * What a screen reader hears after the row's name (its description,
   * `aria-describedby`): the age, and on an unread row the unread word
   * first — «Ново, преди 2 ч.» — since the dot that draws it is a shape
   * with no words.
   */
  readonly meta: string;
  /** Drawn with the unread dot: unread when the page was entered (or since). */
  readonly unread: boolean;
  /** Where a tap goes; `null` for a row that only says something (an announcement). */
  readonly route: InboxRouteVm | null;
};

/**
 * Each topic's leading glyph — the closed set the topic dictionary promises
 * (`notification-payload.data.ts`: "a new topic breaks the build until
 * someone gives it an icon and words"). Secondary ink, never the accent: the
 * accent is the unread dot's alone.
 */
export const notificationGlyphs = {
  APPOINTMENT_REMINDER: 'visit.calendar',
  APPOINTMENT_CHANGED: 'visit.reschedule',
  WAITLIST_MATCH: 'calendar.watching',
  REWARD_GRANTED: 'loyalty.reward',
  ANNOUNCEMENT: 'account.notifications',
} as const satisfies Record<NotificationTopic, UiIconName>;
