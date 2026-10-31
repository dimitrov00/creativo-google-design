import {
  Actor,
  AuditAction,
  AuditContext,
  AuditedProfileField,
  AuditTargetRef,
  CouponValue,
  E164,
  Email,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  Identifier,
  NotificationPayload,
  PhotoOrigin,
  Role,
  SeatLabel,
  SeatOccupant,
  SubjectRelationship,
  VoucherCode,
  VoucherLifecycle,
  type VoucherRedemption,
  WaitlistLifecycle,
  RedemptionCount,
  PolicyPassStamp,
  ClientStatsPolicy,
} from '@core/components';
import {
  AppointmentId,
  AppointmentPhotoId,
  AuditEntryId,
  AuditResourceId,
  ClientMoneyStatsId,
  CouponGrantId,
  CouponId,
  CustomerId,
  GiftVoucherId,
  ImpersonationSessionId,
  InvitationId,
  JournalEntryId,
  NotificationId,
  OtpId,
  Result,
  SeatId,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import {
  type Appointment,
  type AppointmentNote,
  type AppointmentPhoto,
  type AuditEntry,
  type BadgeProgress,
  type ClientMoneyRecord,
  type ClientStatsRecord,
  Collections,
  type CouponGrant,
  type Customer,
  type GiftVoucher,
  type ImpersonationSession,
  type InboxNotification,
  type Invitation,
  type JournalEntry,
  type LoyaltyAccount,
  type Otp,
  type SeasonProgress,
  Subcollections,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import {
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import type {
  AuthEraserPorts,
  AuthRolesPorts,
  CallerRolesPorts,
  ClientFootprintPorts,
  ObjectEraserPorts,
} from '@core/ports';
import {
  AppointmentIndexSystem,
  type ClientFootprint,
  ClientStatsSystem,
} from '@core/systems';
import { appointmentFixture, seatFixture } from './appointment.fixtures';
import { cents, EUR } from './booking-core.fixtures';
import {
  customerFixture,
  impersonationSessionFixture,
  otpFixture,
  userFixture,
} from './identity.fixtures';
import {
  type LoyaltyClientFixture,
  loyaltyAccountFixtures,
} from './loyalty.fixtures';
import type { ClientStatsReadState, LoyaltyWorld } from './port-doubles';
import {
  customerOf,
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  fixtureWalkInHash,
  type MemoryStore,
  memoryStore,
} from './test-support';

/*
 * The data-subject requests' doubles and fixtures (audit-hardening Phase 3,
 * WS-C / WS-D): the in-memory footprint reads (`ClientFootprintPorts`) —
 * over fixed arrays, or over a `MemoryStore` an erasure's own commits write
 * — the stored roles behind a token (`CallerRolesPorts`), the erasure's
 * Auth and Storage doubles (`AuthRolesPorts`, `AuthEraserPorts`,
 * `ObjectEraserPorts`), and ONE small world of three people whose personal
 * values are SENTINELS (plan §4: a scan of the serialised bundle, row, write
 * or log line for a sentinel proves its absence):
 *
 * - P, the person asked about — an account and its record, a solo visit
 *   (a note, a shot photo, a photo naming nobody, a line of P's own
 *   voucher), a place on Q's party, a library photo naming P on that party,
 *   money, loyalty, statistics, the journal, the inbox, a waitlist request,
 *   an invitation, an impersonation session whose reason names P, a
 *   sign-in challenge to P's phone and audit rows filed against P (and one
 *   where P only acted, against Q);
 * - Q, another account, who owns the party: Q's contact on it, Q's walk-in
 *   companion and an anonymous guest, Q's note on it, a line of Q's
 *   voucher, Q's own documents (a session and a challenge included);
 * - W, a walk-in with no account: a staff party `[WALK_IN W, ANONYMOUS]`
 *   whose contact is W's (the keyed-hash arm), and a visit only W sat that
 *   carries a THIRD person's contact.
 *
 * The other loyalty, statistics and audit doubles are reused, never copied
 * (`memoryLoyaltyAccountReadPorts`, `memoryClientStatsReadPorts`,
 * `memoryAuditReadPorts`, `memoryFlagsPorts` of `port-doubles.ts`).
 */

// ── The footprint reads ───────────────────────────────────────────────────

/** What `memoryClientFootprintPorts` reads; every collection empty when omitted. */
export type ClientFootprintState = {
  readonly records: readonly Customer[];
  readonly users: readonly User[];
  readonly visits: readonly Appointment[];
  readonly notes: readonly AppointmentNote[];
  readonly photos: readonly AppointmentPhoto[];
  readonly grants: readonly CouponGrant[];
  readonly vouchers: readonly GiftVoucher[];
  readonly journal: readonly JournalEntry[];
  /** Each account's inbox by its uid — the path names the owner, the body none. */
  readonly notifications: ReadonlyMap<UserId, readonly InboxNotification[]>;
  readonly waitlist: readonly WaitlistRequest[];
  readonly invitations: readonly Invitation[];
  /** Impersonation sessions — the erasure pseudonymises their target's `reason` (P3-RU-24). */
  readonly sessions: readonly ImpersonationSession[];
  /** Sign-in challenges — the erasure deletes those stored under the person's contact (P3-RU-21). */
  readonly otps: readonly Otp[];
};

/**
 * `ClientFootprintPorts` over the given documents, each read answering what
 * its port's comment says the query answers — the same equality, at most
 * `limit`, in the order the documents were handed over (the store promises
 * none) — and nothing guarded (every body is admitted).
 */
export function memoryClientFootprintPorts(
  state: Partial<ClientFootprintState> = {},
): ClientFootprintPorts {
  const records = state.records ?? [];
  const users = state.users ?? [];
  const visits = state.visits ?? [];
  const notes = state.notes ?? [];
  const photos = state.photos ?? [];
  return {
    loadClientRecord: async (customerId) =>
      Result.ok(records.find((record) => record.id === customerId) ?? null),
    loadProfile: async (userId) =>
      Result.ok(users.find((user) => user.id === userId) ?? null),
    listClientVisits: async (customerId, limit) =>
      Result.ok(
        visits
          .filter((visit) => visit.subjectCustomerIds.includes(customerId))
          .slice(0, limit),
      ),
    listVisitsByContact: async (contact, limit) =>
      Result.ok(
        visits
          .filter((visit) => carriesContact(visit, contact))
          .slice(0, limit),
      ),
    loadVisitNotes: async (appointmentIds) =>
      Result.ok(notes.filter((note) => appointmentIds.includes(note.id))),
    listPhotosOfClient: async (clientCustomerId, limit) =>
      Result.ok(
        photos
          .filter((photo) => photo.clientCustomerId === clientCustomerId)
          .slice(0, limit),
      ),
    listVisitPhotos: async (appointmentIds, limit) =>
      Result.ok(
        photos
          .filter((photo) => appointmentIds.includes(photo.appointmentId))
          .slice(0, limit),
      ),
    listClientGrants: async (customerId, limit) =>
      Result.ok(
        (state.grants ?? [])
          .filter((grant) => grant.customerId === customerId)
          .slice(0, limit),
      ),
    listClientVouchers: async (customerId, limit) =>
      Result.ok(
        (state.vouchers ?? [])
          .filter((voucher) => voucher.issuedToCustomerId === customerId)
          .slice(0, limit),
      ),
    listClientJournal: async (customerId, limit) =>
      Result.ok(
        (state.journal ?? [])
          .filter((entry) => entry.customerId === customerId)
          .slice(0, limit),
      ),
    listAccountNotifications: async (userId, limit) =>
      Result.ok((state.notifications?.get(userId) ?? []).slice(0, limit)),
    listAccountWaitlist: async (userId, limit) =>
      Result.ok(
        (state.waitlist ?? [])
          .filter((request) => request.ownerUserId === userId)
          .slice(0, limit),
      ),
    listAccountInvitations: async (userId, limit) =>
      Result.ok(
        (state.invitations ?? [])
          .filter((invitation) => invitation.inviterUserId === userId)
          .slice(0, limit),
      ),
    listAccountSessions: async (userId, limit) =>
      Result.ok(
        (state.sessions ?? [])
          .filter((session) => session.targetUserId === userId)
          .slice(0, limit),
      ),
    listOtpsByDestination: async (destination, limit) =>
      Result.ok(
        (state.otps ?? [])
          .filter((otp) => otp.destination === destination)
          .slice(0, limit),
      ),
  };
}

/** `ListVisitsByContact`'s two equalities: the visit's contact phone or e-mail is the value. */
function carriesContact(visit: Appointment, contact: Identifier): boolean {
  const value: string = contact;
  return visit.contactPhone === value || visit.contactEmail === value;
}

/** Every entity stored directly under `collection` (`{collection}/{id}`), in the store's insertion order. */
function storedIn<E>(store: MemoryStore, collection: string): readonly E[] {
  const prefix = `${collection}/`;
  const out: E[] = [];
  for (const [key, body] of store) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (id.includes('/')) continue;
    out.push({ id, ...body } as E);
  }
  return out;
}

/** The entity at `{collection}/{id}`, or `null`. */
function storedAt<E>(
  store: MemoryStore,
  collection: string,
  id: string,
): E | null {
  const body = store.get(`${collection}/${id}`);
  return body === undefined ? null : ({ id, ...body } as E);
}

/**
 * `ClientFootprintPorts` over a {@link MemoryStore}: every read answers what
 * the store holds NOW — the same equality and `limit` as
 * {@link memoryClientFootprintPorts}, in the store's insertion order — so an
 * erasure spec whose commits (`memoryTxPorts` over the SAME store) clear,
 * stamp and delete reads them back: the residue after a unit, a resumed
 * call's footprint, a re-sweep. Nothing guarded (every body is admitted).
 */
export function storeClientFootprintPorts(
  store: MemoryStore,
): ClientFootprintPorts {
  const listed = async <E>(
    collection: string,
    keep: (entity: E) => boolean,
    limit: number,
  ) => Result.ok(storedIn<E>(store, collection).filter(keep).slice(0, limit));
  return {
    loadClientRecord: async (customerId) =>
      Result.ok(storedAt<Customer>(store, Collections.Customers, customerId)),
    loadProfile: async (userId) =>
      Result.ok(storedAt<User>(store, Collections.Users, userId)),
    listClientVisits: (customerId, limit) =>
      listed<Appointment>(
        Collections.Appointments,
        (visit) => visit.subjectCustomerIds.includes(customerId),
        limit,
      ),
    listVisitsByContact: (contact, limit) =>
      listed<Appointment>(
        Collections.Appointments,
        (visit) => carriesContact(visit, contact),
        limit,
      ),
    loadVisitNotes: async (appointmentIds) => {
      const notes: AppointmentNote[] = [];
      for (const id of appointmentIds) {
        const note = storedAt<AppointmentNote>(
          store,
          Collections.AppointmentNotes,
          id,
        );
        if (note !== null) notes.push(note);
      }
      return Result.ok(notes);
    },
    listPhotosOfClient: (clientCustomerId, limit) =>
      listed<AppointmentPhoto>(
        Collections.AppointmentPhotos,
        (photo) => photo.clientCustomerId === clientCustomerId,
        limit,
      ),
    listVisitPhotos: (appointmentIds, limit) =>
      listed<AppointmentPhoto>(
        Collections.AppointmentPhotos,
        (photo) => appointmentIds.includes(photo.appointmentId),
        limit,
      ),
    listClientGrants: (customerId, limit) =>
      listed<CouponGrant>(
        Collections.CouponGrants,
        (grant) => grant.customerId === customerId,
        limit,
      ),
    listClientVouchers: (customerId, limit) =>
      listed<GiftVoucher>(
        Collections.GiftVouchers,
        (voucher) => voucher.issuedToCustomerId === customerId,
        limit,
      ),
    listClientJournal: (customerId, limit) =>
      listed<JournalEntry>(
        Collections.ClientJournal,
        (entry) => entry.customerId === customerId,
        limit,
      ),
    listAccountNotifications: (userId, limit) =>
      listed<InboxNotification>(
        `${Collections.Users}/${userId}/${Subcollections.Notifications}`,
        () => true,
        limit,
      ),
    listAccountWaitlist: (userId, limit) =>
      listed<WaitlistRequest>(
        Collections.WaitlistRequests,
        (request) => request.ownerUserId === userId,
        limit,
      ),
    listAccountInvitations: (userId, limit) =>
      listed<Invitation>(
        Collections.Invitations,
        (invitation) => invitation.inviterUserId === userId,
        limit,
      ),
    listAccountSessions: (userId, limit) =>
      listed<ImpersonationSession>(
        Collections.ImpersonationSessions,
        (session) => session.targetUserId === userId,
        limit,
      ),
    listOtpsByDestination: (destination, limit) =>
      listed<Otp>(
        Collections.Otps,
        (otp) => otp.destination === destination,
        limit,
      ),
  };
}

/**
 * A {@link MemoryStore} holding the state's documents at their paths — each
 * body the entity minus `id` (Law 5), an inbox under
 * `users/{uid}/notifications` — for {@link storeClientFootprintPorts} and
 * the `memoryTxPorts` of the same spec.
 */
export function footprintStoreOf(
  state: Partial<ClientFootprintState>,
): MemoryStore {
  const store = memoryStore();
  const put = (
    collection: string,
    entities: readonly { readonly id: string }[] | undefined,
  ): void => {
    for (const { id, ...body } of entities ?? []) {
      store.set(`${collection}/${id}`, body);
    }
  };
  put(Collections.Customers, state.records);
  put(Collections.Users, state.users);
  put(Collections.Appointments, state.visits);
  put(Collections.AppointmentNotes, state.notes);
  put(Collections.AppointmentPhotos, state.photos);
  put(Collections.CouponGrants, state.grants);
  put(Collections.GiftVouchers, state.vouchers);
  put(Collections.ClientJournal, state.journal);
  for (const [userId, inbox] of state.notifications ?? []) {
    put(
      `${Collections.Users}/${userId}/${Subcollections.Notifications}`,
      inbox,
    );
  }
  put(Collections.WaitlistRequests, state.waitlist);
  put(Collections.Invitations, state.invitations);
  put(Collections.ImpersonationSessions, state.sessions);
  put(Collections.Otps, state.otps);
  return store;
}

/** `CallerRolesPorts` — each uid's STORED roles; `[]` for an unknown uid, as the port says. */
export function memoryCallerRolesPorts(
  roles: ReadonlyMap<UserId, readonly Role[]>,
): CallerRolesPorts {
  return {
    loadCallerRoles: async (userId) => Result.ok(roles.get(userId) ?? []),
  };
}

// ── The erasure's Auth and Storage ────────────────────────────────────────

/**
 * The Firebase Auth users and Storage objects an erasure reaches (WS-D),
 * data only, mutated IN PLACE by the eraser doubles, and ONE ordered log of
 * every call those doubles answered (`loadAuthRoles:<uid>`,
 * `deleteAuthUser:<uid>`, `deleteStoredObject:<path>`,
 * `deleteStoredPrefix:<prefix>`, `clearStoredLabel:<path>`) — a spec may
 * push its own entries (a wrapped commit) into the same log to read the
 * order of the erasure's impure steps.
 */
export type ErasureStores = {
  /** Each existing Auth user's custom-claim roles (`[]` for a client's). */
  readonly authUsers: Map<UserId, readonly Role[]>;
  /** Every existing Storage object path. */
  readonly objects: Set<string>;
  /** The `clientLabel` custom metadata of the objects that carry one, by path. */
  readonly labels: Map<string, string>;
  readonly calls: string[];
};

/** What the eraser doubles fail — each a code-only failure, never a value. */
export type ErasureStoresScript = {
  /** `loadAuthRoles` answers `PIPELINE_UNAVAILABLE` (`auth/internal-error`). */
  readonly authRolesFailing?: boolean;
  /** `deleteAuthUser` answers `PIPELINE_UNAVAILABLE` (`auth/internal-error`). */
  readonly authDeleteFailing?: boolean;
  /**
   * Object paths whose delete or label clear answers
   * `REPOSITORY_WRITE_FAILED` (`storage/internal`) — a prefix delete fails
   * when it would reach one.
   */
  readonly failingPaths?: readonly string[];
};

/** The stores an erasure starts from — no Auth user, no object and no label when omitted. */
export function memoryErasureStores(
  seed: {
    readonly authUsers?: ReadonlyMap<UserId, readonly Role[]>;
    readonly objects?: Iterable<string>;
    readonly labels?: ReadonlyMap<string, string>;
  } = {},
): ErasureStores {
  return {
    authUsers: new Map(seed.authUsers ?? []),
    objects: new Set(seed.objects ?? []),
    labels: new Map(seed.labels ?? []),
    calls: [],
  };
}

/** The SDK code the Auth doubles fail with — a code, never a message. */
const AUTH_FAILURE = PipelineError.of(
  PipelineErrorCode.Unavailable,
  null,
  'auth/internal-error',
  null,
);

/** `AuthRolesPorts` — the Auth user's claim roles, `null` when it does not exist. */
export function memoryAuthRolesPorts(
  stores: ErasureStores,
  script: ErasureStoresScript = {},
): AuthRolesPorts {
  return {
    loadAuthRoles: async (userId) => {
      stores.calls.push(`loadAuthRoles:${userId}`);
      if (script.authRolesFailing === true) return Result.err(AUTH_FAILURE);
      return Result.ok(stores.authUsers.get(userId) ?? null);
    },
  };
}

/** `AuthEraserPorts` — deletes the Auth user; one already gone answers ok (`auth/user-not-found`). */
export function memoryAuthEraserPorts(
  stores: ErasureStores,
  script: ErasureStoresScript = {},
): AuthEraserPorts {
  return {
    deleteAuthUser: async (userId) => {
      stores.calls.push(`deleteAuthUser:${userId}`);
      if (script.authDeleteFailing === true) return Result.err(AUTH_FAILURE);
      stores.authUsers.delete(userId);
      return Result.ok(undefined);
    },
  };
}

/**
 * `ObjectEraserPorts` — one object deleted by its path (one already gone is
 * ok), every object under a prefix (answering how many were listed), or one
 * object's `clientLabel` cleared (no label, or no object, is ok).
 */
export function memoryObjectEraserPorts(
  stores: ErasureStores,
  script: ErasureStoresScript = {},
): ObjectEraserPorts {
  const failing = script.failingPaths ?? [];
  const failure = (path: string) =>
    Result.err(RepositoryError.writeFailed(path, 'storage/internal'));
  return {
    deleteStoredObject: async (path) => {
      stores.calls.push(`deleteStoredObject:${path}`);
      if (failing.includes(path)) return failure(path);
      stores.objects.delete(path);
      stores.labels.delete(path);
      return Result.ok(undefined);
    },
    clearStoredLabel: async (path) => {
      stores.calls.push(`clearStoredLabel:${path}`);
      if (failing.includes(path)) return failure(path);
      stores.labels.delete(path);
      return Result.ok(undefined);
    },
    deleteStoredPrefix: async (prefix) => {
      stores.calls.push(`deleteStoredPrefix:${prefix}`);
      const listed = [...stores.objects].filter((path) =>
        path.startsWith(prefix),
      );
      if (listed.some((path) => failing.includes(path))) return failure(prefix);
      for (const path of listed) {
        stores.objects.delete(path);
        stores.labels.delete(path);
      }
      return Result.ok(listed.length);
    },
  };
}

// ── The sentinels ─────────────────────────────────────────────────────────

/** P's personal values — each a string no other fixture spells. */
export const PRIVACY_SENTINELS = {
  name: 'Sentinel Firstname',
  lastName: 'Sentinel Lastname',
  phone: E164.of('+359880000777'),
  email: Email.of('sentinel@example.invalid'),
  note: 'sentinel note text',
  contactNote: 'sentinel contact note',
  label: 'Sentinel Label',
  voucherCode: 'PSENTINELCODE',
  shotUrl: 'https://example.invalid/sentinel-shot-token',
  libraryUrl: 'https://example.invalid/sentinel-library-token',
  sessionReason: 'sentinel session reason',
} as const;

/** Q's personal values — none may reach P's bundle. */
export const OTHER_SENTINELS = {
  name: 'Other Sentinel',
  phone: E164.of('+359880000888'),
  email: Email.of('other@example.invalid'),
  note: 'other note text',
  contactNote: 'other contact note',
  label: 'Other Label',
  guestLabel: 'Other Guest',
  voucherCode: 'QSENTINELCODE',
  url: 'https://example.invalid/other-photo-token',
  sessionReason: 'other session reason',
} as const;

/** W's values (a walk-in) and a THIRD person's contact on W's own visit. */
export const WALK_IN_SENTINELS = {
  label: 'Walkin Sentinel',
  phone: E164.of('+359880000999'),
  thirdName: 'Third Sentinel',
  thirdPhone: E164.of('+359880000555'),
} as const;

// ── The world ─────────────────────────────────────────────────────────────

/** An instant `days` before the pinned clock. */
function daysAgo(days: number): UtcEpochMs {
  return UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -days * 86_400_000);
}

function label(text: string): SeatLabel {
  const parsed = SeatLabel.parse(text);
  if (!parsed.ok) throw new Error(`a broken fixture label: ${text}`);
  return parsed.value;
}

/** A voucher line of `code`, live. */
function redemption(voucherId: GiftVoucherId, code: string): VoucherRedemption {
  return {
    voucherId,
    code: VoucherCode.of(code),
    amountCents: cents(1000),
    balanceAfterCents: cents(4000),
    currency: EUR,
    appliedAtUtcMs: daysAgo(5),
    reversedAtUtcMs: null,
  };
}

function voucher(
  id: GiftVoucherId,
  code: string,
  customerId: CustomerId,
  userId: UserId,
): GiftVoucher {
  return {
    id,
    code: VoucherCode.of(code),
    initialValueCents: cents(5000),
    balanceCents: cents(4000),
    currency: EUR,
    issuedAtUtcMs: daysAgo(30),
    expiresAtUtcMs: null,
    expiresLocalDate: null,
    issuedToCustomerId: customerId,
    holderUserId: userId,
    ...VoucherLifecycle.active(),
  };
}

function grant(
  id: string,
  customerId: CustomerId,
  userId: UserId,
): CouponGrant {
  const value = CouponValue.percentOff(10);
  if (!value.ok) throw new Error('a broken fixture coupon value');
  return {
    id: CouponGrantId.of(id),
    customerId,
    holderUserId: userId,
    couponId: CouponId.of('coupon-autumn'),
    grantedAtUtcMs: daysAgo(20),
    ...value.value,
    ...GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.none(),
    ),
  };
}

