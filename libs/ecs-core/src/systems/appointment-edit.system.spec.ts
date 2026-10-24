import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AppliedOperation,
  AuditAction,
  BarberPreference,
  BookingCall,
  BookingLifecycle,
  DiscountMethod,
  DiscountSource,
  RequestedSubjectRole,
  SeatLabel,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
  ServiceTerms,
  StaffTermsOverride,
  VoucherCode,
  WallTime,
  EditCommand,
  ResizeEdge,
} from '@core/components';
import {
  BookingStatus,
  Currency,
  DurationMinutes,
  BarberId,
  CouponGrantId,
  LocationId,
  OperationId,
  SeatId,
  SeatKeyText,
  ServiceId,
  LocalDate,
  type EndMinute,
  type MinuteOfDay,
  PriceCents,
  Result,
  type UtcEpochMs,
} from '@core/primitives';
import { BookingError, StaffEditErrorCode } from '@core/errors';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  endMinute,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  type AppointmentFixtureOverrides,
  appointmentFixture,
  seatFixture,
  type SeatFixtureOverrides,
  resolvedCustomerIds,
  customerOf,
} from '@core/testing';
import {
  AppointmentEditSystem,
  type EditCommandRequest,
  LedgerVerdict,
} from './appointment-edit.system';
import { BillPending } from './billing.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The digest case of apps/functions/src/use-cases/
 * staff-edit-appointment.operations.spec.ts, the ledger's CAP / newest / unique
 * cases of the legacy booking application lib's
 * `applied-operations-document.spec.ts:72-170` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1; as properties — the
 * companion spec holds the examples), and the FOLD's math of
 * staff-edit-appointment.use-case.spec.ts (move, resize, services added and
 * removed, the acts that are not geometry, the revision, the ledger, the batch)
 * — copied, on the shop's wall clock; the decision that prices and places the
 * folded seats is BookingDecisionSystem's.
 */

/** A point on the fixture shop's wall clock today. */
const at = (hour: number, min = 0): MinuteOfDay => minute(hour * 60 + min);
const endAt = (hour: number, min = 0): EndMinute => endMinute(hour * 60 + min);
const IVAN = BarberId.of('ivan');
const PETAR = BarberId.of('petar');
const FADE = ServiceId.of('svc-fade');
const TOMORROW = LocalDate.addDays(FIXTURE_TODAY, 1);

function seat(
  id: string,
  overrides: SeatFixtureOverrides & { readonly minutes?: number } = {},
): Seat {
  const { minutes, ...rest } = overrides;
  return seatFixture({
    seatId: SeatId.of(id),
    serviceId: FADE,
    barberId: IVAN,
    startMinutes: at(10),
    terms: Seat.termsOf(
      ServiceTerms.unpadded(
        unwrapOk(PriceCents.of(4000)),
        Currency.EUR,
        unwrapOk(DurationMinutes.of(minutes ?? 45)),
      ),
      null,
    ),
    ...rest,
  });
}

/** The stored visit: one 45-minute, 40,00 € fade with Ivan at 10:00. */
function stored(
  seats: readonly Seat[] = [seat('seat-1')],
  overrides: AppointmentFixtureOverrides = {},
): Appointment {
  return appointmentFixture({ seats, ...overrides });
}

const guest = SeatOccupant.anonymous(unwrapOk(SeatLabel.parse('Гост')));

/** The client records the pipeline resolves for an added account seat (D29). */
const RESOLVED = resolvedCustomerIds([FIXTURE_IDS.client]);

function fold(
  commands: EditCommandRequest | readonly EditCommandRequest[],
  appointment: Appointment = stored(),
) {
  return AppointmentEditSystem.fold(
    appointment,
    Array.isArray(commands) ? commands : [commands as EditCommandRequest],
    RESOLVED,
  );
}

function seats(
  commands: EditCommandRequest | readonly EditCommandRequest[],
  appointment?: Appointment,
) {
  return unwrapOk(fold(commands, appointment)).seats;
}

const ids = (seatIds: readonly string[] | null) =>
  seatIds === null ? null : seatIds.map(SeatId.of);

const move = (
  startMinutes: MinuteOfDay,
  seatIds: readonly string[] | null = null,
  localDate: LocalDate = FIXTURE_TODAY,
): EditCommandRequest => ({
  editCommand: EditCommand.Move,
  localDate,
  startMinutes,
  seatIds: ids(seatIds),
});
const resizeEnd = (
  atMinutes: EndMinute,
  seatIds: readonly string[] | null = null,
): EditCommandRequest => ({
  editCommand: EditCommand.Resize,
  resizeEdge: ResizeEdge.End,
  atMinutes,
  seatIds: ids(seatIds),
});
const resizeStart = (
  atMinutes: MinuteOfDay,
  seatIds: readonly string[] | null = null,
): EditCommandRequest => ({
  editCommand: EditCommand.Resize,
  resizeEdge: ResizeEdge.Start,
  atMinutes,
  seatIds: ids(seatIds),
});
/**
 * The boundary's half of an added seat: its end placed on the absolute
 * timeline by the zone (the fold never converts) — today's wall clock in the
 * fixture shop unless a test hands its own instant.
 */
const endInstant = (startMinutes: MinuteOfDay, minutes: number) =>
  unwrapOk(
    ZonedTimeSystem.toUtc(
      FIXTURE_TODAY,
      minute(startMinutes + minutes),
      FIXTURE_TIME_ZONE,
    ),
  );
const addSeat = (
  seatId: string,
  startMinutes: MinuteOfDay,
  minutes: number,
  barberId: BarberId = IVAN,
  workedAtUtcMs: UtcEpochMs = endInstant(startMinutes, minutes),
): EditCommandRequest => ({
  editCommand: EditCommand.AddSeat,
  seatId: SeatId.of(seatId),
  serviceId: FADE,
  variantId: null,
  barberId,
  startMinutes,
  durationMinutes: unwrapOk(DurationMinutes.of(minutes)),
  workedAtUtcMs,
  // The request names the account; its client record is the fold's (D29).
  seatSubject: SeatSubject.Account,
  subjectUserId: FIXTURE_IDS.client,
  subjectRelationship: SubjectRelationship.Self,
});
const removeSeat = (seatId: string): EditCommandRequest => ({
  editCommand: EditCommand.RemoveSeat,
  seatId: SeatId.of(seatId),
});

const invalid = (field: string) => ({
  errorCode: StaffEditErrorCode.InvalidCommand,
  field,
});

