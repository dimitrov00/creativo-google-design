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
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  Actor,
  AuditAction,
  AuditTarget,
  BookingCall,
  ClientPrivacyCall,
  FlagName,
  Placement,
  PrivacyMarker,
  Role,
  SeatSubject,
  WriteAction,
  type WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  CartLineId,
  ClientOperationId,
  ClientMoneyStatsId,
  CustomerId,
  LocationId,
  LogEvent,
  MinuteOfDay,
  OperationId,
  Result,
  ServiceId,
} from '@core/primitives';
import { PrivacyErrorCode } from '@core/errors';
import {
  type Appointment,
  Collections,
  type JournalEntry,
  Subcollections,
} from '@core/entities';
import {
  AuditSystem,
  ClientExportSystem,
  EXPORT_MAX_DOCUMENTS,
  StoredDocumentSystem,
} from '@core/systems';
import {
  bookAppointment,
  type ExportClientDataPorts,
  exportClientData,
} from '@core/pipelines';
import {
  barberFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  locationFixture,
  OTHER_SENTINELS,
  pinnedNowUtcMs,
  PRIVACY_SENTINELS,
  privacyWorld,
  serviceFixture,
  unwrapOk,
  WALK_IN_SENTINELS,
} from '@core/testing';
import { consoleTelemetry } from '../adapters/console-telemetry.adapter';
import {
  hmacSha256Hex,
  sha256Hex,
  walkInKeyPorts,
} from '../adapters/crypto.adapter';
import { firestoreAccountPorts } from '../adapters/firestore-accounts.adapter';
import { firestoreAuditReadPorts } from '../adapters/firestore-audit-read.adapter';
import { firestoreJobPorts } from '../adapters/firestore-jobs.adapter';
import { firestorePrivacyPorts } from '../adapters/firestore-privacy.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { decodeCommitBooking } from '../wire/booking.wire';

/**
 * The admin's data-subject export against the REAL Firestore emulator
 * (audit-hardening Phase 3, WS-C — the export proof, plan §4 PC3): the
 * `exportClientData` pipeline over the functions' own adapters (the
 * footprint reads, the audit timelines, the stored roles, the commit), the
 * clock pinned, the walk-in key the emulator's `.secret.local` would hold.
 *
 * The seed is the privacy world of `@core/testing` — person P (an account
 * and its record, a solo visit with a note and a shot photo, a place on
 * Q's party with Q's contact, Q's walk-in companion's label, Q's note and a
 * line of Q's gift voucher, a LIBRARY photo naming P on that party, money,
 * loyalty, statistics, the journal, the inbox, a waitlist request, an
 * invitation, audit rows filed against P and against Q), person Q, and
 * walk-in W — a walk-in-only record whose party `[WALK_IN W, ANONYMOUS]`
 * is booked HERE through the staff request the desk sends
 * (the `BookingCall` the staff sheet sends → the `commitBooking` wire →
 * `bookAppointment`), so its contact is W's sentinel phone and W's record
 * the one the booking keyed. Every personal value is a SENTINEL, so a scan
 * of the bundle, the rows and the log lines proves absence by search.
 *
 * Proved: (1) every section of the plan's §0.4 "export?" column holds
 * exactly P's documents — the library photo on Q's party included, no
 * `url` — and W's export carries W's own contact on W's party (the
 * keyed-hash arm); (2) nothing of Q leaves, and no voucher `code` at all;
 * (3) the bytes are deterministic — the same operation twice, two
 * operations once their own rows are set aside, a store seeded in another
 * order; (4) exactly one `PRIVACY_CLIENT_EXPORTED` row per operation
 * (counts only, the admin, P's record), never inside its own bundle, a
 * replay adding none; (5) the log lines hold no sentinel and no part of
 * the bundle; (6) a person past the cap is refused through the real
 * adapters, no row written.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-export-client-data';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** The emulator app's Firestore, handed to the composition root at the Admin SDK seam. */
const seam = vi.hoisted(() => ({ db: null as Firestore | null }));

vi.mock('../lib/firebase-admin', () => ({
  adminFirestore: () => {
    if (seam.db === null) throw new Error('the emulator app is not up yet');
    return seam.db;
  },
  adminAuth: () => ({}),
}));

