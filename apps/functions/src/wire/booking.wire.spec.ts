import {
  BarberPreference,
  CancellationReason,
  DiscountMethod,
  DiscountSource,
  VoucherCode,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingError,
  BookingStatus,
  CouponGrantId,
  OperationId,
  RepositoryError,
  SchedulingError,
  SeatId,
  UserId,
  UtcEpochMs,
  Result,
} from '@core/primitives';
import { MarkArrivalAction } from '@core/pipelines';
import {
  CancellationRefusalCode,
  EditCommand,
  MoveSubjectRole,
  RequestedSubjectRole,
  ResizeEdge,
  StaffEditError,
  StaffEditErrorCode,
} from '@core/systems';
import { localDate, minute, utcMs } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  arrivalRefusal,
  cancelAppointmentRefusal,
  commitBookingRefusal,
  decodeCancelAppointment,
  decodeClearArrival,
  decodeCommitBooking,
  decodeMarkArrived,
  decodeRecordSeatTip,
  decodeRescheduleAppointment,
  decodeStaffEditAppointment,
  decodeTransitionAppointment,
  encodeCancelAppointmentAnswer,
  encodeClearArrivalAnswer,
  encodeCommitBookingAnswer,
  encodeMarkArrivedAnswer,
  encodeRecordSeatTipAnswer,
  encodeStaffEditAppointmentAnswer,
  encodeTransitionAppointmentAnswer,
  recordSeatTipRefusal,
  rescheduleAppointmentRefusal,
  settle,
  staffEditAppointmentRefusal,
  transitionAppointmentRefusal,
} from './booking.wire';

const instant = (iso: string): UtcEpochMs => utcMs(iso);

const signedIn = (uid: string, roles: readonly string[] = []) => ({
  auth: { uid, token: { roles } },
});
const staff = signedIn('u-staff', ['barber']);
const ATTEMPT = 'attempt-0123456789abcdef';

/** A refusal as the client sees it on the wire. */
function wire(error: EdgeError) {
  const thrown = toHttpsError(error);
  return { code: thrown.code, details: thrown.details };
}

