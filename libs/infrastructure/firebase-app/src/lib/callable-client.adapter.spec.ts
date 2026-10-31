import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Functions, FunctionsError } from 'firebase/functions';
import {
  BookingCall,
  type ClientIssue,
  Identifier,
  OtpCode,
  Placement,
  StreakPublishCall,
  StreakRule,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  CartLineId,
  ClientOperationId,
  IdentifierChannel,
  LocationId,
  MinuteOfDay,
  OtpId,
  PublishRequestId,
  Result,
  ServiceId,
} from '@core/primitives';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { Callables, type ClientIssuePorts } from '@core/ports';
import { ClientIssueSystem } from '@core/systems';
import {
  localDate,
  recordingClientIssuePorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';

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

/** The id source the transport ids come from: one fixed, well-formed key per call. */
const TRANSPORT_ID = 'transport-0123456789abcdef';
const IDS = { nextId: () => TRANSPORT_ID };

const client = (
  ids = IDS,
  issues: ClientIssuePorts = recordingClientIssuePorts().ports,
) => callableClientPorts(FUNCTIONS, ids, issues).callableClient;

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

// WS-4.1: every call the server reads an operation id from carries one — a
// store-named act keeps its own (re-sent on a retry), any other
// `operationId` callable gets a transport id minted here; `attemptId` /
// `requestId` calls and the issue sink are never touched.
describe('callableClientPorts — the transport operation id', () => {
  beforeEach(() => {
    callableMock.mockReset();
    callableMock.mockResolvedValue({ data: {} });
  });

  const OTP_REQUEST = {
    identifierChannel: IdentifierChannel.Phone,
    identifier: Identifier.of('+359888123456'),
  } as const;

  it('mints one for an operationId callable whose input names none, the input otherwise unchanged', async () => {
    await client()(Callables.RequestOtpChallenge)(OTP_REQUEST);

    expect(callableMock.mock.calls[0]?.[0]).toEqual({
      ...OTP_REQUEST,
      operationId: TRANSPORT_ID,
    });
    expect(OTP_REQUEST).not.toHaveProperty('operationId');
  });

  it('mints a fresh one per call — a second call is a second act', async () => {
    let n = 0;
    const ids = { nextId: () => `transport-call-000000${(n += 1)}` };

    await client(ids)(Callables.RequestOtpChallenge)(OTP_REQUEST);
    await client(ids)(Callables.RequestOtpChallenge)(OTP_REQUEST);

    expect(callableMock.mock.calls.map((call) => call[0].operationId)).toEqual([
      'transport-call-0000001',
      'transport-call-0000002',
    ]);
  });

  it('sends a store-named act as it is, its own id kept and none minted', async () => {
    const nextId = vi.fn(() => TRANSPORT_ID);
    const cancel: BookingCall.Cancel = {
      ...BookingCall.clientCancel(brand(AppointmentId.parse('appt-1')), 'нещо'),
      operationId: brand(ClientOperationId.parse('store-minted-0123456789')),
    };

    await client({ nextId })(Callables.CancelAppointment)(cancel);

    expect(callableMock.mock.calls[0]?.[0]).toBe(cancel);
    expect(nextId).not.toHaveBeenCalled();
  });

  it.each([
    ['commitBooking (attemptId)', Callables.CommitBooking, COLD],
    [
      'publishStreakDefinition (requestId)',
      Callables.PublishStreakDefinition,
      StreakPublishCall.withdraw(
        PublishRequestId.of('req-1'),
        StreakRule.DEFAULT_DEFINITION_ID,
        2,
      ),
    ],
    ['reportClientIssues (none — OR-34)', Callables.ReportClientIssues, []],
  ] as const)('never touches %s', async (_what, name, input) => {
    const nextId = vi.fn(() => TRANSPORT_ID);

    await client({ nextId })(name)(input as never);

    expect(callableMock.mock.calls[0]?.[0]).toBe(input);
    expect(nextId).not.toHaveBeenCalled();
  });

  it('sends none when the mint fails the key’s shape', async () => {
    await client({ nextId: () => 'short' })(Callables.RequestOtpChallenge)(
      OTP_REQUEST,
    );

    expect(callableMock.mock.calls[0]?.[0]).toBe(OTP_REQUEST);
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

      expect(failure).toEqual(
        PipelineError.withOperation(
          PipelineError.bare(PipelineErrorCode.Unknown),
          COLD.attemptId,
        ),
      );
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
      PipelineError.withOperation(
        PipelineError.fromWire('functions/failed-precondition', details),
        COLD.attemptId,
      ),
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
        identifier: Identifier.of('+359888123456'),
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

    expect(failure).toEqual(
      PipelineError.withOperation(
        PipelineError.bare(PipelineErrorCode.Unknown),
        COLD.attemptId,
      ),
    );
  });

  it('never rejects: every failure is a value', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('internal'));

    await expect(
      client()(Callables.CommitBooking)(COLD),
    ).resolves.toMatchObject({ ok: false });
  });
});