import * as main from '../main';

/** A deployed function's `run` — what the platform (and a spec) invokes. */
type Runnable = { readonly run: (request: unknown) => Promise<unknown> };

/** The walk-in key, as the emulator's `.secret.local` holds one (OR-26). */
const WALKIN_KEY = 'walkin-integration-key';
const walkInHash = (input: string): string => hmacSha256Hex(WALKIN_KEY, input);

/** Thursday of the week the pinned Monday 09:00 opens — W's party. */
const THURSDAY = localDate('2026-10-01');
/** W's party's attempt id — the staff sheet mints one per act. */
const W_ATTEMPT = 'attempt-walkin-party-0001';

const OP_ONE = OperationId.of('export-operation-000001');
const OP_TWO = OperationId.of('export-operation-000002');

const ADMIN_ROLES: readonly Role[] = [Role.Admin];

type Data = Record<string, unknown>;

function bodyOf(entity: { readonly id: string }): Data {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** The world's documents at their stored paths, in a fixed order. */
function worldDocuments(
  world: ReturnType<typeof privacyWorld>,
): readonly (readonly [string, Data])[] {
  const docs: (readonly [string, Data])[] = [];
  const put = (path: string, entity: { readonly id: string }) =>
    docs.push([`${path}/${entity.id}`, bodyOf(entity)]);
  // W comes from the staff booking below, keyed by THIS key: the world's
  // fixture-keyed W record and W visits stay out.
  const walkInIds = new Set<string>([world.walkIn.customerId]);
  for (const record of world.state.records) {
    if (!walkInIds.has(record.id)) put(Collections.Customers, record);
  }
  for (const user of world.state.users) put(Collections.Users, user);
  for (const visit of [world.visits.solo, world.visits.party]) {
    put(Collections.Appointments, visit);
  }
  for (const note of world.state.notes) put(Collections.AppointmentNotes, note);
  for (const photo of world.state.photos) {
    put(Collections.AppointmentPhotos, photo);
  }
  for (const grant of world.state.grants) put(Collections.CouponGrants, grant);
  for (const voucher of world.state.vouchers) {
    put(Collections.GiftVouchers, voucher);
  }
  for (const entry of world.state.journal)
    put(Collections.ClientJournal, entry);
  for (const [userId, inbox] of world.state.notifications) {
    for (const notification of inbox) {
      put(
        `${Collections.Users}/${userId}/${Subcollections.Notifications}`,
        notification,
      );
    }
  }
  for (const request of world.state.waitlist) {
    put(Collections.WaitlistRequests, request);
  }
  for (const invitation of world.state.invitations) {
    put(Collections.Invitations, invitation);
  }
  for (const [customerId, account] of world.loyalty.accounts) {
    put(Collections.LoyaltyAccounts, account);
    for (const progress of world.loyalty.badgeProgress.get(customerId) ?? []) {
      put(
        `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.BadgeProgress}`,
        progress,
      );
    }
    for (const progress of world.loyalty.seasonProgress.get(customerId) ?? []) {
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
  // The admin's STORED roles — the pipeline re-reads them (P3-RU-13); the
  // sysadmin's say `sysadmin`.
  docs.push([`${Collections.Users}/${world.admin}`, { roles: ['admin'] }]);
  docs.push([
    `${Collections.Users}/${world.sysadmin}`,
    { roles: ['sysadmin'] },
  ]);
  // The catalogue W's party is booked on.
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

/**
 * The call the staff sheet sends for `[W, a guest with no contact]` and no
 * account (`StaffEditPlanSystem.bookingRequest`'s shape, built by the call
 * component's own builders): two seats back to back, the first a walk-in
 * guest with W's phone, the second a guest by label alone; the visit's
 * contact is the FIRST walk-in's.
 */
function walkInPartyCall(): BookingCall {
  const seat = (
    lineId: string,
    startMinutes: number,
    subject: BookingCall.Subject,
  ): BookingCall.Seat =>
    BookingCall.seat(
      CartLineId.of(lineId),
      ServiceId.of(FIXTURE_IDS.service),
      null,
      BarberId.of(FIXTURE_IDS.barber),
      null,
      unwrapOk(MinuteOfDay.of(startMinutes)),
      subject,
    );
  return {
    locationId: LocationId.of(FIXTURE_IDS.location),
    localDate: THURSDAY,
    seats: [
      seat(
        'draft-w',
        600,
        BookingCall.staffGuestSubject(
          WALK_IN_SENTINELS.label,
          BookingCall.guestContact(WALK_IN_SENTINELS.phone, null),
        ),
      ),
      seat('draft-guest', 630, BookingCall.staffGuestSubject('Гост 2', null)),
    ],
    attemptId: unwrapOk(ClientOperationId.parse(W_ATTEMPT)),
    contact: {
      name: WALK_IN_SENTINELS.label,
      phone: WALK_IN_SENTINELS.phone,
      email: null,
      note: null,
    },
    bookedFromAppointmentId: null,
    placement: Placement.Staff,
    onBehalfOfUserId: null,
  };
}

/** The bundle as parsed back — a record of sections, each an array of stored documents. */
type Bundle = { readonly [section: string]: unknown };

const sectionIds = (bundle: Bundle, section: string): readonly string[] =>
  (Reflect.get(bundle, section) as readonly { readonly id: string }[]).map(
    (document) => document.id,
  );

/** Every personal value of P that must never reach a row or a log line. */
const PERSON_VALUES: readonly string[] = [
  PRIVACY_SENTINELS.name,
  PRIVACY_SENTINELS.lastName,
  PRIVACY_SENTINELS.phone,
  PRIVACY_SENTINELS.phone.replace('+', ''),
  PRIVACY_SENTINELS.email,
  PRIVACY_SENTINELS.note,
  PRIVACY_SENTINELS.contactNote,
  PRIVACY_SENTINELS.label,
  PRIVACY_SENTINELS.voucherCode,
  PRIVACY_SENTINELS.shotUrl,
  PRIVACY_SENTINELS.libraryUrl,
];

/** Every value of Q — none may reach P's bundle. */
const OTHER_VALUES: readonly string[] = [
  OTHER_SENTINELS.name,
  OTHER_SENTINELS.phone,
  OTHER_SENTINELS.phone.replace('+', ''),
  OTHER_SENTINELS.email,
  OTHER_SENTINELS.note,
  OTHER_SENTINELS.contactNote,
  OTHER_SENTINELS.label,
  OTHER_SENTINELS.guestLabel,
  OTHER_SENTINELS.voucherCode,
  OTHER_SENTINELS.url,
];

/**
 * Q's own documents (and the row where P only acted on Q) — none may reach
 * P's bundle. Q's voucher is not listed: its id stays on the party's
 * redemption line, an opaque id already on the shared visit (P3-RU-18) —
 * its document and its `code` never leave.
 */
const OTHER_DOCUMENT_IDS: readonly string[] = [
  'grant-q',
  'wl-q',
  'inv-q',
  'note-q-1',
  'row-q-record',
  'row-p-acts-on-q',
  'photo-q-shot',
  'photo-party-nobody',
];

describe('exportClientData (emulator)', () => {
  let db: Firestore;
  let world: ReturnType<typeof privacyWorld>;
  const lines: unknown[][] = [];

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
    seam.db = db;
  });

  afterAll(async () => {
    seam.db = null;
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Wipes the store and seeds the world — forward, or in the reverse order. */
  async function seed(order: 'forward' | 'reverse'): Promise<void> {
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const docs = worldDocuments(world);
    for (const [path, body] of order === 'forward'
      ? docs
      : [...docs].reverse()) {
      await db.doc(path).set(body);
    }
    await bookWalkInParty();
  }

  /** W's party, as the desk books it: the staff request through the `commitBooking` wire. */
  async function bookWalkInParty(): Promise<void> {
    // Through the wire, as the platform hands it over: JSON.
    const payload: unknown = JSON.parse(JSON.stringify(walkInPartyCall()));
    const command = decodeCommitBooking({
      data: payload,
      auth: { uid: 'u-privacy-desk', token: { roles: ['receptionist'] } },
    });
    if (!command.ok) {
      throw new Error(
        `the desk's call must decode: ${command.error.errorCode}`,
      );
    }
    const telemetry = consoleTelemetry();
    let minted = 0;
    const booked = await bookAppointment({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => `walkin-id-${++minted}`,
      hash: sha256Hex,
      ...walkInKeyPorts(() => WALKIN_KEY),
      ...firestoreSettingsPorts(db),
      ...firestoreAccountPorts(db),
      ...telemetry,
    })(command.value);
    if (!booked.ok) {
      throw new Error(`W's party must book: ${booked.error.errorCode}`);
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
    await seed('forward');
  });

  /** The pipeline's ports — the functions' own adapters over the emulator, the clock pinned. */
  function ports(): ExportClientDataPorts {
    const telemetry = consoleTelemetry();
    return {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      hash: sha256Hex,
      ...walkInKeyPorts(() => WALKIN_KEY),
      ...firestoreJobPorts(db, StoredDocumentSystem.guardOf, telemetry.log),
      flagOn: (key) => key === FlagName.ClientPrivacy,
      ...firestorePrivacyPorts(db, StoredDocumentSystem.guardOf, telemetry.log),
      ...firestoreAuditReadPorts(db),
      ...telemetry,
    };
  }

  const exportOf = (
    customerId: CustomerId,
    operationId: OperationId,
    over: Partial<ExportClientDataPorts> = {},
  ) =>
    exportClientData({ ...ports(), ...over })({
      callerUserId: world.admin,
      callerRoles: ADMIN_ROLES,
      customerId,
      operationId,
    });

  async function exported(
    customerId: CustomerId,
    operationId: OperationId,
  ): Promise<ClientPrivacyCall.Exported> {
    const answer = await exportOf(customerId, operationId);
    if (!answer.ok) {
      throw new Error(`the export must answer: ${answer.error.errorCode}`);
    }
    return answer.value;
  }

  const bundleOf = (answer: ClientPrivacyCall.Exported): Bundle =>
    JSON.parse(answer.exportJson) as Bundle;

  /** The bundle with every `PRIVACY_CLIENT_EXPORTED` row and the instant set aside. */
  const withoutOwnRows = (answer: ClientPrivacyCall.Exported): Bundle => {
    const bundle = bundleOf(answer);
    const rows = Reflect.get(bundle, 'auditLog') as readonly Data[];
    return {
      ...bundle,
      auditLog: rows.filter(
        (row) => row['auditAction'] !== AuditAction.PrivacyClientExported,
      ),
    };
  };

  const auditRows = async (): Promise<readonly Data[]> =>
    (await db.collection(Collections.AuditLog).get()).docs.map((row) => ({
      id: row.id,
      ...row.data(),
    }));

  const exportRows = async (): Promise<readonly Data[]> =>
    (await auditRows()).filter(
      (row) => row['auditAction'] === AuditAction.PrivacyClientExported,
    );

  /** The id of the row an operation's export plans — known before any read. */
  const rowIdOf = (customerId: CustomerId, operationId: OperationId) =>
    AuditEntryId.of(
      sha256Hex(ClientExportSystem.rowIdBasis(customerId, operationId)),
    );

  it('(1) holds every section with exactly P’s documents — the library photo on Q’s party included, no url', async () => {
    const p = world.person.customerId;
    const u = world.person.userId;
    const answer = await exported(p, OP_ONE);
    const bundle = bundleOf(answer);
    const byId = (ids: readonly string[]) => [...ids].sort();

    expect(bundle['clientExportVersion']).toBe(
      ClientPrivacyCall.EXPORT_VERSION,
    );
    expect(bundle['exportedCustomerId']).toBe(p);
    expect(bundle['exportedUserId']).toBe(u);
    expect(bundle['exportedAtUtcMs']).toBe(FIXTURE_NOW_UTC_MS);
    expect(sectionIds(bundle, 'customers')).toEqual([p]);
    expect(sectionIds(bundle, 'users')).toEqual([u]);
    // Newest first: Q's party (5 days ago), then P's solo visit (10).
    expect(sectionIds(bundle, 'appointments')).toEqual([
      world.visits.party.id,
      world.visits.solo.id,
    ]);
    // The party's note is withheld (P3-RU-33).
    expect(sectionIds(bundle, 'appointmentNotes')).toEqual([
      world.visits.solo.id,
    ]);
    expect(sectionIds(bundle, 'appointmentPhotos')).toEqual([
      'photo-p-library',
      'photo-p-nobody',
      'photo-p-shot',
    ]);
    for (const photo of Reflect.get(bundle, 'appointmentPhotos') as Data[]) {
      expect(photo).not.toHaveProperty('url');
    }
    expect(sectionIds(bundle, 'giftVouchers')).toEqual(['voucher-p']);
    expect(sectionIds(bundle, 'couponGrants')).toEqual(['grant-p']);
    expect(sectionIds(bundle, 'loyaltyAccounts')).toEqual([p]);
    expect(sectionIds(bundle, 'badgeProgress')).toEqual(
      byId((world.loyalty.badgeProgress.get(p) ?? []).map((b) => b.id)),
    );
    expect(sectionIds(bundle, 'seasonProgress')).toEqual(
      byId((world.loyalty.seasonProgress.get(p) ?? []).map((s) => s.id)),
    );
    expect(sectionIds(bundle, 'clientStats')).toEqual([p]);
    expect(sectionIds(bundle, 'clientMoney')).toEqual([
      ClientMoneyStatsId.FIXED,
    ]);
    expect(sectionIds(bundle, 'clientJournal')).toEqual(
      byId(
        world.state.journal
          .filter((entry: JournalEntry) => entry.customerId === p)
          .map((entry) => entry.id),
      ),
    );
    expect(sectionIds(bundle, 'notifications')).toEqual(['note-p-1']);
    expect(sectionIds(bundle, 'waitlistRequests')).toEqual(['wl-p']);
    expect(sectionIds(bundle, 'invitations')).toEqual(['inv-p']);
    // Filed against the record or the account, oldest first.
    expect(sectionIds(bundle, 'auditLog')).toEqual([
      'row-p-record',
      'row-p-account',
      'row-p-party',
    ]);
    // The documents as stored, but for the redactions.
    expect(Reflect.get(bundle, 'customers')).toEqual([
      JSON.parse(
        JSON.stringify(world.state.records.find((record) => record.id === p)),
      ),
    ]);
    // The counts the answer carries are the bundle's own.
    const documents = Object.values(bundle).filter(Array.isArray).flat();
    expect(answer.exportDocumentCount).toBe(documents.length);
    expect(answer.exportByteCount).toBe(
      Buffer.byteLength(answer.exportJson, 'utf8'),
    );
  });

  it('(1) exports W’s own contact on W’s party — the visit contact derives W’s record (the keyed-hash arm)', async () => {
    const booked = (
      await db.doc(`${Collections.Appointments}/${W_ATTEMPT}`).get()
    ).data() as Omit<Appointment, 'id'>;
    const [w] = booked.subjectCustomerIds;
    if (w === undefined) throw new Error('the desk seated nobody');
    // The record the desk's booking keyed, by W's phone under the key.
    expect(w).toBe(CustomerId.forWalkIn(WALK_IN_SENTINELS.phone, walkInHash));
    expect(booked.ownerCustomerId).toBeNull();
    expect(booked.seats.map((seat) => seat.seatSubject)).toEqual([
      SeatSubject.WalkIn,
      SeatSubject.Anonymous,
    ]);
    expect(booked.contactPhone).toBe(WALK_IN_SENTINELS.phone);

    const bundle = bundleOf(await exported(w, OP_ONE));
    expect(bundle['exportedUserId']).toBeNull();
    expect(sectionIds(bundle, 'users')).toEqual([]);
    expect(sectionIds(bundle, 'appointments')).toEqual([W_ATTEMPT]);
    const [party] = Reflect.get(bundle, 'appointments') as Data[];
    expect(party).toMatchObject({
      contactName: WALK_IN_SENTINELS.label,
      contactPhone: WALK_IN_SENTINELS.phone,
    });
    // W's own seat keeps its label; the guest's is a marker.
    const seats = party?.['seats'] as readonly Data[];
    expect(seats.map((seat) => seat['guestLabel'])).toEqual([
      WALK_IN_SENTINELS.label,
      PrivacyMarker.seatLabel(1),
    ]);
  });

  it('(2) holds nothing of Q — no value, no document, no own row, no note, no voucher code; the party’s other labels are markers and its contact NONE', async () => {
    const answer = await exported(world.person.customerId, OP_ONE);
    for (const value of [
      ...OTHER_VALUES,
      ...OTHER_DOCUMENT_IDS,
      PRIVACY_SENTINELS.voucherCode,
      PRIVACY_SENTINELS.shotUrl,
      PRIVACY_SENTINELS.libraryUrl,
    ]) {
      expect(answer.exportJson, value).not.toContain(value);
    }
    expect(answer.exportJson).not.toContain('"code"');
    expect(answer.exportJson).not.toContain('"url"');

    const appointments = Reflect.get(
      bundleOf(answer),
      'appointments',
    ) as readonly Data[];
    const party = appointments.find(
      (visit) => visit['id'] === world.visits.party.id,
    );
    expect(party).toMatchObject({
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      contactNote: null,
    });
    const labels = (party?.['seats'] as readonly Data[])
      .map((seat) => seat['guestLabel'])
      .filter((label): label is string => typeof label === 'string');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels)
      expect(PrivacyMarker.isMarker(label)).toBe(true);
    // P's own solo visit keeps P's contact — the person's own data.
    const solo = appointments.find(
      (visit) => visit['id'] === world.visits.solo.id,
    );
    expect(solo).toMatchObject({ contactPhone: PRIVACY_SENTINELS.phone });
  });

  it('(3) answers deterministic bytes: one operation twice, two operations once their own rows are set aside, and a store seeded in another order', async () => {
    const p = world.person.customerId;
    const first = await exported(p, OP_ONE);
    const again = await exported(p, OP_ONE);
    expect(again.exportJson).toBe(first.exportJson);

    const other = await exported(p, OP_TWO);
    // The second operation sees the first one's row — set both aside.
    expect(other.exportJson).not.toBe(first.exportJson);
    expect(JSON.stringify(withoutOwnRows(other))).toBe(
      JSON.stringify(withoutOwnRows(first)),
    );

    await seed('reverse');
    const reseeded = await exported(p, OP_ONE);
    expect(reseeded.exportJson).toBe(first.exportJson);
  });

  it('(4) writes ONE PRIVACY_CLIENT_EXPORTED row per operation — the admin, P’s record, counts only — never inside its own bundle; a replay adds none', async () => {
    const p = world.person.customerId;
    const before = (await auditRows()).length;
    const answer = await exported(p, OP_ONE);
    const rows = await exportRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // Exactly the row the system plans for this act, at the id it keys.
    const [planned] = AuditSystem.createsOf(
      [
        ClientExportSystem.planClientExported(
          p,
          {
            documentCount: answer.exportDocumentCount,
            auditRowCount: 3,
            byteCount: answer.exportByteCount,
          },
          Actor.forCaller(world.admin, ADMIN_ROLES),
          OP_ONE,
          FIXTURE_NOW_UTC_MS,
        ),
      ],
      sha256Hex,
    );
    expect(planned?.writeAction).toBe(WriteAction.Create);
    expect(row).toEqual({
      id: rowIdOf(p, OP_ONE),
      ...(planned as WriteOp.Create).body,
    });
    expect(row).toMatchObject({
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      resourceId: `${Collections.Customers}/${p}`,
      auditOperationId: OP_ONE,
      ...Actor.forCaller(world.admin, ADMIN_ROLES),
      auditAction: AuditAction.PrivacyClientExported,
      exportDocumentCount: answer.exportDocumentCount,
      exportAuditRowCount: 3,
      exportByteCount: answer.exportByteCount,
      auditTarget: AuditTarget.Customer,
      targetCustomerId: p,
    });
    expect(answer.exportJson).not.toContain(rowIdOf(p, OP_ONE));
    for (const value of PERSON_VALUES) {
      expect(JSON.stringify(row), value).not.toContain(value);
    }

    const replay = await exported(p, OP_ONE);
    expect(replay.exportJson).toBe(answer.exportJson);
    expect(await exportRows()).toHaveLength(1);
    expect((await auditRows()).length).toBe(before + 1);
  });

  it('(5) logs counts and ids only — no sentinel and no part of the bundle reaches a log line', async () => {
    const p = world.person.customerId;
    lines.length = 0;
    const answer = await exported(p, OP_ONE);
    const logged = lines.filter(
      ([msg]) => msg === LogEvent.PrivacyClientExported,
    );
    expect(logged).toEqual([
      [
        LogEvent.PrivacyClientExported,
        {
          customerId: p,
          exportDocumentCount: answer.exportDocumentCount,
          exportByteCount: answer.exportByteCount,
        },
      ],
    ]);
    const text = JSON.stringify(lines);
    for (const value of PERSON_VALUES) {
      expect(text, value).not.toContain(value);
    }
    expect(text).not.toContain('appointmentNotes');
    expect(text).not.toContain(answer.exportJson.slice(0, 40));
  });

  it('(5) through the deployed export: the outcome line names the act, and no line holds a sentinel or the bundle', async () => {
    vi.stubEnv('LOG_DIGEST_KEY', 'export-log-digest-key');
    vi.stubEnv('WALKIN_ID_KEY', WALKIN_KEY);
    vi.stubEnv('CLIENT_PRIVACY', 'true');
    const p = world.person.customerId;
    lines.length = 0;
    const answer = (await (main.exportClientData as unknown as Runnable).run({
      data: { customerId: p, operationId: OP_ONE },
      auth: { uid: world.admin, token: { roles: ['admin'] } },
      rawRequest: {},
      acceptsStreaming: false,
    })) as ClientPrivacyCall.Exported;
    expect(answer.exportedCustomerId).toBe(p);
    expect(ClientPrivacyCall.decodeExported(answer).ok).toBe(true);
    expect(lines.filter(([msg]) => msg === LogEvent.CallableCompleted)).toEqual(
      [
        [
          LogEvent.CallableCompleted,
          expect.objectContaining({
            callable: 'exportClientData',
            operationId: OP_ONE,
            uid: world.admin,
            errorCode: null,
            wireStatus: 'ok',
          }),
        ],
      ],
    );
    const text = JSON.stringify(lines);
    for (const value of PERSON_VALUES) {
      expect(text, value).not.toContain(value);
    }
    expect(text).not.toContain('appointmentNotes');
    expect(text).not.toContain(answer.exportJson.slice(0, 40));
  });

  it('(6) refuses a person past the cap through the real adapters — PRIVACY_EXPORT_TOO_LARGE, no row, no bundle', async () => {
    const p = world.person.customerId;
    const [entry] = world.state.journal;
    if (entry === undefined) throw new Error('the world holds no journal');
    const before = await auditRows();
    // The footprint double: the record's journal past the cap.
    const answer = await exportOf(p, OP_ONE, {
      listClientJournal: async () =>
        Result.ok(
          Array.from(
            { length: EXPORT_MAX_DOCUMENTS + 1 },
            (_, i): JournalEntry => ({
              ...entry,
              id: `${p}_${String(i).padStart(6, '0')}` as JournalEntry['id'],
              customerId: p,
            }),
          ),
        ),
    });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.errorCode).toBe(PrivacyErrorCode.ExportTooLarge);
    expect(await auditRows()).toEqual(before);
    expect(await exportRows()).toEqual([]);
  });

  it('refuses the sysadmin by the STORED roles — nothing read of the person, no row', async () => {
    const answer = await exportClientData(ports())({
      callerUserId: world.sysadmin,
      // A claim the stored account no longer backs.
      callerRoles: ADMIN_ROLES,
      customerId: world.person.customerId,
      operationId: OP_ONE,
    });
    expect(answer).toEqual({
      ok: false,
      error: { errorCode: PrivacyErrorCode.Forbidden },
    });
    expect(await exportRows()).toEqual([]);
  });

  it('answers an unknown record PRIVACY_CLIENT_NOT_FOUND, no row', async () => {
    const answer = await exportOf(CustomerId.of('cus-nobody'), OP_ONE);
    expect(answer).toEqual({
      ok: false,
      error: { errorCode: PrivacyErrorCode.ClientNotFound },
    });
    expect(await exportRows()).toEqual([]);
  });
});
