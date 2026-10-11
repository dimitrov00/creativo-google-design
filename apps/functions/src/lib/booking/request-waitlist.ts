import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { match } from '@creativo/domain/kernel';
import type { Service } from '@creativo/domain/catalog';
import {
  CalendarDay,
  type ReconstituteBookingCartProps,
  WaitlistRequest,
} from '@creativo/domain/scheduling';
import {
  type StoredShop,
  toService,
  toShop,
} from '../../adapters/firestore-booking-store';
import { FirestoreWaitlistStore } from '../../adapters/firestore-waitlist-store';
import { SystemClock } from '../../adapters/system-clock';
import { CryptoIdGenerator } from '../../adapters/crypto-id-generator';
import {
  BarberId as BarberKey,
  type BookingCart as CartData,
  CartLineId as LineKey,
  DayWindows as DayWindowsData,
  EndMinute,
  LocalDate,
  LocationId as LocationKey,
  MinuteOfDay,
  MinuteRange,
  SeatKeyText,
  ServiceId as ServiceKey,
  ServiceVariantId as VariantKey,
  UserId as UserKey,
  WaitlistSystem,
  FlexibleWhen as WhenData,
  defect,
} from '@creativo/ecs-core';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { TENANT_ZONE } from './tenant-zone';
import {
  RequestWaitlistDuplicateError,
  type RequestWaitlistError,
} from '../../use-cases/request-waitlist.errors';
import {
  type RequestedDay,
  decideWaitlist,
} from '../../use-cases/decide-waitlist';

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
 * Could `id` name a document? A payload's id that could not (a path, `.`,
 * a reserved `__…__` name) names no service: it is not read — the SDK would
 * throw on the path — and is refused as `unknown_service` like any other.
 */
function isDocumentId(id: string): boolean {
  return (
    id.length > 0 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  );
}

/**
 * The ACTIVE catalogue rows of the services `cart` names — what the waitlist
 * admits a request against (`decideWaitlist`, `cartAdmissible`).
 *
 * Read the way the commit reads them (`FirestoreBookingStore.load`): by id,
 * distinct, in one batched round trip, through the commit's own parser
 * (`toService`), so a retired or unreadable service is ABSENT here exactly
 * as it is there, and refused as `unknown_service` by the same check. A
 * second reading of the catalogue would be a second opinion about what the
 * commit accepts.
 */
export async function loadCartServices(
  db: Firestore,
  cart: ReconstituteBookingCartProps,
): Promise<readonly Service[]> {
  const ids = [
    ...new Set(
      cart.seats.flatMap((seat) => seat.lines.map((line) => line.serviceId)),
    ),
  ].filter(isDocumentId);
  if (ids.length === 0) return [];
  const snaps = await db.getAll(
    ...ids.map((id) => db.collection('services').doc(id)),
  );
  return snaps.flatMap((snap) => {
    const data = snap.data();
    const service = data ? toService(snap.id, data) : null;
    return service ? [service] : [];
  });
}

/**
 * The shop a request names, as the commit reads it (`toShop`, the commit's
 * own reading of a location document) — or `null` when there is no such
 * shop, which `decideWaitlist` refuses as the commit refuses it.
 *
 * One document read. An id that could not name a document is refused
 * unread, like a service id (`isDocumentId`): the SDK would throw on the
 * path, and a shop nobody can name is a shop that is not there.
 */
export async function loadNamedShop(
  db: Firestore,
  locationId: string,
): Promise<StoredShop | null> {
  if (!isDocumentId(locationId)) return null;
  const snap = await db.collection('locations').doc(locationId).get();
  return toShop(snap.data());
}

/**
 * How many distinct services one allowed person's lines may name before the
 * cart is refused UNREAD. A read bound, not a booking rule: every cart inside
 * it is still decided by the commit's own checks (`cartAdmissible`). Without
 * it an authenticated caller could name thousands of service ids and cost
 * the shop that many document reads per call.
 */
