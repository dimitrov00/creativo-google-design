import { describe, expect, it } from 'vitest';
import { BookingErrorCode } from './booking.error';
import { CancellationRefusalCode } from './cancellation.error';
import { IdentityErrorCode } from './identity.error';
import { MoveErrorCode } from './move.error';
import {
  PipelineError,
  PipelineErrorCode,
  WIRE_PARAM_ALLOWLIST,
} from './pipeline.error';
import { StaffEditErrorCode } from './staff-edit.error';
import { WaitlistErrorCode } from './waitlist.error';

/*
 * The ONE classification of a failed call (Phase 4a 4A-5). Its per-code
 * rows carry the failure rows of today's four web adapters — the cases of
 * `booking-gateway.adapter.spec.ts`, the waitlist gateway's
 * `toFailureCode` and `otp-client.adapter.spec.ts` (the `userBlocked`
 * reading) — re-keyed one for one on the SCREAMING codes, each row below
 * naming the legacy dotted code it succeeds (R5: the failure table is
 * product behaviour, pinned before an adapter is deleted).
 */

const P = PipelineErrorCode;

describe('PipelineError', () => {
  it('uses the SCREAMING PIPELINE_* codes the UI translates as errors.<errorCode>', () => {
    expect(Object.values(PipelineErrorCode)).toEqual([
      'PIPELINE_UNAUTHENTICATED',
      'PIPELINE_SLOT_UNAVAILABLE',
      'PIPELINE_CATALOG_CHANGED',
      'PIPELINE_INVALID_REQUEST',
      'PIPELINE_UNAVAILABLE',
      'PIPELINE_UNKNOWN',
    ]);
  });

  it('carries the server code and its reason as i18n parameters, off the wire', () => {
    expect(
      PipelineError.of(
        PipelineErrorCode.SlotUnavailable,
        MoveErrorCode.CarriedSeatUnplaceable,
        'barber_unavailable',
        null,
      ),
    ).toEqual({
      errorCode: 'PIPELINE_SLOT_UNAVAILABLE',
      serverErrorCode: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE',
      refusal: 'barber_unavailable',
      field: null,
      wireStatus: null,
      serverParams: {},
    });
  });

  it('bare() has one shape with every detail null', () => {
    expect(PipelineError.bare(PipelineErrorCode.Unavailable)).toEqual({
      errorCode: 'PIPELINE_UNAVAILABLE',
      serverErrorCode: null,
      refusal: null,
      field: null,
      wireStatus: null,
      serverParams: {},
    });
  });

  it('is() compares the code', () => {
    const error = PipelineError.bare(PipelineErrorCode.Unauthenticated);
    expect(PipelineError.is(error, PipelineErrorCode.Unauthenticated)).toBe(
      true,
    );
    expect(PipelineError.is(error, PipelineErrorCode.Unknown)).toBe(false);
  });

  it('isPipelineError() tells a failed call from any other refusal by its code', () => {
    for (const code of Object.values(PipelineErrorCode)) {
      expect(PipelineError.isPipelineError(PipelineError.bare(code))).toBe(
        true,
      );
    }
    expect(
      PipelineError.isPipelineError({
        errorCode: StaffEditErrorCode.Forbidden,
      }),
    ).toBe(false);
    expect(
      PipelineError.isPipelineError({
        errorCode: BookingErrorCode.SlotUnavailable,
      }),
    ).toBe(false);
  });
});

