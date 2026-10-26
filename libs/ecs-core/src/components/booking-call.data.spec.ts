import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  CartLineId,
  ClientOperationId,
  CouponGrantId,
  LocationId,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { PipelineErrorCode } from '@core/errors';
import {
  cents,
  deepFreeze,
  duration,
  endMinute,
  localDate,
  minute,
} from '@core/testing';
import { BarberPreference } from './barber-pref.data';
import { BookingCall, RequestedSubjectRole } from './booking-call.data';
import { DiscountMethod } from './coupon-value.data';
import { DiscountSource } from './discount-provenance.data';
import { E164 } from './e164.data';
import { EditCommand, ResizeEdge } from './edit-command.data';
import { Email } from './email.data';
import { CancellationReason } from './cancellation-reason.data';
import { SeatLabel } from './seat-label.data';
import { VoucherCode } from './voucher-code.data';

/*
 * THE BOOKING WIRE (Phase 4a 4A-4): the builders the web stores call
 * instead of hand-building literals, and the answer decoders — the only
 * way a callable's answer becomes branded data. A 200 with nothing usable
 * in it is `PIPELINE_UNKNOWN` (`booking-gateway.adapter.spec.ts`' "nothing
 * usable" cases: an empty or missing `appointmentId`).
 */
const UNKNOWN = {
  ok: false,
  error: {
    errorCode: PipelineErrorCode.Unknown,
    serverErrorCode: null,
    refusal: null,
    field: null,
    wireStatus: null,
    serverParams: {},
  },
};

describe('BookingCall — the builders', () => {
  it('builds ONE seat shape: what, from whom, from when on the day, for whom', () => {
    expect(
      BookingCall.seat(
        CartLineId.of('line-1'),
        ServiceId.of('svc-cut'),
        null,
        BarberId.of('ivan'),
        BarberPreference.Any,
        minute(600),
        BookingCall.selfSubject(),
      ),
    ).toEqual({
      lineId: 'line-1',
      serviceId: 'svc-cut',
      variantId: null,
      barberId: 'ivan',
      barberPreference: 'ANY',
      startMinutes: 600,
      subject: { requestedSubjectRole: 'SELF' },
    });
  });

  it('keeps a guest key the server accepts, and drops one it would not — never a refusal', () => {
    expect(BookingCall.guestSubject('Maria', 'guest-3')).toEqual({
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label: 'Maria',
      guestKey: 'guest-3',
      contact: null,
    });
    expect(BookingCall.guestSubject('Maria', 'guest 3').guestKey).toBeNull();
    expect(BookingCall.guestSubject('Maria', null).guestKey).toBeNull();
    expect(BookingCall.companionSubject(UserId.of('u-son'))).toEqual({
      requestedSubjectRole: 'COMPANION',
      companionUserId: 'u-son',
    });
  });

  it('a client’s guest carries no contact; the shop’s carries what the desk took (OR-26)', () => {
    const phone = E164.of('+359888123456');
    const email = Email.of('maria@example.com');
    expect(BookingCall.guestSubject('Maria', 'guest-3').contact).toBeNull();
    expect(
      BookingCall.staffGuestSubject(
        'Maria',
        BookingCall.guestContact(phone, email),
      ),
    ).toEqual({
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label: 'Maria',
      guestKey: null,
      contact: { phone, email },
    });
    expect(BookingCall.staffGuestSubject('Мария', null).contact).toBeNull();
  });

  it('guestContact: a phone, an e-mail or both — neither is no contact at all, never an empty one', () => {
    const phone = E164.of('+359888123456');
    const email = Email.of('maria@example.com');
    expect(BookingCall.guestContact(phone, null)).toEqual({
      phone,
      email: null,
    });
    expect(BookingCall.guestContact(null, email)).toEqual({
      phone: null,
      email,
    });
    expect(BookingCall.guestContact(phone, email)).toEqual({ phone, email });
    expect(BookingCall.guestContact(null, null)).toBeNull();
  });

  it('builds the staff commands on the wall clock — a day and minutes, never an instant', () => {
    expect(
      BookingCall.editMove(localDate('2026-10-07'), minute(660), null),
    ).toEqual({
      editCommand: EditCommand.Move,
      localDate: '2026-10-07',
      startMinutes: 660,
      seatIds: null,
    });
    expect(
      BookingCall.editResizeEnd(localDate('2026-10-07'), endMinute(720), [
        SeatId.of('seat-1'),
      ]),
    ).toEqual({
      editCommand: EditCommand.Resize,
      resizeEdge: ResizeEdge.End,
      localDate: '2026-10-07',
      atMinutes: 720,
      seatIds: ['seat-1'],
    });
    expect(
      BookingCall.editResizeStart(localDate('2026-10-07'), minute(0), null),
    ).toMatchObject({ resizeEdge: ResizeEdge.Start, atMinutes: 0 });
    expect(BookingCall.editRemoveSeat(SeatId.of('seat-2'))).toEqual({
      editCommand: 'REMOVE_SEAT',
      seatId: 'seat-2',
    });
  });
});

