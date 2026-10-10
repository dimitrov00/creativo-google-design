import { BookingPolicySettingsId } from '../entities/booking-policy-settings.entity';
import { ClientMoneyStatsId } from '../entities/client-money-stats.entity';
import { PolicyRecomputeJobId } from '../entities/policy-recompute-job.entity';

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
  /** `AppointmentEntity` — callable-only in the rules, staff included. */
  Appointments: 'appointments',
  /** `AppointmentNoteEntity`, keyed by the appointment id. */
  AppointmentNotes: 'appointmentNotes',
  AppointmentPhotos: 'appointmentPhotos',
  /** `BarberBusyDayEntity`, keyed by `BusyKey` (`{barberId}__{dayKey}`); TTL `purgeAt`. */
  BarberBusy: 'barberBusy',
  /** `CapacityMonthEntity`, keyed by `YYYY-MM` (§9 D7); TTL `purgeAt`. */
  Capacity: 'capacity',
  /** `ScheduleExceptionEntity`, keyed by the same `BusyKey` as the busy day. */
  ScheduleExceptions: 'scheduleExceptions',
  /** `BarberScheduleEntity`, keyed by the barber id. */
  BarberSchedules: 'barberSchedules',
  /** `BarberLeadTimeSampleEntity`, keyed by `{barberId}__{dayKey}`; TTL `purgeAt`. */
  BarberLeadTimeSamples: 'barberLeadTimeSamples',
  /** `WaitlistRequestEntity`; TTL `purgeAt`. */
  WaitlistRequests: 'waitlistRequests',
  Services: 'services',
  ServiceCategories: 'serviceCategories',
  Barbers: 'barbers',
  Locations: 'locations',
  /** `UserEntity`, keyed by the Firebase Auth uid. */
  Users: 'users',
  /** `OtpEntity`; TTL `purgeAt`. */
  Otps: 'otps',
  /** `ImpersonationSessionEntity`; TTL `purgeAt`. */
  ImpersonationSessions: 'impersonationSessions',
  /** `AuditEntryEntity`, id `hash(rowBasis)`. */
  AuditLog: 'auditLog',
  Coupons: 'coupons',
  CouponGrants: 'couponGrants',
  GiftVouchers: 'giftVouchers',
  /** `LoyaltyAccountEntity`, keyed by the uid. */
  LoyaltyAccounts: 'loyaltyAccounts',
  /** `JournalEntryEntity`, id `{userId}_{seq:6}`. */
  ClientJournal: 'clientJournal',
  /** `StreakDefinitionEntity` (the head). */
  StreakDefinitions: 'streakDefinitions',
  /** `ClientStatsEntity`, keyed by the uid. */
  ClientStats: 'clientStats',
  BadgeCategories: 'badgeCategories',
  BadgeSeries: 'badgeSeries',
  Seasons: 'seasons',
  TierDefinitions: 'tierDefinitions',
  /** `RewardCatalogItemEntity`. */
  RewardsCatalog: 'rewardsCatalog',
  Invitations: 'invitations',
  Positions: 'positions',
  Courses: 'courses',
  Events: 'events',
  /** Fixed-id tenant settings — today only `bookingPolicy`. */
  Settings: 'settings',
  /** `BackfillJobEntity` / `PolicyRecomputeJobEntity`, keyed by the job. */
  BackfillJobs: 'backfillJobs',
} as const;
export type CollectionName = (typeof Collections)[keyof typeof Collections];

/** Subcollections — `/{parent}/{parentId}/{name}/{id}`. */
export const Subcollections = {
  /** `users/{uid}/notifications` — owner-read, TTL-purged, never queried across users. */
  Notifications: 'notifications',
  /** `clientStats/{uid}/restricted/{docId}` — staff-only (`money`). */
  Restricted: 'restricted',
  /** `streakDefinitions/{id}/versions/{version:6}`. */
  Versions: 'versions',
  /** `invitations/{id}/redemptions/{refereeUserId}` — the id is the idempotency guard. */
  Redemptions: 'redemptions',
  /** `loyaltyAccounts/{uid}/badgeProgress/{seriesId}`. */
  BadgeProgress: 'badgeProgress',
  /** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}`. */
  SeasonProgress: 'seasonProgress',
} as const;
export type SubcollectionName =
  (typeof Subcollections)[keyof typeof Subcollections];

/**
 * Dormant paths §3.1 removes — spelled once so the sweep that deletes their
 * documents (and the rules that still match them) can name them. No reader
 * or writer may use these.
 */
export const RetiredCollections = {
  /** `rewardPrograms/{id}` — removed. */
  RewardPrograms: 'rewardPrograms',
} as const;
export type RetiredCollectionName =
  (typeof RetiredCollections)[keyof typeof RetiredCollections];

export const RetiredSubcollections = {
  /** `users/{uid}/rewardProgress/{programId}` — removed after the sweep. */
  RewardProgress: 'rewardProgress',
} as const;
export type RetiredSubcollectionName =
  (typeof RetiredSubcollections)[keyof typeof RetiredSubcollections];

/** `settings/bookingPolicy` — the one settings document (`BookingPolicySettingsEntity`). */
export const BOOKING_POLICY_DOC = BookingPolicySettingsId.FIXED;

/** `clientStats/{uid}/restricted/money` — the staff-only money projection. */
export const CLIENT_MONEY_DOC = ClientMoneyStatsId.FIXED;

/** `backfillJobs/clientStatsPolicy` — the policy-change recompute pass (`PolicyRecomputeJobEntity`). */
export const POLICY_RECOMPUTE_DOC = PolicyRecomputeJobId.FIXED;

/**
 * Firestore's own filter vocabulary (`WhereFilterOp`), verbatim — the ONE
 * spelling of a `QueryFilter.op` (`tx.port.ts`). The values are the SDK's
 * own strings, so the adapter passes them straight through and no second
 * spelling exists to drift; a pipeline writes `op: QueryOp.ArrayContains`,
 * never `'array-contains'`.
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
