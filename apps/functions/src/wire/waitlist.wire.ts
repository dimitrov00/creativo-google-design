import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import {
  BarberId,
  CartLineId,
  type RepositoryError,
  Result,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  type WaitlistError,
  WaitlistRequestId,
} from '@core/primitives';
import {
  type BookingCart,
  type CartLine,
  type CartSeatLines,
  DayHours,
} from '@core/components';
import type { WaitlistAskDayInput } from '@core/systems';
import {
  type CancelWaitlistAnswer,
  type CancelWaitlistCommand,
  type CancelWaitlistRefusal,
  CancelWaitlistRefusalCode,
  type RequestWaitlistAnswer,
  type RequestWaitlistCommand,
} from '@core/pipelines';
import { type EdgeError, LegacyWireCode, WIRE_ZONE } from '../edge';

/**
 * The waitlist callables' FROZEN wire (flip 1, F1-3): today's request JSON in,
 * today's answer JSON out, byte for byte — the web's `WAITLIST_GATEWAY` and
 * `verify:p0` keep their payloads until Phase 4's `callableClient`.
 *
 * - `requestWaitlist` `{ locationId, when: { days: [{ dayKey, windows:
 *   [{ from, to }] }] }, cart: { seats: [{ seatKey, lines: [{ id,
 *   serviceId, variantId, barberId }] }], nextSequence } }` → `{ requestId }`.
 *   Every field is re-read as a primitive without trusting it, nothing
 *   defaulted into existence; a window face no clock shows becomes a span the
 *   door refuses (`windows`), an unreadable line one it refuses (`cart`). The
 *   owner is the VERIFIED token's uid, never the payload. Refusals are the
 *   pipeline's `WaitlistError`s, which leave by the shared `EDGE_WIRE` table.
 * - `cancelWaitlist` `{ requestId }` → `{ requestId }`. Its two input
 *   refusals — no caller, no request id — are answered HERE, as today's
 *   `{ code }`-only `HttpsError`s, message and all (the decoder throws the
 *   callable's own answer; `callableEdge` passes an `HttpsError` through
 *   untouched). Not found / not cancellable leave as the table's legacy
 *   `{ code }` rows.
 *
 * A store failure is no refusal: it leaves as today's unexpected INTERNAL
 * (the encoder rethrows it for `callableEdge` to track and answer).
 */

type Payload = { readonly [field: string]: unknown };

/** A payload object, or the empty one — read without trusting its shape. */
function objectOf(raw: unknown): Payload {
  return raw !== null && typeof raw === 'object' ? (raw as Payload) : {};
}

