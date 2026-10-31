import type { ClientPrivacyCall, Identifier, Role } from '@core/components';
import type { PipelineError, RepositoryError } from '@core/errors';
import type {
  Appointment,
  AppointmentNote,
  AppointmentPhoto,
  CouponGrant,
  Customer,
  GiftVoucher,
  ImpersonationSession,
  InboxNotification,
  Invitation,
  JournalEntry,
  Otp,
  WaitlistRequest,
} from '@core/entities';
import type {
  AppointmentId,
  CustomerId,
  Result,
  UserId,
} from '@core/primitives';
import type { LoadProfile } from './accounts.port';
import type { Callable } from './scheduling.port';

/*
 * The data-subject requests' ports (audit-hardening Phase 3, WS-C / WS-D):
 * every document holding one person's data, read OUTSIDE any transaction
 * by the admin's privacy callables, and the erasure's impure steps that are
 * no Firestore write (the Auth user, the Storage objects). The person
 * is a client RECORD (`customers/{id}`) and the account it links
 * (`users/{record.userId}`); each read is one equality or `array-contains`
 * on a root field (the by-contact read: one equality per contact field)
 * over the automatic single-field index — no new composite,
 * no `orderBy` (the system orders what it reads). Every list takes `limit`:
 * the caller passes its cap + 1, so a person past the cap is REFUSED by the
 * pipeline, never silently truncated (P3-L-6). The reads of the guarded
 * collections (`customers`, `appointments`, `appointmentNotes`) run through
 * the read-time guard (`StoredDocumentSystem.guardOf`), a malformed document
 * answering `RepositoryError.malformed(path, field)`. Bodies are the
 * entities as stored (`{ id, ...data }`) — zero mapping (Law 5).
 *
 * Reused, not copied (Law 9, P3-RU-26): the account is read by the
 * EXISTING {@link LoadProfile} type; loyalty, statistics and the audit rows
 * that target the person come through `LoyaltyAccountReadPorts`,
 * `ClientStatsLoadPorts` and `AuditTimelinePorts`.
 */

// ── The person ────────────────────────────────────────────────────────────

/** `customers/{customerId}`, one guarded read — `null` when absent. */
export type LoadClientRecord = (
  customerId: CustomerId,
) => Promise<Result<Customer | null, RepositoryError>>;

// ── The visits and what hangs off them ────────────────────────────────────

/**
 * The person's visits — `appointments where subjectCustomerIds
 * array-contains customerId` (every seat of the person is a subject), at
 * most `limit`, guarded, in no promised order.
 */
export type ListClientVisits = (
  customerId: CustomerId,
  limit: number,
) => Promise<Result<readonly Appointment[], RepositoryError>>;

/**
 * The visits whose CONTACT carries one value — `appointments where
 * contactPhone ==` and `where contactEmail ==` that value, each at most
 * `limit`, merged by id (a visit both answer comes once), guarded, in no
 * promised order (review round 1, P3-DEP-28). A visit can carry a person's
 * contact without seating them — a staff edit that removed the booker's
 * seat recomputes the subject mirrors and keeps the contact — so the export
 * and the erasure find those visits by the person's contact values too,
 * while the record still holds them. A failure names the collection only
 * (`RepositoryError.readFailed('appointments', code)`) — never the value.
 */
export type ListVisitsByContact = (
  contact: Identifier,
  limit: number,
) => Promise<Result<readonly Appointment[], RepositoryError>>;

/**
 * The notes of the given visits — `appointmentNotes/{appointmentId}` by one
 * guarded `getAll` (bounded by the visits read); a visit with no note
 * answers nothing for it.
 */
export type LoadVisitNotes = (
  appointmentIds: readonly AppointmentId[],
) => Promise<Result<readonly AppointmentNote[], RepositoryError>>;

/**
 * The person's photo documents of EVERY origin — `appointmentPhotos where
 * clientCustomerId ==` only, no `orderBy`, the automatic single-field index,
 * at most `limit`. Never the card's SHOT-only, ordered `ListClientPhotos`
 * (`notes-photos.port.ts`): a library picture naming the person on a party
 * visit is the person's too (P3-RU-26).
 */