function photo(
  id: string,
  appointmentId: AppointmentId,
  clientCustomerId: CustomerId | null,
  clientLabel: string,
  photoOrigin: PhotoOrigin,
  url: string,
): AppointmentPhoto {
  return {
    id: AppointmentPhotoId.of(id),
    appointmentId,
    barberId: seatFixture().barberId,
    clientCustomerId,
    clientLabel,
    takenByUserId: null,
    takenAtUtcMs: daysAgo(10),
    width: null,
    height: null,
    photoOrigin,
    label: null,
    // The object a SHOT photo owns — `uploadPhotoBytes`' own layout.
    path: `appointmentPhotos/${appointmentId}/${id}`,
    url,
  };
}

function statsOf(customerId: CustomerId): ClientStatsRecord {
  return {
    id: customerId,
    customerId,
    ...ClientStatsSystem.stats(
      customerId,
      [],
      ClientStatsPolicy.DEFAULT,
      FIXTURE_NOW,
    ),
    version: 1,
    updatedAtUtcMs: daysAgo(1),
    ...PolicyPassStamp.NONE,
  };
}

function moneyOf(customerId: CustomerId): ClientMoneyRecord {
  return {
    id: ClientMoneyStatsId.FIXED,
    customerId,
    ...ClientStatsSystem.money(customerId, []),
    version: 1,
    updatedAtUtcMs: daysAgo(1),
  };
}

