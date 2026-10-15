import {
  Actor,
  AuditAction,
  BlockKind,
  BookingPolicy,
  type DocBody,
  type DocPath,
  LocationStatus,
  MinuteBlock,
  SeatOccupant,
  SeatOutcome,
  ServiceStatus,
  SubjectRelationship,
  WriteAction,
  type WriteOp,
} from '@core/components';
import {
  BarberBusyDayId,
  BarberId,
  BookingErrorCode,
  BusyKey,
  CustomerId,
  LocationId,
  OperationId,
  Result,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { type Appointment, type AuditEntry, Collections } from '@core/entities';
import {
  AuditSystem,
  CarriedSeatRefusal,
  MoveErrorCode,
  MoveSubjectRole,
  MoveSystem,
} from '@core/systems';
import {
  appointmentFixture,
  at,
  barberBusyDayFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  fixtureHash,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  seatFixture,
  serviceFixture,
  until,
  utcMs,
} from '@core/testing';
import {
  type RescheduleAppointmentCommand,
  type RescheduleSeatRequest,
  rescheduleAppointment,
} from './reschedule-appointment.pipeline';

const THURSDAY = localDate('2026-10-01');
const FRIDAY = localDate('2026-10-02');
const ATTEMPT = 'move-attempt-0123456789';
const COMPANION = UserId.of('u-son');
const COMPANION_SEAT = SeatId.of('seat-son');

function bodyOf<E extends { readonly id: string }>(entity: E): DocBody {
  const { id: _id, ...body } = entity;
  return body;
}

/** The client's cut on Thursday at 10:00 — well outside the 24 h window. */
function visit(
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    localDate: THURSDAY,
    utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
    busyKeys: [BusyKey.of(FIXTURE_IDS.barber, THURSDAY)],
    ...extra,
  });
}

function catalogue(
  extraServices: readonly ReturnType<typeof serviceFixture>[] = [],
) {
  return [
    {
      path: [Collections.Locations, FIXTURE_IDS.location],
      body: bodyOf(locationFixture()),
    },
    {
      path: [Collections.Services, FIXTURE_IDS.service],
      body: bodyOf(serviceFixture()),
    },
    ...extraServices.map((service) => ({
      path: [Collections.Services, service.id],
      body: bodyOf(service),
    })),
    {
      path: [Collections.BarberSchedules, FIXTURE_IDS.barber],
      body: bodyOf(barberScheduleFixture()),
    },
  ];
}

const CART_SEAT: RescheduleSeatRequest = {
  serviceId: FIXTURE_IDS.service,
  variantId: null,
  barberId: FIXTURE_IDS.barber,
  barberPreference: null,
  startUtcMs: utcMs('2026-10-02T11:00:00.000+03:00'),
  moveSubjectRole: MoveSubjectRole.Self,
  label: null,
};

function command(
  extra: Partial<RescheduleAppointmentCommand> = {},
): RescheduleAppointmentCommand {
  return {
    appointmentId: FIXTURE_IDS.appointment,
    callerUserId: FIXTURE_IDS.client,
    locationId: FIXTURE_IDS.location,
    seats: [CART_SEAT],
    attemptId: ATTEMPT,
    actor: Actor.user(FIXTURE_IDS.client),
    ...extra,
  };
}