// WS-4.5: every failure carries the id its call went out with — the
// reference the surface prints — read off the input AS SENT, so a minted
// transport id is the one the server logged.
describe('callableClientPorts — the operation id on every failure', () => {
  beforeEach(() => callableMock.mockReset());

  const OTP_REQUEST = {
    identifierChannel: IdentifierChannel.Phone,
    identifier: Identifier.of('+359888123456'),
  } as const;

  it('carries the attempt id of a booking refusal', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('unavailable'));

    const failure = unwrapErr(await client()(Callables.CommitBooking)(COLD));

    expect(failure.operationId).toBe('attempt-0123456789abcdef');
  });

  it('carries the transport id minted for the call, on a refusal and on PIPELINE_UNKNOWN', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('permission-denied'));
    const refused = unwrapErr(
      await client()(Callables.RequestOtpChallenge)(OTP_REQUEST),
    );
    callableMock.mockRejectedValueOnce(new Error('network'));
    const unknown = unwrapErr(
      await client()(Callables.RequestOtpChallenge)(OTP_REQUEST),
    );

    expect(refused.operationId).toBe(TRANSPORT_ID);
    expect(unknown).toEqual(
      PipelineError.withOperation(
        PipelineError.bare(PipelineErrorCode.Unknown),
        brand(ClientOperationId.parse(TRANSPORT_ID)),
      ),
    );
  });

  it('carries a store-named act’s own id', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('internal'));
    const cancel: BookingCall.Cancel = {
      ...BookingCall.clientCancel(brand(AppointmentId.parse('appt-1')), 'нещо'),
      operationId: brand(ClientOperationId.parse('store-minted-0123456789')),
    };

    const failure = unwrapErr(
      await client()(Callables.CancelAppointment)(cancel),
    );

    expect(failure.operationId).toBe('store-minted-0123456789');
  });

  it('carries the id when the answer’s decoder refuses it', async () => {
    callableMock.mockResolvedValueOnce({ data: {} });

    const failure = unwrapErr(await client()(Callables.CommitBooking)(COLD));

    expect(failure.errorCode).toBe(PipelineErrorCode.Unknown);
    expect(failure.operationId).toBe('attempt-0123456789abcdef');
  });

  it('carries none for the issue sink, nor for a call that sent none', async () => {
    callableMock.mockRejectedValueOnce(new FunctionsError('internal'));
    const sink = unwrapErr(await client()(Callables.ReportClientIssues)([]));
    callableMock.mockRejectedValueOnce(new FunctionsError('internal'));
    const unminted = unwrapErr(
      await client({ nextId: () => 'short' })(Callables.RequestOtpChallenge)(
        OTP_REQUEST,
      ),
    );

    expect(sink.operationId).toBeNull();
    expect(unminted.operationId).toBeNull();
  });
});