export const MAX_SERVICES_PER_PERSON = WaitlistSystem.MAX_SERVICES_PER_PERSON;

/* ── Legacy ↔ ECS converters (the bound and the id basis are WaitlistSystem's) ── */

function toCartData(cart: ReconstituteBookingCartProps): CartData {
  return {
    cartSeats: cart.seats.map((seat) => {
      const seatKey = SeatKeyText.of(seat.seatKey);
      return {
        seatKey,
        lines: seat.lines.map((line) => ({
          lineId: LineKey.of(line.id),
          seatKey,
          serviceId: ServiceKey.of(line.serviceId),
          variantId:
            line.variantId === null ? null : VariantKey.of(line.variantId),
          barberId: line.barberId === null ? null : BarberKey.of(line.barberId),
          locationId: null,
        })),
      };
    }),
    cartNextSequence: cart.nextSequence,
  };
}

/** Unreachable refusals of values the decided request already checked. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** `'HH:mm'` → minutes of the day (the decided request's faces are always real). */
function minutesOf(face: string): number {
  return Number(face.slice(0, 2)) * 60 + Number(face.slice(3, 5));
}

/**
 * May the callable read the catalogue for this cart? One seat is one person,
 * so a cart with more seats than the party cap is refused by the admission
 * as `party_too_large` without a read; one naming more distinct services than
 * the party could plausibly ask for is refused as naming services the
 * catalogue does not hold (none were looked up), also without a read.
 */
export function cartWithinReadBounds(
  cart: ReconstituteBookingCartProps,
  maxPartySize: number,
): boolean {
  return WaitlistSystem.withinReadBounds(toCartData(cart), maxPartySize);
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
  const cart = toCart(payload['cart']);
  const locationId =
    payload['locationId'] == null ? null : String(payload['locationId']);

  // Read for a caller who can be notified at all: an anonymous request is
  // refused before the cart or the shop is looked at, and costs no reads. A
  // cart past the read bound costs none either; the admission refuses it.
  // The shop and the catalogue rows in one go — neither read needs the other.
  const signedIn = Boolean(request.auth?.uid);
  const [services, shop] = await Promise.all([
    signedIn && cartWithinReadBounds(cart, policy.maxPartySize)
      ? loadCartServices(db, cart)
      : [],
    signedIn && locationId !== null ? loadNamedShop(db, locationId) : null,
  ]);

  const decided = decideWaitlist(
    {
      locationId,
      days: toDays((payload['when'] as Record<string, unknown>)?.['days']),
      cart,
    },
    {
      now,
      zone: TENANT_ZONE,
      maxFlexibleDays: policy.maxFlexibleDays,
      horizonEnd: policy.horizonEndFrom(CalendarDay.fromZonedDateTime(now)),
      nextId: () => new CryptoIdGenerator().next(),
      ownerUserId: request.auth?.uid ?? null,
      // What the commit would admit whatever the time (round 6): the cart
      // is refused now rather than watched for a booking no slot could make.
      policy,
      services,
      // A shop the commit would not find, or one the public surface no
      // longer lists, is refused now rather than watched for a slot the
      // matcher never searches.
      shop,
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
  const when = WhenData.of(
    props.when.days.map((day) =>
      DayWindowsData.of(
        sure(LocalDate.parse(day.dayKey), 'a decided day'),
        day.windows.map((window) =>
          MinuteRange.of(
            sure(MinuteOfDay.of(minutesOf(window.from)), 'a decided start'),
            sure(EndMinute.of(minutesOf(window.to)), 'a decided end'),
          ),
        ),
      ),
    ),
  );
  const basis = WaitlistSystem.idBasis({
    ownerUserId: UserKey.of(props.ownerId),
    locationId:
      props.locationId === null ? null : LocationKey.of(props.locationId),
    ...toCartData(props.cart),
    flexibleDays: when.flexibleDays,
  });
  return `wl_${createHash('sha256').update(basis).digest('hex').slice(0, 40)}`;
}