function rig(
  documents: readonly { readonly path: DocPath; readonly body: DocBody }[],
) {
  const store = memoryStore(documents);
  const tx = memoryTxPorts(store);
  const rows: AuditEntry[] = [];
  const run = rescheduleAppointment({
    ...tx,
    ...recordingTelemetry(),
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, run };
}

function stored(appointment: Appointment) {
  return {
    path: [Collections.Appointments, appointment.id],
    body: bodyOf(appointment),
  };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

const digestOf = (cmd: RescheduleAppointmentCommand): string =>
  fixtureHash(
    MoveSystem.digestBasis({ locationId: cmd.locationId, seats: cmd.seats }),
  ).slice(0, 16);

describe('rescheduleAppointment — the client moving their own visit', () => {
  it('moves the visit in ONE plan: its Update (revision, ledger) and the busy Set of the NEW day only', async () => {
    const { store, tx, rows, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(command());
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: false,
      },
    });
    const plan = tx.plans[0] ?? [];
    const friday = BusyKey.of(FIXTURE_IDS.barber, FRIDAY);
    expect(
      plan.map((op: WriteOp) => [op.writeAction, op.path.join('/')]),
    ).toEqual([
      [WriteAction.Update, PATH],
      [WriteAction.Set, `${Collections.BarberBusy}/${friday}`],
    ]);
    expect(store.get(PATH)).toMatchObject({
      localDate: FRIDAY,
      startMinutes: at(11),
      utcEpochMs: utcMs('2026-10-02T11:00:00.000+03:00'),
      busyKeys: [friday],
      revision: 2,
      appliedOperations: [
        {
          operationId: OperationId.of(`move:${ATTEMPT}`),
          revision: 2,
          digest: digestOf(command()),
        },
      ],
      // Identity kept: status, booking instant, placement stamp.
      bookingStatus: 'CONFIRMED',
      placement: 'SELF',
    });
    // The old day is left to rebuildBusy; every busy key written was read.
    const read = new Set(
      tx.transactions[0]?.reads.map((path) => path.join('/')),
    );
    for (const op of plan) {
      if (op.path[0] === Collections.BarberBusy)
        expect(read.has(op.path.join('/'))).toBe(true);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.BookingRescheduled,
      rescheduleRevision: 2,
      loggedOnRetry: false,
    });
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingRescheduled,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.move(ATTEMPT),
        ),
      ),
    );
  });

  it('an unnamed move is logged under the revision it stamped', async () => {
    const { rows, run } = rig([...catalogue(), stored(visit())]);
    await run(command({ attemptId: null }));
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingRescheduled,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.revision(2),
        ),
      ),
    );
  });

  it('a request for exactly where the visit already is changes nothing and logs nothing', async () => {
    const { tx, rows, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({
        seats: [
          { ...CART_SEAT, startUtcMs: utcMs('2026-10-01T10:00:00.000+03:00') },
        ],
      }),
    );
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 1,
        replayed: true,
      },
    });
    expect(tx.plans).toEqual([[]]);
    expect(rows).toEqual([]);
  });

  it('a re-sent named move answers its original revision, writes nothing, and re-files its row', async () => {
    const applied = visit({
      revision: 4,
      appliedOperations: [
        {
          operationId: OperationId.of(`move:${ATTEMPT}`),
          revision: 4,
          digest: digestOf(command()),
        },
      ],
    });
    const { tx, rows, run } = rig([...catalogue(), stored(applied)]);
    const answer = await run(command());
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 4,
        replayed: true,
      },
    });
    expect(tx.plans).toEqual([[]]);
    expect(rows[0]).toMatchObject({
      rescheduleRevision: 4,
      loggedOnRetry: true,
    });
  });

  it('refuses a known name with another batch (attemptId)', async () => {
    const applied = visit({
      appliedOperations: [
        {
          operationId: OperationId.of(`move:${ATTEMPT}`),
          revision: 1,
          digest: 'other',
        },
      ],
    });
    const { run } = rig([...catalogue(), stored(applied)]);
    const answer = await run(command());
    expect(!answer.ok && answer.error).toMatchObject({ field: 'attemptId' });
  });

  it('answers somebody else’s visit as one that is not there, and refuses an anonymous caller', async () => {
    const { run } = rig([...catalogue(), stored(visit())]);
    const theirs = await run(command({ callerUserId: UserId.of('u-other') }));
    expect(!theirs.ok && theirs.error).toMatchObject({
      field: 'appointmentId',
    });
    const nobody = await run(command({ callerUserId: null }));
    expect(!nobody.ok && nobody.error.errorCode).toBe(
      BookingErrorCode.Unauthenticated,
    );
  });

  it('refuses a move inside the free-cancellation window (window_closed)', async () => {
    // The fixture visit is at 10:00 today — an hour away.
    const { tx, run } = rig([...catalogue(), stored(appointmentFixture())]);
    const answer = await run(command());
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'window_closed',
    });
    expect(tx.plans).toEqual([]);
  });

  it('refuses re-seating a party mid-service (seat_resolved)', async () => {
    const midService = visit({
      seats: [
        seatFixture({
          outcome: SeatOutcome.worked(utcMs('2026-10-01T10:30:00.000+03:00')),
        }),
      ],
    });
    const { run } = rig([...catalogue(), stored(midService)]);
    const answer = await run(command());
    expect(!answer.ok && answer.error).toMatchObject({
      field: 'seat_resolved',
    });
  });

  describe('the carried seats', () => {
    const son = seatFixture({
      seatId: COMPANION_SEAT,
      startMinutes: at(10, 30),
      occupant: SeatOccupant.account(
        COMPANION,
        CustomerId.forUser(COMPANION, fixtureHash),
        SubjectRelationship.Companion,
      ),
    });

    it('keep their id, their sold terms and their distance from the booker', async () => {
      const { store, rows, run } = rig([
        ...catalogue(),
        stored(visit({ seats: [seatFixture(), son] })),
      ]);
      const answer = await run(command());
      expect(answer.ok).toBe(true);
      const seats = store.get(PATH)?.['seats'] as readonly Record<
        string,
        unknown
      >[];
      expect(seats).toHaveLength(2);
      expect(seats[1]).toEqual({ ...son, startMinutes: at(11, 30) });
      // One row per person: the carried companion is named by their own record.
      expect(
        rows.map(
          (row) => row.auditTarget === 'CUSTOMER' && row.targetCustomerId,
        ),
      ).toEqual([
        FIXTURE_IDS.customer,
        CustomerId.forUser(COMPANION, fixtureHash),
      ]);
    });

    it('a carried seat whose service retired is the client’s call to the shop (service_unavailable)', async () => {
      const retired = serviceFixture({
        id: ServiceId.of('svc-retired'),
        serviceStatus: ServiceStatus.Archived,
      });
      const carriedRetired = { ...son, serviceId: retired.id };
      const { run } = rig([
        ...catalogue([retired]),
        stored(visit({ seats: [seatFixture(), carriedRetired] })),
      ]);
      const answer = await run(command());
      expect(!answer.ok && answer.error).toEqual({
        errorCode: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.ServiceUnavailable,
        seatIds: [COMPANION_SEAT],
      });
    });

    it('a visit with nothing of the booker’s is the shop’s to move (shop_only)', async () => {
      const { run } = rig([...catalogue(), stored(visit({ seats: [son] }))]);
      const answer = await run(command());
      expect(!answer.ok && answer.error).toMatchObject({
        errorCode: MoveErrorCode.CarriedSeatUnplaceable,
        refusal: CarriedSeatRefusal.ShopOnly,
      });
    });

    it('when the cart itself does not fit, its own refusal is the answer — not the carried one', async () => {
      const { run } = rig([
        ...catalogue(),
        stored(visit({ seats: [seatFixture(), son] })),
      ]);
      const answer = await run(
        command({
          seats: [{ ...CART_SEAT, barberId: BarberId.of('b-nobody') }],
        }),
      );
      expect(!answer.ok && answer.error.errorCode).not.toBe(
        MoveErrorCode.CarriedSeatUnplaceable,
      );
    });
  });

  it('refuses a start that did not parse (startIso), and a shop that is not there', async () => {
    const { run } = rig([...catalogue(), stored(visit())]);
    const unparsed = await run(
      command({ seats: [{ ...CART_SEAT, startUtcMs: null }] }),
    );
    expect(!unparsed.ok && unparsed.error).toMatchObject({ field: 'startIso' });
    const missing = await run(command({ locationId: 'loc-gone' }));
    expect(!missing.ok && missing.error).toMatchObject({
      field: 'locationId',
      reason: 'not_found',
    });
  });

  describe('the visit’s own chairs never block its move', () => {
    it('moves a quarter of an hour earlier, over the visit’s own old chair', async () => {
      const thursday = BusyKey.of(FIXTURE_IDS.barber, THURSDAY);
      // The busy day holds the visit's OWN 10:00–10:30 — handed back before
      // the move is placed, so 09:45 is free.
      const own = barberBusyDayFixture({
        id: BarberBusyDayId.of(thursday),
        localDate: THURSDAY,
        blocks: [MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy)],
      });
      const { store, run } = rig([
        ...catalogue(),
        stored(visit()),
        { path: [Collections.BarberBusy, thursday], body: bodyOf(own) },
      ]);
      const answer = await run(
        command({
          seats: [
            {
              ...CART_SEAT,
              startUtcMs: utcMs('2026-10-01T09:45:00.000+03:00'),
            },
          ],
        }),
      );
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)).toMatchObject({
        localDate: THURSDAY,
        startMinutes: at(9, 45),
      });
    });
  });

  it('still answers the client’s own taken slot first when the companion’s service is gone too', async () => {
    const friday = BusyKey.of(FIXTURE_IDS.barber, FRIDAY);
    const taken = barberBusyDayFixture({
      id: BarberBusyDayId.of(friday),
      localDate: FRIDAY,
      blocks: [MinuteBlock.of(at(11), until(12), BlockKind.Busy)],
    });
    const retired = serviceFixture({
      id: ServiceId.of('svc-retired'),
      serviceStatus: ServiceStatus.Archived,
    });
    const son = seatFixture({
      seatId: COMPANION_SEAT,
      serviceId: retired.id,
      startMinutes: at(10, 30),
      occupant: SeatOccupant.account(
        COMPANION,
        CustomerId.forUser(COMPANION, fixtureHash),
        SubjectRelationship.Companion,
      ),
    });
    const { tx, run } = rig([
      ...catalogue([retired]),
      stored(visit({ seats: [seatFixture(), son] })),
      { path: [Collections.BarberBusy, friday], body: bodyOf(taken) },
    ]);
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      BookingErrorCode.SlotUnavailable,
    );
    expect(tx.plans).toEqual([]);
  });

  /*
   * A visit at a shop hidden since is never stranded — but a client's move
   * is no door INTO a hidden shop: a request naming a shop the visit is not
   * at is asked what a new booking is (listed). Mladost is a second shop
   * Niko works, offering the classic cut.
   */
  describe('a shop hidden since', () => {
    const MLADOST = LocationId.of('loc-mladost');
    const NIKO = BarberId.of('b-niko');

    function withMladost(center: LocationStatus, mladost: LocationStatus) {
      const offered = serviceFixture();
      return [
        {
          path: [Collections.Locations, FIXTURE_IDS.location],
          body: bodyOf(locationFixture({ locationStatus: center })),
        },
        {
          path: [Collections.Locations, MLADOST],
          body: bodyOf(
            locationFixture({ id: MLADOST, locationStatus: mladost }),
          ),
        },
        {
          path: [Collections.Services, FIXTURE_IDS.service],
          body: bodyOf(
            serviceFixture({
              locationIds: [FIXTURE_IDS.location, MLADOST],
              offerings: [
                ...offered.offerings,
                { ...offered.offerings[0]!, barberId: NIKO },
              ],
            }),
          ),
        },
        {
          path: [Collections.BarberSchedules, FIXTURE_IDS.barber],
          body: bodyOf(barberScheduleFixture()),
        },
        {
          path: [Collections.BarberSchedules, NIKO],
          body: bodyOf(
            barberScheduleFixture({
              id: NIKO,
              versions: barberScheduleFixture().versions.map((version) => ({
                ...version,
                segments: version.segments.map((segment) => ({
                  ...segment,
                  locationId: MLADOST,
                })),
              })),
            }),
          ),
        },
        stored(visit()),
      ];
    }

    const toMladost = command({
      locationId: MLADOST,
      seats: [{ ...CART_SEAT, barberId: NIKO }],
    });

    it('lets the client move their own visit', async () => {
      const { store, run } = rig(
        withMladost(LocationStatus.Hidden, LocationStatus.Active),
      );
      const answer = await run(command());
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)).toMatchObject({
        locationId: FIXTURE_IDS.location,
        localDate: FRIDAY,
        startMinutes: at(11),
      });
    });

    it('moves the client’s visit to another shop `/book` lists', async () => {
      const { store, run } = rig(
        withMladost(LocationStatus.Active, LocationStatus.Active),
      );
      const answer = await run(toMladost);
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)?.['locationId']).toBe(MLADOST);
    });

    it.each([['hidden', LocationStatus.Hidden]])(
      'refuses a client moving their visit INTO a shop `/book` does not list (%s) — the commit’s answer, nothing written',
      async (_label, status) => {
        const { store, tx, run } = rig(
          withMladost(LocationStatus.Active, status),
        );
        const answer = await run(toMladost);
        expect(!answer.ok && answer.error).toMatchObject({
          errorCode: BookingErrorCode.InvalidInput,
          field: 'locationId',
          reason: 'unlisted',
        });
        expect(tx.plans).toEqual([]);
        expect(store.get(PATH)?.['locationId']).toBe(FIXTURE_IDS.location);
      },
    );

    it('lets the client move their visit OUT of a hidden shop, to one `/book` lists', async () => {
      const { store, run } = rig(
        withMladost(LocationStatus.Hidden, LocationStatus.Active),
      );
      const answer = await run(toMladost);
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)?.['locationId']).toBe(MLADOST);
    });
  });
});