describe('AppointmentEditSystem.digestBasis — the fingerprint of one intent', () => {
  const MOVE = {
    editCommand: 'MOVE',
    localDate: '2026-08-03',
    startMinutes: 660,
  };

  it('is the same for the same batch and different for a different one', () => {
    expect(AppointmentEditSystem.digestBasis([MOVE])).toBe(
      AppointmentEditSystem.digestBasis([{ ...MOVE }]),
    );
    expect(AppointmentEditSystem.digestBasis([MOVE])).not.toBe(
      AppointmentEditSystem.digestBasis([{ ...MOVE, startMinutes: 720 }]),
    );
    const resized = {
      editCommand: 'RESIZE',
      resizeEdge: 'END',
      localDate: MOVE.localDate,
      atMinutes: MOVE.startMinutes,
    };
    expect(AppointmentEditSystem.digestBasis([MOVE, resized])).not.toBe(
      AppointmentEditSystem.digestBasis([resized, MOVE]),
    );
  });

  it('is the tagged JSON of the batch whatever goes in — the pipeline hashes it', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue(), { maxLength: 6 }), (commands) => {
        const basis = AppointmentEditSystem.digestBasis(commands);
        expect(basis).toBe(JSON.stringify(['staff-operation/v1', commands]));
        expect(JSON.parse(basis)[0]).toBe('staff-operation/v1');
      }),
    );
  });
});

describe('AppointmentEditSystem — the intents a visit has applied', () => {
  const entry = (id: string, revision: number): AppliedOperation => ({
    operationId: OperationId.of(id),
    revision,
    digest: `d-${id}`,
  });
  const recorded = (names: readonly string[]): readonly AppliedOperation[] => {
    let ledger: readonly AppliedOperation[] = [];
    names.forEach((id, index) => {
      ledger = AppointmentEditSystem.record(
        ledger,
        OperationId.of(id),
        index + 1,
        `d-${id}`,
      );
    });
    return ledger;
  };

  it('finds a recorded intent, and nothing it never recorded', () => {
    const ledger = AppointmentEditSystem.record(
      [],
      OperationId.of('op-a'),
      4,
      'd-op-a',
    );
    expect(AppliedOperation.find(ledger, OperationId.of('op-a'))).toEqual(
      entry('op-a', 4),
    );
    expect(AppliedOperation.find(ledger, OperationId.of('op-b'))).toBeNull();
  });

  it('is immutable: recording returns a new ledger', () => {
    const empty: readonly AppliedOperation[] = deepFreeze([]);
    const one = AppointmentEditSystem.record(
      empty,
      OperationId.of('op-a'),
      1,
      'd',
    );
    expect(empty).toEqual([]);
    expect(one).toHaveLength(1);
  });

  it('keeps at most CAP intents, the newest, oldest first', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          maxLength: AppliedOperation.CAP * 3,
        }),
        (names) => {
          const ledger = recorded(names);
          const kept = names.slice(-AppliedOperation.CAP);
          expect(ledger.map((known) => known.operationId)).toEqual(kept);
          for (const [index, id] of names.entries()) {
            const found = AppliedOperation.find(ledger, OperationId.of(id));
            if (kept.includes(id)) expect(found?.revision).toBe(index + 1);
            else expect(found).toBeNull();
          }
        },
      ),
    );
  });

  it('never holds one name twice — a re-recorded name moves to the newest place', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('op-a', 'op-b', 'op-c', 'op-d'), {
          maxLength: 40,
        }),
        (names) => {
          const kept = recorded(names).map((known) => known.operationId);
          expect(new Set(kept).size).toBe(kept.length);
          if (names.length > 0) expect(kept.at(-1)).toBe(names.at(-1));
        },
      ),
    );
  });

  it('answers a re-sent intent from the ledger, and refuses a known name on a DIFFERENT batch', () => {
    const op1 = OperationId.of('op-1');
    const ledger = AppointmentEditSystem.record([], op1, 5, 'abc');
    expect(AppointmentEditSystem.ledgerVerdict(ledger, op1, 'abc')).toEqual({
      ledgerVerdict: LedgerVerdict.Replay,
      applied: { operationId: 'op-1', revision: 5, digest: 'abc' },
    });
    expect(
      AppointmentEditSystem.ledgerVerdict(ledger, op1, 'xyz').ledgerVerdict,
    ).toBe(LedgerVerdict.Mismatch);
    expect(
      AppointmentEditSystem.ledgerVerdict(ledger, OperationId.of('op-2'), 'abc')
        .ledgerVerdict,
    ).toBe(LedgerVerdict.New);
  });
});

