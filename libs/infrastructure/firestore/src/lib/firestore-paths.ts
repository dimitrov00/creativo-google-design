import {
  CollectionReference,
  DocumentData,
  DocumentReference,
  Firestore,
  Query,
  collection,
  collectionGroup,
  doc,
} from 'firebase/firestore';
import { UserId } from '@creativo/domain/accounts';
import { AppointmentId } from '@creativo/domain/scheduling';
import {
  BOOKING_POLICY_DOC,
  CAPACITY_COLLECTION,
  WAITLIST_COLLECTION,
  SCHEDULE_EXCEPTIONS_COLLECTION,
  SETTINGS_COLLECTION,
  busyDocumentId,
  scheduleExceptionDocId,
} from '@creativo/application/booking';
import {
  BarberId,
  LocationId,
  ServiceCategoryId,
  ServiceId,
} from '@creativo/domain/catalog';
import {
  CouponGrantId,
  CouponId,
  InvitationId,
  RewardProgramId,
} from '@creativo/domain/engagement';
import { ImpersonationSessionId } from '@creativo/domain/governance';
import { CourseId, PositionId, ShopEventId } from '@creativo/domain/programs';

/**
 * Fresh, greenfield Firestore schema (migration-blueprint.md §0.4) — the
 * single path authority for every adapter in this lib. v2's
 * `firestore-paths.ts` is a reference inventory only; names follow this
 * workspace's own bounded-context vocabulary and orphaned v2 concepts
 * (`referralRules`, `discountGrants`, the never-wired `achievementDefinitions`/
 * per-user `achievements` subcollection) are dropped entirely — see
 * `docs/architecture/domain-deviations.md`.
 *
 * Every doc id is the entity's own branded id `.value` — never an
 * auto-generated Firestore id — so `reconstitute()` always has an id to
 * rebuild with.
 */
export const Collections = {
  Users: 'users',
  Appointments: 'appointments',
  ServiceCategories: 'serviceCategories',
  Services: 'services',
  Barbers: 'barbers',
  /** `barberSchedules/{barberId}` — the roster. Public-read, PII-free. */
  BarberSchedules: 'barberSchedules',
  /**
   * `barberBusy/{barberId}__{YYYY-MM-DD}` — the public busy projection.
   *
   * Keyed by barber AND day, so the booking grid reads exactly the days it
   * renders. Geometry only: no client, no service, no price, no reason. That
   * is what makes it safe to leave open to anonymous visitors, who need it to
   * see a single free slot.
   */
  BarberBusy: 'barberBusy',
  /**
   * `scheduleExceptions/{barberId}__{YYYY-MM-DD}` — the sanitized public
   * face of a roster deviation: closed, different hours, or blocked ranges.
   * NEVER a reason — see `schedule-exception-document.ts`.
   */
  ScheduleExceptions: SCHEDULE_EXCEPTIONS_COLLECTION,
  /**
   * `capacity/{YYYY-MM}` — the calendar's month rollup, trigger-maintained.
   * See `capacity-document.ts`; public-read like everything the anonymous
   * grid needs, server-write only.
   */
  Capacity: CAPACITY_COLLECTION,
  /** `giftVouchers/{id}` — money the shop was paid, drawn down by visits. Book-read, server-write. */
  GiftVouchers: 'giftVouchers',
  /** `waitlistRequests/{requestId}` — owner-read, callable-write. */
  WaitlistRequests: WAITLIST_COLLECTION,
  Locations: 'locations',
  Coupons: 'coupons',
  /**
   * `couponGrants/{grantId}` — TOP-LEVEL, with the owner in a `userId`
   * field. It was a per-user subcollection, which forced `findById` (a
   * grant id carries no owner) through a collection-group query that (a)
   * needed a `{path=**}` rule any signed-in account could dump every
   * user's grants through, and (b) silently required a COLLECTION_GROUP
   * fieldOverride that was never authored — green in the emulator, dead in
   * production. Top-level, the same lookup is a point get and the rule is
   * owner-only.
   */
  CouponGrants: 'couponGrants',
  RewardPrograms: 'rewardPrograms',
  Invitations: 'invitations',
  ImpersonationSessions: 'impersonationSessions',
  AuditLog: 'auditLog',
  Positions: 'positions',
  Courses: 'courses',
  Events: 'events',
  /**
   * `settings/{docId}` — tenant configuration, one doc per concern
   * (`settings/bookingPolicy`). Public-read: the booking horizon is literally
   * how far an anonymous visitor's calendar scrolls. The string itself lives
   * in the port module both SDKs share.
   */
  Settings: SETTINGS_COLLECTION,
  /** Server-only (Admin SDK, `apps/functions`) — closed to every client SDK by rule. */
  Otps: 'otps',
} as const;

export const Subcollections = {
  /** `users/{userId}/rewardProgress/{programId}`. */
  RewardProgress: 'rewardProgress',
  /** `invitations/{invitationId}/redemptions/{refereeUserId}` — doc id IS the
   * referee's `UserId`, so "has this user already redeemed this invitation"
   * is a doc-existence check, never a query. */
  Redemptions: 'redemptions',
} as const;

// ── Top-level collections ──────────────────────────────────────────────

export function usersCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Users);
}

export function userDocRef(
  db: Firestore,
  userId: UserId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Users, userId.value);
}

export function appointmentsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Appointments);
}

export function appointmentDocRef(
  db: Firestore,
  appointmentId: AppointmentId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Appointments, appointmentId.value);
}

