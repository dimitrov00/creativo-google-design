import { LocalizedText, NotificationTopic } from '@core/components';
import type { InboxNotification } from '@core/entities';
import {
  Locale,
  type LocalDate,
  type MinuteOfDay,
  type NotificationId,
  Tag,
  type UtcEpochMs,
} from '@core/primitives';
import { intlLocaleOf, relativeTime } from '@creativo/infrastructure/i18n';
import { formatWallClock } from '@creativo/ui/wall-clock';
import {
  type InboxRouteVm,
  type InboxRowVm,
  notificationGlyphs,
} from './inbox.vm';

/*
 * THE INBOX'S WORDS (OR-19, Law 10) — one notification in, the row it
 * prints out. It decides nothing: which notifications exist is the read's
 * (the newest 50, newest first), which ones are unread is
 * `NotificationSystem.unreadIds`' (snapshotted by the page on entry, handed
 * in as `unread`). It words each topic — an exhaustive switch over
 * `notificationTopic`, so a new topic breaks the build until it has words —
 * and builds each row's link from the payload's ids.
 *
 * A visit's time is the SHOP's wall clock, printed as stored
 * (`formatWallClock`, no zone: Law 7.2); the row's age is real elapsed time
 * since the message was sent (`relativeTime`, T2), against the `now` the
 * page read once.
 */

/** Where an appointment topic leads: the account's visits. */
const APPOINTMENTS_PATH = '/account/appointments';
/** Where a reward leads: the account, whose wallet holds it. */
const ACCOUNT_PATH = '/account';
/** Where a waitlist match leads: the booking flow, on the freed day. */
const BOOK_PATH = '/book';

/** The day a visit falls on — «пт, 2 октомври» / «Fri 2 October». */
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
};

/** The minute it starts at — «10:00». */
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * How the host's catalogue answers — Transloco's `translate` in the active
 * language, or anything shaped like it (a spec's own map).
 */
export type InboxTranslate = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

/** What the inbox's rows are worded from. */
export type InboxInput = {
  /** The inbox as read — the newest first. */
  readonly notifications: readonly InboxNotification[];
  /** The ids drawn as unread: the page's entry snapshot (`NotificationSystem.unreadIds`). */
  readonly unread: ReadonlySet<NotificationId>;
  /** The instant the page read once — what each row's age is measured to. */
  readonly nowUtcMs: UtcEpochMs;
  /** The active UI language (`bg` | `en`; anything else reads as `bg`). */
  readonly lang: string;
  readonly translate: InboxTranslate;
};

/** Every notification's row, in the read's order. */
export function inboxRowsOf(input: InboxInput): readonly InboxRowVm[] {
  const rows: InboxRowVm[] = [];
  for (const notification of input.notifications) {
    rows.push(inboxRowOf(notification, input));
  }
  return rows;
}

/** One notification's row: its topic's glyph and words, its age, its dot, its link. */
export function inboxRowOf(
  notification: InboxNotification,
  input: InboxInput,
): InboxRowVm {
  const locale = intlLocaleOf(input.lang);
  const age = relativeTime(
    notification.sentAtUtcMs,
    input.nowUtcMs,
    locale,
    'short',
  );
  const unread = input.unread.has(notification.id);
  return {
    id: notification.id,
    topic: notification.notificationTopic,
    glyph: notificationGlyphs[notification.notificationTopic],
    ...topicWordsOf(notification, input),
    age,
    // The dot is a shape a screen reader never sees: its word, then the age.
    meta: unread ? `${input.translate('notifications.unread')}, ${age}` : age,
    unread,
  };
}

/** A row's words and link — what its topic says. */
type TopicWords = {
  readonly title: string;
  readonly detail: string | null;
  readonly label: string;
  readonly route: InboxRouteVm | null;
};

/**
 * The topic's words (`notifications.topic.<TOPIC>.*`, bg + en) and where it
 * leads. Exhaustive: every `NotificationTopic` member returns here.
 */
function topicWordsOf(
  notification: InboxNotification,
  input: InboxInput,
): TopicWords {
  const t = input.translate;
  switch (notification.notificationTopic) {
    case NotificationTopic.AppointmentReminder:
    case NotificationTopic.AppointmentChanged: {
      const key = `notifications.topic.${notification.notificationTopic}`;
      const when = whenOf(
        notification.localDate,
        notification.startMinutes,
        input,
      );
      return {
        title: t(`${key}.title`),
        detail: t(`${key}.detail`, when),
        label: t(`${key}.label`, when),
        route: { path: APPOINTMENTS_PATH, query: null },
      };
    }
    case NotificationTopic.WaitlistMatch: {
      const key = `notifications.topic.${notification.notificationTopic}`;
      const when = whenOf(
        notification.localDate,
        notification.startMinutes,
        input,
      );
      return {
        title: t(`${key}.title`),
        detail: t(`${key}.detail`, when),
        label: t(`${key}.label`, when),
        // The match's deep link (`client-booking.ts`): the request, and the
        // freed slot's day as the landing opens on.
        route: {
          path: BOOK_PATH,
          query: {
            waitlist: notification.waitlistRequestId,
            day: notification.localDate,
          },
        },
      };
    }
    case NotificationTopic.RewardGranted: {
      const key = `notifications.topic.${notification.notificationTopic}`;
      return {
        title: t(`${key}.title`),
        detail: t(`${key}.detail`),
        label: t(`${key}.label`),
        route: { path: ACCOUNT_PATH, query: null },
      };
    }
    case NotificationTopic.Announcement: {
      // Authored content in both shop languages (`LocalizedText`, like a
      // catalogue name) — the catalogue only frames it.
      const key = `notifications.topic.${notification.notificationTopic}`;
      const locale = Tag.or(Locale, input.lang, Locale.Bg);
      const title = LocalizedText.pick(notification.announcementTitle, locale);
      const body = notification.announcementBody;
      return {
        title: t(`${key}.title`, { title }),
        detail:
          body === null
            ? null
            : t(`${key}.detail`, { body: LocalizedText.pick(body, locale) }),
        label: t(`${key}.label`, { title }),
        route: null,
      };
    }
  }
}

/** A visit's day and time on the shop's wall clock — the `{{day}}` / `{{time}}` the topics print. */
function whenOf(
  localDate: LocalDate,
  startMinutes: MinuteOfDay,
  input: InboxInput,
): { readonly day: string; readonly time: string } {
  const locale = intlLocaleOf(input.lang);
  return {
    day: formatWallClock(localDate, null, locale, DAY_FORMAT),
    time: formatWallClock(localDate, startMinutes, locale, TIME_FORMAT),
  };
}
