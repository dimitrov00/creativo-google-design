import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type {
  CollectionReference,
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import {
  AccountStatus,
  Actor,
  AuditAction,
  AuthDeployment,
  BookingCall,
  type ClientPrivacyCall,
  EditCommand,
  ErasureCensus,
  ErasureStatus,
  FlagName,
  GovernedCollection,
  Identifier,
  OtpCode,
  OtpDestinationType,
  Placement,
  PrivacyMarker,
  Registration,
  RegistrationState,
  RequestedSubjectRole,
  Role,
  SeatLabel,
  SeatSubject,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  CartLineId,
  ClientOperationId,
  CustomerId,
  IdentifierChannel,
  LocationId,
  MinuteOfDay,
  OperationId,
  OtpId,
  Result,
  SeatId,
  ServiceId,
  TenantId,
  UserId,
} from '@core/primitives';
import {
  AccountsErrorCode,
  BookingErrorCode,
  IdentityErrorCode,
  PrivacyErrorCode,
  RepositoryError,
} from '@core/errors';
import { type Appointment, Collections, Subcollections } from '@core/entities';
import {
  auditDocumentChange,
  type BookAppointmentCommand,
  bookAppointment,
  completeRegistration,
  editAppointment,
  type EraseClientPorts,
  eraseClient,
  MAX_ERASURE_CALLS,
  previewClientErasure,
  updateProfile,
  verifyOtp,
} from '@core/pipelines';
import { StoredDocumentSystem } from '@core/systems';
import {
  barberFixture,
  barberScheduleFixture,
  customerFixture,
  duration,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  locationFixture,
  otpFixture,
  pinnedNowUtcMs,
  PRIVACY_SENTINELS,
  privacyWorld,
  serviceFixture,
  unwrapOk,
  WALK_IN_SENTINELS,
} from '@core/testing';
import { authClaimsPorts } from '../adapters/auth-claims.adapter';
import { consoleTelemetry } from '../adapters/console-telemetry.adapter';
import { hmacSha256Hex, walkInKeyPorts } from '../adapters/crypto.adapter';
import { authEraserPorts } from '../adapters/firebase-auth-eraser.adapter';
import { firestoreAccountPorts } from '../adapters/firestore-accounts.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreCouponPorts } from '../adapters/firestore-coupons.adapter';
import { firestoreJobPorts } from '../adapters/firestore-jobs.adapter';
import { firestorePrivacyPorts } from '../adapters/firestore-privacy.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { withPurgeAt } from '../adapters/firestore-ttl.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { firestoreUserPorts } from '../adapters/firestore-users.adapter';
import { nodeOtpCryptoPorts } from '../adapters/otp-crypto.adapter';
import { storageObjectPorts } from '../adapters/storage-objects.adapter';
import { singleTenantPorts } from '../adapters/tenant.adapter';
import { attemptProvenanceOf } from '../edge';
import { decodeCommitBooking } from '../wire/booking.wire';
import {
  type AuthDocumentWriteEvent,
  decodeDocumentChangeEvent,
} from '../wire/triggers.wire';

/**
 * The admin's data-subject ERASURE against the REAL Firestore, Auth and
 * Storage emulators (audit-hardening Phase 3, WS-D — the erasure proof,
 * plan §4 PD3): `previewClientErasure` and `eraseClient` over the
 * functions' own adapters — the commit, the footprint reads, the stored
 * roles, the Auth eraser on the Auth emulator, the object eraser on the
 * Storage emulator's `demo-creativo-test.appspot.com` — an admin caller and
 * the clock pinned.
 *
 * The seed is the privacy world of `@core/testing`, stored as the
 * transaction adapter writes it (every TTL group's body stamped): person P
 * (the account with P's sentinels, an Auth user holding P's phone and
 * e-mail, the record R, an avatar object), P's solo visit with a note, a
 * SHOT photo and a SHOT photo naming nobody (objects uploaded), Q's party
 * with P on an account companion seat, Q's note and a LIBRARY photo naming
 * P (its object the shop's), two notifications, a waitlist request, an
 * invitation, an impersonation session targeting P, a sign-in challenge
 * for P's phone, the journal, loyalty, statistics and money, a grant, a
 * voucher, audit rows filed before; a walk-in record S keyed by P's phone
 * (P's SIBLING); walk-in W — a walk-in-only record whose solo visit and
 * party `[WALK_IN W, ANONYMOUS]` are booked HERE through the staff request
 * the desk sends, so its contact is W's sentinel phone; a record L whose
 * `userId` names a STAFF uid holding a staff claim on its Auth user and NO
 * `users` document; person Q, untouched.
 *
 * THE HASH. The world's account records are `CustomerId.forUser(uid,
 * fixtureHash)` (D29 under the fixture hash of `@core/testing`), so every
 * pipeline here runs over `fixtureHash`: the erasure checks the record's
 * account link with the `hash` port (P3-RU-37 (h)). The walk-in key is the
 * one the emulator's `.secret.local` would hold (OR-26).
 *
 * Proved: (1) every personal value is gone — every document of every
 * collection scanned after P's erasure and its sibling's own; the Auth
 * user, the avatar and the SHOT objects deleted, the LIBRARY object kept;
 * W erased in its own act, its party's contact NONE; (2) the visits, the
 * money, loyalty, the journal and every earlier audit row byte-equal, one
 * STARTED and one ERASED row; (3) no erased value reaches a row of the
 * document-change audit or a log line, and the erased documents carry the
 * erasure's `writeOperationId` (WS-4.3's join from a trigger's attempt line
 * back to the act); (4) a second call is a no-op, and an erasure cut short
 * by a spent budget or a failing object eraser resumes into exactly the
 * same final state; (4b) a note written on P's old visit afterwards is
 * swept by the next call with ONE `PRIVACY_CLIENT_ERASURE_RESWEPT` row;
 * (5) no later writer resurrects P or W; (6) never the wrong account — a
 * staff account by its Auth claim alone, a record whose link fails D29.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-erase-client';
/** The Storage emulator's default bucket of the emulated project — the one the erasure deletes from. */
const BUCKET = 'demo-creativo-test.appspot.com';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
const AUTH_HOST = (process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??=
  '127.0.0.1:9099');
const STORAGE_HOST = (process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ??=
  '127.0.0.1:9199');
if (
  ![FIRESTORE_HOST, AUTH_HOST, STORAGE_HOST].every((host) =>
    host.includes('127.0.0.1'),
  )
) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** The walk-in key, as the emulator's `.secret.local` holds one (OR-26). */
const WALKIN_KEY = 'walkin-integration-key';
const walkInHash = (input: string): string => hmacSha256Hex(WALKIN_KEY, input);

/** Thursday of the week the pinned Monday 09:00 opens — W's visits. */
const THURSDAY = localDate('2026-10-01');
const W_SOLO = 'attempt-walkin-solo-0001';
const W_PARTY = 'attempt-walkin-party-0001';
const GUEST_VISIT = 'attempt-guest-visit-0001';

const OP = OperationId.of('erase-operation-000001');
const OP_SIBLING = OperationId.of('erase-operation-sibling1');
const OP_WALK_IN = OperationId.of('erase-operation-walkin01');
const OP_SECOND = OperationId.of('erase-operation-second01');
const OP_RESWEEP = OperationId.of('erase-operation-resweep1');
const OP_WRONG = OperationId.of('erase-operation-wrong001');

const ADMIN_ROLES: readonly Role[] = [Role.Admin];
/** A staff account with an Auth user and a staff claim — and NO `users` document. */
const STAFF_UID = UserId.of('u-privacy-staff-auth-only');
const CORRUPT = CustomerId.of('cus-corrupt-link');

const unbounded = { spent: () => false } as const;
const spentAtOnce = { spent: () => true } as const;

/** The sign-in code the new challenge for P's freed phone is hashed with (real scrypt). */
const CODE = OtpCode.of('123456');
const SALT = '9f86d081884c7d659a2feaa0c55ad015';
const otpCrypto = nodeOtpCryptoPorts();

type Data = Record<string, unknown>;

function bodyOf(entity: { readonly id: string }): Data {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** One document as comparable text — its keys sorted at every level. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

/** A data map without the named keys. */
function without(data: Data | undefined, ...keys: readonly string[]): Data {
  return Object.fromEntries(
    Object.entries(data ?? {}).filter(([key]) => !keys.includes(key)),
  );
}

/** Every value of P a scan must not find (the voucher code is money — kept by design, R36 / T5). */
const P_VALUES: readonly string[] = [
  PRIVACY_SENTINELS.name,
  PRIVACY_SENTINELS.lastName,
  PRIVACY_SENTINELS.phone,
  PRIVACY_SENTINELS.phone.replace('+', ''),
  PRIVACY_SENTINELS.email,
  PRIVACY_SENTINELS.note,
  PRIVACY_SENTINELS.contactNote,
  PRIVACY_SENTINELS.label,
  PRIVACY_SENTINELS.shotUrl,
  PRIVACY_SENTINELS.libraryUrl,
  PRIVACY_SENTINELS.sessionReason,
];

/** The residue of a complete erasure: every PERSONAL census count 0. */
const NO_PERSONAL_VALUE: Readonly<Record<string, number>> = Object.fromEntries(
  ErasureCensus.PERSONAL_FIELDS.map((field) => [field, 0]),
);

/** Every value of W a scan must not find once W is erased. */
const W_VALUES: readonly string[] = [
  WALK_IN_SENTINELS.label,
  WALK_IN_SENTINELS.phone,
  WALK_IN_SENTINELS.phone.replace('+', ''),
];

/** Every `[label, value]` of `values` that `texts` holds. */
function leaks(
  texts: ReadonlyMap<string, string> | readonly string[],
  values: readonly string[],
): readonly string[] {
  const entries: readonly (readonly [string, string])[] = Array.isArray(texts)
    ? texts.map((text, index) => [String(index), text] as const)
    : [...(texts as ReadonlyMap<string, string>)];
  const found: string[] = [];
  for (const [label, text] of entries) {
    for (const value of values) {
      if (text.includes(value)) found.push(`${label}: ${value}`);
    }
  }
  return found;
}

/** The uid a custom token signs into — its unsigned payload's `uid`. */
function uidOf(customToken: string): string {
  const payload = customToken.split('.')[1] ?? '';
  return String(
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))['uid'],
  );
}

