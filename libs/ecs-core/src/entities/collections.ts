import {
  BookingPolicySettingsId,
  ClientMoneyStatsId,
  PolicyRecomputeJobId,
} from '@core/primitives';

/**
 * The collection-name registry (blueprint §3.1, §4.2) — the ONE spelling
 * of every Firestore path segment (and, at the end, of the query filter
 * operators a `QuerySpec` names), imported by the server adapters, the web
 * bundles, the seed, the e2e seed and every `WriteOp`/`QuerySpec` path. A
 * values file on purpose: not a `*.data.ts` (it names storage, not a
 * component) and not a `*.port.ts` (ports are function types). Each Phase 3b
 * flip deletes its collections' duplicate constants (`firestore-paths.ts`,
 * the application `*_COLLECTION` exports, the functions copies, the seed
 * literals), so the 23 constants across 12 modules end here.
 *
 * Every collection is top-level and unbounded entities never nest inside a
 * shop, barber or settings document (Law 5); the subcollections below are
 * the owner- or parent-scoped exceptions §3.1 keeps.
 */

/** Top-level collections — `/{name}/{id}`. */
export const Collections = {
  /** `Appointment` — callable-only in the rules, staff included. */
  Appointments: 'appointments',
  /** `AppointmentNote`, keyed by the appointment id. */
  AppointmentNotes: 'appointmentNotes',
  AppointmentPhotos: 'appointmentPhotos',
  /** `BarberBusyDay`, keyed by `BusyKey` (`{barberId}__{localDate}`); TTL `purgeAt`. */
  BarberBusy: 'barberBusy',
  /** `CapacityMonth`, keyed by `YYYY-MM` (§9 D7); TTL `purgeAt`. */
  Capacity: 'capacity',
  /** `ScheduleException`, keyed by the same `BusyKey` as the busy day. */
  ScheduleExceptions: 'scheduleExceptions',
  /** `BarberSchedule`, keyed by the barber id. */
  BarberSchedules: 'barberSchedules',
  /** `BarberLeadTimeSample`, keyed by `{barberId}__{localDate}`; TTL `purgeAt`. */
  BarberLeadTimeSamples: 'barberLeadTimeSamples',
  /** `WaitlistRequest`; TTL `purgeAt`. */
  WaitlistRequests: 'waitlistRequests',
  Services: 'services',
  ServiceCategories: 'serviceCategories',
  Barbers: 'barbers',
  Locations: 'locations',
  /**
   * `User`, keyed by the Firebase Auth uid — the flat body, created as the
   * `PROVISIONED` stub by `verifyOtp` and set as the `REGISTERED` body by
   * `completeRegistration`; the owner writes only the profile allowlist.
   */
  Users: 'users',
  /**
   * `Customer` — the client RECORD (D29), keyed by a `CustomerId`
   * (`CustomerId.forUser(uid, hash)` for an account holder,
   * `CustomerId.forWalkIn` for a walk-in, OR-26). The booking and edit
   * transactions create an account holder's record (`FIRST_BOOKING`) and a
   * walk-in's (`STAFF_WALK_IN`) in their phase-one read, and
   * `completeRegistration` creates it beside the registered account
   * (`REGISTRATION`); the web resolves a signed-in account's record by
   * `userId ==` (single-field).
   */
  Customers: 'customers',
  /** `Otp`; TTL `purgeAt` (`expiresAtUtcMs` + 24 h). */
  Otps: 'otps',
  /** `ImpersonationSession`; TTL `purgeAt` (stamped by Phase 4's writers). */
  ImpersonationSessions: 'impersonationSessions',
  /** `AuditEntry`, id `hash(rowBasis)`. */
  AuditLog: 'auditLog',
  Coupons: 'coupons',
  CouponGrants: 'couponGrants',
  GiftVouchers: 'giftVouchers',
  /** `LoyaltyAccount`, keyed by the client record's `CustomerId` (D29, flip (3)). */
  LoyaltyAccounts: 'loyaltyAccounts',
  /** `JournalEntry`, id `{customerId}_{seq:6}` (`JournalEntryId.forEntry`). */
  ClientJournal: 'clientJournal',
  /** `StreakDefinition` (the head). */
  StreakDefinitions: 'streakDefinitions',
  /** `ClientStatsRecord`, keyed by the client record's `CustomerId` (D29, flip (1)). */
  ClientStats: 'clientStats',
  BadgeCategories: 'badgeCategories',
  BadgeSeries: 'badgeSeries',
  Seasons: 'seasons',
  TierDefinitions: 'tierDefinitions',
  /** `RewardCatalogItem`. */
  RewardsCatalog: 'rewardsCatalog',
  Invitations: 'invitations',
  Positions: 'positions',
  Courses: 'courses',
  Events: 'events',
  /** Fixed-id tenant settings — today only `bookingPolicy`. */
  Settings: 'settings',
  /** `BackfillJob` / `PolicyRecomputeJob`, keyed by the job. */
  BackfillJobs: 'backfillJobs',
  /**
   * `TriggerFailure`, keyed by the delivery's event id — the dead letter a
   * retrying trigger writes once when it gives up (audit-hardening WS-6):
   * admin-read, written by no client, never TTL'd.
   */
  TriggerFailures: 'triggerFailures',
} as const;

/** Subcollections — `/{parent}/{parentId}/{name}/{id}`. */
export const Subcollections = {
  /** `users/{uid}/notifications` — owner-read, TTL-purged, never queried across users. */
  Notifications: 'notifications',
  /** `clientStats/{customerId}/restricted/{docId}` — staff-only (`money`). */
  Restricted: 'restricted',
  /** `streakDefinitions/{id}/versions/{version:6}`. */
  Versions: 'versions',
  /** `invitations/{id}/redemptions/{refereeUserId}` — the id is the idempotency guard. */
  Redemptions: 'redemptions',
  /** `loyaltyAccounts/{customerId}/badgeProgress/{seriesId}`. */
  BadgeProgress: 'badgeProgress',
  /** `loyaltyAccounts/{customerId}/seasonProgress/{seasonId}`. */
  SeasonProgress: 'seasonProgress',
} as const;

/** `settings/bookingPolicy` — the one settings document (`BookingPolicySettings`). */
export const BOOKING_POLICY_DOC = BookingPolicySettingsId.FIXED;

/** `clientStats/{customerId}/restricted/money` — the staff-only money projection. */
export const CLIENT_MONEY_DOC = ClientMoneyStatsId.FIXED;

/** `backfillJobs/clientStatsPolicy` — the policy-change recompute pass (`PolicyRecomputeJob`). */
export const POLICY_RECOMPUTE_DOC = PolicyRecomputeJobId.FIXED;

/**
 * Firestore's own filter vocabulary (`WhereFilterOp`), verbatim — the ONE
 * spelling of a `QueryFilter.op` (`tx.port.ts`). The values are the SDK's
 * own strings (values: external contract — the Firestore SDK's filter
 * operators), so the adapter passes them straight through and no second
 * spelling exists to drift; a pipeline writes `op: QueryOp.ArrayContains`,
 * never `'array-contains'`. Its type is `QueryOp` beside it (pass D, S-21:
 * one name — the ports tier's `QueryOperator` alias is gone).
 */
export const QueryOp = {
  Eq: '==',
  Ne: '!=',
  Lt: '<',
  Lte: '<=',
  Gt: '>',
  Gte: '>=',
  ArrayContains: 'array-contains',
  ArrayContainsAny: 'array-contains-any',
  In: 'in',
  NotIn: 'not-in',
} as const;
export type QueryOp = (typeof QueryOp)[keyof typeof QueryOp];
