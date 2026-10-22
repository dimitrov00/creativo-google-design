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
import { Collections as EntityCollections } from '@core/entities';
import { RewardProgramId } from '@creativo/domain/engagement';
import { CourseId, PositionId, ShopEventId } from '@creativo/domain/programs';

/**
 * Fresh, greenfield Firestore schema (migration-blueprint.md §0.4) — the
 * single path authority for every adapter in this lib. v2's
 * `firestore-paths.ts` is a reference inventory only; names follow this
 * workspace's own bounded-context vocabulary and orphaned v2 concepts
 * (`referralRules`, `discountGrants`, the never-wired `achievementDefinitions`/
 * per-user `achievements` subcollection) are dropped entirely — see
 * `docs/architecture/domain-deviations.md`. A client's achievements live
 * at `loyaltyAccounts/{customerId}/badgeProgress/{seriesId}` instead, one
 * document per medal family started (client-card-redesign §4.5).
 *
 * Every doc id is the entity's own branded id `.value` — never an
 * auto-generated Firestore id — so `reconstitute()` always has an id to
 * rebuild with.
 *
 * Flip 1 (booking core, 2026-10-11) removed every booking-core collection
 * from this file, flip 2 (identity and accounts) removed `users`, `otps`
 * and `impersonationSessions`, and flip 3 (loyalty and invitations)
 * removed `invitations` (+ `redemptions`), the loyalty catalogue,
 * `loyaltyAccounts` (+ `badgeProgress`, `seasonProgress`) and
 * `clientJournal` with their path helpers: their one spelling is the
 * `Collections`/`Subcollections` registry of `@core/entities`, which the
 * `(db) => bundle` adapters name directly (the `users/{uid}/rewardProgress`
 * paths below spell their parent through it too). What is left belongs to
 * flip 4 and the dormant reward progress, and goes with them.
 */
export const Collections = {
  RewardPrograms: 'rewardPrograms',
  Positions: 'positions',
  Courses: 'courses',
  Events: 'events',
} as const;

export const Subcollections = {
  /** `users/{userId}/rewardProgress/{programId}`. */
  RewardProgress: 'rewardProgress',
} as const;

// ── Top-level collections ──────────────────────────────────────────────

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

export function rewardProgressCollection(
  db: Firestore,
  userId: UserId,
): CollectionReference<DocumentData> {
  return collection(
    db,
    EntityCollections.Users,
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
    EntityCollections.Users,
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
