import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { LocationId } from '@creativo/domain/catalog';
import type { ReconstituteBookingCartProps } from './booking-cart';
import { CalendarDay } from './calendar-day';
import { FlexibleWhen, type FlexibleWhenProps } from './flexible-when';
import { WaitlistRequestId } from './ids';
import {
  EmptyWaitlistCartError,
  EmptyWaitlistWhenError,
  InvalidWaitlistRequestError,
  type WaitlistRequestError,
  WaitlistTransitionError,
} from './waitlist-request.errors';

/**
 * Where a request is in its life.
 *
 * - `open`      — watching. The only state a matcher considers.
 * - `matched`   — something opened up and the client has been told. Still
 *                 live: being told is not the same as having booked, and a
 *                 match that expires unclaimed goes back to `open`.
 * - `booked`    — it turned into an appointment (terminal).
 * - `cancelled` — the client withdrew it (terminal).
 * - `expired`   — every day it named is in the past (terminal). A request
 *                 for last Tuesday cannot be fulfilled and must stop
 *                 occupying a matcher.
 */
export type WaitlistStatus =
  'open' | 'matched' | 'booked' | 'cancelled' | 'expired';

/**
 * Legal forward moves. Terminal states map to `[]`. One source of truth for
 * the graph, exactly as `AppointmentStatus` does it — every transition method
 * below defers here rather than re-encoding the rules.
 *
 * `matched → open` is the one that looks odd and is the most important: a
 * client who was notified and did not act must go back to being watched. A
 * graph without that edge silently drops people from the waitlist for the
 * crime of being asleep.
 */
const TRANSITIONS: Record<WaitlistStatus, readonly WaitlistStatus[]> = {
  open: ['matched', 'booked', 'cancelled', 'expired'],
  matched: ['open', 'booked', 'cancelled', 'expired'],
  booked: [],
  cancelled: [],
  expired: [],
};

export interface WaitlistRequestProps {
  readonly id: string;
  readonly ownerId: string;
  /** `null` ⇒ any shop, exactly as everywhere else in the flow. */
  readonly locationId: string | null;
  readonly when: FlexibleWhenProps;
  /** The bag, in the same shape the draft persists — one cart serialization. */
  readonly cart: ReconstituteBookingCartProps;
  readonly status: WaitlistStatus;
  readonly createdAtIso: string;
  readonly zone: string;
}

/**
 * **Aggregate root.** A standing request to be told when the shop can fit a
 * specific bag into specific windows.
 *
 * ### Why the cart is snapshotted rather than referenced
 * A waitlist request outlives the browser session that created it — that is
 * the entire point. The bag has to travel with it, because a matcher running
 * three days later has no draft to read and no user to ask. It is stored in
 * `BookingCart`'s own persistence shape so there is exactly one cart
 * serialization in the system: the draft store, this aggregate, and any
 * restore path all speak it.
 *
 * ### The owner is required, unlike a booking party
 * `/book` is deliberately browsable anonymously, and `BookingParty.ownerId`
 * is nullable to say so. A waitlist request cannot be: its whole value is
 * being told later, and there is nobody to tell without an account. This is
 * the one place in the flow where signing in is not a formality at the end
 * but the thing being bought.
 *
 * ### Expiry is derived, never stored
 * A request expires when the last day it names has passed — that is a fact
 * about its own content, and a stored `expiresAt` is a second copy of it that
 * can disagree after an edit. {@link hasLapsedBy} computes it.
 */
export class WaitlistRequest {
  private constructor(
    readonly id: WaitlistRequestId,
    readonly ownerId: UserId,
    readonly locationId: LocationId | null,
    readonly when: FlexibleWhen,
    readonly cart: ReconstituteBookingCartProps,
    readonly status: WaitlistStatus,
    readonly createdAt: ZonedDateTime,
    readonly zone: string,
  ) {}

  static create(
    props: WaitlistRequestProps,
  ): Result<WaitlistRequest, WaitlistRequestError> {
    return WaitlistRequest.build(props);
  }

