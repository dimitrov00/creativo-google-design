import { InjectionToken } from '@angular/core';
import { AuthDeployment, FeatureFlags } from '@core/components';
import type {
  AppointmentNotePorts,
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  AuditReadPorts,
  AuthDeploymentPorts,
  AuthSessionPorts,
  AvatarPorts,
  BookingDraftPorts,
  CatalogReadPorts,
  ClientJournalPorts,
  ClientStatsReadPorts,
  ClockPorts,
  CouponVoucherPorts,
  CourseReadPorts,
  CustomerPorts,
  CustomerSearchPorts,
  DefaultLocationPorts,
  FlagsPorts,
  GatewayPorts,
  IdPorts,
  InboxPorts,
  LocationLoadPorts,
  LoyaltyAccountReadPorts,
  LoyaltyCatalogReadPorts,
  MediaResolvePorts,
  OtpChallengePorts,
  PositionReadPorts,
  ProfilePorts,
  ProgramsPorts,
  ScheduleExceptionPorts,
  SchedulingReadPorts,
  ShopEventReadPorts,
  StreakDefinitionPorts,
  StreakPublishGatewayPorts,
  TimerPorts,
  UserSearchPorts,
  WaitlistReadPorts,
} from '@core/ports';

/**
 * The web's port tokens (blueprint §5.2) — the ONE file where Angular's
 * `InjectionToken` meets ecs-core: one token per named bundle of
 * `@core/ports`, each bundle a plain object of port functions (Law 4: no
 * token inside ecs-core). `app.config.ts` binds each to the
 * `(db) => bundle` export of its `libs/infrastructure/**` adapter, eager or
 * through `provideLazyPort`; features and stores `inject()` the bundle and
 * call its members, computing derived views with `@core/systems` (Law 3).
 * Specs bind the in-memory doubles of `@core/testing` (`port-doubles.ts`).
 */

/** The booking store's raw entity streams (`SchedulingReadPorts`). */
export const SCHEDULING_READ_PORTS = new InjectionToken<SchedulingReadPorts>(
  'SCHEDULING_READ_PORTS',
);

/** The staff schedule-exception command (`ScheduleExceptionPorts`). */
export const SCHEDULE_EXCEPTION_PORTS =
  new InjectionToken<ScheduleExceptionPorts>('SCHEDULE_EXCEPTION_PORTS');

/** The appointment readers and the staff search window (`AppointmentReadPorts`). */
export const APPOINTMENT_READ_PORTS = new InjectionToken<AppointmentReadPorts>(
  'APPOINTMENT_READ_PORTS',
);

/** An account's own waitlist requests (`WaitlistReadPorts`). */
export const WAITLIST_READ_PORTS = new InjectionToken<WaitlistReadPorts>(
  'WAITLIST_READ_PORTS',
);

/** The client-stats readers, keyed by the client record (`ClientStatsReadPorts`). */
export const CLIENT_STATS_READ_PORTS = new InjectionToken<ClientStatsReadPorts>(
  'CLIENT_STATS_READ_PORTS',
);

/**
 * The admin's read of the audit trail — the five timelines and one
 * operation's rows (`AuditReadPorts`, audit-hardening WS-7). `auditLog` is
 * admin-read in the rules; no screen consumes it yet.
 */
export const AUDIT_READ_PORTS = new InjectionToken<AuditReadPorts>(
  'AUDIT_READ_PORTS',
);

/** The catalogue's four live streams (`CatalogReadPorts`). */
export const CATALOG_PORTS = new InjectionToken<CatalogReadPorts>(
  'CATALOG_PORTS',
);

/** Coupons, grants and gift vouchers (`CouponVoucherPorts`). */
export const COUPON_VOUCHER_PORTS = new InjectionToken<CouponVoucherPorts>(
  'COUPON_VOUCHER_PORTS',
);

/** The signed-in account's inbox (`InboxPorts`). */
export const INBOX_PORTS = new InjectionToken<InboxPorts>('INBOX_PORTS');

/** A visit's note (`AppointmentNotePorts`). */
export const APPOINTMENT_NOTE_PORTS = new InjectionToken<AppointmentNotePorts>(
  'APPOINTMENT_NOTE_PORTS',
);

/** A visit's photos, the upload and a client record's strip (`AppointmentPhotoPorts`). */
export const APPOINTMENT_PHOTO_PORTS =
  new InjectionToken<AppointmentPhotoPorts>('APPOINTMENT_PHOTO_PORTS');

/** The signed-in account's client record (`CustomerPorts`). */
export const CUSTOMER_PORTS = new InjectionToken<CustomerPorts>(
  'CUSTOMER_PORTS',
);

/** An account's own profile — live and once (`ProfilePorts`); every write is `updateProfile`'s. */
export const PROFILE_PORTS = new InjectionToken<ProfilePorts>('PROFILE_PORTS');

/** The staff client search over `users` (`UserSearchPorts`). */
export const USER_SEARCH_PORTS = new InjectionToken<UserSearchPorts>(
  'USER_SEARCH_PORTS',
);

/** The staff client search over the client records (`CustomerSearchPorts`, OR-26). */
export const CUSTOMER_SEARCH_PORTS = new InjectionToken<CustomerSearchPorts>(
  'CUSTOMER_SEARCH_PORTS',
);