export type ListPhotosOfClient = (
  clientCustomerId: CustomerId,
  limit: number,
) => Promise<Result<readonly AppointmentPhoto[], RepositoryError>>;

/**
 * The photo documents of the given visits — `appointmentId in` chunks of 30
 * (single-field), every origin, at most `limit` in all: what names no
 * client on a visit only the person sat.
 */
export type ListVisitPhotos = (
  appointmentIds: readonly AppointmentId[],
  limit: number,
) => Promise<Result<readonly AppointmentPhoto[], RepositoryError>>;

// ── Money and the journal ─────────────────────────────────────────────────

/** The record's coupon grants — `couponGrants where customerId ==`, at most `limit`. */
export type ListClientGrants = (
  customerId: CustomerId,
  limit: number,
) => Promise<Result<readonly CouponGrant[], RepositoryError>>;

/** The vouchers issued to the record — `giftVouchers where issuedToCustomerId ==`, at most `limit`. */
export type ListClientVouchers = (
  customerId: CustomerId,
  limit: number,
) => Promise<Result<readonly GiftVoucher[], RepositoryError>>;

/**
 * The record's journal — `clientJournal where customerId ==`, at most
 * `limit`, WITHOUT `orderBy` (its only composite carries
 * `journalVisibility` and `journalEffect`; an `orderBy('seq')` would need
 * another): every visibility, ordered by the system.
 */
export type ListClientJournal = (
  customerId: CustomerId,
  limit: number,
) => Promise<Result<readonly JournalEntry[], RepositoryError>>;

// ── The account ───────────────────────────────────────────────────────────

/** The account's inbox — `users/{userId}/notifications` listed, at most `limit`. */
export type ListAccountNotifications = (
  userId: UserId,
  limit: number,
) => Promise<Result<readonly InboxNotification[], RepositoryError>>;

/** The account's waitlist requests — `waitlistRequests where ownerUserId ==`, at most `limit`. */
export type ListAccountWaitlist = (
  userId: UserId,
  limit: number,
) => Promise<Result<readonly WaitlistRequest[], RepositoryError>>;

/** The invitations the account sent — `invitations where inviterUserId ==`, at most `limit`. */
export type ListAccountInvitations = (
  userId: UserId,
  limit: number,
) => Promise<Result<readonly Invitation[], RepositoryError>>;

/**
 * The impersonation sessions that targeted the account —
 * `impersonationSessions where targetUserId ==`, at most `limit` (the
 * erasure pseudonymises their admin-typed `reason`, P3-RU-24).
 */
export type ListAccountSessions = (
  userId: UserId,
  limit: number,
) => Promise<Result<readonly ImpersonationSession[], RepositoryError>>;

/**
 * The one-time-code challenges stored under one destination —
 * `otps where destination ==`, at most `limit` (the erasure deletes them
 * before its stamp clears the contact values, P3-RU-21). A failure names
 * the collection only (`RepositoryError.readFailed('otps', code)`) — never
 * the destination, a person's phone or e-mail.
 */
export type ListOtpsByDestination = (
  destination: Identifier,
  limit: number,
) => Promise<Result<readonly Otp[], RepositoryError>>;

// ── The erasure's other stores ────────────────────────────────────────────

/**
 * Delete the account's Firebase Auth user (P3-L-9: deleted, not disabled)
 * — `auth/user-not-found` answers ok (already done, a resumed erasure); any
 * other failure carries the SDK's CODE only, never its message.
 */
export type DeleteAuthUser = (
  userId: UserId,
) => Promise<Result<void, PipelineError>>;

/**
 * The Auth user's custom-claim roles (`Roles.known` over its claims) —
 * `null` when no Auth user exists; a failure carries the SDK's code only.
 * The staff-account refusal reads it beside the stored roles (P3-L-16):
 * whether an Auth user exists at all is what makes a missing `users`
 * document refuse (`ClientErasureSystem.refusalOf`, P3-DEP-29), since no
 * production path sets custom claims (roles ride the minted custom token,
 * Phase 4a 4A-14) — the claim roles are defence in depth.
 */
export type LoadAuthRoles = (
  userId: UserId,
) => Promise<Result<readonly Role[] | null, PipelineError>>;

