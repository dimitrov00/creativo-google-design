import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  AuditTargetRef,
  BarberPreference,
  CancellationReason,
  CustomerOrigin,
  EditCommand,
  MarkArrivalAction,
  RequestedSubjectRole,
  Role,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import {
  AppointmentId,
  AuditResourceId,
  BookingStatus,
  BusyKey,
  ClientOperationId,
  CustomerId,
  LogEvent,
  OperationId,
  type Result,
  UserId,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import { AuditSystem, StoredDocumentSystem } from '@core/systems';
import {
  bookAppointment,
  cancelAppointment,
  editAppointment,
  markArrival,
  recordSeatTip,
  rescheduleAppointment,
  transitionAppointment,
} from '@core/pipelines';
import {
  appointmentFixture,
  at,
  barberFixture,
  barberScheduleFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  locationFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
  seatFixture,
  serviceFixture,
  utcMs,
} from '@core/testing';
import { sha256Hex, walkInKeyPorts } from '../adapters/crypto.adapter';
import { firestoreAccountPorts } from '../adapters/firestore-accounts.adapter';
import { firestoreCouponPorts } from '../adapters/firestore-coupons.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * An act's audit rows COMMIT WITH THE ACT (audit-hardening WS-1, DEP-5),
 * against the REAL Firestore emulator's `firestoreCommitPlan`: for each of
 * the seven booking verbs — book, reschedule, staff edit, client cancel,
 * staff transition, arrival, tip —
 *
 * - a committed act has exactly its rows, each naming the act's operation
 *   (`auditOperationId`, WS-4.4);
 * - a commit that fails — the row's `auditLog/<id>` already there, so its
 *   `Create` meets ALREADY_EXISTS — writes no row and no other document,
 *   and answers `REPOSITORY_ALREADY_EXISTS`;
 * - a replay writes no second row (book / reschedule / edit answer
 *   `replayed`, arrival / tip `unchanged`, cancel / transition refuse).
 *
 * The rows are asserted through their count, `auditAction`, ids derived by
 * `AuditSystem.rowBasis` and the root keys — never a hand-built
 * `AuditContext`, so the widened context factories (WS-2) leave this suite
 * as it is.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-audit-in-commit';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** Thursday and Friday of the week the pinned Monday 09:00 opens. */
const THURSDAY = localDate('2026-10-01');
const FRIDAY = localDate('2026-10-02');
const VISIT = FIXTURE_IDS.appointment;
const VISIT_PATH = `${Collections.Appointments}/${VISIT}`;
const VISIT_RESOURCE = AuditResourceId.forAppointment(VISIT);
const RECEPTION = Actor.staff(UserId.of('u-reception'), [Role.Receptionist]);
const CLIENT = Actor.user(FIXTURE_IDS.client);
/**
 * The client's ONE record (D29), as the server derives it — over the same
 * `sha256Hex` the ports below hash with: the record a first booking creates,
 * the one the seeded visit's seat names, and the one a move re-derives for
 * the caller's `SELF` seat. (`FIXTURE_IDS.customer` is the same derivation
 * over `fixtureHash` — another record for the same account here.)
 */
const CLIENT_CUSTOMER = CustomerId.forUser(FIXTURE_IDS.client, sha256Hex);

/** A client-minted name that `ClientOperationId.parse` admits. */
function clientOperation(raw: string): ClientOperationId {
  const id = ClientOperationId.parse(raw);
  if (!id.ok) throw new Error('a broken fixture');
  return id.value;
}

const BOOK_ATTEMPT = AppointmentId.of('attempt-0123456789abcdef');
const MOVE_ATTEMPT = clientOperation('move-attempt-0123456789');
const EDIT = OperationId.of('edit-operation-0123456789');
const CANCEL = OperationId.of('cancel-operation-0123456789');
const NO_SHOW = OperationId.of('transition-operation-0123456789');
const ARRIVE = OperationId.of('arrive-operation-0123456789');
const TIP = OperationId.of('tip-operation-0123456789');

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** The client's cut with Ivan on Thursday at 10:00 — days outside any cancel window. */
function thursdayVisit(): Appointment {
  return appointmentFixture({
    localDate: THURSDAY,
    utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
    busyKeys: [BusyKey.of(FIXTURE_IDS.barber, THURSDAY)],
    seats: [
      seatFixture({
        occupant: SeatOccupant.account(
          FIXTURE_IDS.client,
          CLIENT_CUSTOMER,
          SubjectRelationship.Self,
        ),
      }),
    ],
    ownerCustomerId: CLIENT_CUSTOMER,
    subjectCustomerIds: [CLIENT_CUSTOMER],
  });
}

/** The client record the visit's seat names (D29), seeded with the visit. */
const CLIENT_RECORD: Record<string, unknown> = {
  userId: FIXTURE_IDS.client,
  displayName: 'Maria Ivanova',
  phone: null,
  email: null,
  searchName: 'maria ivanova',
  searchPrefixes: [],
  createdAtUtcMs: FIXTURE_NOW_UTC_MS,
  customerOrigin: CustomerOrigin.Seed,
};

/** One person's row id for one change — `hash(AuditSystem.rowBasis(…))`, as the planner derives it. */
function rowId(
  action: AuditAction,
  resourceId: AuditResourceId,
  target: CustomerId,
  changeKey: string,
): string {
  return sha256Hex(AuditSystem.rowBasis(action, resourceId, target, changeKey));
}

/** What one act's ONE row must be: its id, its verb, its operation, its actor and its person. */
type ExpectedRow = {
  readonly id: string;
  readonly auditAction: AuditAction;
  readonly auditOperationId: OperationId;
  readonly resourceId: AuditResourceId;
  readonly actor: Actor;
  readonly target: CustomerId;
};

/** One verb under test: the visit it works on, its one call, its row and its replay's answer. */
type VerbCase = {
  readonly verb: string;
  /** Seeded before the act; `null` for a booking, which creates its own. */
  readonly visit: Appointment | null;
  /** The call — the SAME command every time, so a second call is a replay. */
  readonly act: () => Promise<Result<unknown, { readonly errorCode: string }>>;
  readonly row: ExpectedRow;
  /** The replay's answer: the act's own `replayed` / `unchanged`, or a refusal. */
  readonly replayed: (
    answer: Result<unknown, { readonly errorCode: string }>,
  ) => void;
};

describe('audit rows commit with the act (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const writes: readonly (readonly [string, Record<string, unknown>])[] = [
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
      // The account a first booking copies its contact from.
      [
        `${Collections.Users}/${FIXTURE_IDS.client}`,
        {
          firstName: 'Maria',
          lastName: 'Ivanova',
          phone: '+359888123456',
          email: null,
        },
      ],
    ];
    for (const [path, body] of writes) await db.doc(path).set(body);
  });

  /** A stored visit and the client record its seat names — a booking creates its own. */
  async function seedVisit(visit: Appointment): Promise<void> {
    await db.doc(VISIT_PATH).set(bodyOf(visit));
    await db
      .doc(`${Collections.Customers}/${CLIENT_CUSTOMER}`)
      .set(CLIENT_RECORD);
  }

  /** Every port any of the seven verbs takes — each pipeline reads its own bundles. */
  function ports(telemetry = recordingTelemetry()) {
    let minted = 0;
    return {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => `id-${++minted}`,
      hash: sha256Hex,
      // The walk-in key, as the emulator's `.secret.local` holds one (OR-26).
      ...walkInKeyPorts(() => 'walkin-integration-key'),
      ...firestoreSettingsPorts(db),
      ...firestoreCouponPorts(db),
      ...firestoreAccountPorts(db),
      ...telemetry,
    };
  }

  /** Every document of every root collection, by path — "nothing else was written" is this, unchanged. */
  async function everything(): Promise<Readonly<Record<string, unknown>>> {
    const all: Record<string, unknown> = {};
    for (const collection of await db.listCollections()) {
      for (const doc of (await collection.get()).docs) {
        all[doc.ref.path] = doc.data();
      }
    }
    return all;
  }

  async function auditIds(): Promise<readonly string[]> {
    return (await db.collection(Collections.AuditLog).get()).docs
      .map((doc) => doc.id)
      .sort();
  }

  async function expectOnlyRow(row: ExpectedRow): Promise<void> {
    const docs = (await db.collection(Collections.AuditLog).get()).docs;
    expect(docs.map((doc) => doc.id)).toEqual([row.id]);
    expect(docs[0]?.data()).toMatchObject({
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      resourceId: row.resourceId,
      auditAction: row.auditAction,
      auditOperationId: row.auditOperationId,
      ...row.actor,
      ...AuditTargetRef.customer(row.target),
    });
  }

  const replayedTrue = (
    answer: Result<unknown, { readonly errorCode: string }>,
  ): void => {
    expect(answer).toMatchObject({ ok: true, value: { replayed: true } });
  };
  const unchangedTrue = (
    answer: Result<unknown, { readonly errorCode: string }>,
  ): void => {
    expect(answer).toMatchObject({ ok: true, value: { unchanged: true } });
  };
  const refused = (
    answer: Result<unknown, { readonly errorCode: string }>,
  ): void => {
    expect(answer.ok).toBe(false);
    // Refused by the act's own rule — never by meeting its own row.
    expect(!answer.ok && answer.error.errorCode).not.toBe(
      RepositoryErrorCode.AlreadyExists,
    );
  };

  const cases: readonly VerbCase[] = [
    {
      verb: 'book',
      visit: null,
      act: () =>
        bookAppointment(ports())({
          locationId: FIXTURE_IDS.location,
          localDate: THURSDAY,
          seats: [
            {
              lineId: 'line-1',
              serviceId: FIXTURE_IDS.service,
              variantId: null,
              barberId: FIXTURE_IDS.barber,
              barberPreference: BarberPreference.Specific,
              startMinutes: 14 * 60,
              subject: { requestedSubjectRole: RequestedSubjectRole.Self },
            },
          ],
          attemptId: BOOK_ATTEMPT,
          operationId: OperationId.of(BOOK_ATTEMPT),
          bookedFromAppointmentId: null,
          contact: null,
          ownerUserId: FIXTURE_IDS.client,
          staffPlacement: false,
          actor: CLIENT,
        }),
      row: {
        id: rowId(
          AuditAction.BookingCommitted,
          AuditResourceId.forAppointment(BOOK_ATTEMPT),
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.attempt(BOOK_ATTEMPT),
        ),
        auditAction: AuditAction.BookingCommitted,
        auditOperationId: OperationId.of(BOOK_ATTEMPT),
        resourceId: AuditResourceId.forAppointment(BOOK_ATTEMPT),
        actor: CLIENT,
        target: CLIENT_CUSTOMER,
      },
      replayed: replayedTrue,
    },
    {
      verb: 'reschedule',
      visit: thursdayVisit(),
      act: () =>
        rescheduleAppointment(ports())({
          appointmentId: VISIT,
          callerUserId: FIXTURE_IDS.client,
          locationId: FIXTURE_IDS.location,
          localDate: FRIDAY,
          seats: [
            {
              lineId: 'line-1',
              serviceId: FIXTURE_IDS.service,
              variantId: null,
              barberId: FIXTURE_IDS.barber,
              barberPreference: null,
              startMinutes: 14 * 60,
              subject: { requestedSubjectRole: RequestedSubjectRole.Self },
            },
          ],
          attemptId: MOVE_ATTEMPT,
          operationId: OperationId.of(MOVE_ATTEMPT),
          actor: CLIENT,
        }),
      row: {
        id: rowId(
          AuditAction.BookingRescheduled,
          VISIT_RESOURCE,
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.move(MOVE_ATTEMPT),
        ),
        auditAction: AuditAction.BookingRescheduled,
        auditOperationId: OperationId.of(MOVE_ATTEMPT),
        resourceId: VISIT_RESOURCE,
        actor: CLIENT,
        target: CLIENT_CUSTOMER,
      },
      replayed: replayedTrue,
    },
    {
      verb: 'staff edit',
      visit: thursdayVisit(),
      act: () =>
        editAppointment(ports())({
          appointmentId: VISIT,
          actorRoles: [Role.Receptionist],
          commands: [
            {
              editCommand: EditCommand.Move,
              localDate: THURSDAY,
              startMinutes: at(11),
              seatIds: null,
            },
          ],
          acknowledgedOverlap: false,
          expectedVersion: null,
          operationId: EDIT,
          actor: RECEPTION,
        }),
      row: {
        id: rowId(
          AuditAction.BookingStaffMove,
          VISIT_RESOURCE,
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.staffEdit(EDIT),
        ),
        auditAction: AuditAction.BookingStaffMove,
        auditOperationId: EDIT,
        resourceId: VISIT_RESOURCE,
        actor: RECEPTION,
        target: CLIENT_CUSTOMER,
      },
      replayed: replayedTrue,
    },
    {
      verb: 'client cancel',
      visit: thursdayVisit(),
      act: () =>
        cancelAppointment(ports())({
          appointmentId: VISIT,
          callerUserId: FIXTURE_IDS.client,
          reason: CancellationReason.Unspecified,
          operationId: CANCEL,
          actor: CLIENT,
        }),
      row: {
        id: rowId(
          AuditAction.BookingCancelled,
          VISIT_RESOURCE,
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.cancel(CANCEL),
        ),
        auditAction: AuditAction.BookingCancelled,
        auditOperationId: CANCEL,
        resourceId: VISIT_RESOURCE,
        actor: CLIENT,
        target: CLIENT_CUSTOMER,
      },
      replayed: refused,
    },
    {
      verb: 'staff transition',
      visit: thursdayVisit(),
      act: () =>
        transitionAppointment(ports())({
          appointmentId: VISIT,
          to: BookingStatus.NoShow,
          seatId: null,
          reason: null,
          operationId: NO_SHOW,
          actor: RECEPTION,
        }),
      row: {
        id: rowId(
          AuditAction.BookingStaffNoShow,
          VISIT_RESOURCE,
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.transition(NO_SHOW, null),
        ),
        auditAction: AuditAction.BookingStaffNoShow,
        auditOperationId: NO_SHOW,
        resourceId: VISIT_RESOURCE,
        actor: RECEPTION,
        target: CLIENT_CUSTOMER,
      },
      replayed: refused,
    },
    {
      verb: 'arrival',
      visit: thursdayVisit(),
      act: () =>
        markArrival(ports())({
          markArrivalAction: MarkArrivalAction.Arrive,
          appointmentId: VISIT,
          operationId: ARRIVE,
          actor: RECEPTION,
        }),
      row: {
        id: rowId(
          AuditAction.BookingStaffArrived,
          VISIT_RESOURCE,
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.arrived(ARRIVE),
        ),
        auditAction: AuditAction.BookingStaffArrived,
        auditOperationId: ARRIVE,
        resourceId: VISIT_RESOURCE,
        actor: RECEPTION,
        target: CLIENT_CUSTOMER,
      },
      replayed: unchangedTrue,
    },
    {
      verb: 'tip',
      visit: thursdayVisit(),
      act: () =>
        recordSeatTip(ports())({
          appointmentId: VISIT,
          seatId: FIXTURE_IDS.seat,
          tipCents: cents(500),
          operationId: TIP,
          actor: RECEPTION,
        }),
      row: {
        id: rowId(
          AuditAction.BookingTipRecorded,
          VISIT_RESOURCE,
          CLIENT_CUSTOMER,
          AuditSystem.changeKey.tip(TIP, FIXTURE_IDS.seat),
        ),
        auditAction: AuditAction.BookingTipRecorded,
        auditOperationId: TIP,
        resourceId: VISIT_RESOURCE,
        actor: RECEPTION,
        target: CLIENT_CUSTOMER,
      },
      replayed: unchangedTrue,
    },
  ];

  describe.each(cases)('$verb', (verbCase) => {
    beforeEach(async () => {
      if (verbCase.visit !== null) await seedVisit(verbCase.visit);
    });

    it('commits exactly its row with the act, naming its operation', async () => {
      const answer = await verbCase.act();

      expect(answer.ok).toBe(true);
      await expectOnlyRow(verbCase.row);
    });

    it('a commit that meets its row already there writes no row and no other document', async () => {
      // A row at the act's own id, seeded first: its `Create` meets
      // ALREADY_EXISTS inside the transaction, and the whole plan fails.
      await db.doc(`${Collections.AuditLog}/${verbCase.row.id}`).set({
        resourceId: verbCase.row.resourceId,
      });
      const before = await everything();

      const answer = await verbCase.act();

      expect(!answer.ok && answer.error.errorCode).toBe(
        RepositoryErrorCode.AlreadyExists,
      );
      expect(await everything()).toEqual(before);
    });

    it('a replay writes no second row', async () => {
      expect((await verbCase.act()).ok).toBe(true);
      const after = await everything();

      verbCase.replayed(await verbCase.act());

      expect(await auditIds()).toEqual([verbCase.row.id]);
      expect(await everything()).toEqual(after);
    });
  });

  it('an act with no verified actor commits without a row, and logs it once', async () => {
    await seedVisit(thursdayVisit());
    const telemetry = recordingTelemetry();

    const answer = await recordSeatTip(ports(telemetry))({
      appointmentId: VISIT,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(500),
      operationId: TIP,
      actor: null,
    });

    expect(answer).toMatchObject({ ok: true, value: { unchanged: false } });
    const seats = (await db.doc(VISIT_PATH).get()).data()?.['seats'] as
      readonly Record<string, unknown>[] | undefined;
    expect(seats?.[0]?.['tipCents']).toBe(500);
    expect(await auditIds()).toEqual([]);
    expect(
      telemetry.lines.filter((line) => line.msg === LogEvent.AuditActorMissing),
    ).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingTipRecorded,
          resourceId: VISIT_RESOURCE,
        },
      },
    ]);
  });
});
