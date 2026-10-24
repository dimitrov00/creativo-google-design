import {
  BookingPolicy,
  BookingCart,
  type CartLine,
  type CartSeatLines,
  Daypart,
  DayWindows,
  FlexibleWhen,
  MinuteRange,
  NotificationPayload,
  type ShopNow,
  WaitlistLifecycle,
  WallTime,
  WriteOp,
  type WaitlistCall,
} from '@core/components';
import {
  Result,
  WaitlistStatus,
  type BarberId,
  LocationId,
  type SeatKeyText,
  NotificationId,
  type UserId,
  type WaitlistRequestId,
  LocalDate,
  EndMinute,
  MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';
import {
  type BookingError,
  type SchedulingError,
  SchedulingErrorCode,
  WaitlistError,
} from '@core/errors';
import {
  type Appointment,
  type InboxNotification,
  type WaitlistRequest,
  Collections,
  Subcollections,
} from '@core/entities';
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
/** The ask's field for a day that is no day. */
const LOCAL_DATE_FIELD = 'localDate';

/**
 * What the door knows besides the ask — every verdict a system cannot reach
 * on its own, precomputed by the pipeline:
 *
 * - `ownerUserId` — from the VERIFIED token, never the payload (an ACCOUNT,
 *   D29: the request is told later through its inbox);
 * - `now` — the shop's "now" (`ZonedTimeSystem.shopNow` at the boundary):
 *   `now.localDate` is the shop's today, `now.utcEpochMs` stamps the
 *   request;
 * - `horizonEndLocalDate` — the policy's horizon
 *   (`BookingPolicy.horizonEndFrom`);
 * - `shopListed` — the named shop is there and listed (`shopListed`, the
 *   waitlist's shop rule); ignored for an any-shop request;
 * - `admission` — the commit's own time-independent admission of the bag at
 *   that shop (`PartyAdmissionSystem.admitCart`): `null` admitted, else the
 *   commit's refusal as it gave it.
 */
export type WaitlistDoor = {
  readonly ownerUserId: UserId | null;
  readonly now: ShopNow;
  readonly horizonEndLocalDate: LocalDate;
  readonly maxFlexibleDays: number;
  readonly shopListed: boolean;
  readonly admission: BookingError | null;
};

/**
 * A decided request — the stored body minus the two fields the boundary
 * owns: the id it names it by (`wl_` + `hash(idBasis)`) and `utcEpochMs`,
 * the first instant of `localDates[0]` in the location's zone
 * (`ZonedTimeSystem.startOfLocalDay`, F-28 — a system never converts zones).
 */
export type WaitlistRequestBody = Omit<WaitlistRequest, 'id' | 'utcEpochMs'>;

/**
 * What one freed shop day offers a request: the catalogue rows of its bag
 * and every barber rostered that day at a LISTED shop, busy already padded —
 * the grid's own read, shared by every request naming the day.
 */
export type WaitlistDaySnapshot = {
  readonly services: readonly CartService[];
  readonly barbers: readonly CartBarberDay[];
};

/**
 * The matcher's context: the shop's now, the policy, and whether the bag is
 * still admissible against today's catalogue (`cartAdmissible`) — catalogue
 * drift since the request is never a promise.
 */
export type WaitlistMatchContext = {
  readonly now: ShopNow;
  readonly policy: BookingPolicy;
  readonly admissible: boolean;
};

/**
 * Something opened up for a request (`match-waitlist.ts:24-52`): the ONE
 * shop the whole party is placed at, the envelope on the shop day, the
 * barbers and the arrangement line by line — what a commit of this match is
 * built from.
 */
export type WaitlistMatch = {
  readonly requestId: WaitlistRequestId;
  readonly localDate: LocalDate;
  readonly locationId: LocationId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  readonly barberIds: readonly BarberId[];
  readonly assignments: readonly AvailabilityAssignment[];
};

/**
 * The matcher's write, in ONE plan: the notification and the `MATCHED`
 * transition land together or not at all (`match-waitlist.ts:192-202`).
 */
export type WaitlistMatchPlan = {
  readonly notification: InboxNotification;
  readonly waitlist: WaitlistLifecycle;
  readonly writes: readonly WriteOp[];
};

/** How long a notification suppresses the next one for the same request. */
const NOTIFY_COOLDOWN_HOURS = 6;

/**
 * Distinct services one allowed person may name before the cart is refused
 * UNREAD — a read bound, not a booking rule (`request-waitlist.ts:184`).
 */
const MAX_SERVICES_PER_PERSON = 8;

/** The first minute of a shop day — where a waiting request's row starts. */
const DAY_START: MinuteOfDay = MinuteOfDay.ofProven(0);

/**
 * Where a request that watches no day files: the first day of the civil
 * axis at its first minute, so it orders before every real row, as the
 * legacy instant 0 did — built from the constructors, never a throw.
 */
const UNDATED: WallTime = WallTime.of(LocalDate.fromEpochDay(0), DAY_START);

/**
 * The staff glance's waiting request (`WaitlistSystem.glancePick`): the
 * newest one still worth showing, and how many others are — `null` and `0`
 * when there is none.
 */
export type WaitlistGlancePick = {
  readonly newest: WaitlistRequest | null;
  readonly others: number;
};

const NO_PICK: WaitlistGlancePick = { newest: null, others: 0 };

/**
 * A raw span as a span of the shop day — integers, `0 ≤ start < end ≤ 1440`
 * — or `null` when it is no span at all.
 */
function windowOf(
  raw: WaitlistCall.DayInput['windows'][number],
): MinuteRange | null {
  const start = MinuteOfDay.of(raw.startMinutes);
  const end = EndMinute.of(raw.endMinutes);
  return start.ok && end.ok && start.value < end.value
    ? MinuteRange.of(start.value, end.value)
    : null;
}

/** What a request's id basis keeps of a cart line: its ids, in this order. */
type BasisLine = Pick<
  CartLine,
  'lineId' | 'serviceId' | 'variantId' | 'barberId'
>;

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
 * request, its deterministic id basis, the matcher that turns a freed shop
 * day into a promise, and the one write plan that keeps the notification and
 * the `MATCHED` transition together. No `crypto`: the pipeline hashes the
 * basis. Placement runs on the shop day's local minutes (Law 7.3).
 */
export const WaitlistSystem = {
  /** How long a notification suppresses the next one for the same request. */
  NOTIFY_COOLDOWN_HOURS,
  /** Distinct services per allowed person a cart may name before it is refused unread. */
  MAX_SERVICES_PER_PERSON,

  /**
   * May a request be stored, and what storing it means
   * (`decideWaitlist`, `decide-waitlist.ts:91-186`), in the commit's order:
   *
   * 1. nobody to notify — `BOOKING_WAITLIST_UNAUTHENTICATED`;
   * 2. a named shop that is blank or not listed — `locationId`, before a
   *    single day or seat is looked at;
   * 3. a day that is no day — `localDate`; a day behind the shop's today or
   *    past the horizon is DROPPED, not refused (it stopped being bookable
   *    while the client decided);
   * 4. more usable days than the policy allows — `BOOKING_WAITLIST_TOO_MANY_DAYS`;
   * 5. a window that is no span of the day — `windows` (the rest are
   *    normalized: sorted, merged; a day named twice keeps its last entry);
   * 6. no day left — `SCHEDULING_WAITLIST_NO_DAYS`; no line at all —
   *    `SCHEDULING_WAITLIST_EMPTY_CART`;
   * 7. a line that does not read, or a corrupt line counter — `cart`: a
   *    promise for part of the party is a broken one;
   * 8. the commit's own admission of the bag — its refusal, carried typed
   *    (`WaitlistError.cartRefused`).
   */
  decide(
    ask: WaitlistCall.Input,
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

    const usable: WaitlistCall.DayInput[] = [];
    const usableDates: LocalDate[] = [];
    for (let i = 0; i < ask.days.length; i++) {
      const day = ask.days[i] as WaitlistCall.DayInput;
      const parsed = LocalDate.parse(day.localDate);
      if (!parsed.ok) {
        return Result.err(WaitlistError.invalidRequest(LOCAL_DATE_FIELD));
      }
      if (parsed.value < door.now.localDate) continue;
      if (door.horizonEndLocalDate < parsed.value) continue;
      usable.push(day);
      usableDates.push(parsed.value);
    }
    if (usable.length > door.maxFlexibleDays) {
      return Result.err(WaitlistError.tooManyDays(door.maxFlexibleDays));
    }

    const days: DayWindows[] = [];
    for (let i = 0; i < usable.length; i++) {
      const day = usable[i] as WaitlistCall.DayInput;
      const windows: MinuteRange[] = [];
      for (let w = 0; w < day.windows.length; w++) {
        const window = windowOf(
          day.windows[w] as WaitlistCall.DayInput['windows'][number],
        );
        if (window === null) {
          return Result.err(WaitlistError.invalidRequest('windows'));
        }
        windows.push(window);
      }
      days.push(DayWindows.of(usableDates[i] as LocalDate, windows));
    }
    const when = FlexibleWhen.of(days);
    if (FlexibleWhen.isEmpty(when))
      return Result.err(WaitlistError.invalidRequest(NO_DAYS));

    if (BookingCart.lineCount(ask.cart) === 0) {
      return Result.err(WaitlistError.invalidRequest(EMPTY_CART));
    }
    const sequence = ask.cart.cartNextSequence;
    if (!Number.isInteger(sequence) || sequence < 0) {
      return Result.err(WaitlistError.invalidRequest('cart'));
    }
    for (let s = 0; s < ask.cart.cartSeats.length; s++) {
      const lines = (ask.cart.cartSeats[s] as CartSeatLines).lines;
      for (let k = 0; k < lines.length; k++) {
        if (!lineReadable(lines[k] as CartLine)) {
          return Result.err(WaitlistError.invalidRequest('cart'));
        }
      }
    }
    if (door.admission !== null) {
      return Result.err(WaitlistError.cartRefused(door.admission));
    }

    return Result.ok({
      ownerUserId: door.ownerUserId,
      locationId:
        ask.locationId === null ? null : LocationId.of(ask.locationId),
      cartSeats: ask.cart.cartSeats,
      cartNextSequence: ask.cart.cartNextSequence,
      flexibleDays: when.flexibleDays,
      localDates: FlexibleWhen.localDates(when),
      ...WaitlistLifecycle.open(door.now.utcEpochMs),
      createdAtUtcMs: door.now.utcEpochMs,
    });
  },

  /**
   * The string a request's id is the hash of (`deterministicRequestId`,
   * `request-waitlist.ts:290-299`): what the request MEANS — owner, shop, the
   * normalized days, the bag — so two phrasings of one ask collapse to one
   * id and a duplicate is one atomic create refusal. The stored body's own
   * fields, key for key in a fixed order: each day's `localDate` and its
   * windows as `MinuteRange` integers, each line's ids. The pipeline mints
   * `wl_` + the first 40 hex of `hash(basis)`.
   */
  idBasis(
    body: Pick<
      WaitlistRequest,
      | 'ownerUserId'
      | 'locationId'
      | 'flexibleDays'
      | 'cartSeats'
      | 'cartNextSequence'
    >,
  ): string {
    const flexibleDays: {
      readonly localDate: LocalDate;
      readonly windows: readonly {
        readonly startMinutes: MinuteOfDay;
        readonly endMinutes: EndMinute;
      }[];
    }[] = [];
    for (let d = 0; d < body.flexibleDays.length; d++) {
      const day = body.flexibleDays[d] as DayWindows;
      const windows: {
        readonly startMinutes: MinuteOfDay;
        readonly endMinutes: EndMinute;
      }[] = [];
      for (let w = 0; w < day.windows.length; w++) {
        const window = day.windows[w] as MinuteRange;
        windows.push({
          startMinutes: window.startMinutes,
          endMinutes: window.endMinutes,
        });
      }
      flexibleDays.push({ localDate: day.localDate, windows });
    }
    const cartSeats: {
      readonly seatKey: SeatKeyText;
      readonly lines: readonly BasisLine[];
    }[] = [];
    for (let s = 0; s < body.cartSeats.length; s++) {
      const seat = body.cartSeats[s] as CartSeatLines;
      const lines: BasisLine[] = [];
      for (let l = 0; l < seat.lines.length; l++) {
        const line = seat.lines[l] as CartLine;
        lines.push({
          lineId: line.lineId,
          serviceId: line.serviceId,
          variantId: line.variantId,
          barberId: line.barberId,
        });
      }
      cartSeats.push({ seatKey: seat.seatKey, lines });
    }
    return JSON.stringify({
      ownerUserId: body.ownerUserId,
      locationId: body.locationId,
      flexibleDays,
      cartSeats,
      cartNextSequence: body.cartNextSequence,
    });
  },

  /**
   * May the callable read the catalogue for this cart
   * (`cartWithinReadBounds`, `request-waitlist.ts:194-204`)? Not past the
   * party cap in seats, nor past {@link MAX_SERVICES_PER_PERSON} distinct
   * services per allowed person — both refused without a read.
   */
  withinReadBounds(cart: BookingCart, maxPartySize: number): boolean {
    if (cart.cartSeats.length > maxPartySize) return false;
    const distinct: string[] = [];
    for (let s = 0; s < cart.cartSeats.length; s++) {
      const lines = (cart.cartSeats[s] as CartSeatLines).lines;
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
   * expiry would be a second copy that could disagree. `today` is the shop's
   * (`ShopNow.localDate`).
   */
  hasLapsed(when: FlexibleWhen, today: LocalDate): boolean {
    const last = FlexibleWhen.lastLocalDate(when);
    return last !== null && last < today;
  },

  /**
   * From when a sent notification still suppresses the next one for its
   * request — a cooldown measured in elapsed real time on the stamps (T2).
   */
  cooldownSinceUtcMs(nowUtcMs: UtcEpochMs): UtcEpochMs {
    return UtcEpochMs.plusHours(nowUtcMs, -NOTIFY_COOLDOWN_HOURS);
  },

  /**
   * Does anything on this shop day now fit what the request asked for
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
   * - the lead-time floor (`AvailabilitySystem.leadFloor`, on the shop's
   *   clock);
   * - ONE match: each shop's search stops at the first arrangement, and the
   *   earliest across shops is the one named.
   *
   * `null` is the overwhelmingly common answer.
   */
  match(
    request: Pick<
      WaitlistRequest,
      'id' | 'locationId' | 'cartSeats' | 'cartNextSequence' | 'flexibleDays'
    >,
    localDate: LocalDate,
    snapshot: WaitlistDaySnapshot,
    ctx: WaitlistMatchContext,
  ): WaitlistMatch | null {
    const declared = FlexibleWhen.windowsFor(request, localDate);
    if (declared === null) return null;
    if (
      BookingPolicy.horizonEndFrom(ctx.policy, ctx.now.localDate) < localDate
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

    const within = AvailabilitySystem.withinOf(declared);
    if (within.length === 0) return null;

    const options = BookingCartSystem.optionsForDay({
      cart: request,
      services: snapshot.services,
      riders: [],
      barbers,
      localDate,
      policy: ctx.policy,
      notBefore: AvailabilitySystem.leadFloor(ctx.now, ctx.policy, localDate),
      within,
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
      localDate,
      locationId: first.locationId,
      startMinutes: first.option.startMinutes,
      endMinutes: first.option.endMinutes,
      barberIds,
      assignments: first.option.assignments,
    };
  },

  /**
   * The matcher's write for a match, in ONE plan
   * (`match-waitlist.ts:192-202`): the notification — FACTS, never words
   * (§9 D20): the request and the freed start on the shop's clock, worded by
   * the inbox in the reader's locale — created under the owner's ACCOUNT,
   * and the request moved to `MATCHED`, both stamped with `now.utcEpochMs`.
   * Refused when the request can no longer be matched
   * (`SCHEDULING_WAITLIST_INVALID_TRANSITION`), so a terminal request is
   * never told anything.
   */
  planMatch(
    request: WaitlistRequest,
    match: WaitlistMatch,
    now: ShopNow,
    nextId: () => string,
  ): Result<WaitlistMatchPlan, SchedulingError> {
    const waitlist = WaitlistLifecycle.transition(
      request,
      WaitlistStatus.Matched,
      now.utcEpochMs,
    );
    if (!waitlist.ok) return waitlist;
    const notification: InboxNotification = {
      id: NotificationId.of(nextId()),
      sentAtUtcMs: now.utcEpochMs,
      readAtUtcMs: null,
      ...NotificationPayload.waitlistMatch(
        request.id,
        match.localDate,
        match.startMinutes,
      ),
    };
    const { id, ...body } = notification;
    return Result.ok({
      notification,
      waitlist: waitlist.value,
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
          waitlistStatus: waitlist.value.waitlistStatus,
          waitlistStatusAtUtcMs: waitlist.value.waitlistStatusAtUtcMs,
        }),
      ],
    });
  },

  /**
   * The days a request still watches, as its row tells them: those on or
   * after the shop's `today` (`LocalDate.compare`). A request whose every
   * day has passed is the host's to leave out; drawn anyway, it keeps every
   * day it named rather than none — and so does a row with no `today` to
   * read (`null`: an unparsable one).
   */
  daysAhead(
    days: readonly DayWindows[],
    today: LocalDate | null,
  ): readonly DayWindows[] {
    if (today === null) return days;
    const ahead: DayWindows[] = [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i] as DayWindows;
      if (LocalDate.compare(day.localDate, today) >= 0) ahead.push(day);
    }
    return ahead.length > 0 ? ahead : days;
  },

  /**
   * The parts of the day the days' windows touch, in the day's order
   * (`Daypart.touchedBy`, the booking time sheet's own boundaries). None
   * without a day, and none when ANY day is offered whole: «чт–пт,
   * следобед» would be untrue of a Thursday that works at any hour.
   */
  daypartsWatched(days: readonly DayWindows[]): readonly Daypart[] {
    if (days.length === 0) return [];
    const windows: MinuteRange[] = [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i] as DayWindows;
      if (DayWindows.isWholeDay(day)) return [];
      for (let w = 0; w < day.windows.length; w++) {
        windows.push(day.windows[w] as MinuteRange);
      }
    }
    return Daypart.touchedBy(windows);
  },

  /**
   * Where a waiting request's row files in the upcoming run: its first
   * watched day at the day's first minute; a request that watches no day
   * at the first day of the civil axis (`1970-01-01`, minute 0), before
   * every real row.
   */
  sortPoint(days: readonly DayWindows[]): WallTime {
    const first = days[0];
    return first === undefined
      ? UNDATED
      : WallTime.of(first.localDate, DAY_START);
  },

  /**
   * The staff glance's waiting request: none while the client is paused;
   * else the requests still watching (`WaitlistLifecycle.isWatching`), not
   * lapsed at the shop's `today` ({@link hasLapsed}), and not answered by a
   * visit to come booked at or after the request was made (a stamp-order
   * rule, T2 — the two instants compared as stamped; a visit with no stamp
   * answers nothing) — the newest by `createdAtUtcMs` (a STABLE order:
   * equal stamps keep the input's), with how many others there are.
   * `upcoming` is the glance's visits to come (`VisitListSystem.upcomingSoonestFirst`).
   */
  glancePick(
    requests: readonly WaitlistRequest[],
    upcoming: readonly Pick<Appointment, 'bookedAtUtcMs'>[],
    today: LocalDate,
    paused: boolean,
  ): WaitlistGlancePick {
    if (paused) return NO_PICK;
    const watching: WaitlistRequest[] = [];
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i] as WaitlistRequest;
      if (!WaitlistLifecycle.isWatching(request)) continue;
      if (WaitlistSystem.hasLapsed(request, today)) continue;
      if (bookedAtOrAfter(upcoming, request.createdAtUtcMs)) continue;
      watching.push(request);
    }
    watching.sort((a, b) =>
      UtcEpochMs.compare(b.createdAtUtcMs, a.createdAtUtcMs),
    );
    const newest = watching[0];
    return newest === undefined
      ? NO_PICK
      : { newest, others: watching.length - 1 };
  },
} as const;

/** Some visit to come was booked at or after `createdAtUtcMs` — the request is answered. */
function bookedAtOrAfter(
  upcoming: readonly Pick<Appointment, 'bookedAtUtcMs'>[],
  createdAtUtcMs: UtcEpochMs,
): boolean {
  for (let i = 0; i < upcoming.length; i++) {
    const bookedAtUtcMs = (upcoming[i] as Pick<Appointment, 'bookedAtUtcMs'>)
      .bookedAtUtcMs;
    if (
      bookedAtUtcMs !== null &&
      UtcEpochMs.compare(bookedAtUtcMs, createdAtUtcMs) >= 0
    ) {
      return true;
    }
  }
  return false;
}