  static reconstitute(
    props: WaitlistRequestProps,
  ): Result<WaitlistRequest, WaitlistRequestError> {
    return WaitlistRequest.build(props);
  }

  private static build(
    props: WaitlistRequestProps,
  ): Result<WaitlistRequest, WaitlistRequestError> {
    const id = WaitlistRequestId.create(props.id);
    if (id.isFailure()) return fail(new InvalidWaitlistRequestError('id'));

    const ownerId = UserId.create(props.ownerId);
    if (ownerId.isFailure()) {
      return fail(new InvalidWaitlistRequestError('ownerId'));
    }

    let locationId: LocationId | null = null;
    if (props.locationId !== null) {
      const parsed = LocationId.create(props.locationId);
      if (parsed.isFailure()) {
        return fail(new InvalidWaitlistRequestError('locationId'));
      }
      locationId = parsed.value;
    }

    const when = FlexibleWhen.create(props.when, props.zone);
    if (when.isFailure()) return fail(new InvalidWaitlistRequestError('when'));
    // A request naming no days is a request to be told about nothing. It
    // would sit in the matcher forever matching everything or nothing
    // depending on how the mask degrades — refuse it at the door.
    if (when.value.isEmpty()) return fail(new EmptyWaitlistWhenError());

    const lineCount = props.cart.seats.reduce(
      (total, seat) => total + seat.lines.length,
      0,
    );
    if (lineCount === 0) return fail(new EmptyWaitlistCartError());

    const createdAt = ZonedDateTime.fromISO(props.createdAtIso, props.zone);
    if (createdAt.isFailure()) {
      return fail(new InvalidWaitlistRequestError('createdAt'));
    }

    return ok(
      new WaitlistRequest(
        id.value,
        ownerId.value,
        locationId,
        when.value,
        props.cart,
        props.status,
        createdAt.value,
        props.zone,
      ),
    );
  }

  /** The last day this request names — what it is waiting for. */
  lastDay(): CalendarDay | null {
    return this.when.days.at(-1)?.day ?? null;
  }

  /**
   * Has every day it named already passed?
   *
   * Takes "today" rather than reading a clock: the domain never asks what time
   * it is, and a sweeper running in a Cloud Function and a browser rendering
   * "expired" must reach the same answer from the same input.
   */
  hasLapsedBy(today: CalendarDay): boolean {
    const last = this.lastDay();
    return last !== null && last.isBefore(today);
  }

  isWatching(): boolean {
    return this.status === 'open' || this.status === 'matched';
  }

  private transition(
    to: WaitlistStatus,
  ): Result<WaitlistRequest, WaitlistTransitionError> {
    if (!TRANSITIONS[this.status].includes(to)) {
      return fail(new WaitlistTransitionError(this.status, to));
    }
    return ok(
      new WaitlistRequest(
        this.id,
        this.ownerId,
        this.locationId,
        this.when,
        this.cart,
        to,
        this.createdAt,
        this.zone,
      ),
    );
  }

  /** Something opened up and the client has been told. */
  markMatched(): Result<WaitlistRequest, WaitlistTransitionError> {
    return this.transition('matched');
  }

  /** The notified match went unclaimed — keep watching rather than dropping them. */
  reopen(): Result<WaitlistRequest, WaitlistTransitionError> {
    return this.transition('open');
  }

  markBooked(): Result<WaitlistRequest, WaitlistTransitionError> {
    return this.transition('booked');
  }

  cancel(): Result<WaitlistRequest, WaitlistTransitionError> {
    return this.transition('cancelled');
  }

  markExpired(): Result<WaitlistRequest, WaitlistTransitionError> {
    return this.transition('expired');
  }

  toProps(): WaitlistRequestProps {
    return {
      id: this.id.value,
      ownerId: this.ownerId.value,
      locationId: this.locationId?.value ?? null,
      when: this.when.toProps(),
      cart: this.cart,
      status: this.status,
      createdAtIso: this.createdAt.toISO(),
      zone: this.zone,
    };
  }
}
