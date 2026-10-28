import type { DocumentData, Firestore, Query } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type Appointment,
  type AppointmentNote,
  type AppointmentPhoto,
  type BadgeProgress,
  CLIENT_MONEY_DOC,
  type ClientMoneyRecord,
  type ClientStatsRecord,
  Collections,
  type CouponGrant,
  type Customer,
  type GiftVoucher,
  type InboxNotification,
  type ImpersonationSession,
  type Invitation,
  type JournalEntry,
  type LoyaltyAccount,
  type Otp,
  type SeasonProgress,
  Subcollections,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import type {
  ClientFootprintPorts,
  ClientStatsLoadPorts,
  Log,
  LoyaltyAccountReadPorts,
} from '@core/ports';
import {
  type StoredDocument,
  type StoredGuardOf,
  TriggerAttemptSystem,
} from '@core/systems';
import { admitStored } from './firestore-tx.adapter';

/**
 * The person's footprint, read by the admin's privacy callables over the
 * Admin SDK (audit-hardening Phase 3, WS-C; `ClientFootprintPorts`, and
 * the loyalty and statistics reads they reuse — `LoyaltyAccountReadPorts`,
 * `ClientStatsLoadPorts`, P3-RU-26). Every read runs OUTSIDE a transaction
 * and is ONE equality or `array-contains` on a root field over the
 * automatic single-field index — no composite, no `orderBy` (the system
 * orders what it reads) — or a document by its path:
 *
 * - `loadClientRecord` — `customers/{id}`; `loadProfile` — `users/{uid}`;
 * - `listClientVisits` — `appointments where subjectCustomerIds
 *   array-contains`; `loadVisitNotes` — `appointmentNotes/{visitId}` by one
 *   `getAll`;
 * - `listPhotosOfClient` — `appointmentPhotos where clientCustomerId ==`
 *   (every origin); `listVisitPhotos` — `appointmentId in` chunks of 30;
 * - `listClientGrants` — `couponGrants where customerId ==`;
 *   `listClientVouchers` — `giftVouchers where issuedToCustomerId ==`;
 *   `listClientJournal` — `clientJournal where customerId ==`;
 * - `listAccountNotifications` — `users/{uid}/notifications`;
 *   `listAccountWaitlist` — `waitlistRequests where ownerUserId ==`;
 *   `listAccountInvitations` — `invitations where inviterUserId ==`;
 *   `listAccountSessions` — `impersonationSessions where targetUserId ==`;
 * - `listOtpsByDestination` — `otps where destination ==` (the erasure's
 *   sweep, WS-D): a failure names the COLLECTION only
 *   (`RepositoryError.readFailed('otps', code)`) — never the destination, a
 *   person's phone or e-mail (the `firestore-otps.adapter.ts` idiom);
 * - `loadLoyaltyAccount`, `listBadgeProgress`, `listSeasonProgress` —
 *   `loyaltyAccounts/{id}` and its two subcollections; `loadClientStats`,
 *   `loadClientMoney` — `clientStats/{id}` and its `restricted/money`.
 *
 * Every list applies the `limit` it is handed (the pipeline passes its cap
 * and one, so a person past the cap is refused, never truncated). Bodies
 * spread as stored (`{ id, ...data }`, Law 5 — zero mapping) but for the
 * TTL stamp: the adapter-stamped root `purgeAt` (`notifications`,
 * `waitlistRequests`, `impersonationSessions`, `otps`) is part of no entity
 * (`firestore-layout.md`), so it is never read into one — the export's
 * bundle IS the entities (P3-RU-37 (i)). The guarded
 * collections (`customers`, `appointments`, `appointmentNotes`) pass the
 * stored-document guard the composition root hands in
 * (`StoredDocumentSystem.guardOf`): the FIRST malformed document fails the
 * read — `RepositoryError.malformed(path, field)`, logged once — never a
 * silently shorter list. The registry and the log are REQUIRED (OR-33,
 * runbook §4.10). A read that throws answers `RepositoryError.readFailed`
 * whose `reason` is the failure's canonical code — never its message.
 */

/** The `in` operator's most values per query (Firestore's own bound). */
const IN_CHUNK = 30;

/**
 * The adapter-stamped TTL root field — the one Firestore `Timestamp` a
 * document holds (`firestore-ttl.adapter.ts`), outside every entity type.
 */
const TTL_FIELD = 'purgeAt';

/**
 * A stored document as its entity: `{ id, ...data }` without the TTL stamp
 * (P3-RU-37 (i)) — every other field as stored, nothing mapped.
 */
function entityOf(id: string, data: DocumentData | undefined): StoredDocument {
  return {
    id,
    ...Object.fromEntries(
      Object.entries(data ?? {}).filter(([field]) => field !== TTL_FIELD),
    ),
  };
}

function readFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.readFailed(
    path,
    TriggerAttemptSystem.failureCode(error),
  );
}