describe('PipelineError.fromWire — today’s adapter rows, re-keyed', () => {
  /** [legacy dotted code (today's switch), its successor, the wire status, what the caller does next] */
  const ROWS: readonly (readonly [
    string,
    string,
    string,
    PipelineErrorCode,
  ])[] = [
    // booking-gateway.adapter.ts — a lost race, and a roster changed under a stale tab
    [
      'booking.commit.slot_unavailable',
      BookingErrorCode.SlotUnavailable,
      'aborted',
      P.SlotUnavailable,
    ],
    [
      'booking.commit.barber_not_rostered',
      BookingErrorCode.BarberNotRostered,
      'failed-precondition',
      P.SlotUnavailable,
    ],
    // the one staff refusal that is an OFFER («Запази въпреки застъпването»)
    [
      'booking.staffEdit.overlaps',
      StaffEditErrorCode.Overlaps,
      'failed-precondition',
      P.SlotUnavailable,
    ],
    [
      'booking.commit.unauthenticated',
      BookingErrorCode.Unauthenticated,
      'unauthenticated',
      P.Unauthenticated,
    ],
    [
      'booking.cancel.unauthenticated',
      CancellationRefusalCode.Unauthenticated,
      'unauthenticated',
      P.Unauthenticated,
    ],
    [
      'booking.transition.unauthenticated',
      BookingErrorCode.TransitionUnauthenticated,
      'unauthenticated',
      P.Unauthenticated,
    ],
    [
      'booking.transition.forbidden',
      BookingErrorCode.TransitionForbidden,
      'permission-denied',
      P.Unauthenticated,
    ],
    [
      'booking.arrived.unauthenticated',
      BookingErrorCode.ArrivedUnauthenticated,
      'unauthenticated',
      P.Unauthenticated,
    ],
    [
      'booking.arrived.forbidden',
      BookingErrorCode.ArrivedForbidden,
      'permission-denied',
      P.Unauthenticated,
    ],
    [
      'booking.staffEdit.unauthenticated',
      StaffEditErrorCode.Unauthenticated,
      'unauthenticated',
      P.Unauthenticated,
    ],
    [
      'booking.staffEdit.forbidden',
      StaffEditErrorCode.Forbidden,
      'permission-denied',
      P.Unauthenticated,
    ],
    [
      'booking.commit.unknown_service',
      BookingErrorCode.UnknownService,
      'not-found',
      P.CatalogChanged,
    ],
    [
      'booking.commit.service_not_at_location',
      BookingErrorCode.ServiceNotAtLocation,
      'failed-precondition',
      P.CatalogChanged,
    ],
    [
      'booking.commit.invalid_input',
      BookingErrorCode.InvalidInput,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.commit.invariant_violated',
      BookingErrorCode.InvariantViolated,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.commit.conflicting_services',
      BookingErrorCode.ConflictingServices,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.commit.party_too_large',
      BookingErrorCode.PartyTooLarge,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.commit.too_soon',
      BookingErrorCode.TooSoon,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.commit.beyond_horizon',
      BookingErrorCode.BeyondHorizon,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.staffEdit.invalid_command',
      StaffEditErrorCode.InvalidCommand,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.staffEdit.before_arrival',
      StaffEditErrorCode.BeforeArrival,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.staffEdit.stale',
      StaffEditErrorCode.Stale,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.transition.invalid_input',
      BookingErrorCode.TransitionInvalidInput,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.transition.not_found',
      BookingErrorCode.TransitionNotFound,
      'not-found',
      P.InvalidRequest,
    ],
    [
      'booking.transition.not_allowed',
      BookingErrorCode.TransitionNotAllowed,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.arrived.invalid_input',
      BookingErrorCode.ArrivedInvalidInput,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.arrived.not_found',
      BookingErrorCode.ArrivedNotFound,
      'not-found',
      P.InvalidRequest,
    ],
    [
      'booking.arrived.not_allowed',
      BookingErrorCode.ArrivedNotAllowed,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.cancel.invalid_input',
      CancellationRefusalCode.InvalidInput,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.cancel.not_found',
      CancellationRefusalCode.NotFound,
      'not-found',
      P.InvalidRequest,
    ],
    [
      'booking.cancel.not_cancellable',
      CancellationRefusalCode.NotCancellable,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.cancel.window_closed',
      CancellationRefusalCode.WindowClosed,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.reschedule.carried_seat_unplaceable',
      MoveErrorCode.CarriedSeatUnplaceable,
      'failed-precondition',
      P.InvalidRequest,
    ],
    // a store failure, and terms that could not be READ — the same tap later is the fix
    [
      'booking.commit.store_failed',
      BookingErrorCode.CommitStoreFailed,
      'internal',
      P.Unavailable,
    ],
    [
      'booking.cancel.policy_unavailable',
      CancellationRefusalCode.PolicyUnavailable,
      'unavailable',
      P.Unavailable,
    ],
    // waitlist-gateway.adapter.ts
    [
      'booking.waitlist.unauthenticated',
      WaitlistErrorCode.Unauthenticated,
      'unauthenticated',
      P.Unauthenticated,
    ],
    [
      'booking.waitlist.invalid_request',
      WaitlistErrorCode.InvalidRequest,
      'invalid-argument',
      P.InvalidRequest,
    ],
    [
      'booking.waitlist.too_many_days',
      WaitlistErrorCode.TooManyDays,
      'failed-precondition',
      P.InvalidRequest,
    ],
    [
      'booking.waitlist.already_watching',
      WaitlistErrorCode.AlreadyWatching,
      'already-exists',
      P.InvalidRequest,
    ],
  ];

  it.each(ROWS)('%s → %s (%s) → %s', (_legacy, code, status, expected) => {
    const error = PipelineError.fromWire(status, { errorCode: code });
    expect(error.errorCode).toBe(expected);
    expect(error.serverErrorCode).toBe(code);
    expect(error.wireStatus).toBe(status);
  });

  it('answers a carried seat whose barber is busy like any lost slot — re-pick from a fresh grid (R2-5)', () => {
    const busy = PipelineError.fromWire('failed-precondition', {
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal: 'barber_unavailable',
    });
    expect(busy.errorCode).toBe(P.SlotUnavailable);
    expect(busy.refusal).toBe('barber_unavailable');
    const shopOnly = PipelineError.fromWire('failed-precondition', {
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal: 'shop_only',
    });
    expect(shopOnly.errorCode).toBe(P.InvalidRequest);
    expect(shopOnly.refusal).toBe('shop_only');
  });

  it('does not read a `refusal` riding on some other code as a lost slot', () => {
    const other = PipelineError.fromWire('invalid-argument', {
      errorCode: BookingErrorCode.InvalidInput,
      refusal: 'barber_unavailable',
    });
    expect(other.errorCode).toBe(P.InvalidRequest);
    expect(other.serverErrorCode).toBe(BookingErrorCode.InvalidInput);
    expect(other.refusal).toBe('barber_unavailable');
  });

  it('reads the reason one level down — the field an invalid request names', () => {
    expect(
      PipelineError.fromWire('invalid-argument', {
        errorCode: BookingErrorCode.InvalidInput,
        field: 'person_overlap',
      }),
    ).toEqual({
      errorCode: P.InvalidRequest,
      serverErrorCode: 'BOOKING_INVALID_INPUT',
      refusal: null,
      field: 'person_overlap',
      wireStatus: 'invalid-argument',
      serverParams: {},
    });
  });

  it('classifies a code with no row of its own by the status', () => {
    const byStatus = (status: string) =>
      PipelineError.fromWire(status, { errorCode: 'SOME_OTHER_CODE' })
        .errorCode;
    expect(byStatus('unauthenticated')).toBe(P.Unauthenticated);
    for (const status of [
      'invalid-argument',
      'failed-precondition',
      'not-found',
      'permission-denied',
      'already-exists',
      'out-of-range',
    ]) {
      expect(byStatus(status)).toBe(P.InvalidRequest);
    }
    for (const status of [
      'unavailable',
      'internal',
      'deadline-exceeded',
      'resource-exhausted',
    ]) {
      expect(byStatus(status)).toBe(P.Unavailable);
    }
    expect(byStatus('aborted')).toBe(P.Unknown);
    expect(byStatus('cancelled')).toBe(P.Unknown);
  });

  it('a bare platform failure (no details) is the status alone, no server code', () => {
    expect(PipelineError.fromWire('internal', undefined)).toEqual({
      errorCode: P.Unavailable,
      serverErrorCode: null,
      refusal: null,
      field: null,
      wireStatus: 'internal',
      serverParams: {},
    });
    expect(PipelineError.fromWire('unknown', null).errorCode).toBe(P.Unknown);
  });

  it('reads the SDK’s `functions/` spelling of the status as the status itself', () => {
    const error = PipelineError.fromWire('functions/unauthenticated', {});
    expect(error.wireStatus).toBe('unauthenticated');
    expect(error.errorCode).toBe(P.Unauthenticated);
  });

  it('reads an aggregate by its FIRST refusal — one code for the flow’s single string (the OTP client)', () => {
    const error = PipelineError.fromWire('invalid-argument', {
      errors: [
        {
          errorCode: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
          attempted: 'A',
          minLength: 2,
        },
        { errorCode: 'PHONE_INVALID', attempted: 'x', reason: 'too-short' },
      ],
    });
    expect(error.serverErrorCode).toBe('ACCOUNTS_FIRST_NAME_TOO_SHORT');
    expect(error.serverParams).toEqual({ attempted: 'A', minLength: 2 });
  });
});

