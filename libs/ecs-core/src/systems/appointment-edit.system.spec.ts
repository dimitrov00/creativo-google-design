import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AppliedOperation,
  BarberPreference,
  BookingLifecycle,
  MinuteRange,
  SeatLabel,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  ServiceTerms,
  WallTime,
} from '@core/components';
import {
  BookingStatus,
  Currency,
  DurationMinutes,
  BarberId,
  LocationId,
  OperationId,
  SeatId,
  ServiceId,
  LocalDate,
  type EndMinute,
  type MinuteOfDay,
  PriceCents,
  type UtcEpochMs,
} from '@core/primitives';
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
} from '@core/testing';
import {
  AppointmentEditSystem,
  EditCommand,
  type EditCommandRequest,
  LedgerVerdict,
  ResizeEdge,
  StaffEditErrorCode,
} from './appointment-edit.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The digest case of apps/functions/src/use-cases/
 * staff-edit-appointment.operations.spec.ts, the ledger's CAP / newest /
 * unique cases of libs/application/booking/.../applied-operations-document
 * .spec.ts:72-170 (as properties — the companion spec holds the examples),
 * and the FOLD's math of staff-edit-appointment.use-case.spec.ts (move,
 * resize, services added and removed, the acts that are not geometry, the
 * revision, the ledger, the batch) — copied, on the shop's wall clock; the
 * decision that prices and places the folded seats is BookingDecisionSystem's.
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

function fold(
  commands: EditCommandRequest | readonly EditCommandRequest[],
  appointment: Appointment = stored(),
) {
  return AppointmentEditSystem.fold(
    appointment,
    Array.isArray(commands) ? commands : [commands as EditCommandRequest],
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
  ...SeatOccupant.account(FIXTURE_IDS.client, SubjectRelationship.Self),
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
  const MOVE = { kind: 'move', startIso: '2026-08-03T11:00:00.000+03:00' };

  it('is the same for the same batch and different for a different one', () => {
    expect(AppointmentEditSystem.digestBasis([MOVE])).toBe(
      AppointmentEditSystem.digestBasis([{ ...MOVE }]),
    );
    expect(AppointmentEditSystem.digestBasis([MOVE])).not.toBe(
      AppointmentEditSystem.digestBasis([
        { ...MOVE, startIso: '2026-08-03T12:00:00.000+03:00' },
      ]),
    );
    const resized = { kind: 'resize', edge: 'end', atIso: MOVE.startIso };
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
          maxLength: AppointmentEditSystem.LEDGER_CAP * 3,
        }),
        (names) => {
          const ledger = recorded(names);
          const kept = names.slice(-AppointmentEditSystem.LEDGER_CAP);
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
      invalid('startIso'),
    );
  });

  it('refuses a move that would carry a seat past midnight', () => {
    expect(unwrapErr(fold(move(at(23, 30))))).toEqual(invalid('startIso'));
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
  const sold = (start: MinuteOfDay, minutes: number) =>
    MinuteRange.of(start, endMinute(start + minutes));
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
        field: 'status',
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
    expect(unwrapErr(fold(resizeEnd(endAt(10))))).toEqual(invalid('minutes'));
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
    expect(unwrapErr(fold([]))).toEqual(invalid('command'));
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
    const once = AppointmentEditSystem.fold(appointment, commands);
    const twice = AppointmentEditSystem.fold(appointment, commands);
    expect(twice).toEqual(once);
    expect(appointment.seats.map((s) => s.startMinutes)).toEqual([
      at(10),
      at(10, 45),
    ]);
  });
});