/** One staff seat of the desk's call, on the fixture barber and service. */
function deskSeat(
  lineId: string,
  startMinutes: number,
  subject: BookingCall.Subject,
): BookingCall.Seat {
  return BookingCall.seat(
    CartLineId.of(lineId),
    ServiceId.of(FIXTURE_IDS.service),
    null,
    BarberId.of(FIXTURE_IDS.barber),
    null,
    unwrapOk(MinuteOfDay.of(startMinutes)),
    subject,
  );
}

/**
 * The call the staff sheet sends (`StaffEditPlanSystem.bookingRequest`'s
 * shape, built by the call component's own builders — export spec PC3
 * deviation 3): the given seats, no account, the visit's contact the FIRST
 * walk-in's.
 */
function deskCall(
  attemptId: string,
  seats: readonly BookingCall.Seat[],
  contact: BookingCall['contact'],
): BookingCall {
  return {
    locationId: LocationId.of(FIXTURE_IDS.location),
    localDate: THURSDAY,
    seats,
    attemptId: unwrapOk(ClientOperationId.parse(attemptId)),
    contact,
    bookedFromAppointmentId: null,
    placement: Placement.Staff,
    onBehalfOfUserId: null,
  };
}

/** W's own contact, as the desk types it. */
const W_CONTACT = {
  name: WALK_IN_SENTINELS.label,
  phone: WALK_IN_SENTINELS.phone,
  email: null,
  note: null,
};

const wGuest = () =>
  BookingCall.staffGuestSubject(
    WALK_IN_SENTINELS.label,
    BookingCall.guestContact(WALK_IN_SENTINELS.phone, null),
  );

