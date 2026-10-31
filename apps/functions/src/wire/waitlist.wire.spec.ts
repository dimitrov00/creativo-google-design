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
import { WaitlistSystem } from '@core/systems';
import { type EdgeError, toHttpsError } from '../edge';
import { decodeCancelWaitlist, decodeRequestWaitlist } from './waitlist.wire';
import { refusalOf } from './wire-read';

/*
 * The waitlist callables' flipped wire (Phase 4a 4A-4): the call component
 * `WaitlistCall` decoded into the pipeline commands, its answers the
 * pipelines' own (wired as they are), a refusal the ecs-core struct
 * projected by the shared table (`refusalOf`).
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

function errorOf<T>(result: Result<T, EdgeError>): EdgeError {
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
  it('turns the call component into the command: the verified owner, the ask on the shop’s minutes, the flat cart as raw strings — no zone, the pipeline reads the shop’s', () => {
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
        // The raw twin (pass E, E-4): the brand is the door's.
        cart: {
          cartSeats: [
            {
              seatKey: 'self',
              lines: [
                {
                  lineId: 'line-1',
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
      },
    };
    const command = valueOf(decodeRequestWaitlist(callable(CALL_JSON)));
    expect(command).toEqual(expected);
    // Branded as sent by the door, it is the flat cart the wire once built.
    const self = SeatKeyText.of('self');
    expect(WaitlistSystem.cartAsSent(command.ask.cart)).toEqual({
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
    });
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

  it('judges no id: `/`, blanks and a stray line seat key pass to the door as raw strings, the counter `Number`-read', () => {
    const command = valueOf(
      decodeRequestWaitlist(
        callable({
          ...CALL_JSON,
          cart: {
            cartSeats: [
              {
                seatKey: 'self/1',
                lines: [
                  {
                    lineId: 'line/0',
                    seatKey: 'someone-else',
                    serviceId: 'svc/x',
                    variantId: '',
                    barberId: 7,
                    locationId: '  ',
                  },
                ],
              },
            ],
            cartNextSequence: '2',
          },
        }),
      ),
    );
    expect(command.ask.cart).toEqual({
      cartSeats: [
        {
          seatKey: 'self/1',
          lines: [
            {
              lineId: 'line/0',
              serviceId: 'svc/x',
              variantId: '',
              barberId: '7',
              locationId: '  ',
            },
          ],
        },
      ],
      cartNextSequence: 2,
    });
    // Branded as sent by the door: the seat's key on the line, nothing judged
    // — the cart the wire built before pass E, byte for byte.
    const seat = SeatKeyText.of('self/1');
    expect(WaitlistSystem.cartAsSent(command.ask.cart)).toEqual({
      cartSeats: [
        {
          seatKey: seat,
          lines: [
            {
              lineId: CartLineId.of('line/0'),
              seatKey: seat,
              serviceId: ServiceId.of('svc/x'),
              variantId: ServiceVariantId.of(''),
              barberId: BarberId.of('7'),
              locationId: LocationId.of('  '),
            },
          ],
        },
      ],
      cartNextSequence: 2,
    });
    const noCount = valueOf(
      decodeRequestWaitlist(
        callable({
          ...CALL_JSON,
          cart: { ...CALL_JSON.cart, cartNextSequence: 'x' },
        }),
      ),
    );
    expect(noCount.ask.cart.cartNextSequence).toBeNaN();
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

describe('requestWaitlist’s refusals (`refusalOf`)', () => {
  it('lets a refusal leave by the shared table, its field as the struct holds it', () => {
    expect(
      wire(
        refusalOf(
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
      refusalOf(
        RepositoryError.readFailed('settings/bookingPolicy', 'unavailable'),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});

describe('decodeCancelWaitlist', () => {
  it('refuses a caller nobody verified as BOOKING_WAITLIST_UNAUTHENTICATED', () => {
    expect(
      wire(errorOf(decodeCancelWaitlist(callable({ requestId: 'r1' }, null)))),
    ).toEqual({
      code: 'unauthenticated',
      message: 'BOOKING_WAITLIST_UNAUTHENTICATED',
      details: { errorCode: 'BOOKING_WAITLIST_UNAUTHENTICATED' },
    });
  });

  it('refuses a missing request id as BOOKING_WAITLIST_INVALID_REQUEST naming `requestId`', () => {
    for (const data of [{}, { requestId: '' }, { requestId: 7 }]) {
      expect(wire(errorOf(decodeCancelWaitlist(callable(data))))).toEqual({
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

describe('cancelWaitlist’s refusals (`refusalOf`)', () => {
  it.each([
    [CancelWaitlistRefusalCode.NotFound, 'not-found'],
    [CancelWaitlistRefusalCode.NotCancellable, 'failed-precondition'],
  ])('lets %s leave as its code alone', (errorCode, status) => {
    expect(wire(refusalOf({ errorCode }))).toEqual({
      code: status,
      message: errorCode,
      details: { errorCode },
    });
  });

  it('turns a store failure into the edge’s unexpected throw', () => {
    expect(() =>
      refusalOf(
        RepositoryError.writeFailed('waitlistRequests/wl_1', 'aborted'),
      ),
    ).toThrow('REPOSITORY_WRITE_FAILED');
  });
});
