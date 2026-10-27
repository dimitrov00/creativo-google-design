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
  InvitationId,
  JournalEntryId,
  NotificationId,
  Result,
  SeatId,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import type {
  Appointment,
  AppointmentNote,
  AppointmentPhoto,
  AuditEntry,
  BadgeProgress,
  ClientMoneyRecord,
  ClientStatsRecord,
  CouponGrant,
  Customer,
  GiftVoucher,
  InboxNotification,
  Invitation,
  JournalEntry,
  LoyaltyAccount,
  SeasonProgress,
  User,
  WaitlistRequest,
} from '@core/entities';
import type { CallerRolesPorts, ClientFootprintPorts } from '@core/ports';
import { type ClientFootprint, ClientStatsSystem } from '@core/systems';
import { appointmentFixture, seatFixture } from './appointment.fixtures';
import { cents, EUR } from './booking-core.fixtures';
import { customerFixture, userFixture } from './identity.fixtures';
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
} from './test-support';

/*
 * The data-subject requests' doubles and fixtures (audit-hardening Phase 3,
 * WS-C): the in-memory footprint reads (`ClientFootprintPorts`), the stored
 * roles behind a token (`CallerRolesPorts`), and ONE small world of three
 * people whose personal values are SENTINELS (plan §4: a scan of the
 * serialised bundle, row or log line for a sentinel proves its absence):
 *
 * - P, the person asked about — an account and its record, a solo visit
 *   (a note, a shot photo, a photo naming nobody, a line of P's own
 *   voucher), a place on Q's party, a library photo naming P on that party,
 *   money, loyalty, statistics, the journal, the inbox, a waitlist request,
 *   an invitation and audit rows filed against P (and one where P only
 *   acted, against Q);
 * - Q, another account, who owns the party: Q's contact on it, Q's walk-in
 *   companion and an anonymous guest, Q's note on it, a line of Q's
 *   voucher, Q's own documents;
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
  };
}

/** `CallerRolesPorts` — each uid's STORED roles; `[]` for an unknown uid, as the port says. */
export function memoryCallerRolesPorts(
  roles: ReadonlyMap<UserId, readonly Role[]>,
): CallerRolesPorts {
  return {
    loadCallerRoles: async (userId) => Result.ok(roles.get(userId) ?? []),
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
    path: `appointmentPhotos/${appointmentId}/${id}.jpg`,
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
