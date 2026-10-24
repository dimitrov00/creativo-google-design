import type { LocalDate, UtcEpochMs } from '@core/primitives';

/**
 * The TTL groups (pass C, P-34; `firestore-layout.md`: TTL on `purgeAt` for
 * `barberBusy`, `capacity`, `waitlistRequests`, `notifications`,
 * `barberLeadTimeSamples`, `otps`, `impersonationSessions`) — one per
 * collection the TTL service purges, the ONLY source of these strings, the
 * field `retentionGroup` ({@link RetentionAnchor}'s discriminator). Which
 * collection a document path names is the TTL adapter's to read; the
 * retention arithmetic is `RetentionSystem.purgeAtUtcMs`.
 */
export const RetentionGroup = {
  /** `barberBusy/{barberId__localDate}` — kept past its day. */
  BarberBusy: 'BARBER_BUSY',
  /** `capacity/{YYYY-MM}` — kept past its month's last day. */
  Capacity: 'CAPACITY',
  /** `waitlistRequests/{id}` — kept past the latest day it watches. */
  WaitlistRequests: 'WAITLIST_REQUESTS',
  /** `users/{uid}/notifications/{id}` — kept past its sending. */
  Notifications: 'NOTIFICATIONS',
  /** `barberLeadTimeSamples/{id}` — kept past its sampled day. */
  LeadTimeSamples: 'LEAD_TIME_SAMPLES',
  /** `otps/{id}` — kept past its expiry. */
  Otps: 'OTPS',
  /** `impersonationSessions/{id}` — kept past its end, else its window. */
  ImpersonationSessions: 'IMPERSONATION_SESSIONS',
} as const;
export type RetentionGroup =
  (typeof RetentionGroup)[keyof typeof RetentionGroup];

/**
 * What one TTL group's `purgeAt` is anchored on — the fields its formula
 * reads, already branded (the TTL adapter parses the stored body: a missing
 * or unreadable field is no anchor, and no stamp). Discriminated by
 * `retentionGroup`; never a document body or a path.
 */
export type RetentionAnchor =
  | RetentionAnchor.BarberBusy
  | RetentionAnchor.Capacity
  | RetentionAnchor.WaitlistRequests
  | RetentionAnchor.Notifications
  | RetentionAnchor.LeadTimeSamples
  | RetentionAnchor.Otps
  | RetentionAnchor.ImpersonationSessions;

export const RetentionAnchor = {
  barberBusy(localDate: LocalDate): RetentionAnchor.BarberBusy {
    return { retentionGroup: RetentionGroup.BarberBusy, localDate };
  },

  /** The month by its first day (`YYYY-MM-01`). */
  capacity(monthFirstDay: LocalDate): RetentionAnchor.Capacity {
    return { retentionGroup: RetentionGroup.Capacity, monthFirstDay };
  },

  /** Copies the list, so a caller's later mutation cannot move the anchor. */
  waitlistRequests(
    localDates: readonly LocalDate[],
  ): RetentionAnchor.WaitlistRequests {
    return {
      retentionGroup: RetentionGroup.WaitlistRequests,
      localDates: [...localDates],
    };
  },

  notifications(sentAtUtcMs: UtcEpochMs): RetentionAnchor.Notifications {
    return { retentionGroup: RetentionGroup.Notifications, sentAtUtcMs };
  },

  leadTimeSamples(localDate: LocalDate): RetentionAnchor.LeadTimeSamples {
    return { retentionGroup: RetentionGroup.LeadTimeSamples, localDate };
  },

  otps(expiresAtUtcMs: UtcEpochMs): RetentionAnchor.Otps {
    return { retentionGroup: RetentionGroup.Otps, expiresAtUtcMs };
  },

  impersonationSessions(
    endedAtUtcMs: UtcEpochMs | null,
    expiresAtUtcMs: UtcEpochMs | null,
  ): RetentionAnchor.ImpersonationSessions {
    return {
      retentionGroup: RetentionGroup.ImpersonationSessions,
      endedAtUtcMs,
      expiresAtUtcMs,
    };
  },
} as const;

export namespace RetentionAnchor {
  /** A busy day: its shop day. */
  export type BarberBusy = {
    readonly retentionGroup: typeof RetentionGroup.BarberBusy;
    readonly localDate: LocalDate;
  };
  /** A capacity month: its first day. */
  export type Capacity = {
    readonly retentionGroup: typeof RetentionGroup.Capacity;
    readonly monthFirstDay: LocalDate;
  };
  /** A waitlist request: every day it watches (none at all is allowed). */
  export type WaitlistRequests = {
    readonly retentionGroup: typeof RetentionGroup.WaitlistRequests;
    readonly localDates: readonly LocalDate[];
  };
  /** An inbox notification: when it was sent. */
  export type Notifications = {
    readonly retentionGroup: typeof RetentionGroup.Notifications;
    readonly sentAtUtcMs: UtcEpochMs;
  };
  /** A lead-time sample: its sampled day. */
  export type LeadTimeSamples = {
    readonly retentionGroup: typeof RetentionGroup.LeadTimeSamples;
    readonly localDate: LocalDate;
  };
  /** An OTP challenge: its expiry. */
  export type Otps = {
    readonly retentionGroup: typeof RetentionGroup.Otps;
    readonly expiresAtUtcMs: UtcEpochMs;
  };
  /** An impersonation session: its end when stamped, its window's expiry otherwise. */
  export type ImpersonationSessions = {
    readonly retentionGroup: typeof RetentionGroup.ImpersonationSessions;
    readonly endedAtUtcMs: UtcEpochMs | null;
    readonly expiresAtUtcMs: UtcEpochMs | null;
  };
}
