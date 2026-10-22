import {
  BarberPreference,
  CancellationReason,
  DiscountMethod,
  DiscountSource,
  VoucherCode,
  EditCommand,
  Placement,
  RequestedSubjectRole,
  ResizeEdge,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingError,
  BookingErrorCode,
  BookingStatus,
  CancellationRefusal,
  CouponGrantId,
  OperationId,
  RepositoryError,
  SchedulingError,
  SeatId,
  UserId,
  Result,
  StaffEditError,
  StaffEditErrorCode,
} from '@core/primitives';
import {
  MarkArrivalAction,
  type MarkArrivalCommand,
  type RecordSeatTipCommand,
} from '@core/pipelines';
import { endMinute, localDate, minute, utcMs } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  arrivalRefusal,
  CallStateWord,
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
  encodeRescheduleAppointmentAnswer,
  encodeStaffEditAppointmentAnswer,
  encodeTransitionAppointmentAnswer,
  recordSeatTipRefusal,
  rescheduleAppointmentRefusal,
  staffEditAppointmentRefusal,
  transitionAppointmentRefusal,
} from './booking.wire';
import { settle } from './wire-read';

const signedIn = (uid: string, roles: readonly string[] = []) => ({
  auth: { uid, token: { roles } },
});
const staff = signedIn('u-staff', ['barber']);
const ATTEMPT = 'attempt-0123456789abcdef';
const A1 = AppointmentId.of('a1');

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

const arrival = (markArrivalAction: MarkArrivalAction): MarkArrivalCommand => ({
  markArrivalAction,
  appointmentId: A1,
  actor: null,
});

const TIP: RecordSeatTipCommand = {
  appointmentId: A1,
  seatId: SeatId.of('s1'),
  tipCents: null,
  actor: null,
};