function waitlistRequest(id: string, ownerUserId: UserId): WaitlistRequest {
  return {
    id: WaitlistRequestId.of(id),
    ownerUserId,
    locationId: null,
    localDates: [FIXTURE_NOW.localDate],
    utcEpochMs: FIXTURE_NOW_UTC_MS,
    createdAtUtcMs: daysAgo(2),
    cartSeats: [],
    cartNextSequence: 0,
    flexibleDays: [],
    ...WaitlistLifecycle.open(daysAgo(2)),
  };
}

function notification(
  id: string,
  appointmentId: AppointmentId,
): InboxNotification {
  return {
    id: NotificationId.of(id),
    sentAtUtcMs: daysAgo(3),
    readAtUtcMs: null,
    ...NotificationPayload.appointmentReminder(
      appointmentId,
      FIXTURE_NOW.localDate,
      seatFixture().startMinutes,
    ),
  };
}

function invitation(
  id: string,
  inviterUserId: UserId,
  inviterName: string,
): Invitation {
  return {
    id: InvitationId.of(id),
    inviterUserId,
    inviterName,
    redemptionCount: RedemptionCount.zero(),
    createdAtUtcMs: daysAgo(40),
  };
}

/** One audit row, filed at `days` ago — ids, tags and the target only. */
function auditRow(
  id: string,
  days: number,
  actor: Actor,
  target: AuditTargetRef,
  resourceId: AuditResourceId,
): AuditEntry {
  return {
    id: AuditEntryId.of(id),
    recordedAtUtcMs: daysAgo(days),
    resourceId,
    auditOperationId: null,
    ...actor,
    ...AuditContext.profile(AuditAction.ProfileUpdated, [
      AuditedProfileField.FirstName,
    ]),
    ...target,
  };
}