describe('BookingCall.sameCommands — two batches that ask for the same thing (OR-4)', () => {
  const DAY = localDate('2026-08-05');
  const CUT_SEAT = SeatId.of('seat-0002');
  const BEARD_SEAT = SeatId.of('seat-beard');

  /** A save's batch as the staff plan builds it — every arm the wire knows. */
  function batch(): readonly BookingCall.EditCommand[] {
    return [
      BookingCall.editRelocate(LocationId.of('loc-mladost')),
      BookingCall.editRemoveSeat(BEARD_SEAT),
      BookingCall.editAddSeat(
        SeatId.of('draft-wash-1'),
        ServiceId.of('wash'),
        null,
        BarberId.of('ivan'),
        DAY,
        minute(630),
        duration(10),
        {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: guest(),
          contact: BookingCall.guestContact(
            E164.of('+359888123456'),
            Email.of('maria@example.com'),
          ),
        },
      ),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(640), [CUT_SEAT]),
      BookingCall.editReprice(CUT_SEAT, cents(1800)),
      BookingCall.editDiscounts([
        {
          discountSource: DiscountSource.Grant,
          grantId: CouponGrantId.of('grant-1'),
        },
        {
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.PercentOff,
          discountPercent: 10,
        },
      ]),
      BookingCall.editVouchers([VoucherCode.of('GIFT-A')]),
    ];
  }

  it('calls two batches built alike the same', () => {
    expect(BookingCall.sameCommands(batch(), batch())).toBe(true);
    expect(BookingCall.sameCommands([], [])).toBe(true);
  });

  it('calls a command the same whatever order its keys were written in — where the stringify text told them apart', () => {
    const built = BookingCall.editMove(DAY, minute(600), [CUT_SEAT]);
    const reordered: BookingCall.EditCommand.Move = {
      seatIds: [CUT_SEAT],
      startMinutes: minute(600),
      localDate: DAY,
      editCommand: EditCommand.Move,
    };
    expect(JSON.stringify([built])).not.toBe(JSON.stringify([reordered]));
    expect(BookingCall.sameCommands([built], [reordered])).toBe(true);
  });

  it('reads nested records key-order-blind too — a discount, an added seat’s subject', () => {
    const nested = batch().map((command): BookingCall.EditCommand => {
      if (command.editCommand === EditCommand.Discounts) {
        return {
          discounts: [
            {
              grantId: CouponGrantId.of('grant-1'),
              discountSource: DiscountSource.Grant,
            },
            {
              discountPercent: 10,
              discountMethod: DiscountMethod.PercentOff,
              discountSource: DiscountSource.Manual,
            },
          ],
          editCommand: EditCommand.Discounts,
        };
      }
      if (command.editCommand === EditCommand.AddSeat) {
        return {
          ...command,
          addedSubject: {
            contact: {
              email: Email.of('maria@example.com'),
              phone: E164.of('+359888123456'),
            },
            label: guest(),
            requestedSubjectRole: RequestedSubjectRole.Guest,
          },
        };
      }
      return command;
    });
    expect(BookingCall.sameCommands(batch(), nested)).toBe(true);
  });

  it('counts order where the wire means it: the batch’s, and a scope’s seats', () => {
    const [first, second, ...rest] = batch() as BookingCall.EditCommand[];
    expect(
      BookingCall.sameCommands(batch(), [
        second as BookingCall.EditCommand,
        first as BookingCall.EditCommand,
        ...rest,
      ]),
    ).toBe(false);
    expect(
      BookingCall.sameCommands(
        [BookingCall.editMove(DAY, minute(600), [CUT_SEAT, BEARD_SEAT])],
        [BookingCall.editMove(DAY, minute(600), [BEARD_SEAT, CUT_SEAT])],
      ),
    ).toBe(false);
  });

  it('tells apart a changed value, another arm, a missing command, a whole-party scope and an empty one', () => {
    const move = BookingCall.editMove(DAY, minute(600), [CUT_SEAT]);
    expect(
      BookingCall.sameCommands(
        [move],
        [BookingCall.editMove(DAY, minute(660), [CUT_SEAT])],
      ),
    ).toBe(false);
    expect(
      BookingCall.sameCommands(
        [BookingCall.editReprice(CUT_SEAT, cents(1800))],
        [BookingCall.editRedurate(CUT_SEAT, duration(18))],
      ),
    ).toBe(false);
    expect(
      BookingCall.sameCommands(
        [move],
        [BookingCall.editResizeStart(DAY, minute(600), [CUT_SEAT])],
      ),
    ).toBe(false);
    expect(BookingCall.sameCommands(batch(), batch().slice(1))).toBe(false);
    // A guest's contact is part of what the batch asks for (OR-26).
    const withoutContact = batch().map((command): BookingCall.EditCommand =>
      command.editCommand === EditCommand.AddSeat
        ? {
            ...command,
            addedSubject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: guest(),
              contact: null,
            },
          }
        : command,
    );
    expect(BookingCall.sameCommands(batch(), withoutContact)).toBe(false);
    expect(
      BookingCall.sameCommands(
        [BookingCall.editMove(DAY, minute(600), null)],
        [BookingCall.editMove(DAY, minute(600), [])],
      ),
    ).toBe(false);
  });

  it('never takes a record for a list holding the same items', () => {
    // Not a shape the wire builds — a guard on the equality itself.
    const listed = [BookingCall.editMove(DAY, minute(600), [CUT_SEAT])];
    const keyed = {
      0: BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      length: 1,
    } as unknown as readonly BookingCall.EditCommand[];
    expect(BookingCall.sameCommands(listed, keyed)).toBe(false);
    expect(BookingCall.sameCommands(keyed, listed)).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched, either way round', () => {
    const a = deepFreeze(batch());
    const b = deepFreeze(batch().slice(0, -1));
    const once = BookingCall.sameCommands(a, b);
    expect(BookingCall.sameCommands(a, b)).toBe(once);
    expect(BookingCall.sameCommands(b, a)).toBe(once);
    expect(a).toEqual(batch());
  });
});

