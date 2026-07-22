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
  Locations: 'locations',
  Coupons: 'coupons',
  RewardPrograms: 'rewardPrograms',
  Invitations: 'invitations',
  ImpersonationSessions: 'impersonationSessions',
  AuditLog: 'auditLog',
  /** Server-only (Admin SDK, `apps/functions`) — closed to every client SDK by rule. */
  Otps: 'otps',
  /** Server-only. */
  RateLimits: 'rateLimits',
  /** Server-only. */
  Blocklist: 'blocklist',
} as const;

export const Subcollections = {
  /** `users/{userId}/couponGrants/{grantId}`. */
  CouponGrants: 'couponGrants',
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

// ── Subcollections ──────────────────────────────────────────────────────

export function couponGrantsCollection(
  db: Firestore,
  userId: UserId,
): CollectionReference<DocumentData> {
  return collection(
    db,
    Collections.Users,
    userId.value,
    Subcollections.CouponGrants,
  );
}

export function couponGrantDocRef(
  db: Firestore,
  userId: UserId,
  grantId: CouponGrantId,
): DocumentReference<DocumentData> {
  return doc(
    db,
    Collections.Users,
    userId.value,
    Subcollections.CouponGrants,
    grantId.value,
  );
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