/** One person's loyalty documents. */
type PersonLoyalty = {
  readonly account: LoyaltyAccount;
  readonly badgeProgress: readonly BadgeProgress[];
  readonly seasonProgress: readonly SeasonProgress[];
  readonly journal: readonly JournalEntry[];
};

/** One person's loyalty documents, re-keyed onto the record (the fixture accounts are someone else's). */
function loyaltyOf(
  customerId: CustomerId,
  from: LoyaltyClientFixture,
): PersonLoyalty {
  return {
    account: { ...from.account, id: customerId, customerId },
    badgeProgress: from.badgeProgress,
    seasonProgress: from.seasonProgress,
    journal: from.clientJournal.slice(0, 2).map((entry): JournalEntry => ({
      ...entry,
      id: JournalEntryId.forEntry(customerId, entry.seq),
      customerId,
    })),
  };
}

/** The audit rows of the world filed against P (the record, the account, P's party seat). */
export const PERSON_ROW_IDS: readonly string[] = [
  'row-p-record',
  'row-p-account',
  'row-p-party',
];

/** The three people's ids, and the visits and documents the specs name. */
export type PrivacyWorld = {
  readonly person: { readonly userId: UserId; readonly customerId: CustomerId };
  readonly other: { readonly userId: UserId; readonly customerId: CustomerId };
  /** W — a walk-in record keyed by W's phone under `fixtureWalkInHash`. */
  readonly walkIn: { readonly customerId: CustomerId };
  /** Q's walk-in companion on the party. */
  readonly otherWalkIn: { readonly customerId: CustomerId };
  /** The admin who asks (stored `admin`), and a sysadmin and a barber who may not. */
  readonly admin: UserId;
  readonly sysadmin: UserId;
  readonly barber: UserId;
  readonly visits: {
    /** P alone; P's contact; P's voucher line; a note; a shot photo and a photo naming nobody. */
    readonly solo: Appointment;
    /** Q's party: Q (self), P (companion), Q's walk-in companion, an anonymous guest; Q's contact, note and voucher line. */
    readonly party: Appointment;
    /** A staff party `[WALK_IN W, ANONYMOUS]`, no owner — its contact is W's. */
    readonly walkInParty: Appointment;
    /** A visit only W sat, carrying a third person's contact. */
    readonly walkInThird: Appointment;
  };
  readonly state: ClientFootprintState;
  readonly loyalty: LoyaltyWorld;
  readonly stats: ClientStatsReadState;
  readonly auditRows: readonly AuditEntry[];
  readonly roles: ReadonlyMap<UserId, readonly Role[]>;
  /** P's footprint exactly as `exportClientData` reads it. */
  readonly personFootprint: ClientFootprint;
};

