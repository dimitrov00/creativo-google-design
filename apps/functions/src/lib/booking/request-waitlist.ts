import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import { CalendarDay, WaitlistRequest } from '@creativo/domain/scheduling';
import { FirestoreWaitlistStore } from '../../adapters/firestore-waitlist-store';
import { SystemClock } from '../../adapters/system-clock';
import { CryptoIdGenerator } from '../../adapters/crypto-id-generator';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import {
  RequestWaitlistDuplicateError,
  type RequestWaitlistError,
} from '../../use-cases/request-waitlist.errors';
import {
  type RequestedDay,
  decideWaitlist,
} from '../../use-cases/decide-waitlist';

/**
 * The tenant's zone.
 *
 * A single-city tenant, so a constant is honest today. It becomes a read of
 * the chosen `Location.timezone` the day a shop opens in another zone — the
 * same day `decideBooking`'s own zone lookup stops being one shop's.
 */
const TENANT_ZONE = 'Europe/Sofia';

export function toWaitlistHttpsError(error: RequestWaitlistError): HttpsError {
  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'booking.waitlist.unauthenticated':
      return new HttpsError('unauthenticated', error.message, details);
    case 'booking.waitlist.already_watching':
      return new HttpsError('already-exists', error.message, details);
    case 'booking.waitlist.too_many_days':
      return new HttpsError('failed-precondition', error.message, details);
    default:
      return new HttpsError('invalid-argument', error.message, details);
  }
}

/**
 * Shape the payload without trusting it — same discipline as `commitBooking`:
 * every field re-read as a primitive, nothing defaulted into existence.
 */
function toDays(raw: unknown): readonly RequestedDay[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): RequestedDay => {
    const day = (entry ?? {}) as Record<string, unknown>;
    const windows = Array.isArray(day['windows']) ? day['windows'] : [];
    return {
      dayKey: String(day['dayKey'] ?? ''),
      windows: windows.map((window) => {
        const span = (window ?? {}) as Record<string, unknown>;
        return {
          from: String(span['from'] ?? ''),
          to: String(span['to'] ?? ''),
        };
      }),
    };
  });
}

function toCart(raw: unknown): {
  readonly seats: readonly {
    readonly seatKey: string;
    readonly lines: readonly {
      readonly id: string;
      readonly serviceId: string;
      readonly variantId: string | null;
      readonly barberId: string | null;
    }[];
  }[];
  readonly nextSequence: number;
} {
  const cart = (raw ?? {}) as Record<string, unknown>;
  const seats = Array.isArray(cart['seats']) ? cart['seats'] : [];
  return {
    seats: seats.map((entry) => {
      const seat = (entry ?? {}) as Record<string, unknown>;
      const lines = Array.isArray(seat['lines']) ? seat['lines'] : [];
      return {
        seatKey: String(seat['seatKey'] ?? ''),
        lines: lines.map((rawLine) => {
          const line = (rawLine ?? {}) as Record<string, unknown>;
          return {
            id: String(line['id'] ?? ''),
            serviceId: String(line['serviceId'] ?? ''),
            variantId:
              line['variantId'] == null ? null : String(line['variantId']),
            barberId:
              line['barberId'] == null ? null : String(line['barberId']),
          };
        }),
      };
    }),
    nextSequence: Number(cart['nextSequence'] ?? 0),
  };
}

/**
 * Record a standing request to be told when these days open up.
 *
 * Server-side for the same reason `commitBooking` is: the owner comes from
 * `request.auth` and never from the payload. Unlike a booking there is no
 * transaction — a waitlist request claims no slot, so two arriving at once is
 * not a race, it is two people waiting.
 */
export const requestWaitlist = onCall(async (request) => {
  const db = adminFirestore();
  const store = new FirestoreWaitlistStore(db);
  const clock = new SystemClock();
  const policy = await loadBookingPolicy(db);

  const nowResult = clock.now(TENANT_ZONE);
  if (nowResult.isFailure()) {
    throw new HttpsError('internal', 'Clock unavailable');
  }
  const now = nowResult.value;

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const decided = decideWaitlist(
    {
      locationId:
        payload['locationId'] == null ? null : String(payload['locationId']),
      days: toDays((payload['when'] as Record<string, unknown>)?.['days']),
      cart: toCart(payload['cart']),
    },
    {
      now,
      zone: TENANT_ZONE,
      maxFlexibleDays: policy.maxFlexibleDays,
      horizonEnd: policy.horizonEndFrom(CalendarDay.fromZonedDateTime(now)),
      nextId: () => new CryptoIdGenerator().next(),
      ownerUserId: request.auth?.uid ?? null,
    },
  );

  if (decided.isFailure()) throw toWaitlistHttpsError(decided.error);

  // The id is a HASH of what the request means. Decided (normalized) first,
  // hashed second, so two phrasings of the same ask collapse to one id — and
  // `createOnly` turns "already watching?" from a read-N-then-check race into
  // one atomic write refusal. Still refused loudly rather than silently
  // deduplicated: the honest answer to "watch these days" when they are
  // already watched is that they are.
  const stable = WaitlistRequest.reconstitute({
    ...decided.value.toProps(),
    id: deterministicRequestId(decided.value),
  });
  if (stable.isFailure()) {
    throw new HttpsError('internal', 'Waitlist id derivation failed');
  }

  const created = await store.createOnly(stable.value);
  if (!created) {
    throw toWaitlistHttpsError(new RequestWaitlistDuplicateError());
  }

  return match(stable, {
    success: (accepted) => ({ requestId: accepted.id.value }),
    failure: () => {
      throw new HttpsError('internal', 'unreachable');
    },
  });
});

/**
 * `wl_` + SHA-256 over the request's normalized meaning. The domain has
 * already sorted days and windows by the time this runs, so equality of
 * meaning is equality of serialization — the property the doc id encodes.
 */
function deterministicRequestId(request: WaitlistRequest): string {
  const props = request.toProps();
  const basis = JSON.stringify({
    owner: props.ownerId,
    locationId: props.locationId ?? null,
    when: props.when,
    cart: props.cart,
  });
  return `wl_${createHash('sha256').update(basis).digest('hex').slice(0, 40)}`;
}
