import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Functions, FunctionsError } from 'firebase/functions';
import {
  BookingCall,
  OtpCode,
  Placement,
  StreakPublishCall,
  StreakRule,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingErrorCode,
  CartLineId,
  ClientOperationId,
  IdentifierChannel,
  LocationId,
  MinuteOfDay,
  OtpId,
  PipelineError,
  PipelineErrorCode,
  PublishRequestId,
  ServiceId,
} from '@core/primitives';
import { Callables } from '@core/ports';
import { localDate, unwrapErr, unwrapOk } from '@core/testing';

const { callableMock, httpsCallableMock } = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    callableMock: callable,
    httpsCallableMock: vi.fn<
      (functions: unknown, name: string) => typeof callable
    >(() => callable),
  };
});

vi.mock('firebase/functions', async () => ({
  ...(await vi.importActual<typeof import('firebase/functions')>(
    'firebase/functions',
  )),
  httpsCallable: httpsCallableMock,
}));

const { callableClientPorts } = await import('./callable-client.adapter');

const FUNCTIONS = { app: 'functions' } as unknown as Functions;

/** A brand off its smart constructor, or the spec stops. */
function brand<T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!parsed.ok) throw new Error('fixture failed its smart constructor');
  return parsed.value;
}

/** One seat for the booker — the shape the booking store sends. */
const COLD: BookingCall = {
  locationId: brand(LocationId.parse('loc-center')),
  localDate: localDate('2026-10-06'),
  seats: [
    BookingCall.seat(
      brand(CartLineId.parse('line-1')),
      brand(ServiceId.parse('svc-fade')),
      null,
      brand(BarberId.parse('ivan')),
      null,
      brand(MinuteOfDay.of(600)),
      BookingCall.selfSubject(),
    ),
  ],
  attemptId: brand(ClientOperationId.parse('attempt-0123456789abcdef')),
  contact: null,
  bookedFromAppointmentId: null,
  placement: Placement.Self,
  onBehalfOfUserId: null,
};

const client = () => callableClientPorts(FUNCTIONS).callableClient;

describe('callableClientPorts — the request', () => {
  beforeEach(() => {
    callableMock.mockReset();
    httpsCallableMock.mockClear();
  });

  it('dials the export the registry names, on the app’s Functions instance', async () => {
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-new' } });

    await client()(Callables.CommitBooking)(COLD);

    expect(httpsCallableMock).toHaveBeenCalledWith(FUNCTIONS, 'commitBooking');
  });

  // Defect §2.3 #6: nothing between the store and the callable drops the
  // rebooking edge (or anything else): the call component goes as it is.
  it('sends the call component as it is — the rebooking edge and a staff placement included', async () => {
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-new' } });
    const rebooked: BookingCall = {
      ...COLD,
      bookedFromAppointmentId: brand(AppointmentId.parse('appt-source')),
    };

    await client()(Callables.CommitBooking)(rebooked);

    expect(callableMock).toHaveBeenCalledTimes(1);
    expect(callableMock.mock.calls[0]?.[0]).toBe(rebooked);
  });
});

