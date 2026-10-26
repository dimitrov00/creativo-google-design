import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  CustomerOrigin,
  Placement,
  Role,
  SeatLabel,
  SeatOccupant,
  VoucherCode,
  VoucherLifecycle,
  EditCommand,
  RequestedSubjectRole,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  ClientOperationId,
  Currency,
  GiftVoucherId,
  OperationId,
  SeatId,
} from '@core/primitives';
import { BookingErrorCode, StaffEditErrorCode } from '@core/errors';
import {
  type Appointment,
  type GiftVoucher,
  Collections,
} from '@core/entities';
import type { BookingCall } from '@core/components';
import { StoredDocumentSystem } from '@core/systems';
import {
  type EditAppointmentCommand,
  editAppointment,
  rescheduleAppointment,
} from '@core/pipelines';
import {
  appointmentFixture,
  at,
  barberFixture,
  barberScheduleFixture,
  cents,
  duration,
  endMinute,
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
import { toHttpsError } from '../edge';
import {
  encodeStaffEditAppointmentAnswer,
  staffEditAppointmentRefusal,
} from '../wire/booking.wire';
import { settle } from '../wire/wire-read';
import { firestoreAccountPorts } from '../adapters/firestore-accounts.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreCouponPorts } from '../adapters/firestore-coupons.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * One NAMED staff intent against the REAL Firestore emulator — the
 * successor of `use-cases/staff-edit-appointment.integration.spec.ts`
 * (flip 1 §5.2): the ledger is decided inside the edit's transaction and
 * written by the same root-field `Update` that applies the edit, and it has
 * to survive the OTHER writer of the placement — a client's move — for a
 * late re-send to be recognised. Plus the race no fake can stage: two saves
 * drawing one gift voucher BY CODE at once.
 *
 * Emulator-only by construction (the same guard as the seed and the move's
 * suite), with its own demo project so the wipe between tests never touches
 * the dev stack's data.
 */
const PROJECT_ID = 'demo-functions-staff-operations';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** Thursday of the week the pinned Monday 09:00 opens. */
const THURSDAY = localDate('2026-10-01');
const OPERATION = OperationId.of('operation-0123456789abcdef');
/** The client's move's name — every move is named (WS-4.1). */
const MOVE_ATTEMPT = ((): ClientOperationId => {
  const id = ClientOperationId.parse('move-attempt-0123456789');
  if (!id.ok) throw new Error('a broken fixture');
  return id.value;
})();
let named = 0;
/** A fresh name for a save that is no re-send — every staff save is named (WS-4.1). */
function nextOperation(): OperationId {
  named += 1;
  return OperationId.of(`edit-operation-${String(named).padStart(6, '0')}`);
}
const PETAR = BarberId.of('b-petar');
const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;
const RECEPTION = Actor.staff(FIXTURE_IDS.client, [Role.Receptionist]);

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const thursdayAt = (hour: number, minute = 0) =>
  utcMs(
    `2026-10-01T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+03:00`,
  );

/** The client's cut with Ivan on Thursday at 10:00. */
function visit(
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    localDate: THURSDAY,
    utcEpochMs: thursdayAt(10),
    busyKeys: [BusyKey.of(FIXTURE_IDS.barber, THURSDAY)],
    ...extra,
  });
}