describe('AppointmentEditSystem.checkRevision — the revision', () => {
  it('refuses a save drawn from a screen the book has moved past', () => {
    expect(
      unwrapErr(
        AppointmentEditSystem.checkRevision(
          stored([seat('s')], { revision: 3 }),
          2,
        ),
      ),
    ).toEqual({
      errorCode: StaffEditErrorCode.Stale,
      expected: 2,
      actual: 3,
    });
  });

  it('does not refuse a caller that made no claim about what it read', () => {
    expect(
      AppointmentEditSystem.checkRevision(
        stored([seat('s')], { revision: 3 }),
        null,
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it('takes a claim of revision 0 — every visit written before the counter', () => {
    expect(
      AppointmentEditSystem.checkRevision(
        stored([seat('s')], { revision: 0 }),
        0,
      ).ok,
    ).toBe(true);
  });
});

describe('AppointmentEditSystem.fold — move', () => {
  it('shifts the start and holds the duration', () => {
    const [moved] = seats(move(at(14)));
    expect(moved?.startMinutes).toBe(at(14));
    expect(moved?.durationMinutes).toBe(45);
  });

  it('shifts every seat of a party by ONE delta, preserving the arrangement', () => {
    const party = stored([
      seat('seat-1'),
      seat('seat-2', {
        barberId: PETAR,
        startMinutes: at(10, 45),
        occupant: guest,
      }),
    ]);
    expect(seats(move(at(12)), party).map((s) => s.startMinutes)).toEqual([
      at(12),
      at(12, 45),
    ]);
  });

  it('shifts ONLY the named seats, leaving the rest of the party put', () => {
    const party = stored([
      seat('seat-1'),
      seat('seat-2', {
        barberId: PETAR,
        startMinutes: at(10, 45),
        occupant: guest,
      }),
    ]);
    expect(
      seats(move(at(12), ['seat-2']), party).map((s) => s.startMinutes),
    ).toEqual([at(10), at(12)]);
  });

  it('moves the whole party to another day, onto that day’s wall clock', () => {
    const outcome = unwrapOk(fold(move(at(9), null, TOMORROW)));
    expect(outcome.localDate).toBe(TOMORROW);
    expect(outcome.seats[0]?.startMinutes).toBe(at(9));
  });

  it('refuses to take PART of a party to another day — one shop day per visit', () => {
    const party = stored([
      seat('seat-1'),
      seat('seat-2', { barberId: PETAR, occupant: guest }),
    ]);
    expect(unwrapErr(fold(move(at(9), ['seat-2'], TOMORROW), party))).toEqual(
      invalid('startMinutes'),
    );
  });

  it('refuses a move that would carry a seat past midnight', () => {
    expect(unwrapErr(fold(move(at(23, 30))))).toEqual(invalid('startMinutes'));
  });

  it('refuses a scope naming a seat this booking does not have', () => {
    expect(unwrapErr(fold(move(at(12), ['seat-99'])))).toEqual(
      invalid('seatIds'),
    );
  });

  it('refuses an EMPTY scope rather than widening it to the whole party', () => {
    expect(unwrapErr(fold(move(at(12), [])))).toEqual(invalid('seatIds'));
  });

  it('resizes only the scoped seat, not whichever runs latest', () => {
    const party = stored([
      seat('seat-1', { minutes: 90 }),
      seat('seat-2', { barberId: PETAR, occupant: guest }),
    ]);
    expect(
      seats(resizeEnd(endAt(11), ['seat-2']), party).map(
        (s) => s.durationMinutes,
      ),
    ).toEqual([90, 60]);
  });

  // The move-preservation cases of staff-edit-appointment.use-case.spec.ts
  // (L666-L716, L1568), one per legacy case: a move is not a re-sale.
  it('preserves a recorded tip across a move', () => {
    const tipped = stored([
      Seat.withTip(seat('seat-1'), unwrapOk(PriceCents.of(700))),
    ]);
    const [moved] = seats(move(at(12)), tipped);
    expect(moved?.tipCents).toBe(700);
    expect(moved?.priceCents).toBe(4000);
  });

  it('preserves a ZERO tip, which is a recording and not an absence', () => {
    const tipped = stored([Seat.withTip(seat('seat-1'), PriceCents.ZERO)]);
    const [moved] = seats(move(at(12)), tipped);
    expect(moved?.tipCents).toBe(0);
  });

  it('leaves an untipped seat untipped rather than defaulting it to zero', () => {
    const [moved] = seats(move(at(12)));
    expect(moved?.tipCents).toBeNull();
  });

  it('keeps the seat ids, so per-seat actions are not orphaned', () => {
    expect(seats(move(at(11))).map((s) => s.seatId)).toEqual(['seat-1']);
  });

  it('keeps `barberPreference` — the fact that decides whether staff may phone', () => {
    const asked = stored([
      seat('seat-1', { barberPreference: BarberPreference.Specific }),
    ]);
    expect(seats(move(at(11)), asked)[0]?.barberPreference).toBe('SPECIFIC');
    const any = stored([
      seat('seat-1', { barberPreference: BarberPreference.Any }),
    ]);
    expect(seats(move(at(11)), any)[0]?.barberPreference).toBe('ANY');
  });

  // §11.2 #6: a drag of a legacy seat must not invent a request the client
  // never made.
  it('keeps an unknown `barberPreference` unknown', () => {
    const legacy = stored([seat('seat-1', { barberPreference: null })]);
    expect(seats(move(at(11)), legacy)[0]?.barberPreference).toBeNull();
  });

  it('restores per-seat OUTCOMES, so a party mid-service stays movable', () => {
    const workedAt = utcMs('2026-09-28T10:30:00+03:00');
    const mid = stored([
      seat('seat-1', { outcome: SeatOutcome.worked(workedAt) }),
      seat('seat-2', {
        barberId: PETAR,
        startMinutes: at(10, 45),
        occupant: guest,
      }),
    ]);
    expect(seats(move(at(11)), mid).map((s) => s.attendanceState)).toEqual([
      'WORKED',
      'SCHEDULED',
    ]);
    expect(seats(move(at(11)), mid)[0]).toMatchObject({
      workedAtUtcMs: workedAt,
    });
  });
});

describe('AppointmentEditSystem.guard — what may be corrected at all', () => {
  // staff-edit-appointment.use-case.spec.ts L1559, L1598, L1609.
  // The folded seats as they are (P-10, zero inbound mapping): a start and a duration.
  const sold = (start: MinuteOfDay, minutes: number) => ({
    startMinutes: start,
    durationMinutes: unwrapOk(DurationMinutes.of(minutes)),
  });
  const arrived = (point: MinuteOfDay) => WallTime.of(FIXTURE_TODAY, point);

  it('refuses a move that would END the visit before its arrival stamp', () => {
    // Arrived 09:55; moved to 08:00 for 45 minutes, it would end at 08:45.
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        [sold(at(8), 45)],
        arrived(at(9, 55)),
      ),
    ).toEqual({
      errorCode: StaffEditErrorCode.BeforeArrival,
      localDate: FIXTURE_TODAY,
      finishMinutes: 525,
      arrivalLocalDate: FIXTURE_TODAY,
      arrivalMinutes: 595,
    });
    // Ending AT the stamp is still before it; one minute after is not.
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        [sold(at(9), 55)],
        arrived(at(9, 55)),
      )?.errorCode,
    ).toBe(StaffEditErrorCode.BeforeArrival);
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        [sold(at(9), 56)],
        arrived(at(9, 55)),
      ),
    ).toBeNull();
    // The visit ends with its LAST seat, not its first.
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        [sold(at(8), 30), sold(at(9, 30), 45)],
        arrived(at(9, 55)),
      ),
    ).toBeNull();
    // No stamp, nothing to hold.
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        [sold(at(8), 45)],
        null,
      ),
    ).toBeNull();
  });

  it('compares across days on the wall clock — a visit moved to the day before its arrival ends before it', () => {
    const yesterday = LocalDate.addDays(FIXTURE_TODAY, -1);
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        yesterday,
        [sold(at(18), 45)],
        arrived(at(9, 55)),
      )?.errorCode,
    ).toBe(StaffEditErrorCode.BeforeArrival);
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        TOMORROW,
        [sold(at(8), 45)],
        arrived(at(9, 55)),
      ),
    ).toBeNull();
  });

  it('refuses to touch a visit that never happened — cancelled is history', () => {
    for (const state of [BookingStatus.Cancelled, BookingStatus.NoShow]) {
      expect(
        AppointmentEditSystem.guard(
          state,
          FIXTURE_TODAY,
          [sold(at(11), 45)],
          null,
        ),
      ).toEqual({
        errorCode: 'BOOKING_INVALID_INPUT',
        field: 'bookingStatus',
        detail: null,
        reason: null,
      });
    }
  });

  it('lets a FINISHED visit be corrected — the sheet is filled in after the cut', () => {
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Completed,
        FIXTURE_TODAY,
        [sold(at(11), 45)],
        null,
      ),
    ).toBeNull();
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Pending,
        FIXTURE_TODAY,
        [sold(at(11), 45)],
        null,
      ),
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const spans = deepFreeze([sold(at(8), 45)]);
    const arrival = deepFreeze(arrived(at(9, 55)));
    const once = AppointmentEditSystem.guard(
      BookingStatus.Confirmed,
      FIXTURE_TODAY,
      spans,
      arrival,
    );
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        spans,
        arrival,
      ),
    ).toEqual(once);
  });
});

