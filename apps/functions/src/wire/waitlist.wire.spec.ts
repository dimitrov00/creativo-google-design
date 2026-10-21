import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import {
  BarberId,
  BookingErrorCode,
  CancelWaitlistRefusalCode,
  CartLineId,
  RepositoryError,
  Result,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  WaitlistError,
  WaitlistRequestId,
} from '@core/primitives';
import { type RequestWaitlistCommand } from '@core/pipelines';
import { toHttpsError, WIRE_ZONE } from '../edge';
import {
  decodeCancelWaitlist,
  decodeRequestWaitlist,
  encodeCancelWaitlistAnswer,
  encodeRequestWaitlistAnswer,
} from './waitlist.wire';

/*
 * The waitlist callables' frozen wire (F1-3): today's JSON decoded into the
 * pipeline commands, today's answers and refusals encoded back — status,
 * message and `details` byte for byte where today's handlers spelled them
 * (`request-waitlist.ts`, `cancel-waitlist.ts`, pinned by `main.spec.ts`).
 */

function callable(
  data: unknown,
  uid: string | null = 'u-waiting',
): CallableRequest<unknown> {
  return {
    data,
    ...(uid === null ? {} : { auth: { uid, token: { roles: ['client'] } } }),
  } as unknown as CallableRequest<unknown>;
}

/** What the thrown answer of a decoder is, or a broken fixture. */
function thrownBy(run: () => unknown): HttpsError {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error('expected the decoder to answer with an HttpsError');
}

const TODAY_JSON = {
  locationId: 'loc-center',
  when: {
    days: [{ dayKey: '2030-01-15', windows: [{ from: '10:00', to: '12:00' }] }],
  },
  cart: {
    seats: [
      {
        seatKey: 'self',
        lines: [
          {
            id: 'line-1',
            serviceId: 'svc-cut',
            variantId: 'short',
            barberId: 'ivan',
          },
        ],
      },
    ],
    nextSequence: 1,
  },
};

describe('decodeRequestWaitlist', () => {
  it('turns today’s JSON into the command: the verified owner, the ask on the shop’s minutes, the flat cart, the tenant zone', () => {
    const self = SeatKeyText.of('self');
    const expected: RequestWaitlistCommand = {
      ownerUserId: UserId.of('u-waiting'),
      ask: {
        locationId: 'loc-center',
        days: [
          {
            localDate: '2030-01-15',
            windows: [{ startMinutes: 600, endMinutes: 720 }],
          },
        ],
        cart: {
          cartSeats: [
            {
              seatKey: self,
              lines: [
                {
                  lineId: CartLineId.of('line-1'),
                  seatKey: self,
                  serviceId: ServiceId.of('svc-cut'),
                  variantId: ServiceVariantId.of('short'),
                  barberId: BarberId.of('ivan'),
                  locationId: null,
                },
              ],
            },
          ],
          cartNextSequence: 1,
        },
      },
      timeZone: WIRE_ZONE,
    };
    expect(decodeRequestWaitlist(callable(TODAY_JSON))).toEqual(expected);
  });

  it('defaults nothing into existence: absent fields read empty, a face no clock shows a span the door refuses', () => {
    const command = decodeRequestWaitlist(
      callable({
        when: { days: [{ windows: [{ from: '25:00', to: 'noon' }] }] },
        cart: { seats: [{ lines: [{}] }] },
      }),
    );
    expect(command.ask.locationId).toBeNull();
    expect(command.ask.days[0]?.localDate).toBe('');
    expect(command.ask.days[0]?.windows[0]?.startMinutes).toBeNaN();
    expect(command.ask.days[0]?.windows[0]?.endMinutes).toBeNaN();
    expect(command.ask.cart).toEqual({
      cartSeats: [
        {
          seatKey: '',
          lines: [
            {
              lineId: '',
              seatKey: '',
              serviceId: '',
              variantId: null,
              barberId: null,
              locationId: null,
            },
          ],
        },
      ],
      cartNextSequence: 0,
    });
  });

  it('takes the owner from the token, never the payload — a visitor is nobody', () => {
    expect(
      decodeRequestWaitlist(
        callable({ ...TODAY_JSON, ownerUserId: 'u-forged' }, null),
      ).ownerUserId,
    ).toBeNull();
  });
});

