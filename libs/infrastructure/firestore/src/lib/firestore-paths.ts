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
import { InvitationId, RewardProgramId } from '@creativo/domain/engagement';
import {
  BADGE_CATEGORIES_COLLECTION,
  BADGE_PROGRESS_COLLECTION,
  BADGE_SERIES_COLLECTION,
  CLIENT_JOURNAL_COLLECTION,
  LOYALTY_ACCOUNTS_COLLECTION,
  REWARDS_CATALOG_COLLECTION,
  SEASONS_COLLECTION,
  SEASON_PROGRESS_COLLECTION,
  STREAK_DEFINITIONS_COLLECTION,
  TIER_DEFINITIONS_COLLECTION,
} from '@creativo/application/engagement';
import { CourseId, PositionId, ShopEventId } from '@creativo/domain/programs';

/**
 * Fresh, greenfield Firestore schema (migration-blueprint.md §0.4) — the
 * single path authority for every adapter in this lib. v2's
 * `firestore-paths.ts` is a reference inventory only; names follow this
 * workspace's own bounded-context vocabulary and orphaned v2 concepts
 * (`referralRules`, `discountGrants`, the never-wired `achievementDefinitions`/
 * per-user `achievements` subcollection) are dropped entirely — see
 * `docs/architecture/domain-deviations.md`. A client's achievements live
 * at `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` instead, one document
 * per medal family started (client-card-redesign §4.5).
 *
 * Every doc id is the entity's own branded id `.value` — never an
 * auto-generated Firestore id — so `reconstitute()` always has an id to
 * rebuild with.
 *
 * Flip 1 (booking core, 2026-10-11) removed every booking-core collection
 * from this file, and flip 2 (identity and accounts) removed `users`,
 * `otps` and `impersonationSessions`: their one spelling is the
 * `Collections` registry of `@core/entities`, which the `(db) => bundle`
 * adapters name directly (the `users/{uid}/rewardProgress` paths below
 * spell their parent through it too). What is left belongs to flips 3-4
 * and goes with them.
 */
export const Collections = {
  RewardPrograms: 'rewardPrograms',
  Invitations: 'invitations',
  Positions: 'positions',
  Courses: 'courses',
  Events: 'events',
  // ── The loyalty read model (client-card-redesign §4.5). The names are
  // the port module's, shared with the functions and the dev seed. The
  // catalogue is any signed-in person's to read; accounts and the journal
  // are the book's. Every write is the server's.
  BadgeCategories: BADGE_CATEGORIES_COLLECTION,
  BadgeSeries: BADGE_SERIES_COLLECTION,
  Seasons: SEASONS_COLLECTION,
  TierDefinitions: TIER_DEFINITIONS_COLLECTION,
  RewardsCatalog: REWARDS_CATALOG_COLLECTION,
  StreakDefinitions: STREAK_DEFINITIONS_COLLECTION,
  /** `loyaltyAccounts/{uid}` — one per client. */
  LoyaltyAccounts: LOYALTY_ACCOUNTS_COLLECTION,
  /** `clientJournal/{uid}_{seq:06}` — append-only; `userId` in the body for the ledger query. */
  ClientJournal: CLIENT_JOURNAL_COLLECTION,
} as const;

export const Subcollections = {
  /** `users/{userId}/rewardProgress/{programId}`. */
  RewardProgress: 'rewardProgress',
  /** `invitations/{invitationId}/redemptions/{refereeUserId}` — doc id IS the
   * referee's `UserId`, so "has this user already redeemed this invitation"
   * is a doc-existence check, never a query. */
  Redemptions: 'redemptions',
  /** `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` — absent = not started. */
  BadgeProgress: BADGE_PROGRESS_COLLECTION,
  /** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` — a season's track. */
  SeasonProgress: SEASON_PROGRESS_COLLECTION,
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

// ── The loyalty read model ─────────────────────────────────────────────

export function loyaltyAccountDocRef(
  db: Firestore,
  userId: UserId,
): DocumentReference<DocumentData> {
  return doc(db, Collections.LoyaltyAccounts, userId.value);
}

export function badgeProgressCollection(
  db: Firestore,
  userId: UserId,
): CollectionReference<DocumentData> {
  return collection(
    db,
    Collections.LoyaltyAccounts,
    userId.value,
    Subcollections.BadgeProgress,
  );
}

export function seasonProgressCollection(
  db: Firestore,
  userId: UserId,
): CollectionReference<DocumentData> {
  return collection(
    db,
    Collections.LoyaltyAccounts,
    userId.value,
    Subcollections.SeasonProgress,
  );
}

export function clientJournalCollection(
  db: Firestore,
): CollectionReference<DocumentData> {
  return collection(db, Collections.ClientJournal);
}