describe('AppointmentEditSystem.fold — resize', () => {
  it('`END` holds the start and writes a duration', () => {
    const [resized] = seats(resizeEnd(endAt(11, 30)));
    expect(resized?.startMinutes).toBe(at(10));
    expect(resized?.durationMinutes).toBe(90);
  });

  it('`START` holds the END and writes both', () => {
    const [resized] = seats(resizeStart(at(10, 15)));
    expect(resized?.startMinutes).toBe(at(10, 15));
    expect(resized === undefined ? null : Seat.endMinutes(resized)).toBe(
      endAt(10, 45),
    );
  });

  it('extends only the seats that OWN the edge', () => {
    const chain = stored([
      seat('seat-1'),
      seat('seat-2', {
        startMinutes: at(10, 45),
        barberId: PETAR,
        occupant: guest,
      }),
    ]);
    expect(
      seats(resizeEnd(endAt(12)), chain).map((s) => s.durationMinutes),
    ).toEqual([45, 75]);
  });

  it('refuses a resize that drives the duration to zero — as a DURATION', () => {
    expect(unwrapErr(fold(resizeEnd(endAt(10))))).toEqual(
      invalid('durationMinutes'),
    );
  });
});

describe('AppointmentEditSystem.fold — services added and removed', () => {
  it('adds a seat after the visit, unpriced — the decision prices it from the catalogue, not the client', () => {
    const outcome = unwrapOk(fold([addSeat('seat-2', at(10, 45), 30)]));
    expect(outcome.seats.map((s) => s.seatId)).toEqual(['seat-1', 'seat-2']);
    const added = outcome.seats[1];
    expect(added).toMatchObject({
      priceCents: 0,
      durationMinutes: 30,
      currency: 'EUR',
      catalogPriceCents: null,
      seatSubject: 'ACCOUNT',
      subjectRelationship: 'SELF',
    });
    expect(added?.startMinutes).toBe(at(10, 45));
    expect(added?.attendanceState).toBe('SCHEDULED');
    expect(outcome.freshSeatIds).toEqual(['seat-2']);
  });

  it('gives an added account seat the client record the pipeline resolved, beside its account (D29)', () => {
    const added = unwrapOk(fold([addSeat('seat-2', at(10, 45), 30)])).seats[1];
    expect(added).toMatchObject({
      seatSubject: 'ACCOUNT',
      subjectUserId: FIXTURE_IDS.client,
      subjectCustomerId: customerOf(FIXTURE_IDS.client),
    });
  });

  it('adds a guest as the guest it names — no record to resolve', () => {
    const added = unwrapOk(
      fold([
        {
          ...addSeat('seat-2', at(10, 45), 30),
          ...SeatOccupant.anonymous(SeatLabel.of('Гост 2')),
        } as EditCommandRequest,
      ]),
    ).seats[1];
    expect(added).toMatchObject({
      seatSubject: 'ANONYMOUS',
      guestLabel: 'Гост 2',
    });
    expect(added).not.toHaveProperty('subjectUserId');
  });

  it('refuses to invent a record: an unresolved account is the caller’s defect', () => {
    expect(() =>
      AppointmentEditSystem.fold(
        stored(),
        [addSeat('seat-2', at(10, 45), 30)],
        new Map(),
      ),
    ).toThrow(/client record/);
  });

  it('marks a seat added to a FINISHED visit as worked, not scheduled', () => {
    const done = stored([seat('seat-1')], {
      lifecycle: BookingLifecycle.complete(utcMs('2026-09-28T11:00:00+03:00')),
    });
    const added = seats([addSeat('seat-2', at(10, 45), 45)], done)[1];
    expect(added === undefined ? null : SeatOutcome.isResolved(added)).toBe(
      true,
    );
    expect(added).toMatchObject({
      attendanceState: 'WORKED',
      workedAtUtcMs: utcMs('2026-09-28T11:30:00+03:00'),
    });
  });

  it('stamps a seat added after the batch moved a finished visit to another day with the boundary’s instant, as given — never a wall-clock distance across days', () => {
    const done = stored([seat('seat-1')], {
      lifecycle: BookingLifecycle.complete(utcMs('2026-09-28T11:00:00+03:00')),
    });
    // The boundary placed 10:45 + 45 min on TOMORROW's wall clock itself.
    const end = utcMs('2026-09-29T11:30:00+03:00');
    const outcome = unwrapOk(
      fold(
        [
          move(at(10), null, TOMORROW),
          addSeat('seat-2', at(10, 45), 45, IVAN, end),
        ],
        done,
      ),
    );
    expect(outcome.localDate).toBe(TOMORROW);
    expect(outcome.seats[1]).toMatchObject({
      attendanceState: 'WORKED',
      workedAtUtcMs: end,
    });
  });

  it('removes a scheduled seat and keeps the others', () => {
    const two = stored([
      seat('seat-1'),
      seat('seat-2', { startMinutes: at(10, 45) }),
    ]);
    expect(seats(removeSeat('seat-2'), two).map((s) => s.seatId)).toEqual([
      'seat-1',
    ]);
  });

  it('refuses to remove the last seat, or one somebody already sat in', () => {
    expect(unwrapErr(fold(removeSeat('seat-1')))).toEqual(invalid('seatId'));
    const worked = stored([
      seat('seat-1'),
      seat('seat-2', {
        startMinutes: at(10, 45),
        outcome: SeatOutcome.worked(utcMs('2026-09-28T11:30:00+03:00')),
      }),
    ]);
    expect(unwrapErr(fold(removeSeat('seat-2'), worked))).toEqual(
      invalid('seatId'),
    );
  });

  it('applies an add before the resize that follows it in one batch', () => {
    expect(
      seats([
        addSeat('seat-2', at(10, 45), 45),
        move(at(10)),
        resizeEnd(endAt(11, 30)),
      ]).map((s) => s.durationMinutes),
    ).toEqual([45, 45]);
  });

  it('never hands a new seat a removed seat’s id — the batch that drops seat-2 cannot mint it again', () => {
    const pair = stored([seat('seat-1'), seat('seat-2', { barberId: PETAR })]);
    expect(
      unwrapErr(
        fold(
          [
            removeSeat('seat-2'),
            addSeat('seat-2', at(10), 45, BarberId.of('georgi')),
          ],
          pair,
        ),
      ),
    ).toEqual(invalid('seatId'));
  });
});