describe('encodeRequestWaitlistAnswer', () => {
  it('answers today’s `{ requestId }`', () => {
    expect(
      encodeRequestWaitlistAnswer(
        Result.ok({ requestId: WaitlistRequestId.of('wl_abc') }),
      ),
    ).toEqual({ ok: true, value: { requestId: 'wl_abc' } });
  });

  it('lets a refusal leave by the shared table, details as today', () => {
    const encoded = encodeRequestWaitlistAnswer(
      Result.err(WaitlistError.invalidRequest(BookingErrorCode.UnknownService)),
    );
    if (encoded.ok) throw new Error('expected a refusal');
    const answer = toHttpsError(encoded.error);
    expect(answer.code).toBe('invalid-argument');
    expect(answer.details).toEqual({
      code: 'booking.waitlist.invalid_request',
      params: { field: 'booking.commit.unknown_service' },
    });
  });

  it('turns a store failure into the edge’s unexpected throw — never a refusal on the wire', () => {
    expect(() =>
      encodeRequestWaitlistAnswer(
        Result.err(
          RepositoryError.readFailed('settings/bookingPolicy', 'unavailable'),
        ),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});

describe('decodeCancelWaitlist', () => {
  it('answers a caller nobody verified with today’s own `{ code }`, message and all', () => {
    const answer = thrownBy(() =>
      decodeCancelWaitlist(callable({ requestId: 'r1' }, null)),
    );
    expect(answer.code).toBe('unauthenticated');
    expect(answer.message).toBe('Sign in to manage the waitlist');
    expect(answer.details).toEqual({
      code: 'booking.waitlist.unauthenticated',
    });
  });

  it('answers a missing request id with today’s own `{ code }`', () => {
    const answer = thrownBy(() => decodeCancelWaitlist(callable({})));
    expect(answer.code).toBe('invalid-argument');
    expect(answer.message).toBe('requestId is required');
    expect(answer.details).toEqual({
      code: 'booking.waitlist.invalid_request',
    });
  });

  it('decodes the verified owner and the request id', () => {
    expect(decodeCancelWaitlist(callable({ requestId: 'wl_1' }))).toEqual({
      ownerUserId: UserId.of('u-waiting'),
      requestId: WaitlistRequestId.of('wl_1'),
    });
  });
});

describe('encodeCancelWaitlistAnswer', () => {
  it('answers today’s `{ requestId }`', () => {
    expect(
      encodeCancelWaitlistAnswer(
        Result.ok({ requestId: WaitlistRequestId.of('wl_1') }),
      ),
    ).toEqual({ ok: true, value: { requestId: 'wl_1' } });
  });

  it.each([
    [
      CancelWaitlistRefusalCode.NotFound,
      'not-found',
      'booking.waitlist.not_found',
    ],
    [
      CancelWaitlistRefusalCode.NotCancellable,
      'failed-precondition',
      'booking.waitlist.not_cancellable',
    ],
  ])('lets %s leave as today’s `{ code }` row', (errorCode, status, code) => {
    const encoded = encodeCancelWaitlistAnswer(Result.err({ errorCode }));
    if (encoded.ok) throw new Error('expected a refusal');
    const answer = toHttpsError(encoded.error);
    expect(answer.code).toBe(status);
    expect(answer.details).toEqual({ code });
  });

  it('turns a store failure into the edge’s unexpected throw', () => {
    expect(() =>
      encodeCancelWaitlistAnswer(
        Result.err(
          RepositoryError.writeFailed('waitlistRequests/wl_1', 'aborted'),
        ),
      ),
    ).toThrow('REPOSITORY_WRITE_FAILED');
  });
});