describe('booking.wire — the flipped callable wire (Phase 4a 4A-4)', () => {
  describe('commitBooking', () => {
    const payload = {
      locationId: 'loc-center',
      localDate: '2026-09-29',
      attemptId: ATTEMPT,
      placement: Placement.Self,
      onBehalfOfUserId: null,
      bookedFromAppointmentId: null,
      seats: [
        {
          lineId: 'line-1',
          serviceId: 'svc-1',
          variantId: null,
          barberId: 'b-ivan',
          barberPreference: BarberPreference.Any,
          startMinutes: 600,
          subject: { requestedSubjectRole: RequestedSubjectRole.Self },
        },
        {
          lineId: 'line-2',
          serviceId: 'svc-2',
          barberId: 'b-ivan',
          barberPreference: 'nonsense',
          startMinutes: 'ten',
          subject: {
            requestedSubjectRole: RequestedSubjectRole.Guest,
            label: 'Petar',
            guestKey: 'guest-1',
          },
        },
      ],
      contact: {
        name: 'Maria',
        phone: '+359888123456',
        email: '',
        note: 'x'.repeat(500),
      },
    };

    it('decodes the call component: the owner off the token, the starts on the shop’s wall clock, nothing defaulted into existence', () => {
      const command = valueOf(
        decodeCommitBooking({ ...signedIn('u-client'), data: payload }),
      );
      expect(command).toMatchObject({
        locationId: 'loc-center',
        localDate: '2026-09-29',
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
          startMinutes: 600,
          subject: { requestedSubjectRole: RequestedSubjectRole.Self },
        },
        {
          lineId: 'line-2',
          serviceId: 'svc-2',
          variantId: null,
          barberId: 'b-ivan',
          barberPreference: null,
          startMinutes: null,
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
              {
                subject: {
                  requestedSubjectRole: RequestedSubjectRole.Self,
                  guestKey: 'bad key!',
                },
              },
            ],
          },
        }),
      );
      expect(command.attemptId).toBeNull();
      expect(command.bookedFromAppointmentId).toBeNull();
      expect(command.contact).toBeNull();
      expect(command.locationId).toBe('');
      expect(command.localDate).toBe('');
      expect(command.seats[0]).toMatchObject({
        serviceId: '',
        barberId: '',
        startMinutes: null,
        subject: { requestedSubjectRole: RequestedSubjectRole.Self },
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
        guestSeat({
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: 'Мария',
          guestKey: 'guest-3',
        }),
      ).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Мария',
        guestKey: 'guest-3',
      });
      expect(
        guestSeat({
          requestedSubjectRole: RequestedSubjectRole.Self,
          guestKey: 'x',
        }),
      ).toEqual({ requestedSubjectRole: RequestedSubjectRole.Self });
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
            requestedSubjectRole: RequestedSubjectRole.Guest,
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

    it('reads a companion by the id it names, and an unknown or legacy subject as the booker', () => {
      expect(
        guestSeat({
          requestedSubjectRole: RequestedSubjectRole.Companion,
          companionUserId: 'u-friend',
        }),
      ).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Companion,
        companionUserId: 'u-friend',
      });
      // The legacy lowercase `kind` is no subject the flipped wire knows.
      expect(guestSeat({ kind: 'guest', label: 'G' })).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Self,
      });
    });

    it('carries «Всеки» and a named barber through, and leaves an absent, unknown or legacy preference unknown', () => {
      const preferences = valueOf(
        decodeCommitBooking({
          ...signedIn('u-client'),
          data: {
            seats: [
              { barberPreference: BarberPreference.Any },
              { barberPreference: BarberPreference.Specific },
              {},
              { barberPreference: 'whoever' },
              { barberPreference: 'any' },
            ],
          },
        }),
      ).seats.map((seat) => seat.barberPreference);
      expect(preferences).toEqual([
        BarberPreference.Any,
        BarberPreference.Specific,
        null,
        null,
        null,
      ]);
    });

    it('a staff placement says so — or names its client — and needs a role that works the book', () => {
      expect(
        wire(
          refusalOf(
            decodeCommitBooking({
              ...signedIn('u-client'),
              data: { onBehalfOfUserId: 'u-other' },
            }),
          ),
        ),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: 'BOOKING_COMMIT_FORBIDDEN' },
      });
      expect(
        wire(
          refusalOf(
            decodeCommitBooking({
              ...signedIn('u-client'),
              data: { placement: Placement.Staff, onBehalfOfUserId: null },
            }),
          ),
        ),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: 'BOOKING_COMMIT_FORBIDDEN' },
      });
      const guestsOnly = {
        placement: Placement.Staff,
        onBehalfOfUserId: null,
        seats: [
          {
            subject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: 'Walk-in',
            },
          },
        ],
      };
      const walkIn = valueOf(
        decodeCommitBooking({ ...staff, data: guestsOnly }),
      );
      expect(walkIn).toMatchObject({ staffPlacement: true, ownerUserId: null });
      const named = valueOf(
        decodeCommitBooking({
          ...staff,
          data: { placement: Placement.Staff, onBehalfOfUserId: 'u-client' },
        }),
      );
      expect(named).toMatchObject({
        staffPlacement: true,
        ownerUserId: 'u-client',
      });
      expect(named.actor).toMatchObject({
        actorRole: 'STAFF',
        actorUserId: 'u-staff',
      });
      // A malformed client id names nobody — still the shop's placement.
      expect(
        valueOf(
          decodeCommitBooking({
            ...staff,
            data: {
              placement: Placement.Staff,
              onBehalfOfUserId: 'has spaces',
            },
          }),
        ).ownerUserId,
      ).toBeNull();
    });

    it('a staff member booking their own seat is a client booking, and a client’s guests-only cart is the client’s', () => {
      expect(
        valueOf(
          decodeCommitBooking({
            ...staff,
            data: {
              placement: Placement.Self,
              onBehalfOfUserId: null,
              seats: [
                {
                  subject: { requestedSubjectRole: RequestedSubjectRole.Self },
                },
              ],
            },
          }),
        ),
      ).toMatchObject({ staffPlacement: false, ownerUserId: 'u-staff' });
      // A staff member's guests-only cart from `/book` is theirs too: the
      // call's own placement says who places it, never the seats.
      expect(
        valueOf(
          decodeCommitBooking({
            ...staff,
            data: {
              placement: Placement.Self,
              onBehalfOfUserId: null,
              seats: [
                {
                  subject: {
                    requestedSubjectRole: RequestedSubjectRole.Guest,
                    label: 'Kid',
                  },
                },
              ],
            },
          }),
        ),
      ).toMatchObject({ staffPlacement: false, ownerUserId: 'u-staff' });
      expect(
        valueOf(
          decodeCommitBooking({
            ...signedIn('u-client'),
            data: {
              placement: Placement.Self,
              onBehalfOfUserId: null,
              seats: [
                {
                  subject: {
                    requestedSubjectRole: RequestedSubjectRole.Guest,
                    label: 'Kid',
                  },
                },
              ],
            },
          }),
        ),
      ).toMatchObject({ staffPlacement: false, ownerUserId: 'u-client' });
    });

    it('answers the call component’s answer, and leaves the commit’s refusals as their structs projected', () => {
      expect(
        encodeCommitBookingAnswer({ appointmentId: A1, replayed: true }),
      ).toEqual({ appointmentId: 'a1' });
      expect(
        wire(commitBookingRefusal(BookingError.unauthenticated())),
      ).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_UNAUTHENTICATED' },
      });
      expect(
        wire(
          commitBookingRefusal(
            BookingError.slotUnavailable(
              BarberId.of('b-ivan'),
              localDate('2026-09-29'),
              minute(600),
              0,
            ),
          ),
        ),
      ).toEqual({
        code: 'aborted',
        details: {
          errorCode: 'BOOKING_SLOT_UNAVAILABLE',
          barberId: 'b-ivan',
          localDate: '2026-09-29',
          startMinutes: 600,
        },
      });
    });
  });

  describe('cancelAppointment', () => {
    it('refuses an anonymous caller, a missing id and a reason that is no code', () => {
      expect(
        wire(
          refusalOf(
            decodeCancelAppointment({
              data: {
                appointmentId: 'a1',
                reason: CancellationReason.ClientUnwell,
              },
            }),
          ),
        ),
      ).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_CANCEL_UNAUTHENTICATED' },
      });
      expect(
        wire(
          refusalOf(decodeCancelAppointment({ ...signedIn('u1'), data: {} })),
        ),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: 'BOOKING_CANCEL_INVALID_INPUT' },
      });
      // Code-only (D23): the client sends the code it files the cancel
      // under — a typed sentence, a legacy lower-case word or nothing is no
      // request (the web maps the typed text to its code itself).
      for (const reason of [undefined, '  sick ', 'client_unwell', 7]) {
        expect(
          wire(
            refusalOf(
              decodeCancelAppointment({
                ...signedIn('u1'),
                data: { appointmentId: 'a1', reason },
              }),
            ),
          ),
        ).toEqual({
          code: 'invalid-argument',
          details: { errorCode: 'BOOKING_CANCEL_INVALID_INPUT' },
        });
      }
    });

    it('decodes the visit, the caller off the token and the code as sent', () => {
      for (const reason of [
        CancellationReason.Other,
        CancellationReason.Unspecified,
        CancellationReason.ClientUnwell,
      ]) {
        expect(
          valueOf(
            decodeCancelAppointment({
              ...signedIn('u1'),
              data: { appointmentId: 'a1', reason },
            }),
          ),
        ).toMatchObject({ appointmentId: 'a1', callerUserId: 'u1', reason });
      }
    });

    it('answers a visit that is not there (or not theirs) as BOOKING_CANCEL_NOT_FOUND; the window and the policy as their structs', () => {
      const cmd = valueOf(
        decodeCancelAppointment({
          ...signedIn('u1'),
          data: { appointmentId: 'a1', reason: CancellationReason.Other },
        }),
      );
      expect(
        wire(
          cancelAppointmentRefusal(
            BookingError.invalidInput('appointmentId'),
            cmd,
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { errorCode: 'BOOKING_CANCEL_NOT_FOUND' },
      });
      expect(
        wire(
          cancelAppointmentRefusal(
            CancellationRefusal.windowClosed(
              24,
              utcMs('2026-09-28T10:00:00.000+03:00'),
            ),
            cmd,
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: { errorCode: 'BOOKING_CANCEL_WINDOW_CLOSED', windowHours: 24 },
      });
      expect(
        wire(
          cancelAppointmentRefusal(
            CancellationRefusal.policyUnavailable(),
            cmd,
          ),
        ),
      ).toEqual({
        code: 'unavailable',
        details: { errorCode: 'BOOKING_CANCEL_POLICY_UNAVAILABLE' },
      });
      expect(encodeCancelAppointmentAnswer({ appointmentId: A1 })).toEqual({
        appointmentId: 'a1',
      });
    });
  });

  describe('rescheduleAppointment', () => {
    it('decodes the cart on the wall clock: the booker or a guest, never another account; the caller off the token', () => {
      const command = valueOf(
        decodeRescheduleAppointment({
          ...signedIn('u-client'),
          data: {
            appointmentId: 'a1',
            locationId: 'loc-center',
            localDate: '2026-10-02',
            attemptId: ATTEMPT,
            seats: [
              {
                serviceId: 's',
                barberId: 'b',
                startMinutes: 660,
                subject: { requestedSubjectRole: RequestedSubjectRole.Self },
              },
              {
                serviceId: 's',
                barberId: 'b',
                startMinutes: 660,
                subject: {
                  requestedSubjectRole: RequestedSubjectRole.Guest,
                  label: 'G',
                },
              },
            ],
          },
        }),
      );
      expect(command).toMatchObject({
        appointmentId: 'a1',
        callerUserId: 'u-client',
        locationId: 'loc-center',
        localDate: '2026-10-02',
        attemptId: ATTEMPT,
      });
      expect(
        command.seats.map((seat) => [
          seat.subject.requestedSubjectRole,
          seat.startMinutes,
        ]),
      ).toEqual([
        [RequestedSubjectRole.Self, 660],
        [RequestedSubjectRole.Guest, 660],
      ]);
      expect(
        valueOf(decodeRescheduleAppointment({ data: { appointmentId: 'a1' } })),
      ).toMatchObject({ callerUserId: null, attemptId: null, seats: [] });
    });

    it('refuses a request that names no visit', () => {
      expect(
        wire(refusalOf(decodeRescheduleAppointment({ data: {} }))),
      ).toEqual({
        code: 'invalid-argument',
        details: {
          errorCode: 'BOOKING_INVALID_INPUT',
          field: 'appointmentId',
        },
      });
    });

    it('answers the moved visit and leaves the move’s refusals as themselves', () => {
      expect(
        encodeRescheduleAppointmentAnswer({
          appointmentId: A1,
          revision: 3,
          replayed: false,
        }),
      ).toEqual({ appointmentId: 'a1' });
      expect(
        wire(
          rescheduleAppointmentRefusal(
            BookingError.invalidInput('startMinutes'),
          ),
        ),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: 'BOOKING_INVALID_INPUT', field: 'startMinutes' },
      });
    });
  });

  describe('transitionAppointment', () => {
    it('refuses anonymous and role-less callers, and a request that is no transition', () => {
      expect(
        wire(refusalOf(decodeTransitionAppointment({ data: {} }))),
      ).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_TRANSITION_UNAUTHENTICATED' },
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
        details: { errorCode: 'BOOKING_TRANSITION_FORBIDDEN' },
      });
      for (const data of [
        { appointmentId: 'a1', toBookingStatus: 'PENDING' },
        { appointmentId: 'a1', toBookingStatus: 'cancelled' },
        { appointmentId: '', toBookingStatus: BookingStatus.Confirmed },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Cancelled,
          cancellationReason: 'nonsense',
        },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Cancelled,
          cancellationReason: CancellationReason.Other,
          note: ' ',
        },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Cancelled,
          cancellationReason: 'client_unwell',
        },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Completed,
          seatId: 7,
        },
      ]) {
        expect(
          wire(refusalOf(decodeTransitionAppointment({ ...staff, data }))),
        ).toEqual({
          code: 'invalid-argument',
          details: { errorCode: 'BOOKING_TRANSITION_INVALID_INPUT' },
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
              toBookingStatus: BookingStatus.Cancelled,
              seatId: 'seat-2',
              cancellationReason: CancellationReason.ClientUnwell,
              note: null,
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
            data: {
              appointmentId: 'a1',
              toBookingStatus: BookingStatus.Cancelled,
              cancellationReason: null,
            },
          }),
        ).reason,
      ).toBe(CancellationReason.Unspecified);
      expect(
        valueOf(
          decodeTransitionAppointment({
            ...staff,
            data: {
              appointmentId: 'a1',
              toBookingStatus: BookingStatus.Cancelled,
              cancellationReason: CancellationReason.Other,
              note: 'flooded',
            },
          }),
        ).reason,
      ).toBe(CancellationReason.Other);
      // A verb that is no cancel carries no reason.
      expect(
        valueOf(
          decodeTransitionAppointment({
            ...staff,
            data: {
              appointmentId: 'a1',
              toBookingStatus: BookingStatus.NoShow,
              cancellationReason: CancellationReason.ClientUnwell,
            },
          }),
        ),
      ).toMatchObject({ to: BookingStatus.NoShow, seatId: null, reason: null });
    });

    it('speaks the lifecycle’s refusals in the callable’s own codes, the states SCREAMING', () => {
      const party = {
        appointmentId: A1,
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
        details: { errorCode: 'BOOKING_TRANSITION_NOT_FOUND' },
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
          errorCode: 'BOOKING_TRANSITION_NOT_ALLOWED',
          fromBookingStatus: 'NO_SHOW',
          toBookingStatus: 'COMPLETED',
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
        details: { errorCode: 'BOOKING_TRANSITION_INVALID_INPUT' },
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
          errorCode: 'BOOKING_TRANSITION_NOT_ALLOWED',
          fromBookingStatus: CallStateWord.Resolved,
          toBookingStatus: 'NO_SHOW',
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
        details: { errorCode: 'BOOKING_TRANSITION_NOT_FOUND' },
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
          errorCode: 'BOOKING_TRANSITION_REOPEN_WINDOW_CLOSED',
          fromBookingStatus: 'COMPLETED',
          toBookingStatus: 'CONFIRMED',
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
          errorCode: 'BOOKING_TRANSITION_SLOT_TAKEN',
          fromBookingStatus: 'CANCELLED',
          toBookingStatus: 'CONFIRMED',
        },
      });
      expect(
        wire(
          transitionAppointmentRefusal(
            SchedulingError.appointmentEmptyCancellationReason(),
            { ...party, to: BookingStatus.Cancelled },
          ),
        ),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: 'BOOKING_TRANSITION_INVALID_INPUT' },
      });
      expect(
        encodeTransitionAppointmentAnswer({
          appointmentId: A1,
          to: BookingStatus.NoShow,
        }),
      ).toEqual({ appointmentId: 'a1', toBookingStatus: 'NO_SHOW' });
    });
  });

  describe('markArrived / clearArrival', () => {
    it('refuses as their own codes and answers the call component’s answers', () => {
      expect(wire(refusalOf(decodeMarkArrived({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_ARRIVED_UNAUTHENTICATED' },
      });
      expect(
        wire(refusalOf(decodeClearArrival({ ...signedIn('u1'), data: {} }))),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: 'BOOKING_ARRIVED_FORBIDDEN' },
      });
      expect(
        wire(refusalOf(decodeMarkArrived({ ...staff, data: {} }))),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: 'BOOKING_ARRIVED_INVALID_INPUT' },
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
            arrival(MarkArrivalAction.Arrive),
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          errorCode: 'BOOKING_ARRIVED_NOT_ALLOWED',
          fromBookingStatus: 'COMPLETED',
          toBookingStatus: CallStateWord.Arrived,
        },
      });
      expect(
        wire(
          arrivalRefusal(
            SchedulingError.appointmentNotArrivable(BookingStatus.Cancelled),
            arrival(MarkArrivalAction.Clear),
          ),
        ).details,
      ).toMatchObject({ toBookingStatus: CallStateWord.Unarrived });
      expect(
        wire(
          arrivalRefusal(
            BookingError.invalidInput('appointmentId'),
            arrival(MarkArrivalAction.Clear),
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { errorCode: 'BOOKING_ARRIVED_NOT_FOUND' },
      });
      const answer = { appointmentId: A1, unchanged: true };
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
    it('takes null to clear, a whole non-negative figure in cents to record, and refuses anything else', () => {
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: { appointmentId: 'a1', seatId: 's1', amountCents: 250 },
          }),
        ),
      ).toMatchObject({ tipCents: 250 });
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: { appointmentId: 'a1', seatId: 's1', amountCents: null },
          }),
        ).tipCents,
      ).toBeNull();
      // The legacy `amountMinorUnits` is no field the flipped wire reads.
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: { appointmentId: 'a1', seatId: 's1', amountMinorUnits: 250 },
          }),
        ).tipCents,
      ).toBeNull();
      for (const amountCents of [-1, 2.5, '3']) {
        expect(
          wire(
            refusalOf(
              decodeRecordSeatTip({
                ...staff,
                data: { appointmentId: 'a1', seatId: 's1', amountCents },
              }),
            ),
          ),
        ).toEqual({
          code: 'invalid-argument',
          details: { errorCode: 'BOOKING_TIP_INVALID_INPUT' },
        });
      }
      expect(wire(refusalOf(decodeRecordSeatTip({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_TIP_UNAUTHENTICATED' },
      });
      expect(
        wire(refusalOf(decodeRecordSeatTip({ ...signedIn('u1'), data: {} }))),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: 'BOOKING_TIP_FORBIDDEN' },
      });
    });

    it('answers no visit or no seat as BOOKING_TIP_NOT_FOUND, and the call component’s answer', () => {
      expect(
        wire(
          recordSeatTipRefusal(
            SchedulingError.appointmentUnknownSeat(SeatId.of('s9')),
            TIP,
          ),
        ),
      ).toEqual({
        code: 'not-found',
        details: { errorCode: 'BOOKING_TIP_NOT_FOUND' },
      });
      expect(
        wire(
          recordSeatTipRefusal(BookingError.invalidInput('appointmentId'), TIP),
        ).details,
      ).toEqual({ errorCode: 'BOOKING_TIP_NOT_FOUND' });
      expect(
        encodeRecordSeatTipAnswer({
          appointmentId: A1,
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
    const one = (command: Record<string, unknown>) => ({
      appointmentId: 'a1',
      commands: [command],
    });

    it('refuses before anything is read: anonymous, role-less, no visit, a malformed name or version', () => {
      expect(wire(refusalOf(decodeStaffEditAppointment({ data: {} })))).toEqual(
        {
          code: 'unauthenticated',
          details: { errorCode: StaffEditErrorCode.Unauthenticated },
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
          details: { errorCode: StaffEditErrorCode.Forbidden },
        });
      }
      const move = {
        editCommand: EditCommand.Move,
        localDate: '2026-10-01',
        startMinutes: 660,
      };
      for (const [data, fieldName] of [
        [{}, 'appointmentId'],
        [{ ...one(move), operationId: 'short' }, 'operationId'],
        [{ ...one(move), operationId: 7 }, 'operationId'],
        [{ ...one(move), expectedVersion: -1 }, 'expectedVersion'],
        [{ ...one(move), expectedVersion: '2' }, 'expectedVersion'],
        [{ ...one(move), expectedVersion: 1.5 }, 'expectedVersion'],
        [{ ...one(move), expectedVersion: true }, 'expectedVersion'],
        [{ ...one(move), expectedVersion: {} }, 'expectedVersion'],
        [{ ...one(move), operationId: '' }, 'operationId'],
        [
          { ...one(move), operationId: 'has spaces in it, sixteen+' },
          'operationId',
        ],
        [{ ...one(move), operationId: 'x'.repeat(65) }, 'operationId'],
        [
          { ...one(move), operationId: { id: 'operation-0123456789ab' } },
          'operationId',
        ],
        [{ appointmentId: 'a1' }, 'commands'],
        [{ appointmentId: 'a1', commands: [] }, 'commands'],
        // The legacy lone `command` is no request: always an array.
        [{ appointmentId: 'a1', command: move }, 'commands'],
        [{ appointmentId: 'a1', commands: move }, 'commands'],
        [one({}), 'editCommand'],
        [one({ editCommand: 'TELEPORT' }), 'editCommand'],
        [one({ editCommand: 'move' }), 'editCommand'],
        [one({ ...move, localDate: 'soon' }), 'localDate'],
        [one({ ...move, startMinutes: 1440 }), 'startMinutes'],
        [one({ ...move, startMinutes: 600.5 }), 'startMinutes'],
        [one({ ...move, seatIds: [] }), 'seatIds'],
        [
          one({
            editCommand: EditCommand.Resize,
            resizeEdge: 'top',
            localDate: '2026-10-01',
            atMinutes: 660,
          }),
          'resizeEdge',
        ],
        [
          one({
            editCommand: EditCommand.Resize,
            resizeEdge: ResizeEdge.Start,
            localDate: '2026-10-01',
            atMinutes: 1440,
          }),
          'atMinutes',
        ],
        [
          one({
            editCommand: EditCommand.Resize,
            resizeEdge: ResizeEdge.End,
            localDate: '2026-10-01',
            atMinutes: 0,
          }),
          'atMinutes',
        ],
        [
          one({
            editCommand: EditCommand.Reprice,
            seatId: 's1',
            priceCents: 1.5,
          }),
          'priceCents',
        ],
        [
          one({
            editCommand: EditCommand.Redurate,
            seatId: 's1',
            durationMinutes: 0,
          }),
          'durationMinutes',
        ],
        [
          one({
            editCommand: EditCommand.Restaff,
            seatId: 's1',
            barberId: ' ',
          }),
          'barberId',
        ],
        [one({ editCommand: EditCommand.RemoveSeat }), 'seatId'],
        [
          one({ editCommand: EditCommand.Relocate, locationId: '' }),
          'locationId',
        ],
        [
          one({
            editCommand: EditCommand.Discounts,
            discounts: [
              {
                discountSource: DiscountSource.Manual,
                discountMethod: DiscountMethod.PercentOff,
                discountPercent: 12.5,
              },
            ],
          }),
          'discounts',
        ],
        [
          one({
            editCommand: EditCommand.Vouchers,
            codes: ['GIFT50', ' gift50 '],
          }),
          'codes',
        ],
        [
          one({
            editCommand: EditCommand.AddSeat,
            seatId: 's9',
            serviceId: 'svc',
            barberId: 'b',
            localDate: '2026-10-01',
            startMinutes: 720,
            durationMinutes: 30,
            addedSubject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: '',
            },
          }),
          'addedSubject',
        ],
      ] as const) {
        expect(wire(refusalOf(edit(data)))).toEqual({
          code: 'invalid-argument',
          details: {
            errorCode: StaffEditErrorCode.InvalidCommand,
            field: fieldName,
          },
        });
      }
    });

    it('decodes a batch on the wall clock: a move, a resize’s handle, the discounts and the normalised voucher codes', () => {
      const command = valueOf(
        edit({
          appointmentId: 'a1',
          operationId: 'operation-0123456789ab',
          expectedVersion: 3,
          acknowledgedOverlap: true,
          commands: [
            {
              editCommand: EditCommand.Move,
              localDate: '2026-10-01',
              startMinutes: 660,
              seatIds: null,
            },
            {
              editCommand: EditCommand.Resize,
              resizeEdge: ResizeEdge.End,
              localDate: '2026-10-01',
              atMinutes: 705,
              seatIds: ['s1'],
            },
            {
              editCommand: EditCommand.Resize,
              resizeEdge: ResizeEdge.Start,
              localDate: '2026-10-01',
              atMinutes: 650,
            },
            {
              editCommand: EditCommand.Discounts,
              discounts: [
                { discountSource: DiscountSource.Grant, grantId: 'g1' },
                { discountSource: DiscountSource.Code, code: ' autumn10 ' },
                {
                  discountSource: DiscountSource.Manual,
                  discountMethod: DiscountMethod.FixedAmount,
                  discountAmountCents: 500,
                },
              ],
            },
            { editCommand: EditCommand.Vouchers, codes: [' gift50 '] },
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
          localDate: localDate('2026-10-01'),
          startMinutes: minute(660),
          seatIds: null,
        },
        {
          editCommand: EditCommand.Resize,
          resizeEdge: ResizeEdge.End,
          localDate: localDate('2026-10-01'),
          atMinutes: endMinute(705),
          seatIds: [SeatId.of('s1')],
        },
        {
          editCommand: EditCommand.Resize,
          resizeEdge: ResizeEdge.Start,
          localDate: localDate('2026-10-01'),
          atMinutes: minute(650),
          seatIds: null,
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

    it('an added seat is the owner’s or a guest’s; an absent claim and name are none', () => {
      const command = valueOf(
        edit(
          one({
            editCommand: EditCommand.AddSeat,
            seatId: 's9',
            serviceId: 'svc',
            barberId: 'b-ivan',
            localDate: '2026-10-01',
            startMinutes: 720,
            durationMinutes: 30,
            addedSubject: { requestedSubjectRole: RequestedSubjectRole.Self },
          }),
        ),
      );
      expect(command.commands[0]).toEqual({
        editCommand: EditCommand.AddSeat,
        seatId: 's9',
        serviceId: 'svc',
        variantId: null,
        barberId: 'b-ivan',
        localDate: '2026-10-01',
        startMinutes: 720,
        durationMinutes: 30,
        addedSubject: { requestedSubjectRole: RequestedSubjectRole.Self },
      });
      expect(command.operationId).toBeNull();
      expect(command.expectedVersion).toBeNull();
      expect(command.acknowledgedOverlap).toBe(false);
      // An explicit `null` is no claim and no name either.
      const unclaimed = valueOf(
        edit({
          ...one({ editCommand: EditCommand.RemoveSeat, seatId: 's1' }),
          expectedVersion: null,
          operationId: null,
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
            ...one({ editCommand: EditCommand.RemoveSeat, seatId: 's1' }),
            expectedVersion: 0,
          }),
        ).expectedVersion,
      ).toBe(0);
    });

    it('names an overlap’s handle as the struct holds it and answers the call component’s answer', () => {
      expect(
        wire(
          staffEditAppointmentRefusal(
            StaffEditError.overlaps(
              BarberId.of('b-ivan'),
              localDate('2026-10-01'),
              minute(600),
              ResizeEdge.End,
            ),
          ),
        ),
      ).toEqual({
        code: 'failed-precondition',
        details: {
          errorCode: StaffEditErrorCode.Overlaps,
          barberId: 'b-ivan',
          localDate: '2026-10-01',
          startMinutes: 600,
          resizeEdge: 'END',
        },
      });
      expect(
        encodeStaffEditAppointmentAnswer({
          appointmentId: A1,
          revision: 4,
          replayed: true,
        }),
      ).toEqual({ appointmentId: 'a1', revision: 4 });
    });
  });

  describe('a refused field as the refusal names it (LEGACY_FIELD_OF deleted)', () => {
    it('leaves every field — a start, a handle, the stored lifecycle — as the struct holds it, never renamed', () => {
      for (const name of [
        'startMinutes',
        'bookingStatus',
        'person_overlap',
        'window_closed',
      ]) {
        expect(
          wire(rescheduleAppointmentRefusal(BookingError.invalidInput(name))),
        ).toEqual({
          code: 'invalid-argument',
          details: { errorCode: BookingErrorCode.InvalidInput, field: name },
        });
      }
      for (const name of ['atMinutes', 'startMinutes', 'durationMinutes']) {
        expect(
          wire(
            staffEditAppointmentRefusal(StaffEditError.invalidCommand(name)),
          ),
        ).toEqual({
          code: 'invalid-argument',
          details: {
            errorCode: StaffEditErrorCode.InvalidCommand,
            field: name,
          },
        });
      }
    });
  });

  describe('store failures and settling', () => {
    it('throws a store failure from every refusal — the edge answers it as an unexpected throw, never a refusal', () => {
      const down = RepositoryError.writeFailed('appointments/a1', 'aborted');
      const party = {
        appointmentId: A1,
        to: BookingStatus.Cancelled,
        seatId: null,
        reason: CancellationReason.ClientUnwell,
        actor: null,
      };
      const cancel = {
        appointmentId: A1,
        callerUserId: UserId.of('u1'),
        reason: CancellationReason.Other,
        actor: null,
      };
      const refusals: readonly (() => EdgeError)[] = [
        () => commitBookingRefusal(down),
        () => cancelAppointmentRefusal(down, cancel),
        () => rescheduleAppointmentRefusal(down),
        () => transitionAppointmentRefusal(down, party),
        () => arrivalRefusal(down, arrival(MarkArrivalAction.Arrive)),
        () => recordSeatTipRefusal(down, TIP),
        () => staffEditAppointmentRefusal(down),
      ];
      for (const refuse of refusals) {
        expect(refuse).toThrowError(
          expect.objectContaining({ repositoryError: down }),
        );
      }
    });

    it('settles a pipeline result: the answer encoded, a refusal in the callable’s words', () => {
      const cancel = {
        appointmentId: A1,
        callerUserId: UserId.of('u1'),
        reason: CancellationReason.Other,
        actor: null,
      };
      expect(
        settle(
          Result.ok({ appointmentId: A1, replayed: true }),
          encodeCommitBookingAnswer,
          commitBookingRefusal,
        ),
      ).toEqual({ ok: true, value: { appointmentId: 'a1' } });
      expect(
        settle(
          Result.err(BookingError.invalidInput('appointmentId')),
          encodeCancelAppointmentAnswer,
          (error) => cancelAppointmentRefusal(error, cancel),
        ),
      ).toEqual({
        ok: false,
        error: CancellationRefusal.notFound(A1),
      });
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