export function serviceCategoriesCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.ServiceCategories);
}

export function serviceCategoryDocRef(
  db: Firestore,
  id: ServiceCategoryId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.ServiceCategories, id.value);
}

export function servicesCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Services);
}

export function serviceDocRef(
  db: Firestore,
  id: ServiceId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Services, id.value);
}

export function barbersCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Barbers);
}

export function barberDocRef(
  db: Firestore,
  id: BarberId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Barbers, id.value);
}

export function barberScheduleDocRef(
  db: Firestore,
  id: BarberId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.BarberSchedules, id.value);
}

/**
 * The composite key is the barber and the day — see `Collections.BarberBusy`.
 * Delegates to the port module's `busyDocumentId`: this is the one key whose
 * byte-drift between the two SDKs would silently stop booking serialization,
 * so exactly one function may spell it.
 */
export function barberBusyDocId(id: BarberId, dayKey: string): string {
  return busyDocumentId(id.value, dayKey);
}

export function barberBusyDocRef(
  db: Firestore,
  id: BarberId,
  dayKey: string,
): DocumentReference<DocumentData> {
  return doc(db, Collections.BarberBusy, barberBusyDocId(id, dayKey));
}

export function scheduleExceptionDocRef(
  db: Firestore,
  id: BarberId,
  dayKey: string,
): DocumentReference<DocumentData> {
  return doc(
    db,
    Collections.ScheduleExceptions,
    scheduleExceptionDocId(id.value, dayKey),
  );
}

export function capacityMonthDocRef(
  db: Firestore,
  monthKey: string,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Capacity, monthKey);
}

export function waitlistRequestsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.WaitlistRequests);
}

export function waitlistRequestDocRef(
  db: Firestore,
  requestId: string,
): DocumentReference<DocumentData> {
  return doc(db, Collections.WaitlistRequests, requestId);
}

export function bookingPolicyDocRef(
  db: Firestore,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Settings, BOOKING_POLICY_DOC);
}

export function locationsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Locations);
}

export function locationDocRef(
  db: Firestore,
  id: LocationId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Locations, id.value);
}

export function couponsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Coupons);
}

export function couponDocRef(
  db: Firestore,
  id: CouponId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Coupons, id.value);
}

export function rewardProgramsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.RewardPrograms);
}

export function rewardProgramDocRef(
  db: Firestore,
  id: RewardProgramId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.RewardPrograms, id.value);
}

export function invitationsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Invitations);
}

export function invitationDocRef(
  db: Firestore,
  id: InvitationId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Invitations, id.value);
}

export function impersonationSessionsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.ImpersonationSessions);
}

export function impersonationSessionDocRef(
  db: Firestore,
  id: ImpersonationSessionId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.ImpersonationSessions, id.value);
}

export function auditLogCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.AuditLog);
}

export function auditLogDocRef(
  db: Firestore,
  entryId: string,
): DocumentReference<DocumentData> {
  return doc(db, Collections.AuditLog, entryId);
}

export function positionsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Positions);
}

export function positionDocRef(
  db: Firestore,
  id: PositionId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Positions, id.value);
}

export function coursesCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Courses);
}

export function courseDocRef(
  db: Firestore,
  id: CourseId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Courses, id.value);
}

export function eventsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.Events);
}

export function eventDocRef(
  db: Firestore,
  id: ShopEventId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.Events, id.value);
}

// ── Subcollections ──────────────────────────────────────────────────────

export function couponGrantsCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.CouponGrants);
}

export function couponGrantDocRef(
  db: Firestore,
  grantId: CouponGrantId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.CouponGrants, grantId.value);
}

export function rewardProgressCollection(
  db: Firestore,
  userId: UserId,
): CollectionReference<DocumentData> {
  return collection(
    db,
    Collections.Users,
    userId.value,
    Subcollections.RewardProgress,
  );
}

export function rewardProgressDocRef(
  db: Firestore,
  userId: UserId,
  programId: RewardProgramId,
): DocumentReference<DocumentData> {
  return doc(
    db,
    Collections.Users,
    userId.value,
    Subcollections.RewardProgress,
    programId.value,
  );
}

/**
 * Collection-group ref across every user's `rewardProgress` subcollection —
 * for cross-user milestone-deadline sweeps (`apps/functions`'
 * `expireStaleMilestonesScheduled`, Phase 7). Mirrors v2's
 * `rewardProgressGroupRef`; kept here (not orphaned — the whole reason
 * `rewardProgress` is a subcollection rather than top-level is to support
 * both the owner-scoped read AND this sweep).
 */
export function rewardProgressGroup(db: Firestore): Query<DocumentData> {
  return collectionGroup(db, Subcollections.RewardProgress);
}

export function invitationRedemptionsCollection(
  db: Firestore,
  invitationId: InvitationId,
): CollectionReference<DocumentData> {
  return collection(
    db,
    Collections.Invitations,
    invitationId.value,
    Subcollections.Redemptions,
  );
}

/** Doc id IS the referee's `UserId` — existence alone proves "already redeemed". */
export function invitationRedemptionDocRef(
  db: Firestore,
  invitationId: InvitationId,
  refereeUserId: UserId,
): DocumentReference<DocumentData> {
  return doc(
    db,
    Collections.Invitations,
    invitationId.value,
    Subcollections.Redemptions,
    refereeUserId.value,
  );
}

export function giftVouchersCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.GiftVouchers);
}
