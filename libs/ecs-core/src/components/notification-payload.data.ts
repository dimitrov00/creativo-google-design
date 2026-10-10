import type { AppointmentId } from '../entities/appointment.entity';
import type { WaitlistRequestId } from '../entities/waitlist-request.entity';
import type { LocalizedText } from './localized-text.data';
import type { RewardRef } from './journal-effect.data';

/**
 * What a notification is ABOUT — drives its glyph and its copy (and, later,
 * whether a channel may suppress it). A closed set: the UI renders every
 * case, so a new kind breaks the build until someone gives it an icon and
 * words. The stored strings of `NotificationKind` (`notification.ts:25-36`),
 * unchanged; index #15 keys on it.
 */
export const NotificationKind = {
  AppointmentReminder: 'appointment_reminder',
  AppointmentChanged: 'appointment_changed',
  /**
   * A standing waitlist request found something. The one time-critical
   * kind: the slot it names is NOT held, so the notification invites a race
   * for it and its copy must say so.
   */
  WaitlistMatch: 'waitlist_match',
  RewardGranted: 'reward_granted',
  Announcement: 'announcement',
} as const;
export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

/**
 * The FACTS a notification is made of (§9 D20) — never formatted words. The
 * matcher stops writing Bulgarian `title`/`body`/`deepLink`
 * (`firestore-notification-writer.ts:29-35`); the inbox words each kind
 * from i18n in the reader's locale, its time in the payload's `zone`, and
 * builds its link from the ids. Discriminated by the same `kind` as the
 * notification it sits on.
 *
 * Only `waitlist_match` has a production writer today (`match-waitlist.ts`);
 * the other four kinds carry the facts their copy needs — the visit, the
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
    startMs: number,
    zone: string,
  ): NotificationPayload.AppointmentReminder {
    return {
      kind: NotificationKind.AppointmentReminder,
      appointmentId,
      startMs,
      zone,
    };
  },

  appointmentChanged(
    appointmentId: AppointmentId,
    startMs: number,
    zone: string,
  ): NotificationPayload.AppointmentChanged {
    return {
      kind: NotificationKind.AppointmentChanged,
      appointmentId,
      startMs,
      zone,
    };
  },

  /** The freed slot a waitlist request matched: when it starts, in the shop's zone. */
  waitlistMatch(
    requestId: WaitlistRequestId,
    startMs: number,
    zone: string,
  ): NotificationPayload.WaitlistMatch {
    return { kind: NotificationKind.WaitlistMatch, requestId, startMs, zone };
  },

  rewardGranted(reward: RewardRef): NotificationPayload.RewardGranted {
    return { kind: NotificationKind.RewardGranted, reward };
  },

  announcement(
    title: LocalizedText,
    body: LocalizedText | null,
  ): NotificationPayload.Announcement {
    return { kind: NotificationKind.Announcement, title, body };
  },
} as const;

export namespace NotificationPayload {
  export type AppointmentReminder = {
    readonly kind: typeof NotificationKind.AppointmentReminder;
    readonly appointmentId: AppointmentId;
    readonly startMs: number;
    readonly zone: string;
  };
  export type AppointmentChanged = {
    readonly kind: typeof NotificationKind.AppointmentChanged;
    readonly appointmentId: AppointmentId;
    readonly startMs: number;
    readonly zone: string;
  };
  export type WaitlistMatch = {
    readonly kind: typeof NotificationKind.WaitlistMatch;
    readonly requestId: WaitlistRequestId;
    readonly startMs: number;
    readonly zone: string;
  };
  export type RewardGranted = {
    readonly kind: typeof NotificationKind.RewardGranted;
    readonly reward: RewardRef;
  };
  export type Announcement = {
    readonly kind: typeof NotificationKind.Announcement;
    readonly title: LocalizedText;
    readonly body: LocalizedText | null;
  };
}
