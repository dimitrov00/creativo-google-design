import type {
  AppointmentId,
  WaitlistRequestId,
  LocalDate,
  MinuteOfDay,
} from '@core/primitives';
import type { RewardRefFields } from './journal-effect.data';
import type { LocalizedText } from './localized-text.data';

/**
 * What a notification is ABOUT — the discriminator `notificationTopic` —
 * drives its glyph and its copy (and, later, whether a channel may
 * suppress it). A closed set: the UI renders every case, so a new topic
 * breaks the build until someone gives it an icon and words. (Stored bytes
 * are today's lowercase `kind` until the notifications flip; the shims map.)
 */
export const NotificationTopic = {
  AppointmentReminder: 'APPOINTMENT_REMINDER',
  AppointmentChanged: 'APPOINTMENT_CHANGED',
  /**
   * A standing waitlist request found something. The one time-critical
   * topic: the slot it names is NOT held, so the notification invites a
   * race for it and its copy must say so.
   */
  WaitlistMatch: 'WAITLIST_MATCH',
  RewardGranted: 'REWARD_GRANTED',
  Announcement: 'ANNOUNCEMENT',
} as const;
export type NotificationTopic =
  (typeof NotificationTopic)[keyof typeof NotificationTopic];

/**
 * The FACTS a notification is made of (§9 D20) — never formatted words. The
 * inbox words each topic from i18n in the reader's locale and builds its
 * link from the ids. A union of FLAT variant slices at the notification's
 * root, discriminated by `notificationTopic`. A visit's time is the SHOP's
 * wall clock — `localDate` + `startMinutes` — with no zone: the zone is the
 * location's (Law 7.2).
 *
 * Only `WAITLIST_MATCH` has a production writer today (`match-waitlist.ts`);
 * the other four topics carry the facts their copy needs — the visit, the
 * reward — and an announcement its authored bilingual text (content, like a
 * catalogue name, not i18n copy).
 */
export type NotificationPayload =
  | NotificationPayload.AppointmentReminder
  | NotificationPayload.AppointmentChanged
  | NotificationPayload.WaitlistMatch
  | NotificationPayload.RewardGranted
  | NotificationPayload.Announcement;

export const NotificationPayload = {
  appointmentReminder(
    appointmentId: AppointmentId,
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
  ): NotificationPayload.AppointmentReminder {
    return {
      notificationTopic: NotificationTopic.AppointmentReminder,
      appointmentId,
      localDate,
      startMinutes,
    };
  },

  appointmentChanged(
    appointmentId: AppointmentId,
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
  ): NotificationPayload.AppointmentChanged {
    return {
      notificationTopic: NotificationTopic.AppointmentChanged,
      appointmentId,
      localDate,
      startMinutes,
    };
  },

  /** The freed slot a waitlist request matched: when it starts, on the shop's clock. */
  waitlistMatch(
    waitlistRequestId: WaitlistRequestId,
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
  ): NotificationPayload.WaitlistMatch {
    return {
      notificationTopic: NotificationTopic.WaitlistMatch,
      waitlistRequestId,
      localDate,
      startMinutes,
    };
  },

  rewardGranted(reward: RewardRefFields): NotificationPayload.RewardGranted {
    return { notificationTopic: NotificationTopic.RewardGranted, ...reward };
  },

  announcement(
    announcementTitle: LocalizedText,
    announcementBody: LocalizedText | null,
  ): NotificationPayload.Announcement {
    return {
      notificationTopic: NotificationTopic.Announcement,
      announcementTitle,
      announcementBody,
    };
  },
} as const;

export namespace NotificationPayload {
  export type AppointmentReminder = {
    readonly notificationTopic: typeof NotificationTopic.AppointmentReminder;
    readonly appointmentId: AppointmentId;
    readonly localDate: LocalDate;
    readonly startMinutes: MinuteOfDay;
  };
  export type AppointmentChanged = {
    readonly notificationTopic: typeof NotificationTopic.AppointmentChanged;
    readonly appointmentId: AppointmentId;
    readonly localDate: LocalDate;
    readonly startMinutes: MinuteOfDay;
  };
  export type WaitlistMatch = {
    readonly notificationTopic: typeof NotificationTopic.WaitlistMatch;
    readonly waitlistRequestId: WaitlistRequestId;
    readonly localDate: LocalDate;
    readonly startMinutes: MinuteOfDay;
  };
  export type RewardGranted = {
    readonly notificationTopic: typeof NotificationTopic.RewardGranted;
  } & RewardRefFields;
  export type Announcement = {
    readonly notificationTopic: typeof NotificationTopic.Announcement;
    readonly announcementTitle: LocalizedText;
    readonly announcementBody: LocalizedText | null;
  };
}