/** A guest label the server reads as it is. */
function guest(): SeatLabel {
  return SeatLabel.of('Гост 1');
}

describe('BookingCall.clientCancel — the code a client’s cancel is filed under (D23)', () => {
  const visit = AppointmentId.of('apt-1');

  it('files anything the client typed as OTHER — the words stay theirs, off the wire', () => {
    expect(BookingCall.clientCancel(visit, 'Болен съм')).toEqual({
      appointmentId: visit,
      reason: CancellationReason.Other,
    });
  });

  it.each(['', '   ', '\n\t'])(
    'files nothing typed (%j) as UNSPECIFIED',
    (typed) => {
      expect(BookingCall.clientCancel(visit, typed).reason).toBe(
        CancellationReason.Unspecified,
      );
    },
  );
});

describe('BookingCall.staffCancelReason — the code a staff cancel files (D23)', () => {
  // The staff dashboard's `confirmCancel` rule: «Друго…» with nothing
  // written is no reason; any other pick, or none, goes as it is.
  it('files OTHER only with words beside it', () => {
    expect(
      BookingCall.staffCancelReason(CancellationReason.Other, 'flooded'),
    ).toBe(CancellationReason.Other);
  });

  it.each(['', '   ', '\n\t'])(
    'files OTHER with a blank note (%j) as no code',
    (note) => {
      expect(
        BookingCall.staffCancelReason(CancellationReason.Other, note),
      ).toBeNull();
    },
  );

  it('files a picked code as it is, with or without a note', () => {
    for (const code of [
      CancellationReason.ClientChangedPlans,
      CancellationReason.ClientUnwell,
      CancellationReason.StaffBarberAbsence,
      CancellationReason.StaffShopClosure,
    ]) {
      expect(BookingCall.staffCancelReason(code, '')).toBe(code);
      expect(BookingCall.staffCancelReason(code, 'words')).toBe(code);
    }
  });

  it('files nothing picked as no code — the server files it UNSPECIFIED', () => {
    expect(BookingCall.staffCancelReason(null, '')).toBeNull();
    expect(BookingCall.staffCancelReason(null, 'words')).toBeNull();
  });

  it('is pure: same input → same output', () => {
    expect(BookingCall.staffCancelReason(CancellationReason.Other, ' ')).toBe(
      BookingCall.staffCancelReason(CancellationReason.Other, ' '),
    );
  });
});