/** A fresh world (every value new, so a spec may freeze or reorder it). */
export function privacyWorld(): PrivacyWorld {
  const pUser = UserId.of('u-privacy-p');
  const qUser = UserId.of('u-privacy-q');
  const p = customerOf(pUser);
  const q = customerOf(qUser);
  const w = CustomerId.forWalkIn(WALK_IN_SENTINELS.phone, fixtureWalkInHash);
  const qw = CustomerId.forWalkIn('+359880000444', fixtureWalkInHash);
  const admin = UserId.of('u-privacy-admin');
  const sysadmin = UserId.of('u-privacy-sysadmin');
  const barber = UserId.of('u-privacy-barber');
  const pVoucher = GiftVoucherId.of('voucher-p');
  const qVoucher = GiftVoucherId.of('voucher-q');

  const solo = appointmentFixture({
    id: AppointmentId.of('appt-p-solo'),
    ownerUserId: pUser,
    subjectUserIds: [pUser],
    ownerCustomerId: p,
    subjectCustomerIds: [p],
    seats: [
      seatFixture({
        seatId: SeatId.of('seat-p-solo'),
        occupant: SeatOccupant.account(pUser, p, SubjectRelationship.Self),
      }),
    ],
    contactName: PRIVACY_SENTINELS.name,
    contactPhone: PRIVACY_SENTINELS.phone,
    contactEmail: PRIVACY_SENTINELS.email,
    contactNote: PRIVACY_SENTINELS.contactNote,
    voucherRedemptions: [redemption(pVoucher, PRIVACY_SENTINELS.voucherCode)],
    utcEpochMs: daysAgo(10),
  });
  const party = appointmentFixture({
    id: AppointmentId.of('appt-q-party'),
    ownerUserId: qUser,
    subjectUserIds: [pUser, qUser],
    ownerCustomerId: q,
    subjectCustomerIds: [p, q, qw].sort(),
    seats: [
      seatFixture({
        seatId: SeatId.of('seat-q-self'),
        occupant: SeatOccupant.account(qUser, q, SubjectRelationship.Self),
      }),
      seatFixture({
        seatId: SeatId.of('seat-p-companion'),
        occupant: SeatOccupant.account(pUser, p, SubjectRelationship.Companion),
      }),
      seatFixture({
        seatId: SeatId.of('seat-q-walk-in'),
        occupant: SeatOccupant.walkIn(qw, label(OTHER_SENTINELS.label)),
      }),
      seatFixture({
        seatId: SeatId.of('seat-q-guest'),
        occupant: SeatOccupant.anonymous(label(OTHER_SENTINELS.guestLabel)),
      }),
    ],
    contactName: OTHER_SENTINELS.name,
    contactPhone: OTHER_SENTINELS.phone,
    contactEmail: OTHER_SENTINELS.email,
    contactNote: OTHER_SENTINELS.contactNote,
    voucherRedemptions: [redemption(qVoucher, OTHER_SENTINELS.voucherCode)],
    utcEpochMs: daysAgo(5),
  });
  const walkInParty = appointmentFixture({
    id: AppointmentId.of('appt-w-party'),
    ownerUserId: null,
    subjectUserIds: [],
    ownerCustomerId: null,
    subjectCustomerIds: [w],
    seats: [
      seatFixture({
        seatId: SeatId.of('seat-w'),
        occupant: SeatOccupant.walkIn(w, label(WALK_IN_SENTINELS.label)),
      }),
      seatFixture({
        seatId: SeatId.of('seat-w-guest'),
        occupant: SeatOccupant.anonymous(label('Гост 2')),
      }),
    ],
    contactName: WALK_IN_SENTINELS.label,
    contactPhone: WALK_IN_SENTINELS.phone,
    utcEpochMs: daysAgo(7),
  });
  const walkInThird = appointmentFixture({
    id: AppointmentId.of('appt-w-third'),
    ownerUserId: null,
    subjectUserIds: [],
    ownerCustomerId: null,
    subjectCustomerIds: [w],
    seats: [
      seatFixture({
        seatId: SeatId.of('seat-w-alone'),
        occupant: SeatOccupant.walkIn(w, label(WALK_IN_SENTINELS.label)),
      }),
    ],
    contactName: WALK_IN_SENTINELS.thirdName,
    contactPhone: WALK_IN_SENTINELS.thirdPhone,
    utcEpochMs: daysAgo(3),
  });

  const pRecord = customerFixture({
    id: p,
    userId: pUser,
    displayName: `${PRIVACY_SENTINELS.name} ${PRIVACY_SENTINELS.lastName}`,
    phone: PRIVACY_SENTINELS.phone,
    email: PRIVACY_SENTINELS.email,
    searchName: 'sentinel firstname sentinel lastname',
    searchPrefixes: ['s', 'se', 'sen'],
  });
  const qRecord = customerFixture({
    id: q,
    userId: qUser,
    displayName: OTHER_SENTINELS.name,
    phone: OTHER_SENTINELS.phone,
    email: OTHER_SENTINELS.email,
    searchName: 'other sentinel',
    searchPrefixes: ['o', 'ot', 'oth'],
  });
  const wRecord = customerFixture({
    id: w,
    userId: null,
    displayName: WALK_IN_SENTINELS.label,
    phone: WALK_IN_SENTINELS.phone,
    email: null,
    searchName: 'walkin sentinel',
    searchPrefixes: ['w', 'wa', 'wal'],
  });
  const qwRecord = customerFixture({
    id: qw,
    userId: null,
    displayName: OTHER_SENTINELS.label,
    phone: E164.of('+359880000444'),
    email: null,
    searchName: 'other label',
    searchPrefixes: ['o', 'ot', 'oth'],
  });
  const pAccount = userFixture({
    id: pUser,
    firstName: PRIVACY_SENTINELS.name,
    lastName: PRIVACY_SENTINELS.lastName,
    phone: PRIVACY_SENTINELS.phone,
    email: PRIVACY_SENTINELS.email,
    searchName: 'sentinel firstname sentinel lastname',
    searchPrefixes: ['s', 'se', 'sen'],
  });
  const qAccount = userFixture({
    id: qUser,
    firstName: OTHER_SENTINELS.name,
    lastName: 'Other',
    phone: OTHER_SENTINELS.phone,
    email: OTHER_SENTINELS.email,
    searchName: 'other sentinel',
    searchPrefixes: ['o', 'ot', 'oth'],
  });

  const soloNote: AppointmentNote = {
    id: solo.id,
    text: PRIVACY_SENTINELS.note,
    authorUserId: barber,
    writtenAtUtcMs: daysAgo(10),
  };
  const partyNote: AppointmentNote = {
    id: party.id,
    text: OTHER_SENTINELS.note,
    authorUserId: barber,
    writtenAtUtcMs: daysAgo(5),
  };
  const pShot = photo(
    'photo-p-shot',
    solo.id,
    p,
    PRIVACY_SENTINELS.label,
    PhotoOrigin.Shot,
    PRIVACY_SENTINELS.shotUrl,
  );
  const pLibrary = photo(
    'photo-p-library',
    party.id,
    p,
    PRIVACY_SENTINELS.label,
    PhotoOrigin.Library,
    PRIVACY_SENTINELS.libraryUrl,
  );
  const pNobody = photo(
    'photo-p-nobody',
    solo.id,
    null,
    PRIVACY_SENTINELS.label,
    PhotoOrigin.Shot,
    PRIVACY_SENTINELS.shotUrl,
  );
  const photos: readonly AppointmentPhoto[] = [
    pShot,
    pLibrary,
    pNobody,
    photo(
      'photo-q-shot',
      party.id,
      q,
      OTHER_SENTINELS.label,
      PhotoOrigin.Shot,
      OTHER_SENTINELS.url,
    ),
    photo(
      'photo-party-nobody',
      party.id,
      null,
      OTHER_SENTINELS.label,
      PhotoOrigin.Shot,
      OTHER_SENTINELS.url,
    ),
  ];
  const pGrant = grant('grant-p', p, pUser);
  const pVoucherDoc = voucher(
    pVoucher,
    PRIVACY_SENTINELS.voucherCode,
    p,
    pUser,
  );
  const pWaitlist = waitlistRequest('wl-p', pUser);
  const pInvitation = invitation('inv-p', pUser, PRIVACY_SENTINELS.name);
  const pSession = impersonationSessionFixture({
    id: ImpersonationSessionId.of('session-p'),
    adminUserId: admin,
    targetUserId: pUser,
    reason: PRIVACY_SENTINELS.sessionReason,
  });
  const pOtp = otpFixture({
    id: OtpId.of('otp-p-phone'),
    destination: Identifier.of(PRIVACY_SENTINELS.phone),
  });
  const pLoyalty = loyaltyOf(p, loyaltyAccountFixtures.georgi);
  const qLoyalty = loyaltyOf(q, loyaltyAccountFixtures.martin);
  const notifications = new Map<UserId, readonly InboxNotification[]>([
    [pUser, [notification('note-p-1', solo.id)]],
    [qUser, [notification('note-q-1', party.id)]],
  ]);

  const pResource = AuditResourceId.forCustomer(p);
  const auditRows: readonly AuditEntry[] = [
    auditRow(
      'row-p-record',
      10,
      Actor.user(pUser),
      AuditTargetRef.customer(p),
      pResource,
    ),
    auditRow(
      'row-p-account',
      8,
      Actor.admin(admin),
      AuditTargetRef.user(pUser),
      AuditResourceId.forUser(pUser),
    ),
    auditRow(
      'row-p-party',
      5,
      Actor.user(qUser),
      AuditTargetRef.customer(p),
      pResource,
    ),
    auditRow(
      'row-q-record',
      5,
      Actor.user(qUser),
      AuditTargetRef.customer(q),
      AuditResourceId.forCustomer(q),
    ),
    auditRow(
      'row-p-acts-on-q',
      4,
      Actor.user(pUser),
      AuditTargetRef.customer(q),
      AuditResourceId.forCustomer(q),
    ),
  ];
  const state: ClientFootprintState = {
    records: [pRecord, qRecord, wRecord, qwRecord],
    users: [pAccount, qAccount],
    visits: [solo, party, walkInParty, walkInThird],
    notes: [soloNote, partyNote],
    photos,
    grants: [pGrant, grant('grant-q', q, qUser)],
    vouchers: [
      pVoucherDoc,
      voucher(qVoucher, OTHER_SENTINELS.voucherCode, q, qUser),
    ],
    journal: [...pLoyalty.journal, ...qLoyalty.journal],
    notifications,
    waitlist: [pWaitlist, waitlistRequest('wl-q', qUser)],
    invitations: [
      pInvitation,
      invitation('inv-q', qUser, OTHER_SENTINELS.name),
    ],
    sessions: [
      pSession,
      impersonationSessionFixture({
        id: ImpersonationSessionId.of('session-q'),
        adminUserId: admin,
        targetUserId: qUser,
        reason: OTHER_SENTINELS.sessionReason,
      }),
    ],
    otps: [
      pOtp,
      otpFixture({
        id: OtpId.of('otp-q-phone'),
        destination: Identifier.of(OTHER_SENTINELS.phone),
      }),
    ],
  };
  const loyalty: LoyaltyWorld = {
    accounts: new Map([
      [p, pLoyalty.account],
      [q, qLoyalty.account],
    ]),
    badgeProgress: new Map([
      [p, pLoyalty.badgeProgress],
      [q, qLoyalty.badgeProgress],
    ]),
    seasonProgress: new Map([
      [p, pLoyalty.seasonProgress],
      [q, qLoyalty.seasonProgress],
    ]),
    calls: [],
  };
  const stats: ClientStatsReadState = {
    stats: [statsOf(p), statsOf(q)],
    money: [moneyOf(p), moneyOf(q)],
  };
  const personFootprint: ClientFootprint = {
    record: pRecord,
    account: pAccount,
    visits: [solo, party],
    notes: [soloNote],
    // `clientCustomerId == P` (the shot and the library photo), then the
    // photos of P's sole-subject visit (the shot again and the one naming nobody).
    photos: [pShot, pLibrary, pShot, pNobody],
    couponGrants: [pGrant],
    giftVouchers: [pVoucherDoc],
    loyaltyAccount: pLoyalty.account,
    badgeProgress: pLoyalty.badgeProgress,
    seasonProgress: pLoyalty.seasonProgress,
    clientStats: statsOf(p),
    clientMoney: moneyOf(p),
    journal: pLoyalty.journal,
    notifications: notifications.get(pUser) ?? [],
    waitlistRequests: [pWaitlist],
    invitations: [pInvitation],
    auditRows: auditRows.filter((row) => PERSON_ROW_IDS.includes(row.id)),
  };
  return {
    person: { userId: pUser, customerId: p },
    other: { userId: qUser, customerId: q },
    walkIn: { customerId: w },
    otherWalkIn: { customerId: qw },
    admin,
    sysadmin,
    barber,
    visits: { solo, party, walkInParty, walkInThird },
    state,
    loyalty,
    stats,
    auditRows,
    roles: new Map<UserId, readonly Role[]>([
      [admin, [Role.Admin]],
      [sysadmin, [Role.Sysadmin]],
      [barber, [Role.Barber]],
      [pUser, [Role.Client]],
      [qUser, [Role.Client]],
    ]),
    personFootprint,
  };
}