function arrayOf(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/** `String(x ?? '')` — today's reading of a text field. */
function textOf(raw: unknown): string {
  return raw === undefined || raw === null ? '' : String(raw);
}

/** `'HH:mm'` → minutes of the day; a face no clock shows is `NaN`, which no window accepts. */
function minutesOf(face: string): number {
  const parsed = DayHours.parseClock(face);
  return parsed.ok ? parsed.value : Number.NaN;
}

function daysOf(raw: unknown): readonly WaitlistAskDayInput[] {
  return arrayOf(raw).map((entry) => {
    const day = objectOf(entry);
    return {
      localDate: textOf(day['dayKey']),
      windows: arrayOf(day['windows']).map((window) => {
        const span = objectOf(window);
        return {
          startMinutes: minutesOf(textOf(span['from'])),
          endMinutes: minutesOf(textOf(span['to'])),
        };
      }),
    };
  });
}

/**
 * The wire cart as the flat `BookingCart` the door reads. Ids are branded as
 * sent (`of`): what is readable is the door's question
 * (`WaitlistSystem.decide` refuses an unreadable line as `cart`).
 */
function cartOf(raw: unknown): BookingCart {
  const cart = objectOf(raw);
  const cartSeats: CartSeatLines[] = arrayOf(cart['seats']).map((entry) => {
    const seat = objectOf(entry);
    const seatKey = SeatKeyText.of(textOf(seat['seatKey']));
    const lines: CartLine[] = arrayOf(seat['lines']).map((rawLine) => {
      const line = objectOf(rawLine);
      return {
        lineId: CartLineId.of(textOf(line['id'])),
        seatKey,
        serviceId: ServiceId.of(textOf(line['serviceId'])),
        variantId:
          line['variantId'] === undefined || line['variantId'] === null
            ? null
            : ServiceVariantId.of(String(line['variantId'])),
        barberId:
          line['barberId'] === undefined || line['barberId'] === null
            ? null
            : BarberId.of(String(line['barberId'])),
        locationId: null,
      };
    });
    return { seatKey, lines };
  });
  return {
    cartSeats,
    cartNextSequence: Number(cart['nextSequence'] ?? 0),
  };
}

/** The verified caller, or `null` — an empty uid is nobody. */
function callerOf(request: CallableRequest<unknown>): UserId | null {
  const uid = UserId.parse(request.auth?.uid ?? '');
  return uid.ok ? uid.value : null;
}

/**
 * A store failure as the edge's unexpected throw — tracked, and answered as
 * today's bare INTERNAL. Never a refusal on the wire.
 */
export function storeFailure(error: RepositoryError): Error {
  return Object.assign(new Error(error.errorCode), { repositoryError: error });
}

export function decodeRequestWaitlist(
  request: CallableRequest<unknown>,
): RequestWaitlistCommand {
  const payload = objectOf(request.data);
  const locationId = payload['locationId'];
  const { days: askedDays } = objectOf(payload['when']);
  return {
    ownerUserId: callerOf(request),
    ask: {
      locationId:
        locationId === undefined || locationId === null
          ? null
          : String(locationId),
      days: daysOf(askedDays),
      cart: cartOf(payload['cart']),
    },
    timeZone: WIRE_ZONE,
  };
}

/** Today's answer `{ requestId }`; a refusal leaves by the shared table. */
export function encodeRequestWaitlistAnswer(
  result: Result<RequestWaitlistAnswer, WaitlistError | RepositoryError>,
): Result<{ readonly requestId: string }, EdgeError> {
  if (result.ok) return Result.ok({ requestId: result.value.requestId });
  const error = result.error;
  if (isRepositoryError(error)) throw storeFailure(error);
  return Result.err(error);
}

/**
 * `{ requestId }` from a verified caller — or today's own `{ code }`-only
 * answer, thrown for `callableEdge` to pass through untouched.
 */
export function decodeCancelWaitlist(
  request: CallableRequest<unknown>,
): CancelWaitlistCommand {
  const ownerUserId = callerOf(request);
  if (ownerUserId === null) {
    throw new HttpsError('unauthenticated', 'Sign in to manage the waitlist', {
      code: 'booking.waitlist.unauthenticated',
    });
  }
  const requestId = textOf(objectOf(request.data)['requestId']);
  if (requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required', {
      code: 'booking.waitlist.invalid_request',
    });
  }
  return { ownerUserId, requestId: WaitlistRequestId.of(requestId) };
}

/** Today's answer `{ requestId }`; not found / not cancellable as the table's legacy `{ code }` rows. */
export function encodeCancelWaitlistAnswer(
  result: Result<CancelWaitlistAnswer, CancelWaitlistRefusal | RepositoryError>,
): Result<{ readonly requestId: string }, EdgeError> {
  if (result.ok) return Result.ok({ requestId: result.value.requestId });
  const error = result.error;
  if (isRepositoryError(error)) throw storeFailure(error);
  return Result.err({
    code:
      error.errorCode === CancelWaitlistRefusalCode.NotFound
        ? LegacyWireCode.WaitlistNotFound
        : LegacyWireCode.WaitlistNotCancellable,
  });
}

function isRepositoryError(
  error: { readonly errorCode: string } | RepositoryError,
): error is RepositoryError {
  return 'path' in error && 'reason' in error;
}
