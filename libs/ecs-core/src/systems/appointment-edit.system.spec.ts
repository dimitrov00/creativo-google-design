import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppliedOperation } from '../components/applied-operation.data';
import { BookingStatus } from '../components/booking-status.data';
import { SeatLabel } from '../components/seat-label.data';
import { SeatOutcome } from '../components/seat-outcome.data';
import {
  type Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { ServiceId } from '../entities/service.entity';
import {
  FIXTURE_IDS,
  appointmentFixture,
  deepFreeze,
  fixtureTodayAt,
  seatFixture,
  unwrapErr,
  unwrapOk,
} from '../testing';
import {
  AppointmentEditSystem,
  type EditCommand,
  EditCommandKind,
  LedgerVerdictKind,
  ResizeEdge,
  StaffEditErrorCode,
} from './appointment-edit.system';

/*
 * The digest case of apps/functions/src/use-cases/
 * staff-edit-appointment.operations.spec.ts, the ledger's CAP / newest /
 * unique cases of libs/application/booking/.../applied-operations-document
 * .spec.ts:72-170 (as properties — the companion spec holds the examples),
 * and the FOLD's math of staff-edit-appointment.use-case.spec.ts (move,
 * resize, services added and removed, the acts that are not geometry, the
 * revision, the ledger, the batch) — copied; the decision that prices and
 * places the folded seats is BookingDecisionSystem's.
 */

const MINUTE = 60_000;
const at = (hour: number, minute = 0): number => fixtureTodayAt(hour, minute);
const IVAN = BarberId.of('ivan');
const PETAR = BarberId.of('petar');
const FADE = ServiceId.of('svc-fade');

function seat(
  id: string,
  overrides: Omit<Partial<Seat>, 'id'> & { readonly minutes?: number } = {},
): Seat {
  const { minutes, ...rest } = overrides;
  return seatFixture({
    id: SeatId.of(id),
    serviceId: FADE,
    barberId: IVAN,
    startMs: at(10),
    terms: {
      ...ServiceTerms.unpadded(4000, 'EUR', minutes ?? 45),
      catalogPriceMinorUnits: null,
      catalogDurationMinutes: null,
    },
    ...rest,
  });
}

/** The stored visit: one 45-minute, 40,00 € fade with Ivan at 10:00. */
function stored(
  seats: readonly Seat[] = [seat('seat-1')],
  overrides: Partial<AppointmentEntity> = {},
): AppointmentEntity {
  return appointmentFixture({ seats, ...overrides });
}

const guest = SeatSubject.anonymous(unwrapOk(SeatLabel.parse('Гост')));

function fold(
  commands: EditCommand | readonly EditCommand[],
  appointment: AppointmentEntity = stored(),
) {
  return AppointmentEditSystem.fold(
    appointment,
    Array.isArray(commands) ? commands : [commands as EditCommand],
  );
}

function seats(
  commands: EditCommand | readonly EditCommand[],
  appointment?: AppointmentEntity,
) {
  return unwrapOk(fold(commands, appointment)).seats;
}

const move = (
  startMs: number,
  seatIds: readonly string[] | null = null,
): EditCommand => ({
  kind: EditCommandKind.Move,
  startMs,
  seatIds: seatIds === null ? null : seatIds.map(SeatId.of),
});
const resize = (
  edge: ResizeEdge,
  atMs: number,
  seatIds: readonly string[] | null = null,
): EditCommand => ({
  kind: EditCommandKind.Resize,
  edge,
  atMs,
  seatIds: seatIds === null ? null : seatIds.map(SeatId.of),
});
const addSeat = (
  seatId: string,
  startMs: number,
  minutes: number,
  overrides: Partial<Extract<EditCommand, { kind: 'addSeat' }>> = {},
): EditCommand => ({
  kind: EditCommandKind.AddSeat,
  seatId: SeatId.of(seatId),
  serviceId: FADE,
  variantId: null,
  barberId: IVAN,
  startMs,
  minutes,
  subject: SeatSubject.account(FIXTURE_IDS.client, SeatRelationship.Self),
  ...overrides,
});

const invalid = (field: string) => ({
  code: StaffEditErrorCode.InvalidCommand,
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
    id,
    revision,
    digest: `d-${id}`,
  });
  const recorded = (ids: readonly string[]): readonly AppliedOperation[] => {
    let ledger: readonly AppliedOperation[] = [];
    ids.forEach((id, index) => {
      ledger = AppointmentEditSystem.record(ledger, id, index + 1, `d-${id}`);
    });
    return ledger;
  };

  it('finds a recorded intent, and nothing it never recorded', () => {
    const ledger = AppointmentEditSystem.record([], 'op-a', 4, 'd-op-a');
    expect(AppliedOperation.find(ledger, 'op-a')).toEqual(entry('op-a', 4));
    expect(AppliedOperation.find(ledger, 'op-b')).toBeNull();
  });

  it('is immutable: recording returns a new ledger', () => {
    const empty: readonly AppliedOperation[] = deepFreeze([]);
    const one = AppointmentEditSystem.record(empty, 'op-a', 1, 'd');
    expect(empty).toEqual([]);
    expect(one).toHaveLength(1);
  });

  it('keeps at most CAP intents, the newest, oldest first', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          maxLength: AppointmentEditSystem.LEDGER_CAP * 3,
        }),
        (ids) => {
          const ledger = recorded(ids);
          const kept = ids.slice(-AppointmentEditSystem.LEDGER_CAP);
          expect(ledger.map((known) => known.id)).toEqual(kept);
          for (const [index, id] of ids.entries()) {
            const found = AppliedOperation.find(ledger, id);
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
        (ids) => {
          const kept = recorded(ids).map((known) => known.id);
          expect(new Set(kept).size).toBe(kept.length);
          if (ids.length > 0) expect(kept.at(-1)).toBe(ids.at(-1));
        },
      ),
    );
  });

  it('answers a re-sent intent from the ledger, and refuses a known name on a DIFFERENT batch', () => {
    const ledger = AppointmentEditSystem.record([], 'op-1', 5, 'abc');
    expect(AppointmentEditSystem.ledgerVerdict(ledger, 'op-1', 'abc')).toEqual({
      kind: LedgerVerdictKind.Replay,
      applied: { id: 'op-1', revision: 5, digest: 'abc' },
    });
    expect(
      AppointmentEditSystem.ledgerVerdict(ledger, 'op-1', 'xyz').kind,
    ).toBe(LedgerVerdictKind.Mismatch);
    expect(
      AppointmentEditSystem.ledgerVerdict(ledger, 'op-2', 'abc').kind,
    ).toBe(LedgerVerdictKind.New);
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
      code: StaffEditErrorCode.Stale,
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
    expect(moved?.startMs).toBe(at(14));
    expect(moved?.terms.durationMinutes).toBe(45);
  });

  it('shifts every seat of a party by ONE delta, preserving the arrangement', () => {
    const party = stored([
      seat('seat-1'),
      seat('seat-2', { barberId: PETAR, startMs: at(10, 45), subject: guest }),
    ]);
    expect(seats(move(at(12)), party).map((s) => s.startMs)).toEqual([
      at(12),
      at(12, 45),
    ]);
  });

  it('shifts ONLY the named seats, leaving the rest of the party put', () => {
    const party = stored([
      seat('seat-1'),
      seat('seat-2', { barberId: PETAR, startMs: at(10, 45), subject: guest }),
    ]);
    expect(
      seats(move(at(12), ['seat-2']), party).map((s) => s.startMs),
    ).toEqual([at(10), at(12)]);
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
      seat('seat-2', { barberId: PETAR, subject: guest }),
    ]);
    expect(
      seats(resize(ResizeEdge.End, at(11), ['seat-2']), party).map(
        (s) => s.terms.durationMinutes,
      ),
    ).toEqual([90, 60]);
  });

  // The move-preservation cases of staff-edit-appointment.use-case.spec.ts
  // (L666-L716, L1568), one per legacy case: a move is not a re-sale.
  it('preserves a recorded tip across a move', () => {
    const tipped = stored([
      seat('seat-1', { tip: { amountMinorUnits: 700, currencyCode: 'EUR' } }),
    ]);
    const [moved] = seats(move(at(12)), tipped);
    expect(moved?.tip).toEqual({ amountMinorUnits: 700, currencyCode: 'EUR' });
    expect(moved?.terms.priceMinorUnits).toBe(4000);
  });

  it('preserves a ZERO tip, which is a recording and not an absence', () => {
    const tipped = stored([
      seat('seat-1', { tip: { amountMinorUnits: 0, currencyCode: 'EUR' } }),
    ]);
    const [moved] = seats(move(at(12)), tipped);
    expect(moved?.tip).toEqual({ amountMinorUnits: 0, currencyCode: 'EUR' });
  });

  it('leaves an untipped seat untipped rather than defaulting it to zero', () => {
    const [moved] = seats(move(at(12)));
    expect(moved?.tip).toBeNull();
  });

  it('keeps the seat ids, so per-seat actions are not orphaned', () => {
    expect(seats(move(at(11))).map((s) => s.id)).toEqual(['seat-1']);
  });

  it('keeps `barberPref` — the fact that decides whether staff may phone', () => {
    const asked = stored([seat('seat-1', { barberPref: 'specific' })]);
    expect(seats(move(at(11)), asked)[0]?.barberPref).toBe('specific');
    const any = stored([seat('seat-1', { barberPref: 'any' })]);
    expect(seats(move(at(11)), any)[0]?.barberPref).toBe('any');
  });

  // §11.2 #6: a drag of a legacy seat must not invent a request the client
  // never made.
  it('keeps an unknown `barberPref` unknown', () => {
    const legacy = stored([seat('seat-1', { barberPref: null })]);
    expect(seats(move(at(11)), legacy)[0]?.barberPref).toBeNull();
  });

  it('restores per-seat OUTCOMES, so a party mid-service stays movable', () => {
    const mid = stored([
      seat('seat-1', { outcome: SeatOutcome.worked(1) }),
      seat('seat-2', { barberId: PETAR, startMs: at(10, 45), subject: guest }),
    ]);
    expect(seats(move(at(11)), mid).map((s) => s.outcome)).toEqual([
      SeatOutcome.worked(1),
      SeatOutcome.scheduled(),
    ]);
  });
});