describe('AppointmentEditSystem.fold — the acts that are not geometry', () => {
  it('reprices ONE seat', () => {
    expect(
      seats({
        editCommand: EditCommand.Reprice,
        seatId: SeatId.of('seat-1'),
        priceCents: unwrapOk(PriceCents.of(2500)),
      })[0]?.priceCents,
    ).toBe(2500);
  });

  it('re-times ONE seat', () => {
    expect(
      seats({
        editCommand: EditCommand.Redurate,
        seatId: SeatId.of('seat-1'),
        durationMinutes: unwrapOk(DurationMinutes.of(30)),
      })[0]?.durationMinutes,
    ).toBe(30);
  });

  it('moves ONE seat to another chair', () => {
    expect(
      seats({
        editCommand: EditCommand.Restaff,
        seatId: SeatId.of('seat-1'),
        barberId: PETAR,
      })[0]?.barberId,
    ).toBe('petar');
  });

  it("moves the WHOLE visit to the other shop — the root's own fact, the seats untouched", () => {
    const outcome = unwrapOk(
      fold({
        editCommand: EditCommand.Relocate,
        locationId: LocationId.of('loc-mladost'),
      }),
    );
    expect(outcome.locationId).toBe('loc-mladost');
    expect(outcome.seats).toEqual(stored().seats);
  });

  it('refuses a seat the appointment does not have', () => {
    expect(
      unwrapErr(
        fold({
          editCommand: EditCommand.Reprice,
          seatId: SeatId.of('seat-99'),
          priceCents: unwrapOk(PriceCents.of(100)),
        }),
      ),
    ).toEqual(invalid('seatId'));
  });
});

describe('AppointmentEditSystem.fold — the batch', () => {
  it('folds several commands in order — the resize sees the move', () => {
    expect(
      seats([move(at(12)), resizeStart(at(12, 15))])[0]?.startMinutes,
    ).toBe(at(12, 15));
  });

  it('refuses the whole batch when one arm is refused', () => {
    expect(
      fold([
        move(at(12)),
        {
          editCommand: EditCommand.Redurate,
          seatId: SeatId.of('seat-99'),
          durationMinutes: unwrapOk(DurationMinutes.of(30)),
        },
      ]).ok,
    ).toBe(false);
  });

  it('refuses an empty batch rather than writing nothing quietly', () => {
    expect(unwrapErr(fold([]))).toEqual(invalid('commands'));
  });

  it('carries the bill’s and the place’s arms past the seats', () => {
    expect(
      seats([
        { editCommand: EditCommand.Discounts },
        { editCommand: EditCommand.Vouchers },
      ]),
    ).toEqual(stored().seats);
  });

  it('a whole-party move is undone by the move back (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -600, max: 600 }), (minutes) => {
        const party = stored([
          seat('seat-1'),
          seat('seat-2', {
            barberId: PETAR,
            startMinutes: at(10, 30),
            occupant: guest,
          }),
        ]);
        const there = seats(move(minute(600 + minutes)), party);
        const back = seats(move(at(10)), { ...party, seats: there });
        expect(back).toEqual(party.seats);
      }),
    );
  });
});

describe('AppointmentEditSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(
      stored([seat('seat-1'), seat('seat-2', { startMinutes: at(10, 45) })]),
    );
    const commands = deepFreeze([
      move(at(12)),
      resizeEnd(endAt(14)),
      addSeat('seat-3', at(14), 30),
    ]);
    const once = AppointmentEditSystem.fold(appointment, commands, RESOLVED);
    const twice = AppointmentEditSystem.fold(appointment, commands, RESOLVED);
    expect(twice).toEqual(once);
    expect(appointment.seats.map((s) => s.startMinutes)).toEqual([
      at(10),
      at(10, 45),
    ]);
  });
});

/*
 * PASS C (P-1…P-16, S-9, E-9): the staff edit's decisions moved out of
 * `edit-appointment.pipeline.ts` and the dashboard/editor — each restated
 * here as values on the fixtures above (the pipeline cases they came from
 * are named per block).
 */

/** The call's own `ADD_SEAT` on the fixture day — a guest unless it names the owner. */
const callAddSeat = (
  seatId: string,
  startMinutes: MinuteOfDay,
  minutes: number,
  addedSubject: BookingCall.AddedSubject = {
    requestedSubjectRole: RequestedSubjectRole.Guest,
    label: SeatLabel.of('Гост'),
  },
): BookingCall.EditCommand =>
  BookingCall.editAddSeat(
    SeatId.of(seatId),
    FADE,
    null,
    IVAN,
    FIXTURE_TODAY,
    startMinutes,
    unwrapOk(DurationMinutes.of(minutes)),
    addedSubject,
  );
const SELF_SUBJECT: BookingCall.AddedSubject = {
  requestedSubjectRole: RequestedSubjectRole.Self,
};