describe('editAppointment — one named intent, one change (emulator)', () => {
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
      [`${Collections.Barbers}/${PETAR}`, bodyOf(barberFixture({ id: PETAR }))],
      [
        `${Collections.Services}/${FIXTURE_IDS.service}`,
        bodyOf(
          serviceFixture({
            offerings: [
              {
                ...serviceFixture().offerings[0]!,
                barberId: FIXTURE_IDS.barber,
              },
              { ...serviceFixture().offerings[0]!, barberId: PETAR },
            ],
          }),
        ),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
      [
        `${Collections.BarberSchedules}/${PETAR}`,
        bodyOf(barberScheduleFixture({ id: PETAR })),
      ],
      [
        `${Collections.Customers}/${FIXTURE_IDS.customer}`,
        {
          userId: FIXTURE_IDS.client,
          displayName: 'Ana Petrova',
          phone: null,
          email: null,
          searchName: 'ana petrova',
          searchPrefixes: [],
          createdAtUtcMs: FIXTURE_NOW_UTC_MS,
          customerOrigin: CustomerOrigin.Seed,
        },
      ],
      [PATH, bodyOf(visit())],
    ];
    for (const [path, body] of writes) await db.doc(path).set(body);
  });

  function ports() {
    const telemetry = recordingTelemetry();
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
      ...firestoreAuditPorts(db, telemetry),
      ...telemetry,
    };
  }

  function staffEdit(
    startHour: number,
    extra: Partial<EditAppointmentCommand> = {},
  ) {
    return editAppointment(ports())({
      appointmentId: FIXTURE_IDS.appointment,
      actorRoles: [Role.Receptionist],
      commands: [
        {
          editCommand: EditCommand.Move,
          localDate: THURSDAY,
          startMinutes: at(startHour),
          seatIds: null,
        },
      ],
      acknowledgedOverlap: false,
      expectedVersion: null,
      operationId: nextOperation(),
      actor: RECEPTION,
      ...extra,
    });
  }

  async function stored(path = PATH): Promise<Record<string, unknown>> {
    return (await db.doc(path).get()).data() ?? {};
  }

  it('stamps the intent beside the edit, and answers its re-send without writing again', async () => {
    const first = await staffEdit(11, {
      operationId: OPERATION,
      expectedVersion: 1,
    });
    expect(first).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: false,
      },
    });
    const afterFirst = await stored();
    expect(afterFirst['revision']).toBe(2);
    expect(afterFirst['appliedOperations']).toEqual([
      { operationId: OPERATION, revision: 2, digest: expect.any(String) },
    ]);

    // The response was lost; the sheet sends the same save again, still
    // claiming the revision it was drawn from.
    const resent = await staffEdit(11, {
      operationId: OPERATION,
      expectedVersion: 1,
    });

    expect(resent).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: true,
      },
    });
    expect(await stored()).toEqual(afterFirst);
  });

  it("keeps the ledger through a client's move, so a late re-send is still recognised", async () => {
    await staffEdit(11, { operationId: OPERATION });
    const moved = await rescheduleAppointment(ports())({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      locationId: FIXTURE_IDS.location,
      localDate: THURSDAY,
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
      actor: Actor.user(FIXTURE_IDS.client),
    });
    expect(moved.ok).toBe(true);
    const afterMove = await stored();
    expect(afterMove['revision']).toBe(3);
    // The client's move is named too (WS-4.1): the ledger holds both acts.
    expect(afterMove['appliedOperations']).toEqual([
      expect.objectContaining({ operationId: OPERATION, revision: 2 }),
      expect.objectContaining({
        operationId: OperationId.of(`move:${MOVE_ATTEMPT}`),
        revision: 3,
      }),
    ]);

    const resent = await staffEdit(11, { operationId: OPERATION });

    // Answered, not re-applied over the client's 14:00.
    expect(resent).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: true,
      },
    });
    expect(await stored()).toEqual(afterMove);
  });

  it('applies two differently named saves once each — no save is unnamed (WS-4.1)', async () => {
    const first = nextOperation();
    const second = nextOperation();
    await staffEdit(11, { operationId: first });
    await staffEdit(11, { operationId: second });

    const after = await stored();
    expect(after['revision']).toBe(3);
    expect(after['appliedOperations']).toEqual([
      expect.objectContaining({ operationId: first, revision: 2 }),
      expect.objectContaining({ operationId: second, revision: 3 }),
    ]);
  });

  it('settles two saves drawing one voucher BY CODE at once against the balance the loser re-reads — the draws never sum past it', async () => {
    const SECOND = AppointmentId.of('appt-2');
    const voucher: GiftVoucher = {
      id: GiftVoucherId.of('v-gift30'),
      code: VoucherCode.of('GIFT30'),
      initialValueCents: cents(3000),
      balanceCents: cents(3000),
      currency: Currency.EUR,
      issuedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
      expiresAtUtcMs: null,
      expiresLocalDate: null,
      issuedToCustomerId: null,
      holderUserId: null,
      ...VoucherLifecycle.active(),
    };
    await db
      .doc(`${Collections.GiftVouchers}/${voucher.id}`)
      .set(bodyOf(voucher));
    await db.doc(`${Collections.Appointments}/${SECOND}`).set(
      bodyOf(
        visit({
          id: SECOND,
          seats: [
            seatFixture({ seatId: SeatId.of('seat-2'), startMinutes: at(12) }),
          ],
          startMinutes: at(12),
          endMinutes: endMinute(12 * 60 + 30),
          utcEpochMs: thursdayAt(12),
        }),
      ),
    );
    const redeem = (appointmentId: AppointmentId) =>
      editAppointment(ports())({
        appointmentId,
        actorRoles: [Role.Receptionist],
        commands: [
          { editCommand: EditCommand.Vouchers, codes: [voucher.code] },
        ],
        acknowledgedOverlap: false,
        expectedVersion: null,
        operationId: nextOperation(),
        actor: RECEPTION,
      });

    const [first, second] = await Promise.all([
      redeem(FIXTURE_IDS.appointment),
      redeem(SECOND),
    ]);
    expect(first.ok && second.ok).toBe(true);

    const drawn = await Promise.all(
      [PATH, `${Collections.Appointments}/${SECOND}`].map(async (path) => {
        const lines = (await stored(path))['voucherRedemptions'] as readonly {
          readonly amountCents: number;
        }[];
        return lines.reduce((sum, line) => sum + line.amountCents, 0);
      }),
    );
    // 28,00 € to whichever committed first, the 2,00 € left to the other.
    expect([...drawn].sort((a, b) => a - b)).toEqual([200, 2800]);
    expect(
      (await stored(`${Collections.GiftVouchers}/${voucher.id}`))[
        'balanceCents'
      ],
    ).toBe(0);
  });

  /*
   * ONE PERSON, ONE CHAIR, AS THE CALLABLE ANSWERS (round 4, 2026-09-25; by
   * seat identity since round 5). A visit that already seats one walk-in
   * label in two chairs at once (booked before the sheet numbered its
   * strangers) still takes any save that makes it no worse — the pair left
   * where it stood, dragged whole, or one of its seats moved — and a batch
   * that puts a person in two chairs ANEW is refused on the wire as
   * `BOOKING_INVALID_INPUT` naming the field (the person key stays on the
   * server, 4A-4). The commands are the
   * decoded ones (the payloads' decoding is `booking.wire.spec.ts`'s); the
   * answer and the refusal leave through the callable's own settle and
   * `toHttpsError`, as `main.ts` wires them.
   */
  describe('a double seating the visit already held (callable)', () => {
    const PAIR = AppointmentId.of('appt-pair');
    const PAIR_PATH = `${Collections.Appointments}/${PAIR}`;
    const WALK_IN = 'Случаен клиент';

    function guestSeat(seatId: string, barberId: BarberId) {
      const label = SeatLabel.parse(WALK_IN);
      if (!label.ok) throw new Error('a broken walk-in label');
      return seatFixture({
        seatId: SeatId.of(seatId),
        barberId,
        occupant: SeatOccupant.anonymous(label.value),
      });
    }

    beforeEach(async () => {
      await db.doc(PAIR_PATH).set(
        bodyOf(
          visit({
            id: PAIR,
            ownerUserId: null,
            ownerCustomerId: null,
            subjectUserIds: [],
            subjectCustomerIds: [],
            placement: Placement.Staff,
            barberIds: [FIXTURE_IDS.barber, PETAR],
            busyKeys: [
              BusyKey.of(FIXTURE_IDS.barber, THURSDAY),
              BusyKey.of(PETAR, THURSDAY),
            ],
            seats: [
              guestSeat('seat-a', FIXTURE_IDS.barber),
              guestSeat('seat-b', PETAR),
            ],
          }),
        ),
      );
    });

    /** One save from the desk, answered as the callable answers it (a refusal thrown). */
    async function call(
      commands: BookingCall.EditCommand | readonly BookingCall.EditCommand[],
      expectedVersion: number | null = null,
    ): Promise<unknown> {
      const settled = settle(
        await editAppointment(ports())({
          appointmentId: PAIR,
          actorRoles: [Role.Receptionist],
          commands: Array.isArray(commands) ? commands : [commands],
          acknowledgedOverlap: false,
          expectedVersion,
          operationId: nextOperation(),
          actor: RECEPTION,
        }),
        encodeStaffEditAppointmentAnswer,
        staffEditAppointmentRefusal,
      );
      if (!settled.ok) throw toHttpsError(settled.error);
      return settled.value;
    }

    const repriceSeatA: BookingCall.EditCommand = {
      editCommand: EditCommand.Reprice,
      seatId: SeatId.of('seat-a'),
      priceCents: cents(3000),
    };
    const removeSeatB: BookingCall.EditCommand = {
      editCommand: EditCommand.RemoveSeat,
      seatId: SeatId.of('seat-b'),
    };
    const moveTo = (
      hour: number,
      minute = 0,
      seatIds: readonly string[] | null = null,
    ): BookingCall.EditCommand => ({
      editCommand: EditCommand.Move,
      localDate: THURSDAY,
      startMinutes: at(hour, minute),
      seatIds: seatIds === null ? null : seatIds.map((id) => SeatId.of(id)),
    });
    const addGuest = (
      seatId: string,
      barberId: BarberId,
      label: string,
      hour: number,
    ): BookingCall.EditCommand => {
      const guest = SeatLabel.parse(label);
      if (!guest.ok) throw new Error('a broken guest label');
      return {
        editCommand: EditCommand.AddSeat,
        seatId: SeatId.of(seatId),
        serviceId: FIXTURE_IDS.service,
        variantId: null,
        barberId,
        localDate: THURSDAY,
        startMinutes: at(hour),
        durationMinutes: duration(30),
        addedSubject: {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: guest.value,
          contact: null,
        },
      };
    };

    const pair = () => stored(PAIR_PATH);
    const seatsOf = async () =>
      (await pair())['seats'] as readonly Record<string, unknown>[];

    it('saves a batch that leaves the pair where it stood', async () => {
      await expect(call(repriceSeatA)).resolves.toEqual({
        appointmentId: PAIR,
        revision: 2,
      });

      const seats = await seatsOf();
      expect(
        seats.map((seat) => [
          seat['barberId'],
          seat['startMinutes'],
          seat['guestLabel'],
        ]),
      ).toEqual([
        [FIXTURE_IDS.barber, at(10), WALK_IN],
        [PETAR, at(10), WALK_IN],
      ]);
      expect(seats[0]?.['priceCents']).toBe(3000);
    });

    it('refuses a batch that seats one person twice, naming the field', async () => {
      await expect(
        call([
          addGuest('seat-c', FIXTURE_IDS.barber, 'Мария', 11),
          addGuest('seat-d', PETAR, 'Мария', 11),
        ]),
      ).rejects.toMatchObject({
        code: 'invalid-argument',
        details: {
          errorCode: BookingErrorCode.InvalidInput,
          field: 'person_overlap',
        },
      });
      expect((await pair())['revision']).toBe(1);
    });

    // Round 5: the round-4 grandfather matched positions, so dragging the
    // whole visit — which leaves it no worse — was refused with the
    // client's "pick another time", and no time would do.
    it('saves a whole-visit drag of the pair, then a move of one seat that still overlaps', async () => {
      await expect(call(moveTo(11), 1)).resolves.toEqual({
        appointmentId: PAIR,
        revision: 2,
      });
      await expect(call(moveTo(11, 15, ['seat-b']), 2)).resolves.toEqual({
        appointmentId: PAIR,
        revision: 3,
      });

      expect(
        (await seatsOf()).map((seat) => [seat['seatId'], seat['startMinutes']]),
      ).toEqual([
        ['seat-a', at(11)],
        ['seat-b', at(11, 15)],
      ]);
    });

    // Round 6: «Отмени» restores exactly what the save changed. A save that
    // removed one seat of the pair remembers the pair, under the revision
    // it stamped; the undo made on that stamp puts the seat back under its
    // old id. Anything written in between, and the seat is new again.
    const readdSeatB = addGuest('seat-b', PETAR, WALK_IN, 10);

    it('lets the undo of a removal put the seat of the pair back', async () => {
      await expect(call(removeSeatB, 1)).resolves.toEqual({
        appointmentId: PAIR,
        revision: 2,
      });
      expect(await pair()).toMatchObject({
        stoodSeatPairsRevision: 2,
        stoodSeatPairs: [{ seatId: 'seat-a', otherSeatId: 'seat-b' }],
      });

      await expect(call(readdSeatB, 2)).resolves.toEqual({
        appointmentId: PAIR,
        revision: 3,
      });

      const after = await pair();
      expect(
        (after['seats'] as readonly Record<string, unknown>[]).map((seat) => [
          seat['seatId'],
          seat['barberId'],
        ]),
      ).toEqual([
        ['seat-a', FIXTURE_IDS.barber],
        ['seat-b', PETAR],
      ]);
      expect(after).toMatchObject({
        stoodSeatPairsRevision: null,
        stoodSeatPairs: [],
      });
    });

    it('judges the seat new once another save landed after the removal', async () => {
      await call(removeSeatB, 1);
      await call(repriceSeatA, 2);

      await expect(call(readdSeatB, 3)).rejects.toMatchObject({
        code: 'invalid-argument',
        details: {
          errorCode: BookingErrorCode.InvalidInput,
          field: 'person_overlap',
        },
      });
      expect((await pair())['revision']).toBe(3);
    });

    // Round 5: the sheet claims the revision its draft was drawn from; a
    // colleague's save since is refused, typed, and nothing is written.
    it('refuses a save from a stale screen as failed-precondition, writing nothing', async () => {
      await call(moveTo(11), 1);
      await expect(call(moveTo(12), 1)).rejects.toMatchObject({
        code: 'failed-precondition',
        details: {
          errorCode: StaffEditErrorCode.Stale,
          expected: 1,
          actual: 2,
        },
      });
      expect((await pair())['revision']).toBe(2);
    });
  });
});