describe('eraseClient (emulator)', () => {
  let db: Firestore;
  let auth: Auth;
  let bucket: ReturnType<ReturnType<typeof getStorage>['bucket']>;
  let world: ReturnType<typeof privacyWorld>;
  const lines: unknown[][] = [];

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp(
        { projectId: PROJECT_ID, storageBucket: BUCKET },
        PROJECT_ID,
      );
    db = app.firestore();
    auth = app.auth();
    bucket = getStorage(app).bucket(BUCKET);
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── the people ────────────────────────────────────────────────────────

  const p = () => world.person.customerId;
  const u = () => world.person.userId;
  /** S — the walk-in record keyed by P's phone (P's sibling, P3-L-7). */
  const sibling = () =>
    CustomerId.forWalkIn(PRIVACY_SENTINELS.phone, walkInHash);
  /** W — the walk-in record the desk's booking keyed by W's phone. */
  const walkIn = () =>
    CustomerId.forWalkIn(WALK_IN_SENTINELS.phone, walkInHash);
  /** L — a record linking the staff uid by D29 under the fixture hash. */
  const staffLinked = () => CustomerId.forUser(STAFF_UID, fixtureHash);

  const avatarPath = () => `avatars/${u()}/avatar.jpg`;
  const photo = (id: string) => {
    const found = world.state.photos.find((stored) => stored.id === id);
    if (found === undefined) throw new Error(`the world holds no ${id}`);
    return found;
  };

  // ── the seed ──────────────────────────────────────────────────────────

  /** The world's documents at their stored paths (the fixture-keyed W stays out: the desk books W here). */
  function worldDocuments(): readonly (readonly [string, Data])[] {
    const docs: (readonly [string, Data])[] = [];
    const put = (path: string, entity: { readonly id: string }) =>
      docs.push([`${path}/${entity.id}`, bodyOf(entity)]);
    for (const record of world.state.records) {
      if (record.id !== world.walkIn.customerId) {
        put(Collections.Customers, record);
      }
    }
    for (const user of world.state.users) put(Collections.Users, user);
    for (const visit of [world.visits.solo, world.visits.party]) {
      put(Collections.Appointments, visit);
    }
    for (const note of world.state.notes)
      put(Collections.AppointmentNotes, note);
    for (const stored of world.state.photos) {
      put(Collections.AppointmentPhotos, stored);
    }
    for (const grant of world.state.grants)
      put(Collections.CouponGrants, grant);
    for (const voucher of world.state.vouchers) {
      put(Collections.GiftVouchers, voucher);
    }
    for (const entry of world.state.journal) {
      put(Collections.ClientJournal, entry);
    }
    for (const [userId, inbox] of world.state.notifications) {
      const path = `${Collections.Users}/${userId}/${Subcollections.Notifications}`;
      for (const notification of inbox) put(path, notification);
      // P's second notification.
      if (userId === u()) {
        const [first] = inbox;
        if (first !== undefined) put(path, { ...first, id: 'note-p-2' });
      }
    }
    for (const request of world.state.waitlist) {
      put(Collections.WaitlistRequests, request);
    }
    for (const invitation of world.state.invitations) {
      put(Collections.Invitations, invitation);
    }
    for (const session of world.state.sessions) {
      put(Collections.ImpersonationSessions, session);
    }
    for (const otp of world.state.otps) put(Collections.Otps, otp);
    for (const [customerId, account] of world.loyalty.accounts) {
      put(Collections.LoyaltyAccounts, account);
      for (const progress of world.loyalty.badgeProgress.get(customerId) ??
        []) {
        put(
          `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.BadgeProgress}`,
          progress,
        );
      }
      for (const progress of world.loyalty.seasonProgress.get(customerId) ??
        []) {
        put(
          `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.SeasonProgress}`,
          progress,
        );
      }
    }
    for (const stats of world.stats.stats) put(Collections.ClientStats, stats);
    for (const money of world.stats.money) {
      put(
        `${Collections.ClientStats}/${money.customerId}/${Subcollections.Restricted}`,
        money,
      );
    }
    for (const row of world.auditRows) put(Collections.AuditLog, row);
    // S: a walk-in record keyed by P's phone — another record, never merged.
    put(
      Collections.Customers,
      customerFixture({
        id: sibling(),
        userId: null,
        displayName: PRIVACY_SENTINELS.label,
        phone: PRIVACY_SENTINELS.phone,
        email: null,
        searchName: 'sentinel label',
        searchPrefixes: ['s', 'se', 'sen'],
      }),
    );
    // L: the staff uid's record by D29 — its account holds no document.
    put(
      Collections.Customers,
      customerFixture({
        id: staffLinked(),
        userId: STAFF_UID,
        displayName: 'Staff Linked',
        phone: null,
        email: null,
        searchName: 'staff linked',
        searchPrefixes: ['s', 'st', 'sta'],
      }),
    );
    // The admin's STORED roles — the pipeline re-reads them (P3-RU-13).
    docs.push([`${Collections.Users}/${world.admin}`, { roles: ['admin'] }]);
    // The catalogue W's visits are booked on.
    docs.push(
      [
        `${Collections.Locations}/${FIXTURE_IDS.location}`,
        bodyOf(locationFixture()),
      ],
      [`${Collections.Barbers}/${FIXTURE_IDS.barber}`, bodyOf(barberFixture())],
      [
        `${Collections.Services}/${FIXTURE_IDS.service}`,
        bodyOf(serviceFixture()),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
    );
    return docs;
  }

  /** The booking pipeline's ports — the functions' own adapters, the clock pinned. */
  function bookingPorts() {
    const telemetry = consoleTelemetry();
    let minted = 0;
    return {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => `id-${++minted}`,
      hash: fixtureHash,
      ...walkInKeyPorts(() => WALKIN_KEY),
      ...firestoreSettingsPorts(db),
      ...firestoreAccountPorts(db),
      ...telemetry,
    };
  }

  /** One of the desk's calls, through the `commitBooking` wire as the platform hands it over (JSON). */
  async function deskBooking(call: BookingCall) {
    const command = decodeCommitBooking({
      data: JSON.parse(JSON.stringify(call)) as unknown,
      auth: { uid: 'u-privacy-desk', token: { roles: ['receptionist'] } },
    });
    if (!command.ok) {
      throw new Error(
        `the desk's call must decode: ${command.error.errorCode}`,
      );
    }
    return bookAppointment(bookingPorts())(command.value);
  }

  /** Wipes the three emulators and seeds the world. */
  async function seed(): Promise<void> {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await fetch(
      `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: 'DELETE' },
    );
    const [stored] = await bucket.getFiles();
    for (const file of stored) await file.delete({ ignoreNotFound: true });

    for (const [path, body] of worldDocuments()) {
      // As the transaction adapter writes a TTL group's body: stamped.
      await db.doc(path).set(withPurgeAt(path.split('/'), body));
    }

    // The Auth users: P's holds P's phone and e-mail; L's uid a staff claim.
    await auth.createUser({
      uid: u(),
      phoneNumber: PRIVACY_SENTINELS.phone,
      email: PRIVACY_SENTINELS.email,
      displayName: `${PRIVACY_SENTINELS.name} ${PRIVACY_SENTINELS.lastName}`,
    });
    await auth.createUser({ uid: world.other.userId });
    await auth.createUser({ uid: STAFF_UID });
    await auth.setCustomUserClaims(STAFF_UID, {
      tenantId: 'creativo',
      stage: 'active',
      roles: ['barber'],
    });

    // The objects: P's avatar, the SHOT photos' bytes (their metadata names
    // the client), the LIBRARY picture's (the shop's), Q's.
    const upload = (path: string, clientLabel: string | null) =>
      bucket.file(path).save(Buffer.from('jpeg bytes'), {
        resumable: false,
        contentType: 'image/jpeg',
        metadata: clientLabel === null ? {} : { metadata: { clientLabel } },
      });
    await upload(avatarPath(), null);
    for (const stored of world.state.photos) {
      await upload(
        stored.path,
        stored.photoOrigin === 'SHOT' ? stored.clientLabel : null,
      );
    }

    // W, as the desk books it: a solo visit, and the party [W, a guest].
    for (const call of [
      deskCall(W_SOLO, [deskSeat('draft-w-solo', 690, wGuest())], W_CONTACT),
      deskCall(
        W_PARTY,
        [
          deskSeat('draft-w', 600, wGuest()),
          deskSeat(
            'draft-guest',
            630,
            BookingCall.staffGuestSubject('Гост 2', null),
          ),
        ],
        W_CONTACT,
      ),
    ]) {
      const booked = await deskBooking(call);
      if (!booked.ok) {
        throw new Error(`W's visit must book: ${booked.error.errorCode}`);
      }
    }
  }

  beforeEach(async () => {
    world = privacyWorld();
    lines.length = 0;
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args);
      });
    }
    await seed();
  }, 60_000);

  // ── the erasure ───────────────────────────────────────────────────────

  /** The erasure's ports — the functions' own adapters over the three emulators, the clock pinned. */
  function erasePorts(over: Partial<EraseClientPorts> = {}): EraseClientPorts {
    const telemetry = consoleTelemetry();
    return {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      // The hash the world's account records were derived under (see THE HASH).
      hash: fixtureHash,
      ...walkInKeyPorts(() => WALKIN_KEY),
      ...firestoreJobPorts(db, StoredDocumentSystem.guardOf, telemetry.log),
      flagOn: (key) => key === FlagName.ClientPrivacy,
      ...firestorePrivacyPorts(db, StoredDocumentSystem.guardOf, telemetry.log),
      ...authEraserPorts(auth),
      ...storageObjectPorts(bucket),
      ...telemetry,
      ...over,
    };
  }

  const command = (customerId: CustomerId, operationId: OperationId) => ({
    callerUserId: world.admin,
    callerRoles: ADMIN_ROLES,
    customerId,
    operationId,
  });

  /** One `eraseClient` call. */
  const erase = (
    customerId: CustomerId,
    operationId: OperationId,
    budget: { readonly spent: () => boolean } = unbounded,
    over: Partial<EraseClientPorts> = {},
  ) => eraseClient(erasePorts(over))(command(customerId, operationId), budget);

  /** The browser's loop: the SAME act resent until it answers done (`MAX_ERASURE_CALLS`). */
  async function eraseUntilDone(
    customerId: CustomerId,
    operationId: OperationId,
  ): Promise<ClientPrivacyCall.Erasure> {
    let last: ClientPrivacyCall.Erasure | null = null;
    for (let call = 0; call < MAX_ERASURE_CALLS; call++) {
      const answer = await erase(customerId, operationId);
      if (!answer.ok) {
        throw new Error(`the erasure refused: ${answer.error.errorCode}`);
      }
      last = answer.value;
      if (last.erasureDone) return last;
    }
    throw new Error(`the erasure is not done: ${canonical(last)}`);
  }

  // ── what the emulators hold ───────────────────────────────────────────

  /** Every document of the database, every collection and subcollection, by path. */
  async function allDocuments(): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>();
    const walk = async (
      collections: readonly CollectionReference[],
    ): Promise<void> => {
      for (const collection of collections) {
        for (const ref of await collection.listDocuments()) {
          const snap = await ref.get();
          if (snap.exists) out.set(ref.path, canonical(snap.data()));
          await walk(await ref.listCollections());
        }
      }
    };
    await walk(await db.listCollections());
    return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  const objectNames = async (): Promise<readonly string[]> =>
    (await bucket.getFiles())[0].map((file) => file.name).sort();

  const authUids = async (): Promise<readonly string[]> =>
    (await auth.listUsers()).users.map((user) => user.uid).sort();

  /** The three emulators' whole state — comparable byte for byte. */
  async function everything() {
    return {
      documents: [...(await allDocuments())],
      objects: await objectNames(),
      uids: await authUids(),
    };
  }

  const authCodeOf = (uid: string): Promise<string> =>
    auth.getUser(uid).then(
      () => 'present',
      (error: unknown) =>
        String((error as { readonly code?: unknown }).code ?? error),
    );

  const exists = async (path: string): Promise<boolean> =>
    (await bucket.file(path).exists())[0];

  /** The rows of one erasure verb that target a record. */
  const rowsOf = async (
    customerId: CustomerId,
    auditAction: string,
  ): Promise<readonly Data[]> =>
    (
      await db
        .collection(Collections.AuditLog)
        .where('targetCustomerId', '==', customerId)
        .get()
    ).docs
      .map((row) => row.data())
      .filter((row) => row['auditAction'] === auditAction);

  const docData = async (path: string): Promise<Data | undefined> =>
    (await db.doc(path).get()).data();

  // ── (1) every personal value is gone ──────────────────────────────────

  it('(1) erases every personal value of P — the preview names the sibling S, whose own act follows; the Auth user, the avatar and the SHOT objects go, the LIBRARY object stays', async () => {
    const preview = await previewClientErasure(erasePorts())(command(p(), OP));
    expect(preview).toEqual({
      ok: true,
      value: expect.objectContaining({
        erasureStatus: ErasureStatus.None,
        erasureSiblingCustomerIds: [sibling()],
        erasureRecordCount: 1,
        erasureAccountCount: 1,
        erasureVisitCount: 2,
        erasureNoteCount: 2,
        erasurePhotoCount: 3,
      }),
    });
    const siblingBefore = await docData(
      `${Collections.Customers}/${sibling()}`,
    );

    const done = await eraseUntilDone(p(), OP);
    expect(done.erasureStatus).toBe(ErasureStatus.Erased);
    expect(done).toMatchObject(NO_PERSONAL_VALUE);
    // R's ERASED row claims no sibling: S is untouched by P's act.
    const [erased] = await rowsOf(p(), AuditAction.PrivacyClientErased);
    expect(erased).toMatchObject({
      erasureRecordCount: 0,
      erasureVisitCount: 2,
    });
    expect(await docData(`${Collections.Customers}/${sibling()}`)).toEqual(
      siblingBefore,
    );
    expect(await rowsOf(sibling(), AuditAction.PrivacyClientErased)).toEqual(
      [],
    );

    // The Auth user deleted; Q's and the staff uid's kept.
    expect(await authCodeOf(u())).toBe('auth/user-not-found');
    expect(await authCodeOf(world.other.userId)).toBe('present');
    // The avatar and the SHOT objects gone; the LIBRARY object and Q's kept.
    expect(await exists(avatarPath())).toBe(false);
    expect(await exists(photo('photo-p-shot').path)).toBe(false);
    expect(await exists(photo('photo-p-nobody').path)).toBe(false);
    expect(await exists(photo('photo-p-library').path)).toBe(true);
    expect(await exists(photo('photo-q-shot').path)).toBe(true);
    expect(await exists(photo('photo-party-nobody').path)).toBe(true);
    // The LIBRARY photo's DOCUMENT on Q's party and that party's note are gone.
    expect(
      await docData(`${Collections.AppointmentPhotos}/photo-p-library`),
    ).toBeUndefined();
    expect(
      await docData(`${Collections.AppointmentNotes}/${world.visits.party.id}`),
    ).toBeUndefined();
    // The challenge under P's phone swept; Q's kept.
    expect(await docData(`${Collections.Otps}/otp-p-phone`)).toBeUndefined();
    expect(await docData(`${Collections.Otps}/otp-q-phone`)).toBeDefined();

    // S, erased in its own act.
    const siblingDone = await eraseUntilDone(sibling(), OP_SIBLING);
    expect(siblingDone.erasureStatus).toBe(ErasureStatus.Erased);

    // Every document of every collection: no value of P.
    expect(leaks(await allDocuments(), P_VALUES)).toEqual([]);
  }, 60_000);

  it('(1) erases the walk-in W in its own act — no value of W anywhere; its party’s contact is NONE and its seat a mark', async () => {
    const w = walkIn();
    const party = (await docData(
      `${Collections.Appointments}/${W_PARTY}`,
    )) as Omit<Appointment, 'id'>;
    expect(party.subjectCustomerIds).toEqual([w]);
    expect(party.contactPhone).toBe(WALK_IN_SENTINELS.phone);

    const done = await eraseUntilDone(w, OP_WALK_IN);
    expect(done.erasureStatus).toBe(ErasureStatus.Erased);
    expect(done.erasureVisitCount).toBe(2);

    const after = (await docData(
      `${Collections.Appointments}/${W_PARTY}`,
    )) as Omit<Appointment, 'id'>;
    expect(after).toMatchObject({
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      contactNote: null,
      writeOperationId: OP_WALK_IN,
    });
    const labelOf = (seat: object | undefined): unknown =>
      seat === undefined ? undefined : Reflect.get(seat, 'guestLabel');
    const [own, guest] = after.seats;
    expect(own?.seatSubject).toBe(SeatSubject.WalkIn);
    expect(PrivacyMarker.isMarker(String(labelOf(own)))).toBe(true);
    expect(labelOf(guest)).toBe('Гост 2');
    const solo = (await docData(
      `${Collections.Appointments}/${W_SOLO}`,
    )) as Omit<Appointment, 'id'>;
    expect(solo.contactPhone).toBeNull();
    expect(PrivacyMarker.isMarker(String(labelOf(solo.seats[0])))).toBe(true);
    expect(await docData(`${Collections.Customers}/${w}`)).toMatchObject({
      erasureStatus: ErasureStatus.Erased,
      displayName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
    });
    expect(leaks(await allDocuments(), W_VALUES)).toEqual([]);
  }, 60_000);

  // ── (2) visits, money and audit rows remain ───────────────────────────

  it('(2) keeps the visits, the money and the audit rows — every document but the erased ones byte-equal; ONE STARTED and ONE ERASED row', async () => {
    const before = await allDocuments();
    await eraseUntilDone(p(), OP);
    const after = await allDocuments();

    const solo = `${Collections.Appointments}/${world.visits.solo.id}`;
    const record = `${Collections.Customers}/${p()}`;
    const account = `${Collections.Users}/${u()}`;
    const inbox = `${Collections.Users}/${u()}/${Subcollections.Notifications}`;
    const changed = new Set([
      record,
      account,
      solo,
      `${Collections.Invitations}/inv-p`,
      `${Collections.ImpersonationSessions}/session-p`,
    ]);
    const deleted = new Set([
      `${Collections.AppointmentNotes}/${world.visits.solo.id}`,
      `${Collections.AppointmentNotes}/${world.visits.party.id}`,
      `${Collections.AppointmentPhotos}/photo-p-shot`,
      `${Collections.AppointmentPhotos}/photo-p-library`,
      `${Collections.AppointmentPhotos}/photo-p-nobody`,
      `${inbox}/note-p-1`,
      `${inbox}/note-p-2`,
      `${Collections.WaitlistRequests}/wl-p`,
      `${Collections.Otps}/otp-p-phone`,
    ]);
    for (const [path, text] of before) {
      if (deleted.has(path)) {
        expect(after.has(path), path).toBe(false);
      } else if (!changed.has(path)) {
        // Q, S, W, L, the party visit, money, loyalty, stats, the journal,
        // every earlier audit row: byte-equal.
        expect(after.get(path), path).toBe(text);
      }
    }
    // Only the two rows are new.
    const added = [...after.keys()].filter((path) => !before.has(path));
    expect(added).toHaveLength(2);
    for (const path of added) expect(path.startsWith('auditLog/')).toBe(true);

    // The solo visit: only its contact cleared and its writer named.
    const parse = (text: string | undefined): Data =>
      JSON.parse(text ?? '{}') as Data;
    const contact = [
      'contactName',
      'contactPhone',
      'contactEmail',
      'contactNote',
      'writeOperationId',
    ];
    expect(without(parse(after.get(solo)), ...contact)).toEqual(
      without(parse(before.get(solo)), ...contact),
    );
    expect(parse(after.get(solo))).toMatchObject({
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      contactNote: null,
      writeOperationId: OP,
    });
    // The record and the account: pseudonymised, kept, stamped.
    expect(parse(after.get(record))).toMatchObject({
      userId: u(),
      displayName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
      erasureStatus: ErasureStatus.Erased,
      erasureStartedAtUtcMs: FIXTURE_NOW_UTC_MS,
      erasedAtUtcMs: FIXTURE_NOW_UTC_MS,
      writeOperationId: OP,
    });
    expect(parse(after.get(account))).toMatchObject({
      firstName: PrivacyMarker.TEXT,
      lastName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
      birthDate: null,
      accountStatus: AccountStatus.Erased,
      accountErasedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(parse(after.get(`${Collections.Invitations}/inv-p`))).toEqual({
      ...parse(before.get(`${Collections.Invitations}/inv-p`)),
      inviterName: PrivacyMarker.TEXT,
    });
    expect(
      parse(after.get(`${Collections.ImpersonationSessions}/session-p`)),
    ).toEqual({
      ...parse(before.get(`${Collections.ImpersonationSessions}/session-p`)),
      reason: PrivacyMarker.TEXT,
    });

    // ONE STARTED row (the census BEFORE) and ONE ERASED row (the residue).
    const journal = world.state.journal.filter(
      (entry) => entry.customerId === p(),
    ).length;
    const admin = Actor.forCaller(world.admin, ADMIN_ROLES);
    const started = await rowsOf(p(), AuditAction.PrivacyClientErasureStarted);
    expect(started).toEqual([
      expect.objectContaining({
        ...admin,
        auditOperationId: OP,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: record,
        erasureRecordCount: 1,
        erasureAccountCount: 1,
        erasureContactCount: 1,
        erasureLabelCount: 0,
        erasureNoteCount: 2,
        erasurePhotoCount: 3,
        erasureDocumentCount: 3,
        erasurePseudonymCount: 2,
        erasureVisitCount: 2,
        erasureContactKeptCount: 1,
        erasureJournalCount: journal,
      }),
    ]);
    const erasedRows = await rowsOf(p(), AuditAction.PrivacyClientErased);
    expect(erasedRows).toEqual([
      expect.objectContaining({
        ...admin,
        auditOperationId: OP,
        ...ErasureCensus.EMPTY,
        erasureVisitCount: 2,
        erasureContactKeptCount: 1,
        erasureJournalCount: journal,
      }),
    ]);
  }, 60_000);

  // ── (3) no erased value reaches a row or a log line ───────────────────

  it('(3) no erased value reaches a row of the document-change audit or a log line — the erased documents name the erasure as their writer', async () => {
    const solo = world.visits.solo.id;
    const party = world.visits.party.id;
    const governed: readonly (readonly [GovernedCollection, string])[] = [
      [GovernedCollection.Customers, `${Collections.Customers}/${p()}`],
      [GovernedCollection.Users, `${Collections.Users}/${u()}`],
      [
        GovernedCollection.AppointmentNotes,
        `${Collections.AppointmentNotes}/${solo}`,
      ],
      [
        GovernedCollection.AppointmentNotes,
        `${Collections.AppointmentNotes}/${party}`,
      ],
      [
        GovernedCollection.AppointmentPhotos,
        `${Collections.AppointmentPhotos}/photo-p-shot`,
      ],
      [
        GovernedCollection.AppointmentPhotos,
        `${Collections.AppointmentPhotos}/photo-p-library`,
      ],
      [
        GovernedCollection.AppointmentPhotos,
        `${Collections.AppointmentPhotos}/photo-p-nobody`,
      ],
    ];
    const visit = `${Collections.Appointments}/${solo}`;
    const read = (path: string): Promise<DocumentSnapshot> =>
      db.doc(path).get();
    const before = await Promise.all(governed.map(([, path]) => read(path)));
    const visitBefore = await read(visit);
    lines.length = 0;

    await eraseUntilDone(p(), OP);

    const after = await Promise.all(governed.map(([, path]) => read(path)));
    const visitAfter = await read(visit);
    // The document-change audit (WS-3), as each erased document's trigger
    // runs it: its two sides decoded by the ONE decoder, audited by the ONE
    // pipeline over the real audit adapter — the Admin SDK the writer.
    const rowsBefore = new Set(
      (await db.collection(Collections.AuditLog).get()).docs.map(
        (row) => row.id,
      ),
    );
    for (const [i, [governedCollection, path]] of governed.entries()) {
      const event: AuthDocumentWriteEvent<{ readonly docId: string }> = {
        id: `evt-erasure-${i}`,
        time: '2026-09-28T06:00:00.000Z',
        params: { docId: path.split('/')[1] ?? '' },
        data: { before: before.at(i), after: after.at(i) },
        authType: 'service_account',
      };
      const telemetry = consoleTelemetry();
      const audited = await auditDocumentChange({
        ...firestoreAuditPorts(db, telemetry),
        hash: fixtureHash,
        nowUtcMs: pinnedNowUtcMs(),
      })(decodeDocumentChangeEvent(governedCollection, event));
      expect(audited.ok, path).toBe(true);
    }
    const governedRows = (
      await db.collection(Collections.AuditLog).get()
    ).docs.filter((row) => !rowsBefore.has(row.id));
    expect(governedRows.length).toBeGreaterThan(0);
    for (const row of governedRows) {
      // A trigger row names no operation (WS-3); its fields by NAME only.
      expect(row.get('auditOperationId'), row.id).toBeNull();
    }

    // Every row and every line the run logged: no value of P.
    const rows = (await db.collection(Collections.AuditLog).get()).docs.map(
      (row) => canonical(row.data()),
    );
    expect(leaks(rows, P_VALUES)).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
    expect(
      leaks(
        lines.map((line) => JSON.stringify(line)),
        P_VALUES,
      ),
    ).toEqual([]);

    // The join (WS-4.3, DEP-19): the attempt line of the record's and the
    // visit's triggers names the erasure, read off the written document.
    expect(
      attemptProvenanceOf({
        document: `${Collections.Customers}/${p()}`,
        data: { before: before.at(0), after: after.at(0) },
      }),
    ).toEqual({
      documentPath: `${Collections.Customers}/${p()}`,
      writeOperationId: OP,
    });
    expect(
      attemptProvenanceOf({
        document: visit,
        data: { before: visitBefore, after: visitAfter },
      }).writeOperationId,
    ).toBe(OP);
  }, 60_000);

  // ── (4) a second call is a no-op; a partial erasure resumes ───────────

  it('(4) a second call after completion changes nothing and adds no row — a new act or a replay of the same one', async () => {
    await eraseUntilDone(p(), OP);
    const done = await everything();
    for (const operationId of [OP_SECOND, OP]) {
      const again = await erase(p(), operationId);
      expect(again).toEqual({
        ok: true,
        value: expect.objectContaining({
          erasureStatus: ErasureStatus.Erased,
          erasureDone: true,
        }),
      });
      expect(await everything()).toEqual(done);
    }
  }, 60_000);

  it('(4) an erasure cut short — by a budget spent right after the stamp, or a failing object eraser — finishes on the next call in exactly the same final state', async () => {
    await eraseUntilDone(p(), OP);
    const straight = await everything();

    // A budget spent at once: the stamp, then the first unit only.
    await seed();
    const cut = await erase(p(), OP, spentAtOnce);
    expect(cut).toEqual({
      ok: true,
      value: expect.objectContaining({
        erasureStatus: ErasureStatus.Erasing,
        erasureDone: false,
      }),
    });
    expect(
      await rowsOf(p(), AuditAction.PrivacyClientErasureStarted),
    ).toHaveLength(1);
    expect(await rowsOf(p(), AuditAction.PrivacyClientErased)).toEqual([]);
    expect((await erase(p(), OP)).ok).toBe(true);
    expect(await everything()).toEqual(straight);

    // The SHOT object's deletion fails on the first call.
    await seed();
    const shot = photo('photo-p-shot').path;
    const real = storageObjectPorts(bucket);
    const failing = await erase(p(), OP, unbounded, {
      deleteStoredObject: (path) =>
        path === shot
          ? Promise.resolve(
              Result.err(RepositoryError.writeFailed(path, 'unavailable')),
            )
          : real.deleteStoredObject(path),
    });
    expect(failing).toEqual({
      ok: true,
      value: expect.objectContaining({ erasureDone: false }),
    });
    expect(await exists(shot)).toBe(true);
    expect(
      await docData(`${Collections.AppointmentPhotos}/photo-p-shot`),
    ).toBeDefined();
    const finished = await erase(p(), OP);
    expect(finished.ok && finished.value.erasureDone).toBe(true);
    expect(await everything()).toEqual(straight);
  }, 120_000);

  it('(4b) re-sweeps an ERASED record: a note written on P’s old solo visit afterwards is deleted by the next call with ONE RESWEPT row — a replay adds none', async () => {
    await eraseUntilDone(p(), OP);
    const notePath = `${Collections.AppointmentNotes}/${world.visits.solo.id}`;
    const staffNote = {
      text: PRIVACY_SENTINELS.note,
      authorUserId: world.barber,
      writtenAtUtcMs: FIXTURE_NOW_UTC_MS,
    };
    await db.doc(notePath).set(staffNote);

    const swept = await erase(p(), OP_RESWEEP);
    expect(swept).toEqual({
      ok: true,
      value: expect.objectContaining({
        erasureStatus: ErasureStatus.Erased,
        erasureDone: true,
        erasureNoteCount: 0,
      }),
    });
    expect(await docData(notePath)).toBeUndefined();
    const reswept = await rowsOf(p(), AuditAction.PrivacyClientErasureReswept);
    expect(reswept).toEqual([
      expect.objectContaining({
        auditOperationId: OP_RESWEEP,
        // The census BEFORE the sweep: the one note.
        erasureNoteCount: 1,
      }),
    ]);

    // A replay of that act after another note: swept, no second row.
    await db.doc(notePath).set(staffNote);
    expect((await erase(p(), OP_RESWEEP)).ok).toBe(true);
    expect(await docData(notePath)).toBeUndefined();
    expect(
      await rowsOf(p(), AuditAction.PrivacyClientErasureReswept),
    ).toHaveLength(1);
    // Nothing left to sweep: a new act writes nothing.
    const quiet = await everything();
    expect((await erase(p(), OP_SECOND)).ok).toBe(true);
    expect(await everything()).toEqual(quiet);
    // No value of P is left but on the sibling S — its own act's (case (1)).
    const documents = new Map(await allDocuments());
    documents.delete(`${Collections.Customers}/${sibling()}`);
    expect(leaks(documents, P_VALUES)).toEqual([]);
  }, 60_000);

  // ── (6) never the wrong account ───────────────────────────────────────

  it('(6) never the wrong account: a staff account by its Auth claim alone, and a record whose link fails D29 — refused, nothing touched', async () => {
    // A record naming P's uid on an id `forUser` never derives from it.
    const record = world.state.records.find((stored) => stored.id === p());
    if (record === undefined) throw new Error('the world holds no P record');
    await db
      .doc(`${Collections.Customers}/${CORRUPT}`)
      .set({ ...bodyOf(record), userId: u() });
    const before = await everything();

    // L: the staff uid holds no `users` document — its Auth claim refuses it.
    expect(await erase(staffLinked(), OP_WRONG)).toEqual({
      ok: false,
      error: { errorCode: PrivacyErrorCode.ErasureStaffAccount },
    });
    expect(
      await previewClientErasure(erasePorts())(
        command(staffLinked(), OP_WRONG),
      ),
    ).toEqual({
      ok: false,
      error: { errorCode: PrivacyErrorCode.ErasureStaffAccount },
    });
    expect(await authCodeOf(STAFF_UID)).toBe('present');

    // The corrupt link: refused before any read keyed by the uid.
    const real = erasePorts();
    const uidKeyed = {
      loadProfile: vi.fn(real.loadProfile),
      loadAuthRoles: vi.fn(real.loadAuthRoles),
      listAccountNotifications: vi.fn(real.listAccountNotifications),
      listAccountWaitlist: vi.fn(real.listAccountWaitlist),
      listAccountInvitations: vi.fn(real.listAccountInvitations),
      listAccountSessions: vi.fn(real.listAccountSessions),
      deleteAuthUser: vi.fn(real.deleteAuthUser),
      deleteStoredPrefix: vi.fn(real.deleteStoredPrefix),
    };
    expect(await erase(CORRUPT, OP_WRONG, unbounded, uidKeyed)).toEqual({
      ok: false,
      error: { errorCode: PrivacyErrorCode.AccountLinkMismatch },
    });
    for (const [name, port] of Object.entries(uidKeyed)) {
      expect(port, name).not.toHaveBeenCalled();
    }
    expect(await authCodeOf(u())).toBe('present');
    expect(await everything()).toEqual(before);
  }, 60_000);

  // ── (5) no later writer resurrects the person ─────────────────────────

  it('(5) no later writer resurrects P or W — the bookings and the edit refuse, the registration and the profile find nobody; a sign-in with P’s freed phone is a NEW account', async () => {
    await eraseUntilDone(p(), OP);
    await eraseUntilDone(walkIn(), OP_WALK_IN);
    // A guest-only visit the desk booked — the edit below adds W to it.
    const guestVisit = await deskBooking(
      deskCall(
        GUEST_VISIT,
        [
          deskSeat(
            'draft-guest-only',
            750,
            BookingCall.staffGuestSubject('Гост 3', null),
          ),
        ],
        null,
      ),
    );
    expect(guestVisit.ok).toBe(true);
    const before = await allDocuments();

    // P books for themself: P's record is under erasure.
    const self: BookAppointmentCommand = {
      locationId: FIXTURE_IDS.location,
      localDate: THURSDAY,
      seats: [
        {
          lineId: 'line-self',
          serviceId: FIXTURE_IDS.service,
          variantId: null,
          barberId: FIXTURE_IDS.barber,
          barberPreference: null,
          startMinutes: 840,
          subject: { requestedSubjectRole: RequestedSubjectRole.Self },
        },
      ],
      attemptId: AppointmentId.of('attempt-p-again-0001'),
      operationId: OperationId.of('attempt-p-again-0001'),
      bookedFromAppointmentId: null,
      contact: null,
      ownerUserId: u(),
      staffPlacement: false,
      actor: Actor.user(u()),
    };
    expect(await bookAppointment(bookingPorts())(self)).toEqual({
      ok: false,
      error: { errorCode: BookingErrorCode.ClientErased },
    });

    // The desk books a walk-in with W's erased phone.
    expect(
      await deskBooking(
        deskCall(
          'attempt-walkin-again-0001',
          [deskSeat('draft-w-again', 900, wGuest())],
          W_CONTACT,
        ),
      ),
    ).toEqual({
      ok: false,
      error: { errorCode: BookingErrorCode.ClientErased },
    });

    // The desk adds a walk-in with W's erased phone to the guest's visit.
    const label = SeatLabel.parse(WALK_IN_SENTINELS.label);
    if (!label.ok) throw new Error('a broken walk-in label');
    const telemetry = consoleTelemetry();
    const edited = await editAppointment({
      ...bookingPorts(),
      ...firestoreCouponPorts(db),
      ...telemetry,
    })({
      appointmentId: AppointmentId.of(GUEST_VISIT),
      actorRoles: [Role.Receptionist],
      commands: [
        {
          editCommand: EditCommand.AddSeat,
          seatId: SeatId.of('seat-w-again'),
          serviceId: FIXTURE_IDS.service,
          variantId: null,
          barberId: FIXTURE_IDS.barber,
          localDate: THURSDAY,
          startMinutes: unwrapOk(MinuteOfDay.of(780)),
          durationMinutes: duration(30),
          addedSubject: {
            requestedSubjectRole: RequestedSubjectRole.Guest,
            label: label.value,
            contact: { phone: WALK_IN_SENTINELS.phone, email: null },
          },
        },
      ],
      acknowledgedOverlap: false,
      expectedVersion: null,
      operationId: OperationId.of('edit-operation-walkin01'),
      actor: Actor.staff(UserId.of('u-privacy-desk'), [Role.Receptionist]),
    });
    expect(edited).toEqual({
      ok: false,
      error: { errorCode: BookingErrorCode.ClientErased },
    });

    // P's registration finds nobody by P's cleared contact.
    const identity = {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      hash: fixtureHash,
      ...firestoreUserPorts(db),
      ...singleTenantPorts(TenantId.of('creativo')),
      ...authClaimsPorts(auth),
      ...otpCrypto,
      authDeployment: AuthDeployment.DEFAULT,
      ...telemetry,
    };
    const registered = await completeRegistration(identity)({
      callerUserId: u(),
      identifierChannel: IdentifierChannel.Phone,
      rawIdentifier: PRIVACY_SENTINELS.phone,
      fields: {
        ...Registration.emptyFields(),
        firstName: PRIVACY_SENTINELS.name,
        lastName: PRIVACY_SENTINELS.lastName,
      },
      operationId: null,
    });
    expect(!registered.ok && registered.error.errorCode).toBe(
      IdentityErrorCode.RegistrationUserNotFound,
    );
    // P's live token edits the profile: the erased account is not found.
    expect(
      await updateProfile(identity)({
        callerUserId: u(),
        edits: {
          firstName: PRIVACY_SENTINELS.name,
          lastName: null,
          birthDate: null,
        },
        operationId: null,
      }),
    ).toEqual({
      ok: false,
      error: { errorCode: AccountsErrorCode.UpdateProfileNotFound },
    });
    // Nothing was written by any of them.
    expect(await allDocuments()).toEqual(before);

    // A sign-in with P's freed phone: a NEW uid and a NEW stub.
    const otp = otpFixture({
      id: OtpId.of('otp-p-again'),
      destination: Identifier.of(PRIVACY_SENTINELS.phone),
      otpDestinationType: OtpDestinationType.Sms,
      salt: SALT,
      codeHash: otpCrypto.otpCrypto.hashCode(CODE, SALT),
    });
    await db
      .doc(`${Collections.Otps}/${otp.id}`)
      .set(withPurgeAt([Collections.Otps, otp.id], bodyOf(otp)));
    const signedIn = await verifyOtp(identity)({
      otpId: otp.id,
      code: CODE,
      operationId: null,
    });
    if (!signedIn.ok) {
      throw new Error(`the sign-in must answer: ${signedIn.error.errorCode}`);
    }
    const fresh = UserId.of(uidOf(signedIn.value.customToken));
    expect(fresh).not.toBe(u());
    expect(await docData(`${Collections.Users}/${fresh}`)).toMatchObject({
      registrationState: RegistrationState.Provisioned,
      phone: PRIVACY_SENTINELS.phone,
    });
    expect(canonical(await docData(`${Collections.Users}/${u()}`))).toBe(
      before.get(`${Collections.Users}/${u()}`),
    );
    expect(CustomerId.forUser(fresh, fixtureHash)).not.toBe(p());
    expect(canonical(await docData(`${Collections.Customers}/${p()}`))).toBe(
      before.get(`${Collections.Customers}/${p()}`),
    );
  }, 60_000);
});
