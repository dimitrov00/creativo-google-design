import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  BarberId,
  CartLineId,
  LocationId,
  type Result,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  WaitlistRequestId,
} from '@core/primitives';
import {
  BookingErrorCode,
  CancelWaitlistRefusalCode,
  RepositoryError,
  WaitlistError,
} from '@core/errors';
import type { RequestWaitlistCommand } from '@core/pipelines';
import { type EdgeError, toHttpsError } from '../edge';
import {
  cancelWaitlistRefusal,
  decodeCancelWaitlist,
  decodeRequestWaitlist,
  encodeCancelWaitlistAnswer,
  encodeRequestWaitlistAnswer,
  requestWaitlistRefusal,
} from './waitlist.wire';

/*
 * The waitlist callables' flipped wire (Phase 4a 4A-4): the call component
 * `WaitlistCall` decoded into the pipeline commands, its answers encoded,
 * a refusal the ecs-core struct projected by the shared table.
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

function valueOf<T>(result: Result<T, EdgeError>): T {
  if (!result.ok) {
    throw new Error(`expected a command: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function refusalOf<T>(result: Result<T, EdgeError>): EdgeError {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

/** A refusal as the client sees it on the wire. */
function wire(error: EdgeError) {
  const thrown = toHttpsError(error);
  return {
    code: thrown.code,
    message: thrown.message,
    details: thrown.details,
  };
}

const CALL_JSON = {
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
        seatKey: 'self',
        lines: [
          {
            lineId: 'line-1',
            seatKey: 'self',
            serviceId: 'svc-cut',
            variantId: 'short',
            barberId: 'ivan',
            locationId: 'loc-center',
          },
        ],
      },
    ],
    cartNextSequence: 1,
  },
};

describe('decodeRequestWaitlist', () => {
  it('turns the call component into the command: the verified owner, the ask on the shop’s minutes, the flat cart — no zone, the pipeline reads the shop’s', () => {
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
                  locationId: LocationId.of('loc-center'),
                },
              ],
            },
          ],
          cartNextSequence: 1,
        },
      },
    };
    expect(valueOf(decodeRequestWaitlist(callable(CALL_JSON)))).toEqual(
      expected,
    );
  });

  it('defaults nothing into existence: absent fields read empty, a bound that is no number a span the door refuses', () => {
    const command = valueOf(
      decodeRequestWaitlist(
        callable({
          days: [{ windows: [{ startMinutes: '10:00', endMinutes: null }] }],
          cart: { cartSeats: [{ lines: [{}] }] },
        }),
      ),
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

  it('reads no legacy field: `when`, `dayKey`, `from`/`to` and `seats` are no request', () => {
    const command = valueOf(
      decodeRequestWaitlist(
        callable({
          when: {
            days: [
              {
                dayKey: '2030-01-15',
                windows: [{ from: '10:00', to: '12:00' }],
              },
            ],
          },
          cart: { seats: [{ seatKey: 'self', lines: [] }], nextSequence: 1 },
        }),
      ),
    );
    expect(command.ask.days).toEqual([]);
    expect(command.ask.cart).toEqual({ cartSeats: [], cartNextSequence: 0 });
  });

  it('takes the owner from the token, never the payload — a visitor is nobody', () => {
    expect(
      valueOf(
        decodeRequestWaitlist(
          callable({ ...CALL_JSON, ownerUserId: 'u-forged' }, null),
        ),
      ).ownerUserId,
    ).toBeNull();
  });
});

describe('encodeRequestWaitlistAnswer / requestWaitlistRefusal', () => {
  it('answers `{ requestId }`', () => {
    expect(
      encodeRequestWaitlistAnswer({
        requestId: WaitlistRequestId.of('wl_abc'),
      }),
    ).toEqual({ requestId: 'wl_abc' });
  });

  it('lets a refusal leave by the shared table, its field as the struct holds it', () => {
    expect(
      wire(
        requestWaitlistRefusal(
          WaitlistError.invalidRequest(BookingErrorCode.UnknownService),
        ),
      ),
    ).toEqual({
      code: 'invalid-argument',
      message: 'BOOKING_WAITLIST_INVALID_REQUEST',
      details: {
        errorCode: 'BOOKING_WAITLIST_INVALID_REQUEST',
        field: BookingErrorCode.UnknownService,
      },
    });
  });

  it('turns a store failure into the edge’s unexpected throw — never a refusal on the wire', () => {
    expect(() =>
      requestWaitlistRefusal(
        RepositoryError.readFailed('settings/bookingPolicy', 'unavailable'),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});

describe('decodeCancelWaitlist', () => {
  it('refuses a caller nobody verified as BOOKING_WAITLIST_UNAUTHENTICATED', () => {
    expect(
      wire(
        refusalOf(decodeCancelWaitlist(callable({ requestId: 'r1' }, null))),
      ),
    ).toEqual({
      code: 'unauthenticated',
      message: 'BOOKING_WAITLIST_UNAUTHENTICATED',
      details: { errorCode: 'BOOKING_WAITLIST_UNAUTHENTICATED' },
    });
  });

  it('refuses a missing request id as BOOKING_WAITLIST_INVALID_REQUEST naming `requestId`', () => {
    for (const data of [{}, { requestId: '' }, { requestId: 7 }]) {
      expect(wire(refusalOf(decodeCancelWaitlist(callable(data))))).toEqual({
        code: 'invalid-argument',
        message: 'BOOKING_WAITLIST_INVALID_REQUEST',
        details: {
          errorCode: 'BOOKING_WAITLIST_INVALID_REQUEST',
          field: 'requestId',
        },
      });
    }
  });

  it('decodes the verified owner and the request id', () => {
    expect(
      valueOf(decodeCancelWaitlist(callable({ requestId: 'wl_1' }))),
    ).toEqual({
      ownerUserId: UserId.of('u-waiting'),
      requestId: WaitlistRequestId.of('wl_1'),
    });
  });
});

describe('encodeCancelWaitlistAnswer / cancelWaitlistRefusal', () => {
  it('answers `{ requestId }`', () => {
    expect(
      encodeCancelWaitlistAnswer({ requestId: WaitlistRequestId.of('wl_1') }),
    ).toEqual({ requestId: 'wl_1' });
  });

  it.each([
    [CancelWaitlistRefusalCode.NotFound, 'not-found'],
    [CancelWaitlistRefusalCode.NotCancellable, 'failed-precondition'],
  ])('lets %s leave as its code alone', (errorCode, status) => {
    expect(wire(cancelWaitlistRefusal({ errorCode }))).toEqual({
      code: status,
      message: errorCode,
      details: { errorCode },
    });
  });

  it('turns a store failure into the edge’s unexpected throw', () => {
    expect(() =>
      cancelWaitlistRefusal(
        RepositoryError.writeFailed('waitlistRequests/wl_1', 'aborted'),
      ),
    ).toThrow('REPOSITORY_WRITE_FAILED');
  });
});