describe('BookingCall.Transition — a staff cancel is a code, never words (D23)', () => {
  it('carries the code alone: `OTHER` needs no note, and no note rides the call', () => {
    const cancel: BookingCall.Transition = {
      appointmentId: AppointmentId.of('apt-1'),
      toBookingStatus: BookingStatus.Cancelled,
      cancellationReason: CancellationReason.Other,
      seatId: null,
      operationId: OPERATION_ID,
    };
    // What a barber types beside «Друго» is the visit's note
    // (`appointmentNotes`), written after the cancel — the call has no room
    // for it.
    // @ts-expect-error — `note` is no field of the transition call.
    const worded: BookingCall.Transition = { ...cancel, note: 'flooded' };
    expect(worded.cancellationReason).toBe(CancellationReason.Other);
    expect(Object.keys(cancel).sort()).toEqual([
      'appointmentId',
      'cancellationReason',
      'operationId',
      'seatId',
      'toBookingStatus',
    ]);
  });
});

/** A client-minted operation id, parsed as the web mints it. */
const OPERATION_ID = ((): ClientOperationId => {
  const id = ClientOperationId.parse('op-0123456789abcdef');
  if (!id.ok) throw new Error('fixture: a valid client operation id');
  return id.value;
})();

describe('BookingCall.Operated — every mutating booking call names its act (WS-4.1)', () => {
  const visit = AppointmentId.of('apt-1');

  it('a call is its intent & a REQUIRED operation id — never null, never absent', () => {
    const intent: BookingCall.CancelIntent = BookingCall.clientCancel(
      visit,
      '',
    );
    const call: BookingCall.Cancel = { ...intent, operationId: OPERATION_ID };
    expect(call).toEqual({
      appointmentId: visit,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION_ID,
    });
    // @ts-expect-error — a cancel call without its operation id does not type.
    const unnamed: BookingCall.Cancel = intent;
    // @ts-expect-error — `null` makes no claim, and the call must make one.
    const nulled: BookingCall.Cancel = { ...intent, operationId: null };
    expect([unnamed, nulled]).toHaveLength(2);
  });

  it('the intents carry no operation id — the store names the act', () => {
    const tip: BookingCall.TipIntent = {
      appointmentId: visit,
      seatId: SeatId.of('seat-1'),
      amountCents: null,
    };
    const edit: BookingCall.StaffEditIntent = {
      appointmentId: visit,
      commands: [],
      acknowledgedOverlap: false,
      expectedVersion: 3,
    };
    const transition: BookingCall.TransitionIntent = {
      appointmentId: visit,
      toBookingStatus: BookingStatus.Completed,
      cancellationReason: null,
      seatId: null,
    };
    for (const intent of [tip, edit, transition]) {
      expect(Object.keys(intent)).not.toContain('operationId');
    }
    const named: readonly [
      BookingCall.Tip,
      BookingCall.StaffEdit,
      BookingCall.Transition,
      BookingCall.Arrival,
    ] = [
      { ...tip, operationId: OPERATION_ID },
      { ...edit, operationId: OPERATION_ID },
      { ...transition, operationId: OPERATION_ID },
      { appointmentId: visit, operationId: OPERATION_ID },
    ];
    for (const call of named) expect(call.operationId).toBe(OPERATION_ID);
  });

  it('a move names itself by its attempt id — required, never null', () => {
    const move: BookingCall.Reschedule = {
      appointmentId: visit,
      locationId: LocationId.of('loc-1'),
      localDate: localDate('2026-11-02'),
      seats: [],
      attemptId: OPERATION_ID,
    };
    // @ts-expect-error — a move without its attempt id does not type.
    const unnamed: BookingCall.Reschedule = { ...move, attemptId: null };
    expect(unnamed.appointmentId).toBe(move.appointmentId);
  });
});