// ── A visit that kept a removed person's contact (P3-DEP-28) ──────────────

/**
 * A visit as a staff edit leaves it once `REMOVE_SEAT` took `seatId`: the
 * seats without it and the query mirrors (`ownerUserId`, `ownerCustomerId`,
 * `subjectCustomerIds`, …) recomputed by
 * `AppointmentIndexSystem.withQueryKeys` — the edit pipeline's own write —
 * every other field, the `BookingContact` included, as stored.
 */
export function withSeatRemoved(
  visit: Appointment,
  seatId: SeatId,
): Appointment {
  return AppointmentIndexSystem.withQueryKeys({
    ...visit,
    seats: visit.seats.filter((seat) => seat.seatId !== seatId),
  });
}

/** The seat {@link personsParty} seats P on — P's own, the booker's SELF seat. */
export const PERSONS_PARTY_SELF_SEAT = SeatId.of('seat-p-party-self');

/**
 * P's own booking of a party — P's SELF seat and Q on a companion seat, P's
 * contact (name, phone, e-mail, note) on the visit — the visit a desk edit
 * may strip of P's seat ({@link withSeatRemoved}) while keeping P's contact.
 */
export function personsParty(world: PrivacyWorld): Appointment {
  const p = world.person;
  const q = world.other;
  return appointmentFixture({
    id: AppointmentId.of('appt-p-party'),
    ownerUserId: p.userId,
    subjectUserIds: [p.userId, q.userId].sort(),
    ownerCustomerId: p.customerId,
    subjectCustomerIds: [p.customerId, q.customerId].sort(),
    seats: [
      seatFixture({
        seatId: PERSONS_PARTY_SELF_SEAT,
        occupant: SeatOccupant.account(
          p.userId,
          p.customerId,
          SubjectRelationship.Self,
        ),
      }),
      seatFixture({
        seatId: SeatId.of('seat-q-party-companion'),
        occupant: SeatOccupant.account(
          q.userId,
          q.customerId,
          SubjectRelationship.Companion,
        ),
      }),
    ],
    contactName: PRIVACY_SENTINELS.name,
    contactPhone: PRIVACY_SENTINELS.phone,
    contactEmail: PRIVACY_SENTINELS.email,
    contactNote: PRIVACY_SENTINELS.contactNote,
    utcEpochMs: daysAgo(2),
  });
}
