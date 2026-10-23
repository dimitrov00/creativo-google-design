import {
  BarberId,
  CartLineId,
  LocationId,
  Result,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  WaitlistRequestId,
} from '@core/primitives';
import {
  type CancelWaitlistRefusal,
  type RepositoryError,
  WaitlistError,
} from '@core/errors';
import type {
  BookingCart,
  CartLine,
  CartSeatLines,
  WaitlistCall,
} from '@core/components';
import type {
  CancelWaitlistAnswer,
  CancelWaitlistCommand,
  RequestWaitlistAnswer,
  RequestWaitlistCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerUserId } from '../lib/booking/caller-roles';
import {
  field,
  idOf,
  listOf,
  payloadOf,
  refusalOf,
  text,
  textOrNull,
  type WireRequest,
} from './wire-read';

/**
 * THE WAITLIST CALLABLES' WIRE (Phase 4a 4A-4) — flipped with the web's
 * `callableClient`: the request is the call component `WaitlistCall` read
 * into its raw twin (`WaitlistCall.Input`), the answer its answer type, a
 * refusal its ecs-core struct.
 *
 * - `requestWaitlist` `{ locationId, days: [{ localDate, windows:
 *   [{ startMinutes, endMinutes }] }], cart: { cartSeats: [{ seatKey,
 *   lines: [{ lineId, seatKey, serviceId, variantId, barberId, locationId
 *   }] }], cartNextSequence } }` → `{ requestId }`. Every field is re-read
 *   as a primitive without trusting it, nothing defaulted into existence: a
 *   window bound that is no number becomes `NaN`, which the door refuses
 *   (`windows`), an unreadable line one it refuses (`cart`). The owner is
 *   the VERIFIED token's uid, never the payload; the shop's clock is the
 *   pipeline's to read (the ask's shop, else the default location's).
 * - `cancelWaitlist` `{ requestId }` → `{ requestId }`. No caller →
 *   `BOOKING_WAITLIST_UNAUTHENTICATED`, no request id →
 *   `BOOKING_WAITLIST_INVALID_REQUEST` (`requestId`); not found / not
 *   cancellable leave as the pipeline's own refusal.
 *
 * A store failure is no refusal: it is thrown, for the edge to track and
 * answer as the platform's bare INTERNAL.
 */

/** A window bound as sent; anything but a number is `NaN`, which no window accepts. */
function minutesOf(raw: unknown): number {
  return typeof raw === 'number' ? raw : Number.NaN;
}

function daysOf(raw: unknown): readonly WaitlistCall.DayInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((day: unknown) => ({
    localDate: text(day, 'localDate'),
    windows: listOf(day, 'windows').map((window) => ({
      startMinutes: minutesOf(field(window, 'startMinutes')),
      endMinutes: minutesOf(field(window, 'endMinutes')),
    })),
  }));
}

/**
 * The wire cart as the flat `BookingCart` the door reads. Ids are branded as
 * sent (`of`): what is readable is the door's question
 * (`WaitlistSystem.decide` refuses an unreadable line as `cart`).
 */
function cartOf(raw: unknown): BookingCart {
  const cartSeats: CartSeatLines[] = listOf(raw, 'cartSeats').map((seat) => {
    const seatKey = SeatKeyText.of(text(seat, 'seatKey'));
    const lines: CartLine[] = listOf(seat, 'lines').map((line) => {
      const variantId = textOrNull(line, 'variantId');
      const barberId = textOrNull(line, 'barberId');
      const locationId = textOrNull(line, 'locationId');
      return {
        lineId: CartLineId.of(text(line, 'lineId')),
        seatKey,
        serviceId: ServiceId.of(text(line, 'serviceId')),
        variantId: variantId === null ? null : ServiceVariantId.of(variantId),
        barberId: barberId === null ? null : BarberId.of(barberId),
        locationId: locationId === null ? null : LocationId.of(locationId),
      };
    });
    return { seatKey, lines };
  });
  return {
    cartSeats,
    cartNextSequence: Number(field(raw, 'cartNextSequence') ?? 0),
  };
}

export function decodeRequestWaitlist(
  request: WireRequest,
): Result<RequestWaitlistCommand, EdgeError> {
  const payload = payloadOf(request);
  return Result.ok({
    ownerUserId: callerUserId(request),
    ask: {
      locationId: textOrNull(payload, 'locationId'),
      days: daysOf(field(payload, 'days')),
      cart: cartOf(field(payload, 'cart')),
    },
  });
}

export function encodeRequestWaitlistAnswer(
  answer: RequestWaitlistAnswer,
): WaitlistCall.Requested {
  return { requestId: answer.requestId };
}

/** The door's refusals leave as themselves (a store failure thrown). */
export function requestWaitlistRefusal(
  error: WaitlistError | RepositoryError,
): EdgeError {
  return refusalOf(error);
}

/** `{ requestId }` from a verified caller. */
export function decodeCancelWaitlist(
  request: WireRequest,
): Result<CancelWaitlistCommand, EdgeError> {
  const ownerUserId = callerUserId(request);
  if (ownerUserId === null) return Result.err(WaitlistError.unauthenticated());
  const requestId = idOf(
    field(payloadOf(request), 'requestId'),
    WaitlistRequestId.parse,
  );
  if (requestId === null) {
    return Result.err(WaitlistError.invalidRequest('requestId'));
  }
  return Result.ok({ ownerUserId, requestId });
}

export function encodeCancelWaitlistAnswer(
  answer: CancelWaitlistAnswer,
): WaitlistCall.Cancelled {
  return { requestId: answer.requestId };
}

/** Not found / not cancellable leave as themselves (a store failure thrown). */
export function cancelWaitlistRefusal(
  error: CancelWaitlistRefusal | RepositoryError,
): EdgeError {
  return refusalOf(error);
}
