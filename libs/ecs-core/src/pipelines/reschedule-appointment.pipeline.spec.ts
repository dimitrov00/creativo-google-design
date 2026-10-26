import {
  Actor,
  AuditAction,
  BlockKind,
  BookingPolicy,
  type DocBody,
  type DocPath,
  LocationStatus,
  MinuteBlock,
  SeatLabel,
  SeatOccupant,
  SeatOutcome,
  SeatSubject,
  ServiceStatus,
  SubjectRelationship,
  WriteAction,
  type WriteOp,
  type BookingCall,
  RequestedSubjectRole,
} from '@core/components';
import {
  BarberBusyDayId,
  BarberId,
  BusyKey,
  ClientOperationId,
  CustomerId,
  LocationId,
  LogEvent,
  OperationId,
  Result,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import {
  BookingErrorCode,
  CarriedSeatRefusal,
  MoveErrorCode,
  RepositoryErrorCode,
  TimeErrorCode,
} from '@core/errors';
import { type Appointment, type AuditEntry, Collections } from '@core/entities';
import { AuditSystem, MoveSystem } from '@core/systems';
import {
  appointmentFixture,
  at,
  auditRowsOf,
  barberBusyDayFixture,
  barberScheduleFixture,
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
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
  rescheduleAppointment,
} from './reschedule-appointment.pipeline';

const THURSDAY = localDate('2026-10-01');
const FRIDAY = localDate('2026-10-02');
const ATTEMPT = ((): ClientOperationId => {
  const id = ClientOperationId.parse('move-attempt-0123456789');
  if (!id.ok) throw new Error('a broken fixture');
  return id.value;
})();
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

/** The booker's cut on Friday at 11:00 — the call carries the minute of the request's day. */
const CART_SEAT: BookingCall.SeatInput = {
  lineId: 'line-1',
  serviceId: FIXTURE_IDS.service,
  variantId: null,
  barberId: FIXTURE_IDS.barber,
  barberPreference: null,
  startMinutes: 660,
  subject: { requestedSubjectRole: RequestedSubjectRole.Self },
};

function command(
  extra: Partial<RescheduleAppointmentCommand> = {},
): RescheduleAppointmentCommand {
  return {
    appointmentId: FIXTURE_IDS.appointment,
    callerUserId: FIXTURE_IDS.client,
    locationId: FIXTURE_IDS.location,
    localDate: FRIDAY,
    seats: [CART_SEAT],
    attemptId: ATTEMPT,
    operationId: OperationId.of(ATTEMPT),
    actor: Actor.user(FIXTURE_IDS.client),
    ...extra,
  };
}

function rig(
  documents: readonly { readonly path: DocPath; readonly body: DocBody }[],
) {
  const store = memoryStore(documents);
  const tx = memoryTxPorts(store);
  // The rows the committed plans created (WS-1: inside the act's commit).
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  const contended = contendedCommit(tx.commit);
  const pipeline = rescheduleAppointment({
    ...tx,
    commit: contended.commit,
    ...telemetry,
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
  });
  const run: typeof pipeline = async (cmd) => {
    const answer = await pipeline(cmd);
    rows.splice(0, rows.length, ...auditRowsOf(tx.plans));
    return answer;
  };
  return { store, tx, rows, telemetry, run, decisions: contended.decisions };
}

/** The row a move of the fixture visit files for its client (`move:<attemptId>`). */
const MOVE_ROW = fixtureHash(
  AuditSystem.rowBasis(
    AuditAction.BookingRescheduled,
    FIXTURE_IDS.appointment,
    FIXTURE_IDS.customer,
    `move:${ATTEMPT}`,
  ),
);

function stored(appointment: Appointment) {
  return {
    path: [Collections.Appointments, appointment.id],
    body: bodyOf(appointment),
  };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

const digestOf = (cmd: RescheduleAppointmentCommand): string =>
  fixtureHash(
    MoveSystem.digestBasis({
      locationId: cmd.locationId,
      localDate: cmd.localDate,
      seats: cmd.seats,
    }),
  ).slice(0, 16);

describe('rescheduleAppointment — the client moving their own visit', () => {
  it('moves the visit in ONE plan: its Update (revision, ledger), the busy Set of the NEW day only and, last, the act’s row (WS-1)', async () => {
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
      [WriteAction.Create, `${Collections.AuditLog}/${MOVE_ROW}`],
    ]);
    expect(plan.at(-1)).toEqual({
      writeAction: WriteAction.Create,
      path: [Collections.AuditLog, MOVE_ROW],
      body: {
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: FIXTURE_IDS.appointment,
        auditOperationId: ATTEMPT,
        ...Actor.user(FIXTURE_IDS.client),
        auditAction: AuditAction.BookingRescheduled,
        rescheduleRevision: 2,
        auditTarget: 'CUSTOMER',
        targetCustomerId: FIXTURE_IDS.customer,
      },
    });
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
    });
    // `loggedOnRetry` is gone (DEP-7, RU-10): a replay files no row.
    expect(rows[0]).not.toHaveProperty('loggedOnRetry');
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

  it('keys the row `move:<attemptId>` — every move is named (WS-4.1), the key byte for byte today’s', async () => {
    // The unnamed move (`attemptId: null` → `revision:<n>`) is gone: the
    // edge refuses a move without its attempt id, and the web always sent one.
    const { rows, run } = rig([...catalogue(), stored(visit())]);
    expect((await run(command())).ok).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingRescheduled,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          'move:move-attempt-0123456789',
        ),
      ),
    ]);
  });

  it('a request for exactly where the visit already is changes nothing and logs nothing', async () => {
    const { tx, rows, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({
        localDate: THURSDAY,
        seats: [{ ...CART_SEAT, startMinutes: 600 }],
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

  it('a re-sent named move answers its original revision, writes nothing and plans ZERO audit ops (WS-1, DEP-7)', async () => {
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
    expect(rows).toEqual([]);
  });

  it('the same move twice on one store: the second answers the first’s revision as a replay, ZERO audit ops', async () => {
    const { tx, rows, run } = rig([...catalogue(), stored(visit())]);
    const first = await run(command());
    const second = await run(command());
    expect(first).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: false,
      },
    });
    expect(second).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: true,
      },
    });
    expect(tx.plans[1]).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual([MOVE_ROW]);
  });

  it('commits the move without a row when no verified actor is known, and logs it loudly', async () => {
    const { store, tx, rows, telemetry, run } = rig([
      ...catalogue(),
      stored(visit()),
    ]);
    const answer = await run(command({ actor: null }));
    expect(answer.ok).toBe(true);
    expect(store.get(PATH)?.['revision']).toBe(2);
    expect(
      (tx.plans[0] ?? []).some((op) => op.path[0] === Collections.AuditLog),
    ).toBe(false);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingRescheduled,
          resourceId: FIXTURE_IDS.appointment,
        },
      },
    ]);
  });

  it('a Create of a row already there refuses the WHOLE move as REPOSITORY_ALREADY_EXISTS — nothing applied', async () => {
    const { store, tx, run } = rig([
      ...catalogue(),
      stored(visit()),
      { path: [Collections.AuditLog, MOVE_ROW], body: { seeded: true } },
    ]);
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(store.get(PATH)?.['revision']).toBe(1);
    expect(tx.plans).toEqual([]);
  });

  it('a contention re-run of the decision derives the identical rows', async () => {
    const { decisions, run } = rig([...catalogue(), stored(visit())]);
    expect((await run(command())).ok).toBe(true);
    expect(decisions).toHaveLength(2);
    const auditOf = (plan: readonly WriteOp[] | undefined) =>
      (plan ?? []).filter((op) => op.path[0] === Collections.AuditLog);
    expect(auditOf(decisions[0])).toHaveLength(1);
    expect(auditOf(decisions[1])).toEqual(auditOf(decisions[0]));
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

  it('keeps a walk-in the shop seated on their record through the move — the cart names them by label (OR-26)', async () => {
    const record = CustomerId.of('cus_0123456789abcdef0123');
    const walkIn = seatFixture({
      seatId: SeatId.of('seat-maria'),
      startMinutes: at(10, 30),
      occupant: SeatOccupant.walkIn(record, SeatLabel.of('Мария')),
    });
    const { store, run } = rig([
      ...catalogue(),
      stored(
        visit({
          seats: [seatFixture(), walkIn],
          subjectCustomerIds: [FIXTURE_IDS.customer, record],
        }),
      ),
    ]);
    const answer = await run(
      command({
        seats: [
          CART_SEAT,
          {
            ...CART_SEAT,
            lineId: 'line-2',
            startMinutes: 690,
            // Whatever contact a client's cart sends, it files nothing.
            subject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: 'Мария',
              guestKey: null,
              contact: null,
            },
          },
        ],
      }),
    );
    expect(answer.ok).toBe(true);
    const moved = store.get(PATH);
    expect(moved?.['subjectCustomerIds']).toEqual(
      [FIXTURE_IDS.customer, record].sort(),
    );
    expect(
      (moved?.['seats'] as readonly Record<string, unknown>[])[1],
    ).toMatchObject({
      seatSubject: SeatSubject.WalkIn,
      subjectCustomerId: record,
      guestLabel: 'Мария',
      startMinutes: at(11, 30),
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

    /*
     * A carried seat keeps its distance from the booker, so it lands on a
     * minute the request never named. Europe/Sofia springs 03:00 → 04:00 on
     * 2027-03-28: the cart's own start is on the clock, the companion's is
     * not — refused, never written with the cart's instant.
     */
    it.each([
      ['before the booker, starting the envelope', at(9, 30), 240, at(3, 30)],
      ['after the booker', at(10, 30), 165, at(3, 15)],
    ])(
      'refuses a carried seat that lands inside the spring-forward gap (%s) DST_GAP_INVALID_TIME, writing nothing',
      async (_label, sonStart, cartStart, landsAt) => {
        const gapDay = localDate('2027-03-28');
        const { store, tx, rows, run } = rig([
          ...catalogue(),
          stored(
            visit({
              seats: [seatFixture(), { ...son, startMinutes: sonStart }],
            }),
          ),
        ]);
        const answer = await run(
          command({
            localDate: gapDay,
            seats: [{ ...CART_SEAT, startMinutes: cartStart }],
          }),
        );
        expect(!answer.ok && answer.error).toEqual({
          errorCode: TimeErrorCode.DstGap,
          localDate: gapDay,
          minute: landsAt,
          timeZone: FIXTURE_TIME_ZONE,
        });
        expect(tx.plans).toEqual([]);
        expect(store.get(PATH)).toMatchObject({
          localDate: THURSDAY,
          utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
          revision: 1,
        });
        expect(rows).toEqual([]);
      },
    );

    it('stamps the envelope’s instant from the carried seat that starts it, not the cart', async () => {
      const { store, run } = rig([
        ...catalogue(),
        stored(
          visit({
            seats: [seatFixture(), { ...son, startMinutes: at(9, 30) }],
          }),
        ),
      ]);
      const answer = await run(command());
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)).toMatchObject({
        localDate: FRIDAY,
        startMinutes: at(10, 30),
        utcEpochMs: utcMs('2026-10-02T10:30:00.000+03:00'),
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

  it('refuses a start that did not parse (startMinutes), and a shop that is not there', async () => {
    const { run } = rig([...catalogue(), stored(visit())]);
    const unparsed = await run(
      command({ seats: [{ ...CART_SEAT, startMinutes: null }] }),
    );
    expect(!unparsed.ok && unparsed.error).toMatchObject({
      field: 'startMinutes',
    });
    const missing = await run(command({ locationId: 'loc-gone' }));
    expect(!missing.ok && missing.error).toMatchObject({
      field: 'locationId',
      reason: 'not_found',
    });
    // A reserved name is the parse's refusal (OR-44), refused unread as an
    // invalid request (DEP-F31), not as a shop not found.
    for (const locationId of ['..', '__x__']) {
      const reserved = await run(command({ locationId }));
      expect(!reserved.ok && reserved.error, locationId).toEqual({
        errorCode: 'BOOKING_INVALID_INPUT',
        field: 'locationId',
        detail: null,
        reason: null,
      });
    }
  });

  it('refuses a cart start inside the spring-forward gap DST_GAP_INVALID_TIME, writing nothing (4A-2 (a))', async () => {
    const { tx, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({
        localDate: localDate('2027-03-28'),
        seats: [{ ...CART_SEAT, startMinutes: 210 }],
      }),
    );
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: TimeErrorCode.DstGap,
    });
    expect(tx.plans).toEqual([]);
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
          localDate: THURSDAY,
          seats: [{ ...CART_SEAT, startMinutes: 585 }],
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
