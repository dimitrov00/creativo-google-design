import {
  ArrivalVerb,
  BarberPreference,
  CancellationReason,
  DiscountMethod,
  DiscountSource,
  E164,
  Email,
  VoucherCode,
  EditCommand,
  MarkArrivalAction,
  Placement,
  RequestedSubjectRole,
  ResizeEdge,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  CouponGrantId,
  OperationId,
  SeatId,
  UserId,
  Result,
} from '@core/primitives';
import {
  BookingError,
  BookingErrorCode,
  CancellationRefusal,
  RepositoryError,
  SchedulingError,
  StaffEditError,
  StaffEditErrorCode,
} from '@core/errors';
import {
  type BookAppointmentAnswer,
  type MarkArrivalCommand,
  type RecordSeatTipCommand,
} from '@core/pipelines';
import { endMinute, localDate, minute, utcMs } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  arrivalRefusal,
  arrivedOf,
  CallStateWord,
  cancelAppointmentRefusal,
  clearedOf,
  committedOf,
  decodeCancelAppointment,
  decodeClearArrival,
  decodeCommitBooking,
  decodeMarkArrived,
  decodeRecordSeatTip,
  decodeRescheduleAppointment,
  decodeStaffEditAppointment,
  decodeTransitionAppointment,
  recordSeatTipRefusal,
  rescheduledOf,
  staffEditedOf,
  transitionAppointmentRefusal,
} from './booking.wire';
import { refusalOf, type WireRequest } from './wire-read';

const signedIn = (uid: string, roles: readonly string[] = []) => ({
  auth: { uid, token: { roles } },
});
const staff = signedIn('u-staff', ['barber']);
const ATTEMPT = 'attempt-0123456789abcdef';
/** A client-minted act name (WS-4.1) — the key's shape, a plain id. */
const OP = 'operation-0123456789ab';
const OPERATION = OperationId.of(OP);
const A1 = AppointmentId.of('a1');

/** A refusal as the client sees it on the wire. */
function wire(error: EdgeError) {
  const thrown = toHttpsError(error);
  return { code: thrown.code, details: thrown.details };
}

function errorOf<T>(result: Result<T, EdgeError>): EdgeError {
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
  operationId: OPERATION,
  actor: null,
});