describe('AppointmentEditSystem.foldCommands — the call’s batch, resolved on the running clock (P-2)', () => {
  // edit-appointment.pipeline.spec.ts "a batch is a save — folded in order,
  // so the resize measures the MOVED seats" and the clock-of-every-chair
  // cases: the zone-dependent step is the caller's resolver; the fold, the
  // order and the running day are the system's.
  const asRequest = (command: EditCommandRequest) => Result.ok(command);

  it('resolves each command on the day the commands before it left, then applies it — the resize sees the move', () => {
    const days: LocalDate[] = [];
    const folded = unwrapOk(
      AppointmentEditSystem.foldCommands(
        stored(),
        [move(at(11), null, TOMORROW), resizeEnd(endAt(11, 45))],
        RESOLVED,
        (command, runningDay) => {
          days.push(runningDay);
          return asRequest(command);
        },
      ),
    );
    expect(days).toEqual([FIXTURE_TODAY, TOMORROW]);
    expect(folded.localDate).toBe(TOMORROW);
    expect(folded.seats[0]).toMatchObject({
      startMinutes: at(11),
      durationMinutes: 45,
    });
    expect(folded.requests).toEqual([
      move(at(11), null, TOMORROW),
      resizeEnd(endAt(11, 45)),
    ]);
  });

  it('answers the resolver’s refusal as it is, and stops there', () => {
    const refusal = { errorCode: 'TEST_REFUSED' } as const;
    let calls = 0;
    expect(
      AppointmentEditSystem.foldCommands(
        stored(),
        [move(at(11)), move(at(12))],
        RESOLVED,
        () => {
          calls++;
          return Result.err(refusal);
        },
      ),
    ).toEqual(Result.err(refusal));
    expect(calls).toBe(1);
  });

  it('refuses an empty batch as `commands`, and an empty visit as `seats`, before resolving anything (DEP-14)', () => {
    const never = () => {
      throw new Error('resolved an empty batch');
    };
    expect(
      unwrapErr(
        AppointmentEditSystem.foldCommands(stored(), [], RESOLVED, never),
      ),
    ).toEqual(invalid('commands'));
    expect(
      unwrapErr(
        AppointmentEditSystem.foldCommands(
          stored([]),
          [move(at(11))],
          RESOLVED,
          never,
        ),
      ),
    ).toEqual(invalid('seats'));
  });

  it('lands the visit at the batch’s LAST relocation, the seats untouched, and names every unheld seat fresh', () => {
    const elsewhere = LocationId.of('loc-other');
    const last = LocationId.of('loc-last');
    const folded = unwrapOk(
      AppointmentEditSystem.foldCommands(
        stored(),
        [
          { editCommand: EditCommand.Relocate, locationId: elsewhere },
          addSeat('seat-2', at(10, 45), 30),
          { editCommand: EditCommand.Relocate, locationId: last },
        ],
        RESOLVED,
        asRequest,
      ),
    );
    expect(folded.locationId).toBe(last);
    expect(folded.freshSeatIds).toEqual(['seat-2']);
    expect(folded.requests).toHaveLength(3);
  });

  it('is what `fold` answers for an already-resolved batch, minus the requests', () => {
    const batch = [move(at(12)), addSeat('seat-2', at(12, 45), 30)];
    const folded = unwrapOk(
      AppointmentEditSystem.foldCommands(stored(), batch, RESOLVED, asRequest),
    );
    const { requests, ...outcome } = folded;
    expect(requests).toEqual(batch);
    expect(unwrapOk(fold(batch))).toEqual(outcome);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(stored());
    const commands = deepFreeze([move(at(12)), resizeEnd(endAt(13))]);
    const once = AppointmentEditSystem.foldCommands(
      appointment,
      commands,
      RESOLVED,
      asRequest,
    );
    expect(
      AppointmentEditSystem.foldCommands(
        appointment,
        commands,
        RESOLVED,
        asRequest,
      ),
    ).toEqual(once);
    expect(appointment.seats[0]?.startMinutes).toBe(at(10));
  });
});

describe('AppointmentEditSystem.resizeEndOf — the bottom handle, from the running day (P-3)', () => {
  it('reads an end on the running day as it is', () => {
    expect(
      unwrapOk(
        AppointmentEditSystem.resizeEndOf(
          FIXTURE_TODAY,
          FIXTURE_TODAY,
          endAt(11, 30),
        ),
      ),
    ).toBe(690);
  });

  it('takes an end AT the running day’s closing midnight — 1440, all of the day', () => {
    expect(
      unwrapOk(
        AppointmentEditSystem.resizeEndOf(
          FIXTURE_TODAY,
          FIXTURE_TODAY,
          endAt(24),
        ),
      ),
    ).toBe(1440);
  });

  it('refuses an end at or before the running day’s start as `minutes`', () => {
    expect(
      unwrapErr(
        AppointmentEditSystem.resizeEndOf(
          FIXTURE_TODAY,
          LocalDate.addDays(FIXTURE_TODAY, -1),
          endAt(24),
        ),
      ),
    ).toEqual(invalid('minutes'));
    expect(
      unwrapErr(
        AppointmentEditSystem.resizeEndOf(
          TOMORROW,
          LocalDate.addDays(FIXTURE_TODAY, -1),
          endAt(12),
        ),
      ),
    ).toEqual(invalid('minutes'));
  });

  it('refuses an end past the running day’s closing midnight as `atMinutes`', () => {
    expect(
      unwrapErr(
        AppointmentEditSystem.resizeEndOf(
          FIXTURE_TODAY,
          TOMORROW,
          endAt(0, 15),
        ),
      ),
    ).toEqual(invalid('atMinutes'));
  });

  it('is pure: same input → same output', () => {
    const run = () =>
      AppointmentEditSystem.resizeEndOf(FIXTURE_TODAY, TOMORROW, endAt(1));
    expect(run()).toEqual(run());
  });
});