/** A client record's loyalty account, badge and season progress (`LoyaltyAccountReadPorts`). */
export const LOYALTY_ACCOUNT_READ_PORTS =
  new InjectionToken<LoyaltyAccountReadPorts>('LOYALTY_ACCOUNT_READ_PORTS');

/** The published loyalty catalogue, the rhythm's heads included (`LoyaltyCatalogReadPorts`). */
export const LOYALTY_CATALOG_READ_PORTS =
  new InjectionToken<LoyaltyCatalogReadPorts>('LOYALTY_CATALOG_READ_PORTS');

/** A client record's journal pages — the activity feed and the ledger (`ClientJournalPorts`). */
export const CLIENT_JOURNAL_PORTS = new InjectionToken<ClientJournalPorts>(
  'CLIENT_JOURNAL_PORTS',
);

/** The rhythm's live head and its published versions (`StreakDefinitionPorts`). */
export const STREAK_DEFINITION_PORTS =
  new InjectionToken<StreakDefinitionPorts>('STREAK_DEFINITION_PORTS');

/** The rhythm's publish and withdrawal, through the callable (`StreakPublishGatewayPorts`). */
export const STREAK_PUBLISH_PORTS =
  new InjectionToken<StreakPublishGatewayPorts>('STREAK_PUBLISH_PORTS');

/** The admin programs page's suite — roles, courses, events, live and saved (`ProgramsPorts`). */
export const PROGRAMS_PORTS = new InjectionToken<ProgramsPorts>(
  'PROGRAMS_PORTS',
);

/** The careers page's roles, live (`PositionReadPorts`). */
export const POSITION_READ_PORTS = new InjectionToken<PositionReadPorts>(
  'POSITION_READ_PORTS',
);

/** The courses page's courses, live (`CourseReadPorts`). */
export const COURSE_READ_PORTS = new InjectionToken<CourseReadPorts>(
  'COURSE_READ_PORTS',
);

/** The events page's events on one side of now, live (`ShopEventReadPorts`). */
export const SHOP_EVENT_READ_PORTS = new InjectionToken<ShopEventReadPorts>(
  'SHOP_EVENT_READ_PORTS',
);

/** One shop by id — an event save's zone (`LocationLoadPorts`). */
export const LOCATION_LOAD_PORTS = new InjectionToken<LocationLoadPorts>(
  'LOCATION_LOAD_PORTS',
);

/** The deployment's main shop, configuration bound from `TenantConfig.DEFAULT` (`DefaultLocationPorts`). */
export const DEFAULT_LOCATION_PORTS = new InjectionToken<DefaultLocationPorts>(
  'DEFAULT_LOCATION_PORTS',
);

/** The browser's clock, as an absolute instant (`ClockPorts`). */
export const CLOCK_PORTS = new InjectionToken<ClockPorts>('CLOCK_PORTS');

/** The browser's fresh document ids (`IdPorts`). */
export const ID_PORTS = new InjectionToken<IdPorts>('ID_PORTS');

// ── The web's wiring (Phase 4a 4A-7) — one token per bundle ──────────────

/** The Firebase Auth session (`AuthSessionPorts`) — eager. */
export const AUTH_SESSION_PORTS = new InjectionToken<AuthSessionPorts>(
  'AUTH_SESSION_PORTS',
);

/** The three OTP callables (`OtpChallengePorts`). */
export const OTP_CHALLENGE_PORTS = new InjectionToken<OtpChallengePorts>(
  'OTP_CHALLENGE_PORTS',
);

/**
 * The deployment's authentication configuration (`AuthDeploymentPorts`) —
 * `AuthDeployment.DEFAULT` unless a root binds another, as the legacy
 * `AUTH_DEPLOYMENT` token defaulted.
 */
export const AUTH_DEPLOYMENT_PORTS = new InjectionToken<AuthDeploymentPorts>(
  'AUTH_DEPLOYMENT_PORTS',
  { factory: () => ({ authDeployment: AuthDeployment.DEFAULT }) },
);

/** The one typed callable client (`GatewayPorts`) — eager. */
export const GATEWAY_PORTS = new InjectionToken<GatewayPorts>('GATEWAY_PORTS');

/** The `/book` flow's draft in `sessionStorage` (`BookingDraftPorts`). */
export const BOOKING_DRAFT_PORTS = new InjectionToken<BookingDraftPorts>(
  'BOOKING_DRAFT_PORTS',
);

/**
 * The manifest's feature flags (`FlagsPorts`) — bound by `provideFlags`
 * from the environment's manifest; every flag OFF unless a root binds it
 * (test beds and secondary roots, as the legacy `FEATURE_FLAGS` defaulted).
 */
export const FLAGS_PORTS = new InjectionToken<FlagsPorts>('FLAGS_PORTS', {
  factory: () => {
    const flags = FeatureFlags.defaults();
    return { flagOn: (key) => FeatureFlags.flagOn(flags, key) };
  },
});

/** A person's avatar in Storage (`AvatarPorts`) — lazy. */
export const AVATAR_PORTS = new InjectionToken<AvatarPorts>('AVATAR_PORTS');

/** A catalogue image's renditions in Storage (`MediaResolvePorts`) — lazy. */
export const MEDIA_RESOLVE_PORTS = new InjectionToken<MediaResolvePorts>(
  'MEDIA_RESOLVE_PORTS',
);

/** The browser's timer (`TimerPorts`) — the session's refresh back-off. */
export const TIMER_PORTS = new InjectionToken<TimerPorts>('TIMER_PORTS');
