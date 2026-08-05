import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  CalendarDay,
  FlexibleWhen,
  WaitlistRequest,
  type WaitlistRequestProps,
} from '@creativo/domain/scheduling';
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
 */
export function decideWaitlist(
  request: DecideWaitlistRequest,
  deps: DecideWaitlistDeps,
): Result<WaitlistRequest, RequestWaitlistError> {
  if (deps.ownerUserId === null || deps.ownerUserId.trim().length === 0) {
    return fail(new RequestWaitlistUnauthenticatedError());
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
  return ok(result.value);
}