function refusalOf<T>(result: Result<T, EdgeError>): EdgeError {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

function valueOf<T>(result: Result<T, EdgeError>): T {
  if (!result.ok)
    throw new Error(`expected a command: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('booking.wire — the frozen callable wire (F1-3)', () => {
  describe('commitBooking', () => {
    const payload = {
      locationId: 'loc-center',
      attemptId: ATTEMPT,
      seats: [
        {
          lineId: 'line-1',
          serviceId: 'svc-1',
          variantId: null,
          barberId: 'b-ivan',
          barberPref: 'any',
          startIso: '2026-09-29T10:00:00.000+03:00',
          subject: { kind: 'self' },
        },
        {
          lineId: 'line-2',
          serviceId: 'svc-2',
          barberId: 'b-ivan',
          barberPref: 'nonsense',
          startIso: 'not a time',
          subject: { kind: 'guest', label: 'Petar', guestKey: 'guest-1' },
        },
      ],
      contact: {
        name: 'Maria',
        phone: '+359888123456',
        email: '',
        note: 'x'.repeat(500),
      },
    };

    it('decodes today’s payload: the owner off the token, the starts as instants, nothing defaulted into existence', () => {
      const command = valueOf(
        decodeCommitBooking({ ...signedIn('u-client'), data: payload }),
      );
      expect(command).toMatchObject({
        locationId: 'loc-center',
        attemptId: ATTEMPT,
        bookedFromAppointmentId: null,
        ownerUserId: 'u-client',
        staffPlacement: false,
        contact: {
          name: 'Maria',
          phone: '+359888123456',
          email: null,
          note: 'x'.repeat(400),
        },
      });
      expect(command.seats).toEqual([
        {
          lineId: 'line-1',
          serviceId: 'svc-1',
          variantId: null,
          barberId: 'b-ivan',
          barberPreference: BarberPreference.Any,
          startUtcMs: instant('2026-09-29T10:00:00.000+03:00'),
          subject: { requestedSubjectRole: RequestedSubjectRole.Self },
        },
        {
          lineId: 'line-2',
          serviceId: 'svc-2',
          variantId: null,
          barberId: 'b-ivan',
          barberPreference: null,
          startUtcMs: null,
          subject: {
            requestedSubjectRole: RequestedSubjectRole.Guest,
            label: 'Petar',
            guestKey: 'guest-1',
          },
        },
      ]);
    });

    it('drops, never refuses, a malformed attempt id, rebooking edge, guest key or contact', () => {
      const command = valueOf(
        decodeCommitBooking({
          ...signedIn('u-client'),
          data: {
            attemptId: 'short',
            bookedFromAppointmentId: 'has spaces',
            contact: { name: '', phone: '' },
            seats: [
              { subject: { kind: 'guest', label: 'G', guestKey: 'bad key!' } },
            ],
          },
        }),
      );
      expect(command.attemptId).toBeNull();
      expect(command.bookedFromAppointmentId).toBeNull();
      expect(command.contact).toBeNull();
      expect(command.locationId).toBe('');
      expect(command.seats[0]).toMatchObject({
        serviceId: '',
        barberId: '',
        subject: { guestKey: null },
      });
    });

    const guestSeat = (subject: Record<string, unknown>) =>
      valueOf(
        decodeCommitBooking({
          ...signedIn('u-client'),
          data: { locationId: 'loc-center', seats: [{ subject }] },
        }),
      ).seats[0]?.subject;

    it('passes a well-formed guest key through beside the label, and never reads one off anybody but a guest', () => {
      expect(
        guestSeat({ kind: 'guest', label: 'Мария', guestKey: 'guest-3' }),
      ).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Мария',
        guestKey: 'guest-3',
      });
      expect(guestSeat({ kind: 'self', guestKey: 'x' })).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Self,
      });
    });

    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['not id-shaped', 'guest 3/../x'],
      ['too long', 'g'.repeat(65)],
      ['not a string', 3],
    ])(
      'drops a guest key that is %s — the guest is read by label alone',
      (_what, guestKey) => {
        expect(
          guestSeat({
            kind: 'guest',
            label: 'Мария',
            ...(guestKey === undefined ? {} : { guestKey }),
          }),
        ).toEqual({
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: 'Мария',
          guestKey: null,
        });
      },
    );

    it('carries «Всеки» and a named barber through, and leaves an absent or unknown preference unknown', () => {
      const preferences = valueOf(
        decodeCommitBooking({
          ...signedIn('u-client'),
          data: {
            seats: [
              { barberPref: 'any' },
              { barberPref: 'specific' },
              {},
              { barberPref: 'whoever' },
            ],
          },
        }),
      ).seats.map((seat) => seat.barberPreference);
      expect(preferences).toEqual([
        BarberPreference.Any,
        BarberPreference.Specific,
        null,
        null,
      ]);
    });

    it('a staff placement names its client — or nobody — and needs a role that works the book', () => {
      expect(
        wire(
          refusalOf(
            decodeCommitBooking({
              ...signedIn('u-client'),
              data: { onBehalfOfUserId: null },
            }),
          ),
        ),
      ).toEqual({
        code: 'permission-denied',
        details: { code: 'booking.commit.forbidden' },
      });
      const walkIn = valueOf(
        decodeCommitBooking({ ...staff, data: { onBehalfOfUserId: null } }),
      );
      expect(walkIn).toMatchObject({ staffPlacement: true, ownerUserId: null });
      const named = valueOf(
        decodeCommitBooking({
          ...staff,
          data: { onBehalfOfUserId: 'u-client' },
        }),
      );
      expect(named.ownerUserId).toBe('u-client');
      expect(named.actor).toMatchObject({
        actorRole: 'STAFF',
        actorUserId: 'u-staff',
      });
    });

    it('answers today’s JSON, and leaves the commit’s refusals in today’s words', () => {
      expect(
        encodeCommitBookingAnswer({
          appointmentId: AppointmentId.of('a1'),
          replayed: true,
        }),
      ).toEqual({ appointmentId: 'a1' });
      expect(wire(BookingError.unauthenticated())).toEqual({
        code: 'unauthenticated',
        details: { code: 'booking.commit.unauthenticated', params: {} },
      });
      expect(
        wire(
          BookingError.slotUnavailable(
            BarberId.of('b-ivan'),
            localDate('2026-09-29'),
            minute(600),
            0,
          ),
        ),
      ).toEqual({
        code: 'aborted',
        details: {
          code: 'booking.commit.slot_unavailable',
          params: {
            barberId: 'b-ivan',
            startIso: '2026-09-29T10:00:00.000+03:00',
          },
        },
      });
    });
  });

  describe('cancelAppointment', () => {
    it('refuses an anonymous caller and a missing id as today', () => {
      expect(
        wire(
          refusalOf(decodeCancelAppointment({ data: { appointmentId: 'a1' } })),
        ),
      ).toEqual({
        code: 'unauthenticated',
        details: { code: 'booking.cancel.unauthenticated' },
      });
      expect(
        wire(
          refusalOf(decodeCancelAppointment({ ...signedIn('u1'), data: {} })),
        ),
      ).toEqual({
        code: 'invalid-argument',
        details: { code: 'booking.cancel.invalid_input' },
      });
    });

    it('files a typed sentence as OTHER and nothing as UNSPECIFIED', () => {
      expect(
        valueOf(
          decodeCancelAppointment({
            ...signedIn('u1'),
            data: { appointmentId: 'a1', reason: '  sick ' },
          }),
        ),
      ).toMatchObject({
        appointmentId: 'a1',
        callerUserId: 'u1',
        reason: CancellationReason.Other,
      });
      expect(
        valueOf(
          decodeCancelAppointment({
            ...signedIn('u1'),
            data: { appointmentId: 'a1' },
          }),
        ).reason,
      ).toBe(CancellationReason.Unspecified);
    });

    it('answers a visit that is not there (or not theirs) as booking.cancel.not_found; the window as today', () => {
      expect(
        wire(
          cancelAppointmentRefusal(BookingError.invalidInput('appointmentId')),
        ),
      ).toEqual({
        code: 'not-found',
        details: { code: 'booking.cancel.not_found' },
      });
      expect(
        wire(
          cancelAppointmentRefusal({
            errorCode: CancellationRefusalCode.WindowClosed,
            windowHours: 24,
            deadlineUtcMs: instant('2026-09-28T10:00:00.000+03:00'),
          }),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.cancel.window_closed',
          params: { windowHours: '24' },
        },
      });
      expect(
        wire(
          cancelAppointmentRefusal({
            errorCode: CancellationRefusalCode.PolicyUnavailable,
          }),
        ),
      ).toEqual({
        code: 'unavailable',
        details: { code: 'booking.cancel.policy_unavailable' },
      });
    });
  });

  describe('rescheduleAppointment', () => {
    it('decodes the cart: the booker or a guest, never another account; the caller off the token', () => {
      const command = valueOf(
        decodeRescheduleAppointment({
          ...signedIn('u-client'),
          data: {
            appointmentId: 'a1',
            locationId: 'loc-center',
            attemptId: ATTEMPT,
            seats: [
              {
                serviceId: 's',
                barberId: 'b',
                startIso: '2026-10-02T11:00:00.000+03:00',
                subject: { kind: 'self' },
              },
              {
                serviceId: 's',
                barberId: 'b',
                startIso: '2026-10-02T11:00:00.000+03:00',
                subject: { kind: 'guest', label: 'G' },
              },
            ],
          },
        }),
      );
      expect(command).toMatchObject({
        appointmentId: 'a1',
        callerUserId: 'u-client',
        attemptId: ATTEMPT,
      });
      expect(
        command.seats.map((seat) => [seat.moveSubjectRole, seat.label]),
      ).toEqual([
        [MoveSubjectRole.Self, null],
        [MoveSubjectRole.Guest, 'G'],
      ]);
      expect(
        valueOf(decodeRescheduleAppointment({ data: { appointmentId: 'a1' } }))
          .callerUserId,
      ).toBeNull();
    });
  });

  describe('transitionAppointment', () => {
    it('refuses anonymous and role-less callers, and a request that is no transition', () => {
      expect(
        wire(refusalOf(decodeTransitionAppointment({ data: {} }))),
      ).toEqual({
        code: 'unauthenticated',
        details: { code: 'booking.transition.unauthenticated' },
      });
      expect(
        wire(
          refusalOf(
            decodeTransitionAppointment({
              ...signedIn('u1', ['content_manager']),
              data: {},
            }),
          ),
        ),
      ).toEqual({
        code: 'permission-denied',
        details: { code: 'booking.transition.forbidden' },
      });
      for (const data of [
        { appointmentId: 'a1', to: 'pending' },
        { appointmentId: '', to: 'confirmed' },
        { appointmentId: 'a1', to: 'cancelled', reasonCode: 'nonsense' },
        {
          appointmentId: 'a1',
          to: 'cancelled',
          reasonCode: 'other',
          note: ' ',
        },
        { appointmentId: 'a1', to: 'cancelled', reasonCode: 'CLIENT_UNWELL' },
      ]) {
        expect(
          wire(refusalOf(decodeTransitionAppointment({ ...staff, data }))),
        ).toEqual({
          code: 'invalid-argument',
          details: { code: 'booking.transition.invalid_input' },
        });
      }
    });

    it('decodes a verb, an optional seat and a cancel’s code', () => {
      expect(
        valueOf(
          decodeTransitionAppointment({
            ...staff,
            data: {
              appointmentId: 'a1',
              to: 'cancelled',
              seatId: ' seat-2 ',
              reasonCode: 'client_unwell',
            },
          }),
        ),
      ).toMatchObject({
        appointmentId: 'a1',
        to: BookingStatus.Cancelled,
        seatId: 'seat-2',
        reason: CancellationReason.ClientUnwell,
      });
      expect(
        valueOf(
          decodeTransitionAppointment({
            ...staff,
            data: { appointmentId: 'a1', to: 'cancelled' },
          }),
        ).reason,
      ).toBe(CancellationReason.Unspecified);
    });

    it('speaks the lifecycle’s refusals in the callable’s own frozen words', () => {
      const party = {
        appointmentId: AppointmentId.of('a1'),
        to: BookingStatus.Completed,
        seatId: null,
        reason: null,
        actor: null,
      };
      expect(
        wire(
          transitionAppointmentRefusal(
            BookingError.invalidInput('appointmentId'),
            party,
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { code: 'booking.transition.not_found' },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            SchedulingError.appointmentInvalidTransition(
              BookingStatus.NoShow,
              BookingStatus.Completed,
            ),
            party,
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.transition.not_allowed',
          params: { from: 'no_show', to: 'completed' },
        },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            SchedulingError.appointmentInvalidTransition(
              BookingStatus.Confirmed,
              BookingStatus.Confirmed,
            ),
            { ...party, to: BookingStatus.Confirmed, seatId: SeatId.of('s1') },
          ),
        ),
      ).toEqual({
        code: 'invalid-argument',
        details: { code: 'booking.transition.invalid_input' },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            SchedulingError.appointmentSeatAlreadyResolved(
              SeatId.of('s1'),
              'WORKED',
            ),
            { ...party, to: BookingStatus.NoShow, seatId: SeatId.of('s1') },
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.transition.not_allowed',
          params: { from: 'resolved', to: 'no_show' },
        },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            SchedulingError.appointmentUnknownSeat(SeatId.of('s9')),
            party,
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { code: 'booking.transition.not_found' },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            SchedulingError.appointmentReopenWindowClosed(
              BookingStatus.Completed,
            ),
            { ...party, to: BookingStatus.Confirmed },
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.transition.reopen_window_closed',
          params: { from: 'completed', to: 'confirmed' },
        },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            BookingError.slotUnavailable(
              BarberId.of('b'),
              localDate('2026-09-28'),
              minute(600),
              0,
            ),
            { ...party, to: BookingStatus.Confirmed },
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.transition.slot_taken',
          params: { from: 'cancelled', to: 'confirmed' },
        },
      });
      expect(
        encodeTransitionAppointmentAnswer({
          appointmentId: AppointmentId.of('a1'),
          to: BookingStatus.NoShow,
        }),
      ).toEqual({ appointmentId: 'a1', to: 'no_show' });
    });
  });

  describe('markArrived / clearArrival', () => {
    it('refuses as today and answers today’s JSON', () => {
      expect(wire(refusalOf(decodeMarkArrived({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { code: 'booking.arrived.unauthenticated' },
      });
      expect(
        wire(refusalOf(decodeClearArrival({ ...signedIn('u1'), data: {} }))),
      ).toEqual({
        code: 'permission-denied',
        details: { code: 'booking.arrived.forbidden' },
      });
      expect(
        wire(refusalOf(decodeMarkArrived({ ...staff, data: {} }))),
      ).toEqual({
        code: 'invalid-argument',
        details: { code: 'booking.arrived.invalid_input' },
      });
      expect(
        valueOf(
          decodeClearArrival({ ...staff, data: { appointmentId: 'a1' } }),
        ),
      ).toMatchObject({
        markArrivalAction: MarkArrivalAction.Clear,
        appointmentId: 'a1',
      });
      expect(
        valueOf(decodeMarkArrived({ ...staff, data: { appointmentId: 'a1' } })),
      ).toMatchObject({
        markArrivalAction: MarkArrivalAction.Arrive,
        appointmentId: 'a1',
      });
      expect(
        wire(
          arrivalRefusal(
            SchedulingError.appointmentNotArrivable(BookingStatus.Completed),
            'arrived',
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.arrived.not_allowed',
          params: { from: 'completed', to: 'arrived' },
        },
      });
      expect(
        wire(
          arrivalRefusal(
            BookingError.invalidInput('appointmentId'),
            'unarrived',
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { code: 'booking.arrived.not_found' },
      });
      const answer = { appointmentId: AppointmentId.of('a1'), unchanged: true };
      expect(encodeMarkArrivedAnswer(answer)).toEqual({
        appointmentId: 'a1',
        alreadyArrived: true,
      });
      expect(encodeClearArrivalAnswer(answer)).toEqual({
        appointmentId: 'a1',
        alreadyClear: true,
      });
    });
  });

  describe('recordSeatTip', () => {
    it('takes null to clear, a whole non-negative figure to record, and refuses anything else', () => {
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: { appointmentId: 'a1', seatId: 's1', amountMinorUnits: 250 },
          }),
        ),
      ).toMatchObject({ tipCents: 250 });
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: { appointmentId: 'a1', seatId: 's1' },
          }),
        ).tipCents,
      ).toBeNull();
      for (const amountMinorUnits of [-1, 2.5, '3']) {
        expect(
          wire(
            refusalOf(
              decodeRecordSeatTip({
                ...staff,
                data: { appointmentId: 'a1', seatId: 's1', amountMinorUnits },
              }),
            ),
          ),
        ).toEqual({
          code: 'invalid-argument',
          details: { code: 'booking.tip.invalid_input' },
        });
      }
      expect(wire(refusalOf(decodeRecordSeatTip({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { code: 'booking.tip.unauthenticated' },
      });
    });

    it('answers no visit or no seat as booking.tip.not_found, and today’s JSON', () => {
      expect(
        wire(
          recordSeatTipRefusal(
            SchedulingError.appointmentUnknownSeat(SeatId.of('s9')),
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { code: 'booking.tip.not_found' },
      });
      expect(
        encodeRecordSeatTipAnswer({
          appointmentId: AppointmentId.of('a1'),
          seatId: SeatId.of('s1'),
          unchanged: false,
        }),
      ).toEqual({ appointmentId: 'a1', seatId: 's1', unchanged: false });
    });
  });

  describe('staffEditAppointment', () => {
    const edit = (data: Record<string, unknown>) =>
      decodeStaffEditAppointment({
        ...signedIn('u-desk', ['receptionist']),
        data,
      });

    it('refuses before anything is read: anonymous, role-less, no visit, a malformed name or version', () => {
      expect(wire(refusalOf(decodeStaffEditAppointment({ data: {} })))).toEqual(
        {
          code: 'unauthenticated',
          details: { code: 'booking.staffEdit.unauthenticated', params: {} },
        },
      );
      // `mayBook`, not `isStaff`: a role-less caller, a plain client and the
      // content manager the RULES refuse every read may not move the book.
      for (const roles of [[], ['client'], ['content_manager']]) {
        expect(
          wire(
            refusalOf(
              decodeStaffEditAppointment({
                ...signedIn('u1', roles),
                data: {},
              }),
            ),
          ),
        ).toEqual({
          code: 'permission-denied',
          details: { code: 'booking.staffEdit.forbidden', params: {} },
        });
      }
      for (const [data, fieldName] of [
        [{}, 'appointmentId'],
        [{ appointmentId: 'a1', operationId: 'short' }, 'operationId'],
        [{ appointmentId: 'a1', operationId: 7 }, 'operationId'],
        [{ appointmentId: 'a1', expectedVersion: -1 }, 'expectedVersion'],
        [{ appointmentId: 'a1', expectedVersion: '2' }, 'expectedVersion'],
        [{ appointmentId: 'a1', expectedVersion: 1.5 }, 'expectedVersion'],
        [{ appointmentId: 'a1', expectedVersion: true }, 'expectedVersion'],
        [{ appointmentId: 'a1', expectedVersion: {} }, 'expectedVersion'],
        [{ appointmentId: 'a1', operationId: '' }, 'operationId'],
        [
          { appointmentId: 'a1', operationId: 'has spaces in it, sixteen+' },
          'operationId',
        ],
        [{ appointmentId: 'a1', operationId: 'x'.repeat(65) }, 'operationId'],
        [
          {
            appointmentId: 'a1',
            operationId: { id: 'operation-0123456789ab' },
          },
          'operationId',
        ],
        [{ appointmentId: 'a1', command: {} }, 'kind'],
        [{ appointmentId: 'a1', command: [] }, 'command'],
        [{ appointmentId: 'a1', command: { kind: 'teleport' } }, 'kind'],
        [
          { appointmentId: 'a1', command: { kind: 'move', startIso: 'soon' } },
          'startIso',
        ],
        [
          {
            appointmentId: 'a1',
            command: {
              kind: 'move',
              startIso: '2026-10-01T11:00:00+03:00',
              seatIds: [],
            },
          },
          'seatIds',
        ],
        [
          {
            appointmentId: 'a1',
            command: {
              kind: 'resize',
              edge: 'top',
              atIso: '2026-10-01T11:00:00+03:00',
            },
          },
          'edge',
        ],
        [
          {
            appointmentId: 'a1',
            command: { kind: 'reprice', seatId: 's1', priceMinorUnits: 1.5 },
          },
          'priceMinorUnits',
        ],
        [
          {
            appointmentId: 'a1',
            command: { kind: 'redurate', seatId: 's1', minutes: 0 },
          },
          'minutes',
        ],
        [
          {
            appointmentId: 'a1',
            command: { kind: 'restaff', seatId: 's1', barberId: ' ' },
          },
          'barberId',
        ],
        [{ appointmentId: 'a1', command: { kind: 'removeSeat' } }, 'seatId'],
        [
          {
            appointmentId: 'a1',
            command: { kind: 'relocate', locationId: '' },
          },
          'locationId',
        ],
        [
          {
            appointmentId: 'a1',
            command: {
              kind: 'discounts',
              discounts: [
                {
                  source: 'manual',
                  value: { kind: 'percent_off', percent: 12.5 },
                },
              ],
            },
          },
          'discounts',
        ],
        [
          {
            appointmentId: 'a1',
            command: { kind: 'vouchers', codes: ['GIFT50', ' gift50 '] },
          },
          'vouchers',
        ],
        [
          {
            appointmentId: 'a1',
            command: {
              kind: 'addSeat',
              seatId: 's9',
              serviceId: 'svc',
              barberId: 'b',
              startIso: '2026-10-01T12:00:00+03:00',
              minutes: 30,
              subject: { kind: 'guest', label: '' },
            },
          },
          'subject',
        ],
      ] as const) {
        expect(wire(refusalOf(edit(data)))).toEqual({
          code: 'invalid-argument',
          details: {
            code: 'booking.staffEdit.invalid_command',
            params: { field: fieldName },
          },
        });
      }
    });

    it('decodes a batch: instants, a rounded resize, the discounts and the normalised voucher codes', () => {
      const command = valueOf(
        edit({
          appointmentId: 'a1',
          operationId: 'operation-0123456789ab',
          expectedVersion: 3,
          acknowledgedOverlap: true,
          command: [
            { kind: 'move', startIso: '2026-10-01T11:00:00.000+03:00' },
            {
              kind: 'resize',
              edge: 'end',
              atIso: '2026-10-01T11:44:40.000+03:00',
              seatIds: ['s1'],
            },
            {
              kind: 'discounts',
              discounts: [
                { source: 'grant', grantId: 'g1' },
                { source: 'code', code: ' autumn10 ' },
                {
                  source: 'manual',
                  value: { kind: 'fixed_amount', amountMinorUnits: 500 },
                },
              ],
            },
            { kind: 'vouchers', codes: [' gift50 '] },
          ],
        }),
      );
      expect(command).toMatchObject({
        appointmentId: 'a1',
        operationId: OperationId.of('operation-0123456789ab'),
        expectedVersion: 3,
        acknowledgedOverlap: true,
        actorRoles: ['receptionist'],
      });
      expect(command.commands).toEqual([
        {
          editCommand: EditCommand.Move,
          startUtcMs: instant('2026-10-01T11:00:00.000+03:00'),
          seatIds: null,
        },
        {
          editCommand: EditCommand.Resize,
          resizeEdge: ResizeEdge.End,
          atUtcMs: instant('2026-10-01T11:45:00.000+03:00'),
          seatIds: [SeatId.of('s1')],
        },
        {
          editCommand: EditCommand.Discounts,
          discounts: [
            {
              discountSource: DiscountSource.Grant,
              grantId: CouponGrantId.of('g1'),
            },
            {
              discountSource: DiscountSource.Code,
              code: VoucherCode.of('AUTUMN10'),
            },
            {
              discountSource: DiscountSource.Manual,
              discountMethod: DiscountMethod.FixedAmount,
              discountAmountCents: 500,
            },
          ],
        },
        {
          editCommand: EditCommand.Vouchers,
          codes: [VoucherCode.of('GIFT50')],
        },
      ]);
    });

    it('a lone command needs no array; an added seat is the owner’s or a guest’s', () => {
      const command = valueOf(
        edit({
          appointmentId: 'a1',
          command: {
            kind: 'addSeat',
            seatId: 's9',
            serviceId: 'svc',
            barberId: 'b-ivan',
            startIso: '2026-10-01T12:00:00.000+03:00',
            minutes: 30,
            subject: { kind: 'self' },
          },
        }),
      );
      expect(command.commands[0]).toMatchObject({
        editCommand: EditCommand.AddSeat,
        seatId: 's9',
        variantId: null,
        addedSubject: { requestedSubjectRole: RequestedSubjectRole.Self },
      });
      expect(command.operationId).toBeNull();
      expect(command.expectedVersion).toBeNull();
      // An explicit `null` is no claim and no name either — an older client.
      const unclaimed = valueOf(
        edit({
          appointmentId: 'a1',
          expectedVersion: null,
          operationId: null,
          command: { kind: 'removeSeat', seatId: 's1' },
        }),
      );
      expect(unclaimed).toMatchObject({
        expectedVersion: null,
        operationId: null,
      });
      // A claim is handed on exactly as sent — revision 0 included.
      expect(
        valueOf(
          edit({
            appointmentId: 'a1',
            expectedVersion: 0,
            command: { kind: 'removeSeat', seatId: 's1' },
          }),
        ).expectedVersion,
      ).toBe(0);
    });

    it('names an overlap’s handle in today’s words and answers today’s JSON', () => {
      expect(
        wire(
          staffEditAppointmentRefusal({
            errorCode: StaffEditErrorCode.Overlaps,
            barberId: BarberId.of('b-ivan'),
            localDate: localDate('2026-10-01'),
            startMinutes: minute(600),
            edge: ResizeEdge.End,
          }),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          code: 'booking.staffEdit.overlaps',
          params: {
            barberId: 'b-ivan',
            startIso: '2026-10-01T10:00:00.000+03:00',
            edge: 'end',
          },
        },
      });
      expect(
        encodeStaffEditAppointmentAnswer({
          appointmentId: AppointmentId.of('a1'),
          revision: 4,
          replayed: true,
        }),
      ).toEqual({ appointmentId: 'a1', revision: 4 });
    });
  });

  describe('a refused field in today’s words', () => {
    const invalidInput = (field: string) => ({
      code: 'invalid-argument',
      details: { code: 'booking.commit.invalid_input', params: { field } },
    });
    const invalidCommand = (field: string) => ({
      code: 'invalid-argument',
      details: { code: 'booking.staffEdit.invalid_command', params: { field } },
    });

    it('answers the seat start (as a minute of the day or an instant) as startIso', () => {
      expect(
        wire(commitBookingRefusal(BookingError.invalidInput('startMinutes'))),
      ).toEqual(invalidInput('startIso'));
      expect(
        wire(
          rescheduleAppointmentRefusal(BookingError.invalidInput('startUtcMs')),
        ),
      ).toEqual(invalidInput('startIso'));
      expect(
        wire(
          rescheduleAppointmentRefusal(
            BookingError.invalidInput('startMinutes'),
          ),
        ),
      ).toEqual(invalidInput('startIso'));
      expect(
        wire(
          staffEditAppointmentRefusal(
            StaffEditError.invalidCommand('startUtcMs'),
          ),
        ),
      ).toEqual(invalidCommand('startIso'));
      expect(
        wire(
          staffEditAppointmentRefusal(
            BookingError.invalidInput('startMinutes'),
          ),
        ),
      ).toEqual(invalidInput('startIso'));
    });

    it('answers a resize handle as atIso and the stored lifecycle as status', () => {
      expect(
        wire(
          staffEditAppointmentRefusal(StaffEditError.invalidCommand('atUtcMs')),
        ),
      ).toEqual(invalidCommand('atIso'));
      expect(
        wire(
          staffEditAppointmentRefusal(
            BookingError.invalidInput('bookingStatus'),
          ),
        ),
      ).toEqual(invalidInput('status'));
      expect(
        wire(
          rescheduleAppointmentRefusal(
            BookingError.invalidInput('bookingStatus'),
          ),
        ),
      ).toEqual(invalidInput('status'));
    });

    it('leaves every other field as the refusal names it', () => {
      expect(
        wire(commitBookingRefusal(BookingError.invalidInput('person_overlap'))),
      ).toEqual(invalidInput('person_overlap'));
      expect(
        wire(
          rescheduleAppointmentRefusal(
            BookingError.invalidInput('window_closed'),
          ),
        ),
      ).toEqual(invalidInput('window_closed'));
      expect(
        wire(
          staffEditAppointmentRefusal(StaffEditError.invalidCommand('minutes')),
        ),
      ).toEqual(invalidCommand('minutes'));
    });
  });

  describe('store failures and settling', () => {
    it('throws a store failure from every refusal — the edge answers it as an unexpected throw, never a refusal', () => {
      const down = RepositoryError.writeFailed('appointments/a1', 'aborted');
      const party = {
        appointmentId: AppointmentId.of('a1'),
        to: BookingStatus.Cancelled,
        seatId: null,
        reason: CancellationReason.ClientUnwell,
        actor: null,
      };
      const refusals: readonly (() => EdgeError)[] = [
        () => commitBookingRefusal(down),
        () => cancelAppointmentRefusal(down),
        () => rescheduleAppointmentRefusal(down),
        () => transitionAppointmentRefusal(down, party),
        () => arrivalRefusal(down, 'arrived'),
        () => recordSeatTipRefusal(down),
        () => staffEditAppointmentRefusal(down),
      ];
      for (const refuse of refusals) {
        expect(refuse).toThrowError(
          expect.objectContaining({ repositoryError: down }),
        );
      }
    });

    it('settles a pipeline result: the answer encoded, a refusal in the callable’s words', () => {
      expect(
        settle(
          Result.ok({ appointmentId: AppointmentId.of('a1'), replayed: true }),
          encodeCommitBookingAnswer,
          commitBookingRefusal,
        ),
      ).toEqual({ ok: true, value: { appointmentId: 'a1' } });
      expect(
        settle(
          Result.err(BookingError.invalidInput('appointmentId')),
          encodeCancelAppointmentAnswer,
          cancelAppointmentRefusal,
        ),
      ).toEqual({ ok: false, error: { code: 'booking.cancel.not_found' } });
    });
  });

  it('reads the caller off the verified token only — a payload naming an owner is no caller', () => {
    const command = valueOf(
      decodeCommitBooking({
        auth: { uid: 'u-token' },
        data: {
          locationId: 'loc',
          seats: [],
          ownerUserId: 'u-payload',
          uid: 'u-payload',
        },
      }),
    );
    expect(command.ownerUserId).toBe(UserId.of('u-token'));
    expect(command.staffPlacement).toBe(false);
    expect(
      valueOf(decodeCommitBooking({ data: { uid: 'u-payload' } })).ownerUserId,
    ).toBeNull();
  });
});