describe('AppointmentEditSystem.addedOccupantOf / addedAccounts — who an added seat is for (P-3, P-5)', () => {
  // edit-appointment.pipeline.spec.ts "an added SELF seat whose owner has no
  // client record…" and the fresh-seat cases.
  const OWNER = FIXTURE_IDS.client;
  const SEAT = SeatId.of('seat-9');

  it('seats the OWNER by their uid when the call asks for the owner and the visit has one', () => {
    expect(
      AppointmentEditSystem.addedOccupantOf(SELF_SUBJECT, OWNER, SEAT),
    ).toEqual({
      seatSubject: SeatSubject.Account,
      subjectUserId: OWNER,
      subjectRelationship: SubjectRelationship.Self,
    });
  });

  it('seats a guest by the label the call names', () => {
    expect(
      AppointmentEditSystem.addedOccupantOf(
        {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: SeatLabel.of('Мария'),
        },
        OWNER,
        SEAT,
      ),
    ).toEqual(SeatOccupant.anonymous(SeatLabel.of('Мария')));
  });

  it('seats an owner’s seat on an ownerless visit as a guest named by the seat’s id', () => {
    expect(
      AppointmentEditSystem.addedOccupantOf(SELF_SUBJECT, null, SEAT),
    ).toEqual(SeatOccupant.anonymous(SeatLabel.of('seat-9')));
  });

  it('names the owner once among the accounts a batch adds — guests, other commands and an ownerless visit add none', () => {
    const batch = [
      BookingCall.editMove(FIXTURE_TODAY, at(12), null),
      callAddSeat('seat-2', at(12, 45), 30),
      callAddSeat('seat-3', at(13, 15), 30, SELF_SUBJECT),
      callAddSeat('seat-4', at(13, 45), 30, SELF_SUBJECT),
    ];
    expect(AppointmentEditSystem.addedAccounts(batch, OWNER)).toEqual([OWNER]);
    expect(AppointmentEditSystem.addedAccounts(batch, null)).toEqual([]);
    expect(
      AppointmentEditSystem.addedAccounts(batch.slice(0, 2), OWNER),
    ).toEqual([]);
    expect(AppointmentEditSystem.addedAccounts([], OWNER)).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const batch = deepFreeze([callAddSeat('seat-3', at(13), 30, SELF_SUBJECT)]);
    const once = AppointmentEditSystem.addedAccounts(batch, OWNER);
    expect(AppointmentEditSystem.addedAccounts(batch, OWNER)).toEqual(once);
  });
});

describe('AppointmentEditSystem — the batch’s last word, its verb and its fingerprint (P-6, P-7, P-8)', () => {
  const grant = (id: string): BookingCall.StaffDiscount => ({
    discountSource: DiscountSource.Grant,
    grantId: CouponGrantId.of(id),
  });
  const percent: BookingCall.StaffDiscount = {
    discountSource: DiscountSource.Manual,
    discountMethod: DiscountMethod.PercentOff,
    discountPercent: 10,
  };

  it('reads the LAST discounts the batch names, or nothing (keep the stored set)', () => {
    expect(
      AppointmentEditSystem.lastDiscounts([
        BookingCall.editDiscounts([grant('g-1')]),
        BookingCall.editMove(FIXTURE_TODAY, at(12), null),
        BookingCall.editDiscounts([percent]),
      ]),
    ).toEqual([percent]);
    expect(
      AppointmentEditSystem.lastDiscounts([BookingCall.editDiscounts([])]),
    ).toEqual([]);
    expect(
      AppointmentEditSystem.lastDiscounts([
        BookingCall.editMove(FIXTURE_TODAY, at(12), null),
      ]),
    ).toBeNull();
  });

  it('reads the LAST vouchers the batch names, else keeps the stored lines', () => {
    const code = VoucherCode.of('GIFT-1');
    expect(
      AppointmentEditSystem.pendingVouchers([
        BookingCall.editVouchers([VoucherCode.of('OLD')]),
        BookingCall.editVouchers([code]),
      ]),
    ).toEqual({ billPending: BillPending.Set, codes: [code] });
    expect(
      AppointmentEditSystem.pendingVouchers([BookingCall.editVouchers([])]),
    ).toEqual({ billPending: BillPending.Set, codes: [] });
    expect(AppointmentEditSystem.pendingVouchers([])).toEqual({
      billPending: BillPending.Keep,
    });
  });

  it('reads the LAST relocation of a call’s batch or of a resolved one, or none', () => {
    const a = LocationId.of('loc-a');
    const b = LocationId.of('loc-b');
    expect(
      AppointmentEditSystem.relocatedTo([
        BookingCall.editRelocate(a),
        BookingCall.editRelocate(b),
      ]),
    ).toBe(b);
    expect(AppointmentEditSystem.relocatedTo([move(at(12))])).toBeNull();
  });

  it('audits a lone command under its own verb and anything else as a save', () => {
    expect(AppointmentEditSystem.auditVerb([move(at(12))])).toBe(
      AuditAction.BookingStaffMove,
    );
    expect(
      AppointmentEditSystem.auditVerb([
        BookingCall.editResizeEnd(FIXTURE_TODAY, endAt(11), null),
      ]),
    ).toBe(AuditAction.BookingStaffResize);
    expect(
      AppointmentEditSystem.auditVerb([BookingCall.editVouchers([])]),
    ).toBe(AuditAction.BookingStaffVouchers);
    expect(
      AppointmentEditSystem.auditVerb([move(at(12)), resizeEnd(endAt(13))]),
    ).toBe(AuditAction.BookingStaffSave);
    expect(AppointmentEditSystem.auditVerb([])).toBe(
      AuditAction.BookingStaffSave,
    );
  });

  it('keeps the first sixteen hex digits of the batch’s hash — the staff edit and the reschedule alike', () => {
    expect(AppointmentEditSystem.DIGEST_LENGTH).toBe(16);
    expect(
      AppointmentEditSystem.digestOf('0123456789abcdef0123456789abcdef'),
    ).toBe('0123456789abcdef');
    expect(AppointmentEditSystem.digestOf('abc')).toBe('abc');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const batch = deepFreeze([
      BookingCall.editDiscounts([percent]),
      BookingCall.editVouchers([VoucherCode.of('GIFT-1')]),
      BookingCall.editRelocate(LocationId.of('loc-a')),
    ]);
    const run = () => ({
      discounts: AppointmentEditSystem.lastDiscounts(batch),
      vouchers: AppointmentEditSystem.pendingVouchers(batch),
      place: AppointmentEditSystem.relocatedTo(batch),
      verb: AppointmentEditSystem.auditVerb(batch),
    });
    expect(run()).toEqual(run());
  });
});