/** Delete one Storage object by its path — an object already gone answers ok. */
export type DeleteStoredObject = (
  path: string,
) => Promise<Result<void, RepositoryError>>;

/**
 * Remove the `clientLabel` key from one KEPT Storage object's custom
 * metadata (a `LIBRARY` photo's picture — the object stays, the name on it
 * goes; review round 1, P3-DEP-31): idempotent — an object without the key, or no
 * object at the path, is done; every other key of the object kept.
 */
export type ClearStoredLabel = (
  path: string,
) => Promise<Result<void, RepositoryError>>;

/**
 * Delete every Storage object under a prefix (`avatars/<uid>/`): the prefix
 * is LISTED (`getFiles({ prefix })`) and each object deleted (an object
 * already gone is ok) — the count is the list's length, since
 * `bucket.deleteFiles` resolves `void` (@google-cloud/storage 7.21,
 * `bucket.d.ts:702`).
 */
export type DeleteStoredPrefix = (
  prefix: string,
) => Promise<Result<number, RepositoryError>>;

// ── The web's privacy callables ───────────────────────────────────────────

/**
 * `exportClientData` — an admin's export of one client's data (the record
 * and the act's own id in; the canonical JSON bundle and its counts out).
 */
export type ExportClientData = Callable<
  ClientPrivacyCall,
  ClientPrivacyCall.Exported
>;

/**
 * `previewClientErasure` — read-only (P3-L-17): the record's erasure tag,
 * the census of the person's footprint and the sibling walk-in records, for
 * the card's ONE alert. No row, no write.
 */
export type PreviewClientErasure = Callable<
  ClientPrivacyCall,
  ClientPrivacyCall.ErasurePreview
>;

/**
 * `eraseClient` — one resumable call of an admin's erasure (the record and
 * the act's own id in; the record's tag after the call, whether it is done
 * and the residue census out). Idempotent: the same act sent again finishes
 * what a call left (`completeClientErasure` loops it).
 */
export type EraseClient = Callable<
  ClientPrivacyCall,
  ClientPrivacyCall.Erasure
>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The person's footprint reads — `firestorePrivacyPorts(db, guardOf, log)` (functions). */
export type ClientFootprintPorts = {
  readonly loadClientRecord: LoadClientRecord;
  /** The EXISTING account read (`accounts.port.ts`), never a copy. */
  readonly loadProfile: LoadProfile;
  readonly listClientVisits: ListClientVisits;
  readonly listVisitsByContact: ListVisitsByContact;
  readonly loadVisitNotes: LoadVisitNotes;
  readonly listPhotosOfClient: ListPhotosOfClient;
  readonly listVisitPhotos: ListVisitPhotos;
  readonly listClientGrants: ListClientGrants;
  readonly listClientVouchers: ListClientVouchers;
  readonly listClientJournal: ListClientJournal;
  readonly listAccountNotifications: ListAccountNotifications;
  readonly listAccountWaitlist: ListAccountWaitlist;
  readonly listAccountInvitations: ListAccountInvitations;
  readonly listAccountSessions: ListAccountSessions;
  readonly listOtpsByDestination: ListOtpsByDestination;
};

/**
 * The Auth user's claim roles — the preview's and the erasure's staff-account
 * refusal (`firebase-auth-eraser.adapter.ts`, functions).
 */
export type AuthRolesPorts = {
  readonly loadAuthRoles: LoadAuthRoles;
};

/** The Auth user's deletion — the erasure only (Law 9: split from {@link AuthRolesPorts}, never sliced). */
export type AuthEraserPorts = {
  readonly deleteAuthUser: DeleteAuthUser;
};

/** Storage deletions and the kept objects' label — the erasure only (`storage-objects.adapter.ts`, functions). */
export type ObjectEraserPorts = {
  readonly deleteStoredObject: DeleteStoredObject;
  readonly deleteStoredPrefix: DeleteStoredPrefix;
  readonly clearStoredLabel: ClearStoredLabel;
};

/** The web's privacy callables — ONE token, `CLIENT_PRIVACY_PORTS` (the staff client card). */
export type ClientPrivacyGatewayPorts = {
  readonly exportClientData: ExportClientData;
  readonly previewClientErasure: PreviewClientErasure;
  readonly eraseClient: EraseClient;
};
