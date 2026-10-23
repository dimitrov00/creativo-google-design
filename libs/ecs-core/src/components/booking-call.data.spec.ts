import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  CartLineId,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { PipelineErrorCode } from '@core/errors';
import { endMinute, localDate, minute } from '@core/testing';
import { BarberPreference } from './barber-pref.data';
import { BookingCall, RequestedSubjectRole } from './booking-call.data';
import { EditCommand, ResizeEdge } from './edit-command.data';
import { CancellationReason } from './seat-outcome.data';

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
    });
    expect(BookingCall.guestSubject('Maria', 'guest 3').guestKey).toBeNull();
    expect(BookingCall.guestSubject('Maria', null).guestKey).toBeNull();
    expect(BookingCall.companionSubject(UserId.of('u-son'))).toEqual({
      requestedSubjectRole: 'COMPANION',
      companionUserId: 'u-son',
    });
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

describe('BookingCall.Transition — a staff cancel is a code, never words (D23)', () => {
  it('carries the code alone: `OTHER` needs no note, and no note rides the call', () => {
    const cancel: BookingCall.Transition = {
      appointmentId: AppointmentId.of('apt-1'),
      toBookingStatus: BookingStatus.Cancelled,
      cancellationReason: CancellationReason.Other,
      seatId: null,
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
      'seatId',
      'toBookingStatus',
    ]);
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