const TIP: RecordSeatTipCommand = {
  appointmentId: A1,
  seatId: SeatId.of('s1'),
  tipCents: null,
  operationId: OPERATION,
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
        operationId: ATTEMPT,
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
            contact: null,
          },
        },
      ]);
    });

    it('drops, never refuses, a malformed rebooking edge, guest key or contact', () => {
      const command = valueOf(
        decodeCommitBooking({
          ...signedIn('u-client'),
          data: {
            attemptId: ATTEMPT,
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
          data: {
            locationId: 'loc-center',
            attemptId: ATTEMPT,
            seats: [{ subject }],
          },
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
        contact: null,
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
          contact: null,
        });
      },
    );

    it('parses a guest’s contact ONCE, here — the phone through PhoneSystem, the e-mail through its guard (OR-26)', () => {
      expect(
        guestSeat({
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: 'Мария',
          contact: { phone: '+359 88 812 3456', email: ' Maria@Example.com ' },
        }),
      ).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Мария',
        guestKey: null,
        contact: {
          phone: E164.of('+359888123456'),
          email: Email.of('maria@example.com'),
        },
      });
    });

    it.each([
      ['no contact', undefined, null],
      ['a contact that is no record', 'phone', null],
      ['neither part', { phone: '', email: '' }, null],
      ['a phone that is no number', { phone: '12345', email: null }, null],
      ['an over-long phone', { phone: `+359${'8'.repeat(40)}` }, null],
      ['an e-mail that is none', { email: 'not-an-email' }, null],
      [
        'an over-long e-mail',
        { email: `${'m'.repeat(250)}@example.com` },
        null,
      ],
      [
        'a broken phone beside a good e-mail',
        { phone: 'abc', email: 'ana@example.com' },
        { phone: null, email: 'ana@example.com' },
      ],
      [
        'a phone with no e-mail',
        { phone: '+359888123456' },
        { phone: '+359888123456', email: null },
      ],
    ])(
      'drops, never refuses, what does not parse — %s',
      (_what, contact, expected) => {
        expect(
          guestSeat({
            requestedSubjectRole: RequestedSubjectRole.Guest,
            label: 'Мария',
            ...(contact === undefined ? {} : { contact }),
          }),
        ).toMatchObject({ label: 'Мария', contact: expected });
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
            attemptId: ATTEMPT,
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
          errorOf(
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
          errorOf(
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
        attemptId: ATTEMPT,
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
          data: {
            attemptId: ATTEMPT,
            placement: Placement.Staff,
            onBehalfOfUserId: 'u-client',
          },
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
              attemptId: ATTEMPT,
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
              attemptId: ATTEMPT,
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
              attemptId: ATTEMPT,
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
              attemptId: ATTEMPT,
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

    it('projects the commit’s answer to the id alone (`replayed` stays on the server), and leaves its refusals as their structs projected', () => {
      expect(committedOf({ appointmentId: A1, replayed: true })).toStrictEqual({
        appointmentId: 'a1',
      });
      expect(wire(refusalOf(BookingError.unauthenticated()))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_UNAUTHENTICATED' },
      });
      expect(
        wire(
          refusalOf(
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
          seatIndex: 0,
        },
      });
    });
  });

  describe('cancelAppointment', () => {
    it('refuses an anonymous caller, a missing id and a reason that is no code', () => {
      expect(
        wire(
          errorOf(
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
        wire(errorOf(decodeCancelAppointment({ ...signedIn('u1'), data: {} }))),
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
            errorOf(
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
              data: { appointmentId: 'a1', reason, operationId: OP },
            }),
          ),
        ).toMatchObject({
          appointmentId: 'a1',
          callerUserId: 'u1',
          reason,
          operationId: OPERATION,
        });
      }
    });

    it('answers a visit that is not there (or not theirs) as BOOKING_CANCEL_NOT_FOUND; the window and the policy as their structs', () => {
      const cmd = valueOf(
        decodeCancelAppointment({
          ...signedIn('u1'),
          data: {
            appointmentId: 'a1',
            reason: CancellationReason.Other,
            operationId: OP,
          },
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
        operationId: ATTEMPT,
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
        valueOf(
          decodeRescheduleAppointment({
            ...signedIn('u-client'),
            data: { appointmentId: 'a1', attemptId: ATTEMPT },
          }),
        ),
      ).toMatchObject({ callerUserId: 'u-client', seats: [] });
    });

    it('refuses a request that names no visit', () => {
      expect(wire(errorOf(decodeRescheduleAppointment({ data: {} })))).toEqual({
        code: 'invalid-argument',
        details: {
          errorCode: 'BOOKING_INVALID_INPUT',
          field: 'appointmentId',
        },
      });
    });

    it('projects the moved visit to its id (`revision`, `replayed` stay on the server) and leaves the move’s refusals as themselves', () => {
      expect(
        rescheduledOf({
          appointmentId: A1,
          revision: 3,
          replayed: false,
        }),
      ).toStrictEqual({ appointmentId: 'a1' });
      expect(
        wire(refusalOf(BookingError.invalidInput('startMinutes'))),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: 'BOOKING_INVALID_INPUT', field: 'startMinutes' },
      });
    });
  });

  describe('transitionAppointment', () => {
    it('refuses anonymous and role-less callers, and a request that is no transition', () => {
      expect(wire(errorOf(decodeTransitionAppointment({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_TRANSITION_UNAUTHENTICATED' },
      });
      expect(
        wire(
          errorOf(
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
          cancellationReason: 'client_unwell',
        },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Completed,
          seatId: 7,
        },
      ]) {
        expect(
          wire(errorOf(decodeTransitionAppointment({ ...staff, data }))),
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
              operationId: OP,
            },
          }),
        ),
      ).toMatchObject({
        appointmentId: 'a1',
        to: BookingStatus.Cancelled,
        seatId: 'seat-2',
        reason: CancellationReason.ClientUnwell,
        operationId: OPERATION,
      });
      expect(
        valueOf(
          decodeTransitionAppointment({
            ...staff,
            data: {
              appointmentId: 'a1',
              toBookingStatus: BookingStatus.Cancelled,
              cancellationReason: null,
              operationId: OP,
            },
          }),
        ).reason,
      ).toBe(CancellationReason.Unspecified);
      // CODE-ONLY (D23): `OTHER` stands on its own — nothing written beside
      // it is no refusal, and the command carries no words at all (the staff
      // day files what the barber typed as the visit's note). A stray `note`
      // from an older client is ignored, never decoded.
      for (const data of [
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Cancelled,
          cancellationReason: CancellationReason.Other,
          operationId: OP,
        },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Cancelled,
          cancellationReason: CancellationReason.Other,
          operationId: OP,
          note: ' ',
        },
        {
          appointmentId: 'a1',
          toBookingStatus: BookingStatus.Cancelled,
          cancellationReason: CancellationReason.Other,
          operationId: OP,
          note: 'flooded',
        },
      ]) {
        const command = valueOf(
          decodeTransitionAppointment({ ...staff, data }),
        );
        expect(command).toMatchObject({
          appointmentId: 'a1',
          to: BookingStatus.Cancelled,
          seatId: null,
          reason: CancellationReason.Other,
        });
        expect(Object.keys(command).sort()).toEqual([
          'actor',
          'appointmentId',
          'operationId',
          'reason',
          'seatId',
          'to',
        ]);
      }
      // A verb that is no cancel carries no reason.
      expect(
        valueOf(
          decodeTransitionAppointment({
            ...staff,
            data: {
              appointmentId: 'a1',
              toBookingStatus: BookingStatus.NoShow,
              cancellationReason: CancellationReason.ClientUnwell,
              operationId: OP,
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
        operationId: OPERATION,
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
      // A reopened chair taken since names the status the visit left —
      // every reopen, not only a cancelled party's (OR-57).
      for (const from of [
        BookingStatus.Cancelled,
        BookingStatus.NoShow,
        BookingStatus.Completed,
      ]) {
        expect(
          wire(
            transitionAppointmentRefusal(
              SchedulingError.appointmentReopenSlotTaken(
                from,
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
            fromBookingStatus: from,
            toBookingStatus: 'CONFIRMED',
          },
        });
      }
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
    });
  });

  describe('markArrived / clearArrival', () => {
    it('refuses as their own codes and answers the call component’s answers', () => {
      expect(wire(errorOf(decodeMarkArrived({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_ARRIVED_UNAUTHENTICATED' },
      });
      expect(
        wire(errorOf(decodeClearArrival({ ...signedIn('u1'), data: {} }))),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: 'BOOKING_ARRIVED_FORBIDDEN' },
      });
      expect(wire(errorOf(decodeMarkArrived({ ...staff, data: {} })))).toEqual({
        code: 'invalid-argument',
        details: { errorCode: 'BOOKING_ARRIVED_INVALID_INPUT' },
      });
      expect(
        valueOf(
          decodeClearArrival({
            ...staff,
            data: { appointmentId: 'a1', operationId: OP },
          }),
        ),
      ).toMatchObject({
        markArrivalAction: MarkArrivalAction.Clear,
        appointmentId: 'a1',
        operationId: OPERATION,
      });
      expect(
        valueOf(
          decodeMarkArrived({
            ...staff,
            data: { appointmentId: 'a1', operationId: OP },
          }),
        ),
      ).toMatchObject({
        markArrivalAction: MarkArrivalAction.Arrive,
        appointmentId: 'a1',
        operationId: OPERATION,
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
          toBookingStatus: ArrivalVerb.Arrived,
        },
      });
      expect(
        wire(
          arrivalRefusal(
            SchedulingError.appointmentNotArrivable(BookingStatus.Cancelled),
            arrival(MarkArrivalAction.Clear),
          ),
        ).details,
      ).toMatchObject({ toBookingStatus: ArrivalVerb.Unarrived });
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
      expect(arrivedOf(answer)).toStrictEqual({
        appointmentId: 'a1',
        alreadyArrived: true,
      });
      expect(clearedOf(answer)).toStrictEqual({
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
            data: {
              appointmentId: 'a1',
              seatId: 's1',
              amountCents: 250,
              operationId: OP,
            },
          }),
        ),
      ).toMatchObject({ tipCents: 250, operationId: OPERATION });
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: {
              appointmentId: 'a1',
              seatId: 's1',
              amountCents: null,
              operationId: OP,
            },
          }),
        ).tipCents,
      ).toBeNull();
      // The legacy `amountMinorUnits` is no field the flipped wire reads.
      expect(
        valueOf(
          decodeRecordSeatTip({
            ...staff,
            data: {
              appointmentId: 'a1',
              seatId: 's1',
              amountMinorUnits: 250,
              operationId: OP,
            },
          }),
        ).tipCents,
      ).toBeNull();
      for (const amountCents of [-1, 2.5, '3']) {
        expect(
          wire(
            errorOf(
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
      expect(wire(errorOf(decodeRecordSeatTip({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: 'BOOKING_TIP_UNAUTHENTICATED' },
      });
      expect(
        wire(errorOf(decodeRecordSeatTip({ ...signedIn('u1'), data: {} }))),
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
      operationId: OP,
      commands: [command],
    });

    it('refuses before anything is read: anonymous, role-less, no visit, a malformed name or version', () => {
      expect(wire(errorOf(decodeStaffEditAppointment({ data: {} })))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: StaffEditErrorCode.Unauthenticated },
      });
      // `mayBook`, not `isStaff`: a role-less caller, a plain client and the
      // content manager the RULES refuse every read may not move the book.
      for (const roles of [[], ['client'], ['content_manager']]) {
        expect(
          wire(
            errorOf(
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
        // REQUIRED (WS-4.1): an absent, `null` or reserved name is refused too.
        [{ appointmentId: 'a1', commands: [move] }, 'operationId'],
        [{ ...one(move), operationId: null }, 'operationId'],
        [{ ...one(move), operationId: '_'.repeat(16) }, 'operationId'],
        [
          { ...one(move), operationId: { id: 'operation-0123456789ab' } },
          'operationId',
        ],
        [{ appointmentId: 'a1', operationId: OP }, 'commands'],
        [{ appointmentId: 'a1', operationId: OP, commands: [] }, 'commands'],
        // The legacy lone `command` is no request: always an array.
        [{ appointmentId: 'a1', operationId: OP, command: move }, 'commands'],
        [{ appointmentId: 'a1', operationId: OP, commands: move }, 'commands'],
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
        expect(wire(errorOf(edit(data)))).toEqual({
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

    it('an added guest carries the contact the desk took, parsed here — a part that does not parse is dropped (OR-26)', () => {
      const added = (contact: unknown) =>
        valueOf(
          edit(
            one({
              editCommand: EditCommand.AddSeat,
              seatId: 's9',
              serviceId: 'svc',
              barberId: 'b-ivan',
              localDate: '2026-10-01',
              startMinutes: 720,
              durationMinutes: 30,
              addedSubject: {
                requestedSubjectRole: RequestedSubjectRole.Guest,
                label: ' Мария ',
                ...(contact === undefined ? {} : { contact }),
              },
            }),
          ),
        ).commands[0];
      expect(
        added({ phone: '+359888123456', email: 'Maria@Example.com' }),
      ).toMatchObject({
        addedSubject: {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: 'Мария',
          contact: {
            phone: E164.of('+359888123456'),
            email: Email.of('maria@example.com'),
          },
        },
      });
      expect(added(undefined)).toMatchObject({
        addedSubject: { label: 'Мария', contact: null },
      });
      expect(added({ phone: 'nope', email: null })).toMatchObject({
        addedSubject: { contact: null },
      });
      expect(added({ phone: 'nope', email: 'ana@example.com' })).toMatchObject({
        addedSubject: { contact: { phone: null, email: 'ana@example.com' } },
      });
    });

    it('an added seat is the owner’s or a guest’s; an absent claim is none', () => {
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
      expect(command.operationId).toBe(OPERATION);
      expect(command.expectedVersion).toBeNull();
      expect(command.acknowledgedOverlap).toBe(false);
      // An explicit `null` is no claim either.
      const unclaimed = valueOf(
        edit({
          ...one({ editCommand: EditCommand.RemoveSeat, seatId: 's1' }),
          expectedVersion: null,
        }),
      );
      expect(unclaimed).toMatchObject({
        expectedVersion: null,
        operationId: OPERATION,
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

    it('names an overlap’s handle as the struct holds it and projects the answer to the id and revision (`replayed` stays on the server)', () => {
      expect(
        wire(
          refusalOf(
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
        staffEditedOf({
          appointmentId: A1,
          revision: 4,
          replayed: true,
        }),
      ).toStrictEqual({ appointmentId: 'a1', revision: 4 });
    });
  });

  describe('operation ids — REQUIRED on the booking acts (WS-4.1, DEP-4)', () => {
    /** Every way a sent id is no id: absent, `null`, malformed, reserved (OR-44). */
    const NOT_AN_ID: readonly (readonly [string, unknown])[] = [
      ['absent', undefined],
      ['null', null],
      ['too short', 'short'],
      ['65 characters', 'x'.repeat(65)],
      ['spaced', 'has spaces in it, sixteen+'],
      ['a number', 1234567890123456],
      ['an object', { id: OP }],
      ['a reserved name', '_'.repeat(16)],
    ];
    /** A payload with the id under its field — or without the field at all. */
    const withId = (
      base: Record<string, unknown>,
      name: 'attemptId' | 'operationId',
      id: unknown,
    ): Record<string, unknown> =>
      id === undefined
        ? base
        : name === 'attemptId'
          ? { ...base, attemptId: id }
          : { ...base, operationId: id };

    type Act = {
      readonly callable: string;
      readonly name: 'attemptId' | 'operationId';
      readonly decode: (
        request: WireRequest,
      ) => Result<{ readonly operationId: OperationId }, EdgeError>;
      readonly base: Record<string, unknown>;
      readonly caller: WireRequest;
      readonly refusal: EdgeError;
    };
    const ACTS: readonly Act[] = [
      {
        callable: 'commitBooking',
        name: 'attemptId',
        decode: decodeCommitBooking,
        base: { placement: Placement.Self, seats: [] },
        caller: signedIn('u-client'),
        refusal: BookingError.invalidInput('attemptId'),
      },
      {
        callable: 'rescheduleAppointment',
        name: 'attemptId',
        decode: decodeRescheduleAppointment,
        base: { appointmentId: 'a1' },
        caller: signedIn('u-client'),
        refusal: BookingError.invalidInput('attemptId'),
      },
      {
        callable: 'cancelAppointment',
        name: 'operationId',
        decode: decodeCancelAppointment,
        base: { appointmentId: 'a1', reason: CancellationReason.Other },
        caller: signedIn('u-client'),
        refusal: CancellationRefusal.invalidInput('operationId'),
      },
      {
        callable: 'transitionAppointment',
        name: 'operationId',
        decode: decodeTransitionAppointment,
        base: { appointmentId: 'a1', toBookingStatus: BookingStatus.NoShow },
        caller: staff,
        refusal: BookingError.callInvalidInput(
          BookingErrorCode.TransitionInvalidInput,
          'operationId',
        ),
      },
      {
        callable: 'markArrived',
        name: 'operationId',
        decode: decodeMarkArrived,
        base: { appointmentId: 'a1' },
        caller: staff,
        refusal: BookingError.callInvalidInput(
          BookingErrorCode.ArrivedInvalidInput,
          'operationId',
        ),
      },
      {
        callable: 'clearArrival',
        name: 'operationId',
        decode: decodeClearArrival,
        base: { appointmentId: 'a1' },
        caller: staff,
        refusal: BookingError.callInvalidInput(
          BookingErrorCode.ArrivedInvalidInput,
          'operationId',
        ),
      },
      {
        callable: 'recordSeatTip',
        name: 'operationId',
        decode: decodeRecordSeatTip,
        base: { appointmentId: 'a1', seatId: 's1', amountCents: 250 },
        caller: staff,
        refusal: BookingError.callInvalidInput(
          BookingErrorCode.TipInvalidInput,
          'operationId',
        ),
      },
      {
        callable: 'staffEditAppointment',
        name: 'operationId',
        decode: decodeStaffEditAppointment,
        base: {
          appointmentId: 'a1',
          commands: [{ editCommand: EditCommand.RemoveSeat, seatId: 's1' }],
        },
        caller: signedIn('u-desk', ['receptionist']),
        refusal: StaffEditError.invalidCommand('operationId'),
      },
    ];

    describe.each(ACTS)('$callable', (act) => {
      it.each(NOT_AN_ID)(
        `refuses an id that is %s with its own invalid input, naming the field`,
        (_what, id) => {
          expect(
            errorOf(
              act.decode({
                ...act.caller,
                data: withId(act.base, act.name, id),
              }),
            ),
          ).toEqual(act.refusal);
        },
      );

      it('hands a well-formed id on as the act’s OperationId, its text unchanged', () => {
        const sentText = act.name === 'attemptId' ? ATTEMPT : OP;
        expect(
          valueOf(
            act.decode({
              ...act.caller,
              data: withId(act.base, act.name, sentText),
            }),
          ).operationId,
        ).toBe(OperationId.of(sentText));
      });
    });

    it('a booking’s attempt id is the new visit’s id and the act’s name, one text; a move’s too', () => {
      expect(
        valueOf(
          decodeCommitBooking({
            ...signedIn('u-client'),
            data: { attemptId: ATTEMPT },
          }),
        ),
      ).toMatchObject({
        attemptId: AppointmentId.of(ATTEMPT),
        operationId: OperationId.of(ATTEMPT),
      });
      expect(
        valueOf(
          decodeRescheduleAppointment({
            ...signedIn('u-client'),
            data: { appointmentId: 'a1', attemptId: ATTEMPT },
          }),
        ),
      ).toMatchObject({ attemptId: ATTEMPT, operationId: ATTEMPT });
    });

    it('unauthenticated and forbidden still win over a missing id', () => {
      const anonymous = (
        decode: Act['decode'],
        data: Record<string, unknown>,
      ) => wire(errorOf(decode({ data }))).details;
      expect(anonymous(decodeCommitBooking, {})).toEqual({
        errorCode: 'BOOKING_UNAUTHENTICATED',
      });
      expect(
        anonymous(decodeRescheduleAppointment, { appointmentId: 'a1' }),
      ).toEqual({ errorCode: 'BOOKING_UNAUTHENTICATED' });
      expect(anonymous(decodeCancelAppointment, {})).toEqual({
        errorCode: 'BOOKING_CANCEL_UNAUTHENTICATED',
      });
      expect(anonymous(decodeTransitionAppointment, {})).toEqual({
        errorCode: 'BOOKING_TRANSITION_UNAUTHENTICATED',
      });
      expect(anonymous(decodeMarkArrived, {})).toEqual({
        errorCode: 'BOOKING_ARRIVED_UNAUTHENTICATED',
      });
      expect(anonymous(decodeClearArrival, {})).toEqual({
        errorCode: 'BOOKING_ARRIVED_UNAUTHENTICATED',
      });
      expect(anonymous(decodeRecordSeatTip, {})).toEqual({
        errorCode: 'BOOKING_TIP_UNAUTHENTICATED',
      });
      expect(anonymous(decodeStaffEditAppointment, {})).toEqual({
        errorCode: StaffEditErrorCode.Unauthenticated,
      });
      const roleless = (decode: Act['decode'], data: Record<string, unknown>) =>
        wire(errorOf(decode({ ...signedIn('u1'), data }))).details;
      expect(
        roleless(decodeCommitBooking, { placement: Placement.Staff }),
      ).toEqual({ errorCode: 'BOOKING_COMMIT_FORBIDDEN' });
      expect(roleless(decodeTransitionAppointment, {})).toEqual({
        errorCode: 'BOOKING_TRANSITION_FORBIDDEN',
      });
      expect(roleless(decodeMarkArrived, {})).toEqual({
        errorCode: 'BOOKING_ARRIVED_FORBIDDEN',
      });
      expect(roleless(decodeClearArrival, {})).toEqual({
        errorCode: 'BOOKING_ARRIVED_FORBIDDEN',
      });
      expect(roleless(decodeRecordSeatTip, {})).toEqual({
        errorCode: 'BOOKING_TIP_FORBIDDEN',
      });
      expect(roleless(decodeStaffEditAppointment, {})).toEqual({
        errorCode: StaffEditErrorCode.Forbidden,
      });
    });

    it('every other payload field is judged before the id — today’s answers for today’s faults', () => {
      expect(
        errorOf(
          decodeCancelAppointment({ ...signedIn('u1'), data: { reason: 7 } }),
        ),
      ).toEqual(CancellationRefusal.invalidInput('appointmentId'));
      expect(
        errorOf(
          decodeRecordSeatTip({
            ...staff,
            data: { appointmentId: 'a1', seatId: 's1', amountCents: -1 },
          }),
        ),
      ).toEqual(
        BookingError.callInvalidInput(
          BookingErrorCode.TipInvalidInput,
          'amountCents',
        ),
      );
      expect(
        errorOf(decodeRescheduleAppointment({ ...signedIn('u1'), data: {} })),
      ).toEqual(BookingError.invalidInput('appointmentId'));
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
        expect(wire(refusalOf(BookingError.invalidInput(name)))).toEqual({
          code: 'invalid-argument',
          details: { errorCode: BookingErrorCode.InvalidInput, field: name },
        });
      }
      for (const name of ['atMinutes', 'startMinutes', 'durationMinutes']) {
        expect(wire(refusalOf(StaffEditError.invalidCommand(name)))).toEqual({
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
        operationId: OPERATION,
        actor: null,
      };
      const cancel = {
        appointmentId: A1,
        callerUserId: UserId.of('u1'),
        reason: CancellationReason.Other,
        operationId: OPERATION,
        actor: null,
      };
      const refusals: readonly (() => EdgeError)[] = [
        // commit, reschedule and staff edit pass the shared `refusalOf`
        () => refusalOf(down),
        () => cancelAppointmentRefusal(down, cancel),
        () => transitionAppointmentRefusal(down, party),
        () => arrivalRefusal(down, arrival(MarkArrivalAction.Arrive)),
        () => recordSeatTipRefusal(down, TIP),
      ];
      for (const refuse of refusals) {
        expect(refuse).toThrowError(
          expect.objectContaining({ repositoryError: down }),
        );
      }
    });

    it('settles a pipeline result as the root wires it: a projection by name, a refusal in the callable’s words, a store failure thrown', () => {
      const cancel = {
        appointmentId: A1,
        callerUserId: UserId.of('u1'),
        reason: CancellationReason.Other,
        operationId: OPERATION,
        actor: null,
      };
      const committed = (
        result: Result<BookAppointmentAnswer, EdgeError | RepositoryError>,
      ) => Result.mapError(Result.map(result, committedOf), refusalOf);
      expect(
        committed(Result.ok({ appointmentId: A1, replayed: true })),
      ).toStrictEqual({ ok: true, value: { appointmentId: 'a1' } });
      expect(committed(Result.err(BookingError.unauthenticated()))).toEqual({
        ok: false,
        error: BookingError.unauthenticated(),
      });
      const down = RepositoryError.writeFailed('appointments/a1', 'aborted');
      expect(() => committed(Result.err(down))).toThrowError(
        expect.objectContaining({ repositoryError: down }),
      );
      expect(
        Result.mapError(
          Result.err(BookingError.invalidInput('appointmentId')),
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
          attemptId: ATTEMPT,
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
      wire(
        errorOf(
          decodeCommitBooking({
            data: { attemptId: ATTEMPT, uid: 'u-payload' },
          }),
        ),
      ),
    ).toEqual({
      code: 'unauthenticated',
      details: { errorCode: 'BOOKING_UNAUTHENTICATED' },
    });
  });
});