// WS-5 (DEP-22): a call that never answered as a callable — the throw was no
// `FunctionsError` — still answers PIPELINE_UNKNOWN, and is reported ONCE to
// the client issue sink as CALLABLE_TRANSPORT_FAILED: the callable, the
// thrown value's name and code, the operation id; never its message.
describe('callableClientPorts — a transport failure, reported to the issue sink', () => {
  beforeEach(() => callableMock.mockReset());

  /** The issue the client reports for `name`'s failed call. */
  const reported = (
    callableName: string,
    errorName: string | null,
    callableErrorCode: string | null,
    operationId: string | null,
  ): ClientIssue =>
    ClientIssueSystem.composeTransport({
      callableName,
      errorName,
      callableErrorCode,
      operationId:
        operationId === null
          ? null
          : brand(ClientOperationId.parse(operationId)),
      release: null,
    });

  it.each([
    ['a plain Error', new Error('boom 0888123456'), 'Error', null],
    ['something that is no error', 'nope', null, null],
    [
      'an error that only looks like a FunctionsError',
      Object.assign(new TypeError('x'), {
        code: 'functions/not-found',
        details: { errorCode: BookingErrorCode.SlotUnavailable },
      }),
      'TypeError',
      'functions/not-found',
    ],
  ])(
    'reports %s once, with the callable, its name and code and the operation id — and still answers PIPELINE_UNKNOWN',
    async (_what, thrown, errorName, callableErrorCode) => {
      const sink = recordingClientIssuePorts();
      callableMock.mockRejectedValueOnce(thrown);

      const failure = unwrapErr(
        await client(IDS, sink.ports)(Callables.CommitBooking)(COLD),
      );

      expect(failure).toEqual(
        PipelineError.withOperation(
          PipelineError.bare(PipelineErrorCode.Unknown),
          COLD.attemptId,
        ),
      );
      expect(sink.reported).toEqual([
        reported(
          'commitBooking',
          errorName,
          callableErrorCode,
          'attempt-0123456789abcdef',
        ),
      ]);
      expect(JSON.stringify(sink.reported)).not.toContain('0888123456');
    },
  );

  it('reports the transport id minted for the call — the one the server would have logged', async () => {
    const sink = recordingClientIssuePorts();
    // What the SDK throws for a fetch that failed (status 0) — a network
    // that dropped, a backend that crashed without a CORS header (review
    // round 2: never a bare `TypeError`, the SDK catches that itself).
    callableMock.mockRejectedValueOnce(
      new FunctionsError('internal', 'internal'),
    );

    await client(IDS, sink.ports)(Callables.RequestOtpChallenge)({
      identifierChannel: IdentifierChannel.Phone,
      identifier: Identifier.of('+359888123456'),
    });

    expect(sink.reported).toEqual([
      reported(
        'requestOtpChallenge',
        'FirebaseError',
        'functions/internal',
        TRANSPORT_ID,
      ),
    ]);
  });

  // The SDK's own failures — no answer the server wrote — are all
  // `FunctionsError`s worded by the SDK (review round 2): reported once, the
  // answer still `fromWire`'s.
  it.each([
    [
      'a fetch that failed (status 0)',
      new FunctionsError('internal', 'internal'),
    ],
    [
      'a platform 5xx page with no JSON',
      new FunctionsError('unavailable', 'unavailable'),
    ],
    [
      'the SDK’s 70 s timeout',
      new FunctionsError('deadline-exceeded', 'deadline-exceeded'),
    ],
    [
      'a body with no data field',
      new FunctionsError('internal', 'Response is missing data field.'),
    ],
    [
      'a body that is no JSON object',
      new FunctionsError('internal', 'Response is not valid JSON object.'),
    ],
  ])(
    'reports %s once — FirebaseError and its code — and still answers fromWire',
    async (_what, thrown) => {
      const sink = recordingClientIssuePorts();
      callableMock.mockRejectedValueOnce(thrown);

      const failure = unwrapErr(
        await client(IDS, sink.ports)(Callables.CommitBooking)(COLD),
      );

      expect(failure).toEqual(
        PipelineError.withOperation(
          PipelineError.fromWire(thrown.code, undefined),
          COLD.attemptId,
        ),
      );
      expect(sink.reported).toEqual([
        reported(
          'commitBooking',
          'FirebaseError',
          thrown.code,
          'attempt-0123456789abcdef',
        ),
      ]);
    },
  );

  it('reports nothing for a refusal or an answer its decoder refuses — the server answered', async () => {
    const sink = recordingClientIssuePorts();
    callableMock.mockRejectedValueOnce(new FunctionsError('internal'));
    await client(IDS, sink.ports)(Callables.CommitBooking)(COLD);
    callableMock.mockResolvedValueOnce({ data: {} });
    await client(IDS, sink.ports)(Callables.CommitBooking)(COLD);

    expect(sink.reported).toEqual([]);
  });

  // What this edge and the platform answer: the SCREAMING errorCode with its
  // details, or the uppercase bare status — never the SDK's own wording.
  it.each([
    [
      'the platform’s bare INTERNAL',
      new FunctionsError('internal', 'INTERNAL'),
    ],
    [
      'the throttle',
      new FunctionsError('resource-exhausted', 'RESOURCE_EXHAUSTED'),
    ],
    [
      'a coded refusal',
      new FunctionsError(
        'failed-precondition',
        BookingErrorCode.SlotUnavailable,
        {
          errorCode: BookingErrorCode.SlotUnavailable,
        },
      ),
    ],
    [
      'a refusal worded like a bare code, with details',
      new FunctionsError('internal', 'internal', {
        errorCode: 'PIPELINE_UNKNOWN',
      }),
    ],
  ])('reports nothing for %s — the server answered', async (_what, thrown) => {
    const sink = recordingClientIssuePorts();
    callableMock.mockRejectedValueOnce(thrown);

    const failure = unwrapErr(
      await client(IDS, sink.ports)(Callables.CommitBooking)(COLD),
    );

    expect(failure).toEqual(
      PipelineError.withOperation(
        PipelineError.fromWire(thrown.code, thrown.details),
        COLD.attemptId,
      ),
    );
    expect(sink.reported).toEqual([]);
  });

  it('never reports the sink’s own failure — it would report itself', async () => {
    const sink = recordingClientIssuePorts();
    callableMock.mockRejectedValueOnce(new Error('network'));

    const failure = unwrapErr(
      await client(IDS, sink.ports)(Callables.ReportClientIssues)([]),
    );

    expect(failure.errorCode).toBe(PipelineErrorCode.Unknown);
    expect(sink.reported).toEqual([]);
  });

  it('never rejects when the report fails — a throwing sink or a thrown value that throws back', async () => {
    const throwing: ClientIssuePorts = {
      reportClientIssues: () => {
        throw new Error('sink down');
      },
    };
    callableMock.mockRejectedValueOnce(new Error('network'));
    await expect(
      client(IDS, throwing)(Callables.CommitBooking)(COLD),
    ).resolves.toEqual(
      Result.err(
        PipelineError.withOperation(
          PipelineError.bare(PipelineErrorCode.Unknown),
          COLD.attemptId,
        ),
      ),
    );

    const sink = recordingClientIssuePorts();
    const hostile = {
      get name(): string {
        throw new Error('no name for you');
      },
    };
    callableMock.mockRejectedValueOnce(hostile);
    await expect(
      client(IDS, sink.ports)(Callables.CommitBooking)(COLD),
    ).resolves.toMatchObject({ ok: false });
    expect(sink.reported).toEqual([]);
  });
});