describe('AppointmentEditSystem — the decision’s inputs and what it hands back (P-13, P-15, P-16)', () => {
  it('asks only the batch’s FRESH seats for a chair the shop rosters (barberId)', () => {
    const party = [seat('seat-1'), seat('seat-2', { barberId: PETAR })];
    expect(
      AppointmentEditSystem.freshSeatsRostered(
        party,
        [SeatId.of('seat-2')],
        [{ id: PETAR }],
      ),
    ).toBe(true);
    expect(
      AppointmentEditSystem.freshSeatsRostered(
        party,
        [SeatId.of('seat-2')],
        [{ id: IVAN }],
      ),
    ).toBe(false);
    // A stored seat is never asked — the visit already holds its chair.
    expect(AppointmentEditSystem.freshSeatsRostered(party, [], [])).toBe(true);
  });

  it('carries every STORED seat’s terms into the decision, keyed by its id; a fresh seat gets none', () => {
    const party = [seat('seat-1'), seat('seat-2', { minutes: 30 })];
    expect(
      AppointmentEditSystem.termsOverridesOf(party, [SeatId.of('seat-2')]),
    ).toEqual([
      StaffTermsOverride.of(SeatKeyText.of('seat-1'), party[0] as Seat),
    ]);
    expect(AppointmentEditSystem.termsOverridesOf(party, [])).toHaveLength(2);
  });

  it('carries the folded outcomes and tips back onto the decided seats, by position', () => {
    const workedAt = utcMs('2026-09-28T10:30:00+03:00');
    const folded = [
      Seat.withTip(
        seat('seat-1', { outcome: SeatOutcome.worked(workedAt) }),
        PriceCents.ZERO,
      ),
    ];
    const decided = [seat('seat-1'), seat('seat-2')];
    const back = AppointmentEditSystem.carryBack(decided, folded);
    expect(back[0]).toMatchObject({
      attendanceState: 'WORKED',
      workedAtUtcMs: workedAt,
      tipCents: 0,
    });
    // A decided seat with no folded twin stays as decided.
    expect(back[1]).toEqual(decided[1]);
  });

  it('answers a collision as the acknowledgeable overlap — naming the handle of a LONE resize only', () => {
    const slot = BookingError.slotUnavailable(IVAN, FIXTURE_TODAY, at(10), 0);
    expect(
      AppointmentEditSystem.overlapOf(slot, [
        BookingCall.editResizeEnd(FIXTURE_TODAY, endAt(10, 45), null),
      ]),
    ).toEqual({
      errorCode: StaffEditErrorCode.Overlaps,
      barberId: IVAN,
      localDate: FIXTURE_TODAY,
      startMinutes: at(10),
      resizeEdge: ResizeEdge.End,
    });
    expect(
      AppointmentEditSystem.overlapOf(slot, [
        BookingCall.editResizeEnd(FIXTURE_TODAY, endAt(10, 45), null),
        BookingCall.editMove(FIXTURE_TODAY, at(11), null),
      ]).resizeEdge,
    ).toBeNull();
    expect(
      AppointmentEditSystem.overlapOf(slot, [
        BookingCall.editMove(FIXTURE_TODAY, at(11), null),
      ]).resizeEdge,
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const party = deepFreeze([seat('seat-1'), seat('seat-2')]);
    const fresh = deepFreeze([SeatId.of('seat-2')]);
    const run = () => ({
      rostered: AppointmentEditSystem.freshSeatsRostered(party, fresh, [
        { id: IVAN },
      ]),
      terms: AppointmentEditSystem.termsOverridesOf(party, fresh),
      back: AppointmentEditSystem.carryBack(party, party),
    });
    expect(run()).toEqual(run());
  });
});

describe('AppointmentEditSystem.undoable / locksEdits — the way back and the lock (S-9, E-9)', () => {
  const added = [callAddSeat('seat-2', at(10, 45), 30)];
  const moved = [BookingCall.editMove(FIXTURE_TODAY, at(11), null)];
  const removed = [BookingCall.editRemoveSeat(SeatId.of('seat-2'))];

  it('withholds the way back only from a save that added a seat to a FINISHED visit (the ROOT’s status)', () => {
    expect(AppointmentEditSystem.undoable(BookingStatus.Completed, added)).toBe(
      false,
    );
    expect(
      AppointmentEditSystem.undoable(BookingStatus.Completed, [
        ...moved,
        ...added,
      ]),
    ).toBe(false);
    expect(AppointmentEditSystem.undoable(BookingStatus.Completed, moved)).toBe(
      true,
    );
    expect(AppointmentEditSystem.undoable(BookingStatus.Confirmed, added)).toBe(
      true,
    );
    expect(AppointmentEditSystem.undoable(null, added)).toBe(true);
    expect(
      AppointmentEditSystem.undoable(BookingStatus.Confirmed, removed),
    ).toBe(true);
  });

  it('agrees with the fold: a seat added under that root is the worked seat a removal is refused for', () => {
    const done = stored([seat('seat-1')], {
      lifecycle: BookingLifecycle.complete(utcMs('2026-09-28T11:00:00+03:00')),
    });
    const [, addedSeat] = seats(addSeat('seat-2', at(10, 45), 30), done);
    expect(addedSeat?.attendanceState).toBe('WORKED');
    expect(AppointmentEditSystem.undoable(done.bookingStatus, added)).toBe(
      false,
    );
  });

  it('locks the edits of a visit that never happened — cancelled or a no-show — and of nothing else', () => {
    expect(AppointmentEditSystem.locksEdits(BookingStatus.Cancelled)).toBe(
      true,
    );
    expect(AppointmentEditSystem.locksEdits(BookingStatus.NoShow)).toBe(true);
    for (const status of [
      BookingStatus.Completed,
      BookingStatus.Confirmed,
      BookingStatus.Pending,
    ]) {
      expect(AppointmentEditSystem.locksEdits(status)).toBe(false);
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const batch = deepFreeze([...added]);
    const once = AppointmentEditSystem.undoable(BookingStatus.Completed, batch);
    expect(AppointmentEditSystem.undoable(BookingStatus.Completed, batch)).toBe(
      once,
    );
  });
});

describe('AppointmentEditSystem.guard — the folded seats as they are (P-10)', () => {
  it('ends a seat that would run past its shop day at midnight — never a defect', () => {
    const late = [
      {
        startMinutes: at(23, 30),
        durationMinutes: unwrapOk(DurationMinutes.of(45)),
      },
    ];
    // Arrived the day after: a visit ending at today's midnight ends before it.
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        late,
        WallTime.of(TOMORROW, at(9)),
      ),
    ).toEqual({
      errorCode: StaffEditErrorCode.BeforeArrival,
      localDate: FIXTURE_TODAY,
      finishMinutes: 1440,
      arrivalLocalDate: TOMORROW,
      arrivalMinutes: 540,
    });
  });

  it('reads the stored seats straight — no span built first', () => {
    expect(
      AppointmentEditSystem.guard(
        BookingStatus.Confirmed,
        FIXTURE_TODAY,
        stored().seats,
        WallTime.of(FIXTURE_TODAY, at(10, 45)),
      )?.errorCode,
    ).toBe(StaffEditErrorCode.BeforeArrival);
  });
});
