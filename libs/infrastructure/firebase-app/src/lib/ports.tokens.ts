import { InjectionToken } from '@angular/core';
import type {
  AppointmentNotePorts,
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  CatalogReadPorts,
  ClientJournalPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerPorts,
  ImpersonationReadPorts,
  InboxPorts,
  LoyaltyAccountReadPorts,
  LoyaltyCatalogReadPorts,
  ProfilePorts,
  ScheduleExceptionPorts,
  SchedulingReadPorts,
  StreakDefinitionPorts,
  StreakPublishGatewayPorts,
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

/** An account's own profile — live, once, and the owner's edit (`ProfilePorts`). */
export const PROFILE_PORTS = new InjectionToken<ProfilePorts>('PROFILE_PORTS');

/** The staff client search over `users` (`UserSearchPorts`). */
export const USER_SEARCH_PORTS = new InjectionToken<UserSearchPorts>(
  'USER_SEARCH_PORTS',
);

/** The admin's live impersonation session (`ImpersonationReadPorts`). */
export const IMPERSONATION_READ_PORTS =
  new InjectionToken<ImpersonationReadPorts>('IMPERSONATION_READ_PORTS');

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