describe('AppointmentEditSystem.guard — what may be corrected at all', () => {
  // staff-edit-appointment.use-case.spec.ts L1559, L1598, L1609.
  const sold = (startMs: number, minutes: number) => ({
    startMs,
    endMs: startMs + minutes * MINUTE,
  });

  it('refuses a move that would END the visit before its arrival stamp', () => {
    // Arrived 09:55; moved to 08:00 for 45 minutes, it would end at 08:45.
    expect(
      AppointmentEditSystem.guard('confirmed', [sold(at(8), 45)], at(9, 55)),
    ).toEqual({
      code: StaffEditErrorCode.BeforeArrival,
      finishMs: at(8, 45),
      arrivedAtMs: at(9, 55),
    });
    // Ending AT the stamp is still before it; one minute after is not.
    expect(
      AppointmentEditSystem.guard('confirmed', [sold(at(9), 55)], at(9, 55))
        ?.code,
    ).toBe(StaffEditErrorCode.BeforeArrival);
    expect(
      AppointmentEditSystem.guard('confirmed', [sold(at(9), 56)], at(9, 55)),
    ).toBeNull();
    // The visit ends with its LAST seat, not its first.
    expect(
      AppointmentEditSystem.guard(
        'confirmed',
        [sold(at(8), 30), sold(at(9, 30), 45)],
        at(9, 55),
      ),
    ).toBeNull();
    // No stamp, nothing to hold.
    expect(
      AppointmentEditSystem.guard('confirmed', [sold(at(8), 45)], null),
    ).toBeNull();
  });

  it('refuses to touch a visit that never happened — cancelled is history', () => {
    for (const state of ['cancelled', 'no_show'] as const) {
      expect(
        AppointmentEditSystem.guard(state, [sold(at(11), 45)], null),
      ).toEqual({
        code: 'booking.commit.invalid_input',
        field: 'status',
        detail: null,
        reason: null,
      });
    }
  });

  it('lets a FINISHED visit be corrected — the sheet is filled in after the cut', () => {
    expect(
      AppointmentEditSystem.guard('completed', [sold(at(11), 45)], null),
    ).toBeNull();
    expect(
      AppointmentEditSystem.guard('pending', [sold(at(11), 45)], null),
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const spans = deepFreeze([sold(at(8), 45)]);
    const once = AppointmentEditSystem.guard('confirmed', spans, at(9, 55));
    expect(AppointmentEditSystem.guard('confirmed', spans, at(9, 55))).toEqual(
      once,
    );
  });
});

describe('AppointmentEditSystem.fold — resize', () => {
  it('`end` holds the start and writes a duration', () => {
    const [resized] = seats(resize(ResizeEdge.End, at(11, 30)));
    expect(resized?.startMs).toBe(at(10));
    expect(resized?.terms.durationMinutes).toBe(90);
  });

  it('`start` holds the END and writes both', () => {
    const [resized] = seats(resize(ResizeEdge.Start, at(10, 15)));
    expect(resized?.startMs).toBe(at(10, 15));
    expect(
      (resized?.startMs ?? 0) + (resized?.terms.durationMinutes ?? 0) * MINUTE,
    ).toBe(at(10, 45));
  });

  it('extends only the seats that OWN the edge', () => {
    const chain = stored([
      seat('seat-1'),
      seat('seat-2', { startMs: at(10, 45), barberId: PETAR, subject: guest }),
    ]);
    expect(
      seats(resize(ResizeEdge.End, at(12)), chain).map(
        (s) => s.terms.durationMinutes,
      ),
    ).toEqual([45, 75]);
  });

  it('refuses a resize that drives the duration to zero — as a DURATION', () => {
    expect(unwrapErr(fold(resize(ResizeEdge.End, at(10))))).toEqual(
      invalid('minutes'),
    );
  });
});

describe('AppointmentEditSystem.fold — services added and removed', () => {
  it('adds a seat after the visit, unpriced — the decision prices it from the catalogue, not the client', () => {
    const outcome = unwrapOk(fold([addSeat('seat-2', at(10, 45), 30)]));
    expect(outcome.seats.map((s) => s.id)).toEqual(['seat-1', 'seat-2']);
    const added = outcome.seats[1];
    expect(added?.terms).toMatchObject({
      priceMinorUnits: 0,
      durationMinutes: 30,
      currencyCode: 'EUR',
      catalogPriceMinorUnits: null,
    });
    expect(added?.startMs).toBe(at(10, 45));
    expect(added?.outcome.kind).toBe('scheduled');
    expect(outcome.freshSeatIds).toEqual(['seat-2']);
  });

  it('marks a seat added to a FINISHED visit as worked, not scheduled', () => {
    const done = stored([seat('seat-1')], {
      bookingStatus: BookingStatus.complete(at(11)),
    });
    const added = seats([addSeat('seat-2', at(10, 45), 45)], done)[1];
    expect(added?.outcome).toEqual(SeatOutcome.worked(at(11, 30)));
  });

  it('removes a scheduled seat and keeps the others', () => {
    const two = stored([
      seat('seat-1'),
      seat('seat-2', { startMs: at(10, 45) }),
    ]);
    expect(
      seats(
        { kind: EditCommandKind.RemoveSeat, seatId: SeatId.of('seat-2') },
        two,
      ).map((s) => s.id),
    ).toEqual(['seat-1']);
  });

  it('refuses to remove the last seat, or one somebody already sat in', () => {
    expect(
      unwrapErr(
        fold({ kind: EditCommandKind.RemoveSeat, seatId: SeatId.of('seat-1') }),
      ),
    ).toEqual(invalid('seatId'));
    const worked = stored([
      seat('seat-1'),
      seat('seat-2', {
        startMs: at(10, 45),
        outcome: SeatOutcome.worked(at(11, 30)),
      }),
    ]);
    expect(
      unwrapErr(
        fold(
          { kind: EditCommandKind.RemoveSeat, seatId: SeatId.of('seat-2') },
          worked,
        ),
      ),
    ).toEqual(invalid('seatId'));
  });

  it('applies an add before the resize that follows it in one batch', () => {
    expect(
      seats([
        addSeat('seat-2', at(10, 45), 45),
        move(at(10)),
        resize(ResizeEdge.End, at(11, 30)),
      ]).map((s) => s.terms.durationMinutes),
    ).toEqual([45, 45]);
  });

  it('never hands a new seat a removed seat’s id — the batch that drops seat-2 cannot mint it again', () => {
    const pair = stored([seat('seat-1'), seat('seat-2', { barberId: PETAR })]);
    expect(
      unwrapErr(
        fold(
          [
            { kind: EditCommandKind.RemoveSeat, seatId: SeatId.of('seat-2') },
            addSeat('seat-2', at(10), 45, { barberId: BarberId.of('georgi') }),
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
        kind: EditCommandKind.Reprice,
        seatId: SeatId.of('seat-1'),
        priceMinorUnits: 2500,
      })[0]?.terms.priceMinorUnits,
    ).toBe(2500);
  });

  it('re-times ONE seat', () => {
    expect(
      seats({
        kind: EditCommandKind.Redurate,
        seatId: SeatId.of('seat-1'),
        minutes: 30,
      })[0]?.terms.durationMinutes,
    ).toBe(30);
  });

  it('moves ONE seat to another chair', () => {
    expect(
      seats({
        kind: EditCommandKind.Restaff,
        seatId: SeatId.of('seat-1'),
        barberId: PETAR,
      })[0]?.barberId,
    ).toBe('petar');
  });

  it("moves the WHOLE visit to the other shop — the root's own fact, the seats untouched", () => {
    const outcome = unwrapOk(
      fold({
        kind: EditCommandKind.Relocate,
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
          kind: EditCommandKind.Reprice,
          seatId: SeatId.of('seat-99'),
          priceMinorUnits: 100,
        }),
      ),
    ).toEqual(invalid('seatId'));
  });
});

describe('AppointmentEditSystem.fold — the batch', () => {
  it('folds several commands in order — the resize sees the move', () => {
    expect(
      seats([move(at(12)), resize(ResizeEdge.Start, at(12, 15))])[0]?.startMs,
    ).toBe(at(12, 15));
  });

  it('refuses the whole batch when one arm is refused', () => {
    expect(
      fold([
        move(at(12)),
        {
          kind: EditCommandKind.Redurate,
          seatId: SeatId.of('seat-1'),
          minutes: 0,
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
        { kind: EditCommandKind.Discounts },
        { kind: EditCommandKind.Vouchers },
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
            startMs: at(10, 30),
            subject: guest,
          }),
        ]);
        const there = seats(move(at(10) + minutes * MINUTE), party);
        const back = seats(move(at(10)), { ...party, seats: there });
        expect(back).toEqual(party.seats);
      }),
    );
  });
});

describe('AppointmentEditSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(
      stored([seat('seat-1'), seat('seat-2', { startMs: at(10, 45) })]),
    );
    const commands = deepFreeze([
      move(at(12)),
      resize(ResizeEdge.End, at(14)),
      addSeat('seat-3', at(14), 30),
    ]);
    const once = AppointmentEditSystem.fold(appointment, commands);
    const twice = AppointmentEditSystem.fold(appointment, commands);
    expect(twice).toEqual(once);
    expect(appointment.seats.map((s) => s.startMs)).toEqual([
      at(10),
      at(10, 45),
    ]);
  });
});
