import { BookingPolicy } from '../components/booking-policy.data';
import { BookingCart, type CartLine } from '../components/cart-line.data';
import { DayKey } from '../components/day-key.data';
import type { DayOffset } from '../components/day-offset.data';
import { DayWindows } from '../components/day-windows.data';
import { FlexibleWhen } from '../components/flexible-when.data';
import type { MinuteRange } from '../components/minute-range.data';
import {
  NotificationKind,
  NotificationPayload,
} from '../components/notification-payload.data';
import { Result } from '../components/result.data';
import {
  type SchedulingError,
  SchedulingErrorCode,
} from '../components/scheduling-errors.data';
import {
  WaitlistState,
  WaitlistStatus,
} from '../components/waitlist-status.data';
import { WaitlistError } from '../components/waitlist-errors.data';
import { WriteOp } from '../components/write-op.data';
import type { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import {
  type NotificationEntity,
  NotificationId,
} from '../entities/notification.entity';
import { UserId } from '../entities/user.entity';
import type {
  WaitlistRequestEntity,
  WaitlistRequestId,
} from '../entities/waitlist-request.entity';
import { Collections, Subcollections } from '../ports/collections';
import {
  type AvailabilityAssignment,
  AvailabilitySystem,
} from './availability.system';
import {
  type CartBarberDay,
  BookingCartSystem,
  type CartService,
} from './booking-cart.system';
import { RosterSystem } from './roster.system';

const NO_DAYS: string = SchedulingErrorCode.WaitlistNoDays;
const EMPTY_CART: string = SchedulingErrorCode.WaitlistEmptyCart;

/** The commit's own field for a shop it does not serve (`CommitBookingShopUnavailableError.FIELD`). */
const LOCATION_FIELD = 'locationId';

/**
 * One day a request names, as the door receives it: its key not yet trusted,
 * its windows as wall-clock minutes (an unparseable span arrives as one that
 * fails the window rule below).
 */
export type WaitlistAskDay = {
  readonly dayKey: string;
  readonly windows: readonly MinuteRange[];
};

/** What a client asks the waitlist to watch: a shop (`null` = any), days, the bag. */
export type WaitlistAsk = {
  readonly locationId: string | null;
  readonly days: readonly WaitlistAskDay[];
  readonly cart: BookingCart;
};

/**
 * What the door knows besides the ask — every verdict a system cannot reach
 * on its own, precomputed by the pipeline:
 *
 * - `ownerUserId` — from the VERIFIED token, never the payload;
 * - `todayDayKey` / `horizonEndDayKey` — the shop's today and the policy's
 *   horizon (`BookingPolicy.horizonEndFrom`), as day keys of the zone;
 * - `shopListed` — the named shop is there and listed (`shopListed`, the
 *   waitlist's shop rule); ignored for an any-shop request;
 * - `admission` — the commit's own time-independent admission of the bag at
 *   that shop (`cartAdmissible`): `null` admitted, else the commit's refusal
 *   code.
 */
export type WaitlistDoor = {
  readonly ownerUserId: string | null;
  readonly zone: string;
  readonly nowMs: number;
  readonly todayDayKey: DayKey;
  readonly horizonEndDayKey: DayKey;
  readonly maxFlexibleDays: number;
  readonly shopListed: boolean;
  readonly admission: { readonly code: string } | null;
};

/** A decided request — the stored body; the pipeline names it (`wl_` + `hash(idBasis)`). */
export type WaitlistRequestBody = Omit<WaitlistRequestEntity, 'id'>;

/**
 * What one freed day offers a request: the catalogue rows of its bag and
 * every barber rostered that day at a LISTED shop, busy already padded — the
 * grid's own read, shared by every request naming the day.
 */
export type WaitlistDaySnapshot = {
  readonly services: readonly CartService[];
  readonly barbers: readonly CartBarberDay[];
};

/**
 * The matcher's context: now, the shop's today, the policy, and whether the
 * bag is still admissible against today's catalogue (`cartAdmissible`) —
 * catalogue drift since the request is never a promise.
 */
export type WaitlistMatchContext = {
  readonly nowMs: number;
  readonly todayDayKey: DayKey;
  readonly policy: BookingPolicy;
  readonly admissible: boolean;
};

/**
 * Something opened up for a request (`match-waitlist.ts:24-52`): the ONE
 * shop the whole party is placed at, the envelope, the barbers and the
 * arrangement line by line — what a commit of this match is built from.
 */
export type WaitlistMatch = {
  readonly requestId: WaitlistRequestId;
  readonly dayKey: DayKey;
  readonly locationId: LocationId;
  readonly startMs: number;
  readonly endMs: number;
  readonly barberIds: readonly BarberId[];
  readonly assignments: readonly AvailabilityAssignment[];
};

/**
 * The matcher's write, in ONE plan: the notification and the `matched`
 * transition land together or not at all (`match-waitlist.ts:192-202`).
 */
export type WaitlistMatchPlan = {
  readonly notification: NotificationEntity;
  readonly status: WaitlistStatus;
  readonly writes: readonly WriteOp[];
};

/** How long a notification suppresses the next one for the same request. */
const NOTIFY_COOLDOWN_HOURS = 6;
const MS_PER_HOUR = 3_600_000;

/**
 * Distinct services one allowed person may name before the cart is refused
 * UNREAD — a read bound, not a booking rule (`request-waitlist.ts:184`).
 */
const MAX_SERVICES_PER_PERSON = 8;

function isWindow(range: MinuteRange): boolean {
  return (
    Number.isInteger(range.startMinutes) &&
    Number.isInteger(range.endMinutes) &&
    range.startMinutes >= 0 &&
    range.startMinutes < range.endMinutes &&
    range.endMinutes <= 1440
  );
}

/** A line every id of which is readable — the stored cart's own reading. */
function lineReadable(line: CartLine): boolean {
  return (
    line.lineId.trim().length > 0 &&
    line.serviceId.trim().length > 0 &&
    (line.variantId === null || line.variantId.trim().length > 0) &&
    (line.barberId === null || line.barberId.trim().length > 0)
  );
}

/**
 * The waitlist (`apps/functions/src/use-cases/{decide-waitlist,match-waitlist}.ts`,
 * `lib/booking/{request-waitlist,match-waitlist}.ts`): the door that admits a
 * request, its deterministic id basis, the matcher that turns a freed day
 * into a promise, and the one write plan that keeps the notification and the
 * `matched` transition together. No `crypto`: the pipeline hashes the basis.
 */
/** Minutes of the day → the zero-padded `'HH:mm'` face a stored window was written as. */
function clockFace(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return `${hours < 10 ? '0' : ''}${hours}:${rest < 10 ? '0' : ''}${rest}`;
}

export const WaitlistSystem = {
  /** How long a notification suppresses the next one for the same request. */
  NOTIFY_COOLDOWN_HOURS,
  /** Distinct services per allowed person a cart may name before it is refused unread. */
  MAX_SERVICES_PER_PERSON,

  /**
   * May a request be stored, and what storing it means
   * (`decideWaitlist`, `decide-waitlist.ts:91-186`), in the commit's order:
   *
   * 1. nobody to notify — `booking.waitlist.unauthenticated`;
   * 2. a named shop that is blank or not listed — `locationId`, before a
   *    single day or seat is looked at;
   * 3. a day key that is no day — `dayKey`; a day behind today or past the
   *    horizon is DROPPED, not refused (it stopped being bookable while the
   *    client decided);
   * 4. more usable days than the policy allows — `too_many_days`;
   * 5. a window that is no span of the day — `windows` (the rest are
   *    normalized: sorted, merged; a day named twice keeps its last entry);
   * 6. no day left — `scheduling.waitlist.no_days`; no line at all —
   *    `scheduling.waitlist.empty_cart`;
   * 7. a line that does not read, or a corrupt line counter — `cart`: a
   *    promise for part of the party is a broken one;
   * 8. the commit's own admission of the bag — its refusal code.
   */
  decide(
    ask: WaitlistAsk,
    door: WaitlistDoor,
  ): Result<WaitlistRequestBody, WaitlistError> {
    if (door.ownerUserId === null || door.ownerUserId.trim().length === 0) {
      return Result.err(WaitlistError.unauthenticated());
    }
    if (
      ask.locationId !== null &&
      (ask.locationId.trim().length === 0 || !door.shopListed)
    ) {
      return Result.err(WaitlistError.invalidRequest(LOCATION_FIELD));
    }

    const usable: WaitlistAskDay[] = [];
    for (let i = 0; i < ask.days.length; i++) {
      const day = ask.days[i] as WaitlistAskDay;
      if (!DayKey.isValid(day.dayKey)) {
        return Result.err(WaitlistError.invalidRequest('dayKey'));
      }
      if (day.dayKey < door.todayDayKey) continue;
      if (door.horizonEndDayKey < day.dayKey) continue;
      usable.push(day);
    }
    if (usable.length > door.maxFlexibleDays) {
      return Result.err(WaitlistError.tooManyDays(door.maxFlexibleDays));
    }

    const days: DayWindows[] = [];
    for (let i = 0; i < usable.length; i++) {
      const day = usable[i] as WaitlistAskDay;
      for (let w = 0; w < day.windows.length; w++) {
        if (!isWindow(day.windows[w] as MinuteRange)) {
          return Result.err(WaitlistError.invalidRequest('windows'));
        }
      }
      days.push(DayWindows.of(DayKey.of(day.dayKey), day.windows));
    }
    const when = FlexibleWhen.of(days);
    if (FlexibleWhen.isEmpty(when))
      return Result.err(WaitlistError.invalidRequest(NO_DAYS));

    if (BookingCart.lineCount(ask.cart) === 0) {
      return Result.err(WaitlistError.invalidRequest(EMPTY_CART));
    }
    const sequence = ask.cart.nextSequence;
    if (!Number.isInteger(sequence) || sequence < 0) {
      return Result.err(WaitlistError.invalidRequest('cart'));
    }
    for (let s = 0; s < ask.cart.seats.length; s++) {
      const lines = (ask.cart.seats[s] as BookingCart.SeatLines).lines;
      for (let k = 0; k < lines.length; k++) {
        if (!lineReadable(lines[k] as CartLine)) {
          return Result.err(WaitlistError.invalidRequest('cart'));
        }
      }
    }
    if (door.admission !== null) {
      return Result.err(WaitlistError.invalidRequest(door.admission.code));
    }

    return Result.ok({
      ownerUserId: UserId.of(door.ownerUserId),
      locationId:
        ask.locationId === null ? null : LocationId.of(ask.locationId),
      zone: door.zone,
      cart: ask.cart,
      when,
      dayKeys: FlexibleWhen.dayKeys(when),
      status: WaitlistStatus.open(door.nowMs),
      createdAtMs: door.nowMs,
    });
  },

  /**
   * The string a request's id is the hash of (`deterministicRequestId`,
   * `request-waitlist.ts:290-299`): what the request MEANS — owner, shop, the
   * normalized days, the bag — so two phrasings of one ask collapse to one
   * id and a duplicate is one atomic create refusal. The pipeline mints
   * `wl_` + the first 40 hex of `hash(basis)`.
   */
  idBasis(body: WaitlistRequestBody): string {
    // THE WIRE SHAPE THE ID WAS ALWAYS HASHED FROM, key for key and in that
    // order (`request-waitlist.ts` at P0: the request's legacy props) —
    // windows as `'HH:mm'` faces, lines as `{ id, serviceId, variantId,
    // barberId }`. Serialising the structs instead would rename every
    // stored request: a re-sent ask would get a new `wl_` id, slip past the
    // duplicate refusal and be notified twice.
    const days: {
      readonly dayKey: DayKey;
      readonly windows: readonly {
        readonly from: string;
        readonly to: string;
      }[];
    }[] = [];
    for (let d = 0; d < body.when.days.length; d++) {
      const day = body.when.days[d] as DayWindows;
      const windows: { readonly from: string; readonly to: string }[] = [];
      for (let w = 0; w < day.windows.length; w++) {
        const window = day.windows[w] as MinuteRange;
        windows.push({
          from: clockFace(window.startMinutes),
          to: clockFace(window.endMinutes),
        });
      }
      days.push({ dayKey: day.dayKey, windows });
    }
    const seats: {
      readonly seatKey: string;
      readonly lines: readonly {
        readonly id: string;
        readonly serviceId: string;
        readonly variantId: string | null;
        readonly barberId: string | null;
      }[];
    }[] = [];
    for (let s = 0; s < body.cart.seats.length; s++) {
      const seat = body.cart.seats[s] as BookingCart.SeatLines;
      const lines: {
        readonly id: string;
        readonly serviceId: string;
        readonly variantId: string | null;
        readonly barberId: string | null;
      }[] = [];
      for (let l = 0; l < seat.lines.length; l++) {
        const line = seat.lines[l] as CartLine;
        lines.push({
          id: line.lineId,
          serviceId: line.serviceId,
          variantId: line.variantId,
          barberId: line.barberId,
        });
      }
      seats.push({ seatKey: seat.seatKey, lines });
    }
    return JSON.stringify({
      owner: body.ownerUserId,
      locationId: body.locationId,
      when: { days },
      cart: { seats, nextSequence: body.cart.nextSequence },
    });
  },

  /**
   * May the callable read the catalogue for this cart
   * (`cartWithinReadBounds`, `request-waitlist.ts:194-204`)? Not past the
   * party cap in seats, nor past {@link MAX_SERVICES_PER_PERSON} distinct
   * services per allowed person — both refused without a read.
   */
  withinReadBounds(cart: BookingCart, maxPartySize: number): boolean {
    if (cart.seats.length > maxPartySize) return false;
    const distinct: string[] = [];
    for (let s = 0; s < cart.seats.length; s++) {
      const lines = (cart.seats[s] as BookingCart.SeatLines).lines;
      for (let k = 0; k < lines.length; k++) {
        const serviceId = (lines[k] as CartLine).serviceId;
        if (!distinct.includes(serviceId)) distinct.push(serviceId);
      }
    }
    return distinct.length <= maxPartySize * MAX_SERVICES_PER_PERSON;
  },

  /**
   * Has every day the request named gone by (`hasLapsedBy`,
   * `waitlist-request.ts:177-180`)? Derived from its own content — a stored
   * expiry would be a second copy that could disagree.
   */
  hasLapsed(when: FlexibleWhen, todayDayKey: DayKey): boolean {
    const last = FlexibleWhen.lastDayKey(when);
    return last !== null && last < todayDayKey;
  },

  /** From when a sent notification still suppresses the next one for its request. */
  cooldownSinceMs(nowMs: number): number {
    return nowMs - NOTIFY_COOLDOWN_HOURS * MS_PER_HOUR;
  },

  /**
   * Does anything on this day now fit what the request asked for
   * (`matchWaitlist`, `match-waitlist.ts:110-202`)? A notification is a
   * PROMISE, so this is the grid's own question
   * ({@link BookingCartSystem.optionsForDay}) with the request's declared
   * windows as the mask, and nothing the commit would refuse whatever the
   * time:
   *
   * - a day the request did not name, or past the policy's horizon — none;
   * - a bag the catalogue no longer admits (`ctx.admissible`) — none;
   * - the shop it named narrows the pool to that shop's windows
   *   (`RosterSystem.windowsAt`); a barber with none there is not in it;
   * - the lead-time floor (`AvailabilitySystem.leadFloorMs`);
   * - ONE match: each shop's search stops at the first arrangement, and the
   *   earliest across shops is the one named.
   *
   * `null` is the overwhelmingly common answer.
   */
  match(
    request: Pick<WaitlistRequestEntity, 'id' | 'locationId' | 'cart' | 'when'>,
    day: DayOffset,
    snapshot: WaitlistDaySnapshot,
    ctx: WaitlistMatchContext,
  ): WaitlistMatch | null {
    const declared = FlexibleWhen.windowsFor(request.when, day.dayKey);
    if (declared === null) return null;
    if (
      BookingPolicy.horizonEndFrom(ctx.policy, ctx.todayDayKey) < day.dayKey
    ) {
      return null;
    }
    if (!ctx.admissible) return null;

    const shop = request.locationId;
    let barbers = snapshot.barbers;
    if (shop !== null) {
      const narrowed: CartBarberDay[] = [];
      for (let b = 0; b < snapshot.barbers.length; b++) {
        const barber = snapshot.barbers[b] as CartBarberDay;
        const windows = RosterSystem.windowsAt(barber.windows, shop);
        if (windows.length > 0) {
          narrowed.push({
            barberId: barber.barberId,
            windows,
            busy: barber.busy,
          });
        }
      }
      barbers = narrowed;
    }
    if (barbers.length === 0) return null;

    const withinMs = AvailabilitySystem.withinMsOf(declared, [day]);
    if (withinMs.length === 0) return null;

    const options = BookingCartSystem.optionsForDay({
      cart: request.cart,
      services: snapshot.services,
      riders: [],
      barbers,
      day,
      policy: ctx.policy,
      notBeforeMs: AvailabilitySystem.leadFloorMs(ctx.nowMs, ctx.policy),
      withinMs,
      budget: {
        nodeBudget: AvailabilitySystem.DEFAULT_BUDGET.nodeBudget,
        maxOptions: 1,
      },
    });
    const first = options[0];
    if (first === undefined) return null;

    const barberIds: BarberId[] = [];
    for (let i = 0; i < first.option.assignments.length; i++) {
      barberIds.push(
        (first.option.assignments[i] as AvailabilityAssignment).barberId,
      );
    }
    return {
      requestId: request.id,
      dayKey: day.dayKey,
      locationId: first.locationId,
      startMs: first.option.envelope.startMs,
      endMs: first.option.envelope.endMs,
      barberIds,
      assignments: first.option.assignments,
    };
  },

  /**
   * The matcher's write for a match, in ONE plan
   * (`match-waitlist.ts:192-202`): the notification — FACTS, never words
   * (§9 D20): the request, the freed start and the shop's zone, worded by
   * the inbox in the reader's locale — created under the owner, and the
   * request moved to `matched` at `nowMs`. Refused when the request can no
   * longer be matched (`scheduling.waitlist.invalid_transition`), so a
   * terminal request is never told anything.
   */
  planMatch(
    request: WaitlistRequestEntity,
    match: WaitlistMatch,
    nowMs: number,
    nextId: () => string,
  ): Result<WaitlistMatchPlan, SchedulingError> {
    const status = WaitlistStatus.transition(
      request.status,
      WaitlistState.Matched,
      nowMs,
    );
    if (!status.ok) return status;
    const notification: NotificationEntity = {
      id: NotificationId.of(nextId()),
      kind: NotificationKind.WaitlistMatch,
      requestId: request.id,
      dayKey: match.dayKey,
      payload: NotificationPayload.waitlistMatch(
        request.id,
        match.startMs,
        request.zone,
      ),
      sentAtMs: nowMs,
      readAtMs: null,
    };
    const { id, ...body } = notification;
    return Result.ok({
      notification,
      status: status.value,
      writes: [
        WriteOp.create(
          [
            Collections.Users,
            request.ownerUserId,
            Subcollections.Notifications,
            id,
          ],
          body,
        ),
        WriteOp.update([Collections.WaitlistRequests, request.id], {
          status: status.value,
        }),
      ],
    });
  },
} as const;