describe('callableClientPorts — the answer, through its call component’s decoder', () => {
  beforeEach(() => callableMock.mockReset());

  it('answers the decoded, branded answer', async () => {
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-new' } });

    const answer = unwrapOk(await client()(Callables.CommitBooking)(COLD));

    expect(answer).toEqual({ appointmentId: 'appt-new' });
  });

  it('decodes each callable by its own decoder — an OTP answer is not a booking answer', async () => {
    callableMock.mockResolvedValueOnce({
      data: { sessionKind: 'RETURNING', customToken: 'secret-token' },
    });

    const answer = unwrapOk(
      await client()(Callables.VerifyOtpChallenge)({
        challengeId: brand(OtpId.parse('challenge-1')),
        code: brand(OtpCode.parse('123456')),
      }),
    );

    expect(answer).toEqual({
      sessionKind: 'RETURNING',
      customToken: 'secret-token',
    });
  });

  // A 200 with nothing usable in it is UNKNOWN, never a booking: reporting a
  // booking that may not exist is the one failure worse than reporting none
  // (the cases of the deleted `booking-gateway.adapter.spec.ts`).
  it.each([
    ['no answer at all', undefined],
    ['an answer with no id', {}],
    ['an empty id', { appointmentId: '' }],
    ['an id that is no text', { appointmentId: 42 }],
  ])(
    'reports %s as PIPELINE_UNKNOWN, never as a booking',
    async (_what, data) => {
      callableMock.mockResolvedValueOnce({ data });

      const failure = unwrapErr(await client()(Callables.CommitBooking)(COLD));

      expect(failure).toEqual(PipelineError.bare(PipelineErrorCode.Unknown));
    },
  );

  it('reports a publish answer the call does not know as PIPELINE_UNKNOWN', async () => {
    callableMock.mockResolvedValueOnce({ data: { kind: 'published' } });

    const failure = unwrapErr(
      await client()(Callables.PublishStreakDefinition)(
        StreakPublishCall.withdraw(
          PublishRequestId.of('req-1'),
          StreakRule.DEFAULT_DEFINITION_ID,
          2,
        ),
      ),
    );

    expect(failure.errorCode).toBe(PipelineErrorCode.Unknown);
  });
});

describe('callableClientPorts — a refusal, through the ONE classification', () => {
  beforeEach(() => callableMock.mockReset());

  it('classifies a FunctionsError with PipelineError.fromWire, keeping the server’s code and context', async () => {
    const details = {
      errorCode: BookingErrorCode.SlotUnavailable,
      barberId: 'ivan',
      localDate: '2026-10-06',
      startMinutes: 600,
    };
    callableMock.mockRejectedValueOnce(
      new FunctionsError('failed-precondition', 'taken', details),
    );

    const failure = unwrapErr(await client()(Callables.CommitBooking)(COLD));

    expect(failure).toEqual(
      PipelineError.fromWire('functions/failed-precondition', details),
    );
    expect(failure.errorCode).toBe(PipelineErrorCode.SlotUnavailable);
    expect(failure.serverErrorCode).toBe(BookingErrorCode.SlotUnavailable);
    expect(failure.wireStatus).toBe('failed-precondition');
  });

  it('reads a bare status with no details by the status alone', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('unavailable'));

    const failure = unwrapErr(await client()(Callables.CommitBooking)(COLD));

    expect(failure.errorCode).toBe(PipelineErrorCode.Unavailable);
    expect(failure.serverErrorCode).toBeNull();
    expect(failure.wireStatus).toBe('unavailable');
  });

  it('keeps the wire status the OTP «blocked» reading looks at', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('permission-denied'));

    const failure = unwrapErr(
      await client()(Callables.RequestOtpChallenge)({
        identifierChannel: IdentifierChannel.Phone,
        identifier: '+359888123456',
      }),
    );

    expect(PipelineError.isBlocked(failure)).toBe(true);
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['something that is no error', 'nope'],
    [
      'an error that only looks like a FunctionsError',
      Object.assign(new Error('x'), {
        code: 'functions/not-found',
        details: { errorCode: BookingErrorCode.SlotUnavailable },
      }),
    ],
  ])('answers %s as PIPELINE_UNKNOWN', async (_what, thrown) => {
    callableMock.mockRejectedValueOnce(thrown);

    const failure = unwrapErr(await client()(Callables.CommitBooking)(COLD));

    expect(failure).toEqual(PipelineError.bare(PipelineErrorCode.Unknown));
  });

  it('never rejects: every failure is a value', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('internal'));

    await expect(
      client()(Callables.CommitBooking)(COLD),
    ).resolves.toMatchObject({ ok: false });
  });
});