describe('PipelineError.isBlocked — the OTP "blocked" reading is the wire STATUS', () => {
  it('is a bare permission-denied, whatever the code — today’s userBlocked', () => {
    expect(
      PipelineError.isBlocked(
        PipelineError.fromWire('functions/permission-denied', undefined),
      ),
    ).toBe(true);
    expect(
      PipelineError.isBlocked(
        PipelineError.fromWire('permission-denied', {
          errorCode: 'ANYTHING',
        }),
      ),
    ).toBe(true);
  });

  it('is not the lockout — IDENTITY_OTP_LOCKED_OUT is resource-exhausted, not blocked today', () => {
    expect(
      PipelineError.isBlocked(
        PipelineError.fromWire('resource-exhausted', {
          errorCode: IdentityErrorCode.OtpLockedOut,
        }),
      ),
    ).toBe(false);
    expect(
      PipelineError.isBlocked(PipelineError.bare(PipelineErrorCode.Unknown)),
    ).toBe(false);
  });
});

describe('PipelineError.serverParams — bounded by the per-code allowlist (§10.6)', () => {
  /** A value of the right scalar kind for each allowlisted key. */
  const sample = (key: string): string | number =>
    /Minutes|Hours|Months|Size|expected|actual|age|minAge|maxAge|minLength|max$/.test(
      key,
    )
      ? 7
      : `${key}-value`;

  it.each(Object.entries(WIRE_PARAM_ALLOWLIST))(
    '%s carries exactly its allowlisted scalars, nothing else',
    (code, allowed) => {
      const struct: Record<string, unknown> = {
        errorCode: code,
        // Never on the wire: a person key, a violation list, a cause.
        detail: 'person:u-1',
        violations: [{ errorCode: 'X' }],
        path: 'appointments/a-1',
        secret: 'nope',
      };
      for (const key of allowed) {
        // A carried seat's `seatIds` is a list on the struct, as on the wire.
        struct[key] = key === 'seatIds' ? ['seat-1'] : sample(key);
      }
      const params = PipelineError.fromWire(
        'failed-precondition',
        struct,
      ).serverParams;
      // Arrays (a carried seat's `seatIds`) are never params — scalars only.
      const scalars = allowed.filter((key) => key !== 'seatIds');
      expect(Object.keys(params).sort()).toEqual([...scalars].sort());
      for (const key of scalars) expect(params[key]).toBe(sample(key));
    },
  );

  it('pins the window-closed copy’s one figure and drops its deadline', () => {
    expect(
      PipelineError.fromWire('failed-precondition', {
        errorCode: CancellationRefusalCode.WindowClosed,
        windowHours: 24,
        deadlineUtcMs: 1_790_575_200_000,
      }).serverParams,
    ).toEqual({ windowHours: 24 });
  });

  it('pins the transition refusal’s two states — the surface words them', () => {
    expect(
      PipelineError.fromWire('failed-precondition', {
        errorCode: BookingErrorCode.TransitionNotAllowed,
        fromBookingStatus: 'COMPLETED',
        toBookingStatus: 'CONFIRMED',
      }).serverParams,
    ).toEqual({ fromBookingStatus: 'COMPLETED', toBookingStatus: 'CONFIRMED' });
  });

  it('a code with no allowlist carries none', () => {
    expect(
      PipelineError.fromWire('not-found', {
        errorCode: 'REPOSITORY_READ_FAILED',
        path: 'users/u-1',
        reason: 'boom',
      }).serverParams,
    ).toEqual({});
  });
});