describe('BookingCall — the answer decoders', () => {
  it('decodes a commit’s id through its brand', () => {
    expect(BookingCall.decodeCommitted({ appointmentId: 'apt-1' })).toEqual({
      ok: true,
      value: { appointmentId: AppointmentId.of('apt-1') },
    });
  });

  it('answers nothing usable in a 200 as PIPELINE_UNKNOWN — never a booking that may not exist', () => {
    expect(BookingCall.decodeCommitted({ appointmentId: '' })).toEqual(UNKNOWN);
    expect(BookingCall.decodeCommitted({})).toEqual(UNKNOWN);
    expect(BookingCall.decodeCommitted(null)).toEqual(UNKNOWN);
    expect(BookingCall.decodeCommitted({ appointmentId: 'a/b' })).toEqual(
      UNKNOWN,
    );
  });

  it('decodes a transition only onto a status the dictionary names', () => {
    expect(
      BookingCall.decodeTransitioned({
        appointmentId: 'apt-1',
        toBookingStatus: 'COMPLETED',
      }),
    ).toEqual({
      ok: true,
      value: { appointmentId: 'apt-1', toBookingStatus: 'COMPLETED' },
    });
    expect(
      BookingCall.decodeTransitioned({
        appointmentId: 'apt-1',
        toBookingStatus: 'completed',
      }),
    ).toEqual(UNKNOWN);
  });

  it('decodes the arrival, the tip and the staff edit with their flags and figures', () => {
    expect(
      BookingCall.decodeArrived({
        appointmentId: 'apt-1',
        alreadyArrived: true,
      }).ok,
    ).toBe(true);
    expect(
      BookingCall.decodeCleared({ appointmentId: 'apt-1', alreadyClear: 'no' }),
    ).toEqual(UNKNOWN);
    expect(
      BookingCall.decodeTipRecorded({
        appointmentId: 'apt-1',
        seatId: 'seat-1',
        unchanged: false,
      }),
    ).toEqual({
      ok: true,
      value: { appointmentId: 'apt-1', seatId: 'seat-1', unchanged: false },
    });
    expect(
      BookingCall.decodeStaffEdited({ appointmentId: 'apt-1', revision: 4 }),
    ).toEqual({ ok: true, value: { appointmentId: 'apt-1', revision: 4 } });
    expect(
      BookingCall.decodeStaffEdited({ appointmentId: 'apt-1', revision: -1 }),
    ).toEqual(UNKNOWN);
  });
});
