import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { LocationId, type Service } from '@creativo/domain/catalog';
import {
  BookingCart,
  type BookingPolicy,
  CalendarDay,
  FlexibleWhen,
  WaitlistRequest,
  type WaitlistRequestProps,
} from '@creativo/domain/scheduling';
import {
  type AdmissibleShop,
  cartAdmissible,
  shopListed,
} from './party-admission';
import { CommitBookingShopUnavailableError } from './commit-booking.errors';
import {
  RequestWaitlistInvalidError,
  RequestWaitlistTooManyDaysError,
  type RequestWaitlistError,
  RequestWaitlistUnauthenticatedError,
} from './request-waitlist.errors';

/** One declared day as it arrives on the wire. */
export interface RequestedDay {
  readonly dayKey: string;
  readonly windows: readonly { readonly from: string; readonly to: string }[];
}

export interface DecideWaitlistRequest {
  readonly locationId: string | null;
  readonly days: readonly RequestedDay[];
  readonly cart: WaitlistRequestProps['cart'];
}

export interface DecideWaitlistDeps {
  readonly now: ZonedDateTime;
  readonly zone: string;
  readonly maxFlexibleDays: number;
  readonly horizonEnd: CalendarDay;
  readonly nextId: () => string;
  readonly ownerUserId: string | null;
  /** The shop's booking policy — the party cap the commit seats by. */
  readonly policy: BookingPolicy;
  /**
   * The ACTIVE catalogue rows of the services the cart names, read the way
   * the commit reads them (`toService`): a retired or unreadable service is
   * simply absent, and refused as `unknown_service`.
   */
  readonly services: readonly Service[];
  /**
   * The shop the request names, read the way the commit reads it
   * (`toShop`, through `loadNamedShop`); `null` when there is no such shop.
   * An any-shop request names none: nothing is read for it and this is not
   * asked.
   */
  readonly shop: AdmissibleShop | null;
}

/**
 * Decide whether a waitlist request may be stored, and what storing it means.
 *
 * Pure, like `decideBooking`, and for the same reason: the whole server-side
 * authority is unit-testable without an emulator.
 *
 * ### What the server re-checks rather than trusts
 * - **The owner** comes from the verified auth token, never the payload. A
 *   request is a promise to notify someone; letting a caller name the someone
 *   would let them sign a stranger up for it.
 * - **The day cap** is policy, and a client that could exceed it could make
 *   the matcher do unbounded work on every cancellation.
 * - **The horizon** — a day past the booking window can never be fulfilled,
 *   so watching it is a promise the shop cannot keep.
 * - **Days in the past** go the same way. Both are dropped rather than
 *   refused: a request naming five days, one of which has quietly rolled past
 *   midnight, is still a perfectly good request for the other four.
 * - **The shop it names**, first, by the waitlist's shop rule
 *   (`shopListed`): an id no shop answers to, a shop the commit would not
 *   find and one the public surface no longer lists are one refusal
 *   (`field: 'locationId'`) — the matcher never searches any of them. "Any
 *   shop" (`null`) names none and is never refused for it.
 * - **The party, as the commit would admit it whatever the time** (round
 *   6): more people than the policy seats, a service unknown or retired,
 *   one the named shop does not offer, a variant missing or undeclared, or
 *   two services one person may not have together — refused NOW, through
 *   the commit's own checks (`cartAdmissible`), so a client is never kept
 *   waiting for a booking no freed slot could ever make. The matcher asks
 *   the same function again before every notification, for what the
 *   catalogue changes after the request is made.
 */
export function decideWaitlist(
  request: DecideWaitlistRequest,
  deps: DecideWaitlistDeps,
): Result<WaitlistRequest, RequestWaitlistError> {
  if (deps.ownerUserId === null || deps.ownerUserId.trim().length === 0) {
    return fail(new RequestWaitlistUnauthenticatedError());
  }

  // The shop before anything else the request asks, the commit's own
  // order: its load refuses a shop before a single seat, day or time is
  // looked at, and a party measured against a shop that is not there
  // (`service_not_at_location`) would name the wrong reason. A request names
  // no usable shop however that is spelled — an id no shop answers to
  // (empty, blank: the aggregate would refuse it as its own
  // `scheduling.waitlist.invalid`), a shop the commit would not find, or one
  // the public surface no longer lists — and each is the ONE answer the
  // client branches on, with the commit's own field for the same refusal
  // (`CommitBookingShopUnavailableError.FIELD`).
  if (
    request.locationId !== null &&
    (LocationId.create(request.locationId).isFailure() ||
      !shopListed(deps.shop))
  ) {
    return fail(
      new RequestWaitlistInvalidError(CommitBookingShopUnavailableError.FIELD),
    );
  }

  const today = CalendarDay.fromZonedDateTime(deps.now);

  // Drop what cannot be honoured, keep what can. A day already behind us or
  // past the horizon is not an error the user can act on — it is a day that
  // stopped being bookable while they were deciding.
  const usable: RequestedDay[] = [];
  for (const raw of request.days) {
    const day = CalendarDay.create(raw.dayKey, deps.zone);
    if (day.isFailure()) return fail(new RequestWaitlistInvalidError('dayKey'));
    if (day.value.isBefore(today)) continue;
    if (deps.horizonEnd.isBefore(day.value)) continue;
    usable.push(raw);
  }

  if (usable.length > deps.maxFlexibleDays) {
    return fail(new RequestWaitlistTooManyDaysError(deps.maxFlexibleDays));
  }

  // Re-parsed through the domain rather than trusted as shaped: this is the
  // one place the wire becomes a `FlexibleWhen`, and it normalizes the windows
  // on the way in so the matcher never sees an overlapping pair.
  const when = FlexibleWhen.create({ days: usable }, deps.zone);
  if (when.isFailure()) return fail(new RequestWaitlistInvalidError('windows'));

  const result = WaitlistRequest.create({
    id: deps.nextId(),
    ownerId: deps.ownerUserId,
    locationId: request.locationId,
    when: when.value.toProps(),
    cart: request.cart,
    status: 'open',
    createdAtIso: deps.now.toISO(),
    zone: deps.zone,
  });

  if (result.isFailure()) {
    // The aggregate's own refusals — no days left after the drop above, or an
    // empty bag — surface as one invalid-request code rather than leaking a
    // domain error the client has no branch for.
    return fail(new RequestWaitlistInvalidError(result.error.code));
  }

  // The bag as the matcher will read it. A line the cart cannot read (an id
  // that does not parse) is DROPPED by the cart — right for a draft, wrong
  // for a promise: the matcher would watch for what is left of the party,
  // and the commit would book fewer people than asked. Refused whole.
  const cart = BookingCart.reconstitute(result.value.cart);
  const asked = result.value.cart.seats.reduce(
    (total, seat) => total + seat.lines.length,
    0,
  );
  if (cart.isFailure() || cart.value.lineCount() !== asked) {
    return fail(new RequestWaitlistInvalidError('cart'));
  }
  // Every refusal the commit makes whatever the time, as the commit makes
  // it. Surfaced as the one invalid-request code the client branches on,
  // naming the commit's own reason, like the aggregate's refusals above.
  const admissible = cartAdmissible(
    cart.value,
    deps.services,
    deps.policy,
    result.value.locationId,
  );
  if (admissible.isFailure()) {
    return fail(new RequestWaitlistInvalidError(admissible.error.code));
  }
  return ok(result.value);
}