export const firestorePrivacyPorts = (
  db: Firestore,
  guardOf: StoredGuardOf,
  log: Log,
): ClientFootprintPorts & LoyaltyAccountReadPorts & ClientStatsLoadPorts => {
  /**
   * One document by its path — the entity, `null` when absent, or the
   * guard's refusal when `guarded` names a guarded collection.
   */
  const one = async <E>(
    path: string,
    guarded: string | null,
  ): Promise<Result<E | null, RepositoryError>> => {
    let snap;
    try {
      snap = await db.doc(path).get();
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
    if (!snap.exists) return Result.ok(null);
    return admitStored<E>(
      guardOf,
      guarded,
      entityOf(snap.id, snap.data()),
      log,
    );
  };

  /**
   * Every document a query answers, each admitted — the first refusal fails
   * the read. The query is BUILT inside the read too: one the SDK refuses
   * to build is a failed read, never a throw.
   */
  const many = async <E>(
    query: () => Query,
    path: string,
    guarded: string | null,
  ): Promise<Result<E[], RepositoryError>> => {
    let page;
    try {
      page = await query().get();
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
    const rows: E[] = [];
    for (const snap of page.docs) {
      const row = admitStored<E>(
        guardOf,
        guarded,
        entityOf(snap.id, snap.data()),
        log,
      );
      if (!row.ok) return row;
      rows.push(row.value);
    }
    return Result.ok(rows);
  };

  /** `<collection> where <field> == <value>`, at most `limit` — a top-level, unguarded collection. */
  const where = <E>(
    collection: string,
    field: string,
    value: string,
    limit: number,
  ): Promise<Result<E[], RepositoryError>> =>
    many<E>(
      () => db.collection(collection).where(field, '==', value).limit(limit),
      collection,
      collection,
    );

  return {
    loadClientRecord: (customerId) =>
      one<Customer>(
        `${Collections.Customers}/${customerId}`,
        Collections.Customers,
      ),

    loadProfile: (userId) =>
      one<User>(`${Collections.Users}/${userId}`, Collections.Users),

    listClientVisits: (customerId, limit) =>
      many<Appointment>(
        () =>
          db
            .collection(Collections.Appointments)
            .where('subjectCustomerIds', 'array-contains', customerId)
            .limit(limit),
        Collections.Appointments,
        Collections.Appointments,
      ),

    loadVisitNotes: async (appointmentIds) => {
      if (appointmentIds.length === 0) return Result.ok([]);
      const path = Collections.AppointmentNotes;
      let snaps;
      try {
        snaps = await db.getAll(
          ...appointmentIds.map((id) => db.collection(path).doc(id)),
        );
      } catch (error) {
        return Result.err(readFailed(path, error));
      }
      const notes: AppointmentNote[] = [];
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const note = admitStored<AppointmentNote>(
          guardOf,
          path,
          entityOf(snap.id, snap.data()),
          log,
        );
        if (!note.ok) return note;
        notes.push(note.value);
      }
      return Result.ok(notes);
    },

    listPhotosOfClient: (clientCustomerId, limit) =>
      where<AppointmentPhoto>(
        Collections.AppointmentPhotos,
        'clientCustomerId',
        clientCustomerId,
        limit,
      ),

    listVisitPhotos: async (appointmentIds, limit) => {
      const path = Collections.AppointmentPhotos;
      const photos: AppointmentPhoto[] = [];
      for (
        let start = 0;
        start < appointmentIds.length && photos.length < limit;
        start += IN_CHUNK
      ) {
        const chunk = appointmentIds.slice(start, start + IN_CHUNK);
        const owed = limit - photos.length;
        const read = await many<AppointmentPhoto>(
          () =>
            db.collection(path).where('appointmentId', 'in', chunk).limit(owed),
          path,
          path,
        );
        if (!read.ok) return read;
        photos.push(...read.value);
      }
      return Result.ok(photos);
    },

    listClientGrants: (customerId, limit) =>
      where<CouponGrant>(
        Collections.CouponGrants,
        'customerId',
        customerId,
        limit,
      ),

    listClientVouchers: (customerId, limit) =>
      where<GiftVoucher>(
        Collections.GiftVouchers,
        'issuedToCustomerId',
        customerId,
        limit,
      ),

    listClientJournal: (customerId, limit) =>
      where<JournalEntry>(
        Collections.ClientJournal,
        'customerId',
        customerId,
        limit,
      ),

    listAccountNotifications: (userId, limit) => {
      const path = `${Collections.Users}/${userId}/${Subcollections.Notifications}`;
      return many<InboxNotification>(
        () => db.collection(path).limit(limit),
        path,
        null,
      );
    },

    listAccountWaitlist: (userId, limit) =>
      where<WaitlistRequest>(
        Collections.WaitlistRequests,
        'ownerUserId',
        userId,
        limit,
      ),

    listAccountInvitations: (userId, limit) =>
      where<Invitation>(
        Collections.Invitations,
        'inviterUserId',
        userId,
        limit,
      ),

    listAccountSessions: (userId, limit) =>
      where<ImpersonationSession>(
        Collections.ImpersonationSessions,
        'targetUserId',
        userId,
        limit,
      ),

    // The path a failure names is the collection alone — the destination
    // (a person's phone or e-mail) is the query's VALUE, never in an error.
    listOtpsByDestination: (destination, limit) =>
      where<Otp>(Collections.Otps, 'destination', destination, limit),

    loadLoyaltyAccount: (customerId) =>
      one<LoyaltyAccount>(
        `${Collections.LoyaltyAccounts}/${customerId}`,
        Collections.LoyaltyAccounts,
      ),

    listBadgeProgress: (customerId) => {
      const path = `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.BadgeProgress}`;
      return many<BadgeProgress>(() => db.collection(path), path, null);
    },

    listSeasonProgress: (customerId) => {
      const path = `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.SeasonProgress}`;
      return many<SeasonProgress>(() => db.collection(path), path, null);
    },

    loadClientStats: (customerId) =>
      one<ClientStatsRecord>(
        `${Collections.ClientStats}/${customerId}`,
        Collections.ClientStats,
      ),

    loadClientMoney: (customerId) =>
      one<ClientMoneyRecord>(
        `${Collections.ClientStats}/${customerId}/${Subcollections.Restricted}/${CLIENT_MONEY_DOC}`,
        null,
      ),
  };
};
