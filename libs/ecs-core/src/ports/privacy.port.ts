import type { ClientPrivacyCall } from '@core/components';
import type { RepositoryError } from '@core/errors';
import type {
  Appointment,
  AppointmentNote,
  AppointmentPhoto,
  CouponGrant,
  Customer,
  GiftVoucher,
  InboxNotification,
  Invitation,
  JournalEntry,
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
 * The data-subject requests' ports (audit-hardening Phase 3, WS-C; the
 * erasure, WS-D, adds its own): every document holding one person's data,
 * read OUTSIDE any transaction by the admin's privacy callables. The person
 * is a client RECORD (`customers/{id}`) and the account it links
 * (`users/{record.userId}`); each read is one equality or `array-contains`
 * on a root field over the automatic single-field index — no new composite,
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

// ── The web's privacy callables ───────────────────────────────────────────

/**
 * `exportClientData` — an admin's export of one client's data (the record
 * and the act's own id in; the canonical JSON bundle and its counts out).
 */
export type ExportClientData = Callable<
  ClientPrivacyCall,
  ClientPrivacyCall.Exported
>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The person's footprint reads — `firestorePrivacyPorts(db, guardOf, log)` (functions). */
export type ClientFootprintPorts = {
  readonly loadClientRecord: LoadClientRecord;
  /** The EXISTING account read (`accounts.port.ts`), never a copy. */
  readonly loadProfile: LoadProfile;
  readonly listClientVisits: ListClientVisits;
  readonly loadVisitNotes: LoadVisitNotes;
  readonly listPhotosOfClient: ListPhotosOfClient;
  readonly listVisitPhotos: ListVisitPhotos;
  readonly listClientGrants: ListClientGrants;
  readonly listClientVouchers: ListClientVouchers;
  readonly listClientJournal: ListClientJournal;
  readonly listAccountNotifications: ListAccountNotifications;
  readonly listAccountWaitlist: ListAccountWaitlist;
  readonly listAccountInvitations: ListAccountInvitations;
};

/** The web's privacy callables — ONE token, `CLIENT_PRIVACY_PORTS` (the staff client card). */
export type ClientPrivacyGatewayPorts = {
  readonly exportClientData: ExportClientData;
};
