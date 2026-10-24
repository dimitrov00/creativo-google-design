import {
  BarberPref,
  BookingCall,
  type BookingPolicy,
  BookingFlowStep,
  BookingFlowState,
  type SeatAssignment,
  BookingCart,
  type CartLine,
  type CartSeatLines,
  SeatKey,
  type DayWindows,
  FlexibleWhen,
  type MinuteRange,
  Party,
  PartyMember,
  PartyRole,
  type RosterWindow,
  SeatLabel,
  Seat,
  type SeatCore,
  type SeatOccupant,
  SeatSubject,
  SubjectRelationship,
  type ServiceTerms,
  type ShopNow,
  ShopCoverage,
  SeatArrangement,
  type ChairTime,
} from '@core/components';
import {
  Result,
  type BarberId,
  CartLineId,
  GuestId,
  type LocationId,
  SeatKeyText,
  type ServiceId,
  type UserId,
  type LocalDate,
  type MinuteOfDay,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import type {
  BarberBusyDay,
  BarberSchedule,
  ScheduleException,
  Service,
  ShopLocation,
} from '@core/entities';
import {
  type AvailabilityLine,
  type AvailabilityOption,
  type AvailabilityRider,
  AvailabilitySystem,
  type BarberDayAvailability,
  type LineTerms,
  type SearchBudget,
} from './availability.system';
import { GuestLabelSystem } from './guest-label.system';
import { LocationScopeSystem } from './location-scope.system';
import { MoveSystem } from './move.system';
import { OfferingPriceSystem } from './offering-price.system';
import { PartyAdmissionSystem } from './party-admission.system';
import { RosterSystem, type ShopHours } from './roster.system';

/**
 * What the cart math reads off a catalogue service — the terms matrix (the
 * five `ServiceTerms` fields at the root, and the offerings) and the shop
 * scope. A whole `Service` passes straight in.
 */
export type CartService = Pick<
  Service,
  | 'id'
  | 'priceCents'
  | 'currency'
  | 'durationMinutes'
  | 'setupMinutes'
  | 'cleanupMinutes'
  | 'offerings'
  | 'locationIds'
>;

/** What the shop rule reads off a catalogue service — its id and its shop scope. */
export type CartServiceScope = Pick<Service, 'id' | 'locationIds'>;

/**
 * A seat a MOVE carries without the cart naming it (`party-shops.ts:24`): the
 * engine's rider — its barber, its distance from the party, the terms it was
 * sold at — plus WHAT it is, which the engine never needs and the shop does.
 */
export type CartRider = AvailabilityRider & { readonly serviceId: ServiceId };

/**
 * Everything a visit asks a shop to offer (`party-shops.ts:52`). A CART line
 * whose service the catalogue does not know asks nothing (the grid already
 * dropped it); a CARRIED seat's unknown service is served nowhere.
 */
export type CartPartyServices = {
  readonly lineServiceIds: readonly ServiceId[];
  readonly riderServiceIds: readonly ServiceId[];
};

/**
 * One barber's shop day as the booking grid reads it before it is split per
 * shop: the rostered windows at EVERY shop (`RosterSystem.buildDayWindows`,
 * each window naming its shop) and the busy minutes already padded by the
 * barber's turnaround (`AvailabilitySystem.paddedBusy`) — local coordinates
 * of the query's `localDate` (Law 7.3).
 */
export type CartBarberDay = {
  readonly barberId: BarberId;
  readonly windows: readonly RosterWindow[];
  readonly busy: readonly MinuteRange[];
};

/**
 * One shop day's question (`observe-availability.use-case.ts:255-306`): the
 * bag, the catalogue it resolves against, a move's riders (`[]` on every
 * ordinary booking), every barber's day, the day itself, the policy, the
 * lead-time floor (`AvailabilitySystem.leadFloor`; `null` = the whole day is
 * too soon), the client's declared windows (`null` unconstrained, `[]`
 * nothing qualifies) and the search budget.
 */
export type CartDayQuery = {
  readonly cart: BookingCart;
  readonly services: readonly CartService[];
  readonly riders: readonly CartRider[];
  readonly barbers: readonly CartBarberDay[];
  readonly localDate: LocalDate;
  readonly policy: BookingPolicy;
  readonly notBefore: MinuteOfDay | null;
  readonly within: readonly MinuteRange[] | null;
  readonly budget: SearchBudget;
};

/**
 * One arrangement and the shop it happens at — an appointment holds ONE
 * `locationId`, so every option is single-shop.
 */
export type CartLocatedOption = {
  readonly locationId: LocationId;
  readonly option: AvailabilityOption;
};

/** What becomes of a seat the booker cannot name — the ONLY source of these strings. */
export const PrefillCompanions = {
  /** A new booking: a companion account comes back as a guest seat. */
  AsGuests: 'AS_GUESTS',
  /** A move: the server carries them, so they stay out of the cart. */
  CarriedByServer: 'CARRIED_BY_SERVER',
} as const;
export type PrefillCompanions =
  (typeof PrefillCompanions)[keyof typeof PrefillCompanions];

/**
 * What a prefill reads off a stored seat — its service, variant and barber
 * and who sits in it. A whole `Seat` passes straight in.
 */
export type PrefillSeat = Pick<
  SeatCore,
  'serviceId' | 'variantId' | 'barberId'
> &
  SeatOccupant;

/** A bag rebuilt from a visit: the party and the cart. */
export type CartPrefill = {
  readonly party: Party;
  readonly cart: BookingCart;
};

/**
 * A persisted booking draft, as {@link BookingCartSystem.restore} reads it:
 * the flow state and the shop day the schedule step had picked (`null` when
 * none).
 */
export type CartDraft = {
  readonly state: BookingFlowState;
  readonly selectedLocalDate: LocalDate | null;
};

/**
 * Can the chosen shop serve the visit, and where else it can be
 * ({@link BookingCartSystem.shopCoverage}): the verdict, and — for
 * `ELSEWHERE` — the ONE shop that can serve it, or `null` for "any shop"
 * (several can). `targetId` is `null` for every other verdict.
 */
export type ShopCoverageAnswer = {
  readonly shopCoverage: ShopCoverage;
  readonly targetId: LocationId | null;
};

/** Which documents one shop day is read from. */
export type DayDocsKey = {
  readonly localDate: LocalDate;
  /** Every active barber, in code-unit order — the engine's barber order, stable across reads. */
  readonly barberIds: readonly BarberId[];
  /**
   * The shop a MOVE names, read by id whatever its status — a hidden shop
   * takes no new booking, but a visit already booked there is still moved
   * by its client (team decision 2026-09-26). `null` for every other query.
   */
  readonly namedLocationId: LocationId | null;
};

/** One barber's day, as stored: `null` where there is no document. */
export type BarberDayDocs = {
  readonly barberId: BarberId;
  readonly schedule: BarberSchedule | null;
  readonly busy: BarberBusyDay | null;
  readonly exception: ScheduleException | null;
};

/** Everything one shop day's grid reads, and which key it was read for. */
export type DayDocs = {
  readonly key: DayDocsKey;
  readonly barbers: readonly BarberDayDocs[];
  readonly namedLocation: ShopLocation | null;
};

/** What one shop day's grid is asked — the bag, the catalogue, the clock and a move's carried facts. */
export type DayQuery = {
  /** The bag, as the cart math reads it. */
  readonly cart: BookingCart;
  /** The catalogue the bag's service ids resolve against. */
  readonly services: readonly Service[];
  /** Every ACTIVE barber — the roster decides who works where, not this list. */
  readonly barberIds: readonly BarberId[];
  /** `null` ⇒ "any shop": every shop is a candidate and each option names its own. */
  readonly locationId: LocationId | null;
  readonly localDate: LocalDate;
  readonly policy: BookingPolicy;
  /** "Now" on the shop's wall clock, read once by the caller. */
  readonly now: ShopNow;
  /** Everybody a MOVE carries, pinned to the party's start; `[]` on a new booking. */
  readonly riders: readonly CartRider[];
  /**
   * The chair time of the visit being MOVED, handed back first — minutes of
   * {@link DayQuery.releaseLocalDate}, the visit's own shop day; `[]` on a
   * new booking.
   */
  readonly release: readonly ChairTime[];
  /** The shop day the moved visit stands on — `null` on a new booking. */
  readonly releaseLocalDate: LocalDate | null;
  /** Every LISTED shop — the grid's whole set of shops, each clamping its own segments. */
  readonly shops: readonly ShopLocation[];
};

const SELF_KEY = SeatKeyText.of('self');
const GUEST_PREFIX = 'guest-';

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** A line the legacy reader could rebuild — every id it carries is non-blank. */
function readable(line: CartLine): boolean {
  return (
    !isBlank(line.lineId) &&
    !isBlank(line.serviceId) &&
    (line.variantId === null || !isBlank(line.variantId)) &&
    (line.barberId === null || !isBlank(line.barberId))
  );
}

/**
 * The seats of a stored cart with every unreadable line dropped, every line
 * naming its own seat, and an emptied seat unlisted; a seat key listed twice
 * keeps its first position and its last non-empty lines (the legacy `Map`).
 */
function readableSeats(
  stored: readonly CartSeatLines[],
): readonly CartSeatLines[] {
  const seats: CartSeatLines[] = [];
  for (let i = 0; i < stored.length; i++) {
    const seat = stored[i] as CartSeatLines;
    const lines: CartLine[] = [];
    for (let k = 0; k < seat.lines.length; k++) {
      const line = seat.lines[k] as CartLine;
      if (!readable(line)) continue;
      lines.push(
        line.seatKey === seat.seatKey
          ? line
          : { ...line, seatKey: seat.seatKey },
      );
    }
    if (lines.length === 0) continue;
    let at = -1;
    for (let s = 0; s < seats.length; s++) {
      if ((seats[s] as CartSeatLines).seatKey === seat.seatKey) {
        at = s;
        break;
      }
    }
    if (at === -1) seats.push({ seatKey: seat.seatKey, lines });
    else seats[at] = { seatKey: seat.seatKey, lines };
  }
  return seats;
}

function findService<S extends CartServiceScope>(
  services: readonly S[],
  serviceId: ServiceId,
): S | null {
  for (let i = 0; i < services.length; i++) {
    const service = services[i] as S;
    if (service.id === serviceId) return service;
  }
  return null;
}

function lineTermsOf(terms: ServiceTerms): LineTerms {
  return {
    durationMinutes: terms.durationMinutes,
    padBeforeMinutes: terms.setupMinutes,
    padAfterMinutes: terms.cleanupMinutes,
  };
}

/** Does the catalogue say `serviceId` is offered at `locationId`? `null` when it does not know the service. */
function offers(
  services: readonly CartServiceScope[],
  serviceId: ServiceId,
  locationId: LocationId,
): boolean | null {
  const service = findService(services, serviceId);
  return service === null
    ? null
    : LocationScopeSystem.serves(service.locationIds, locationId);
}

/** The guest member whose seat key is `seatKey`, or `null`. */
function guestOf(party: Party, seatKey: SeatKeyText): PartyMember.Guest | null {
  for (let i = 0; i < party.members.length; i++) {
    const member = party.members[i] as PartyMember;
    if (
      member.partyRole === PartyRole.Guest &&
      SeatKey.text(SeatKey.guest(member.guestId)) === seatKey
    ) {
      return member;
    }
  }
  return null;
}

/**
 * The per-shop runs merged by start, then shop — what a stable sort of
 * their concatenation by (start, shop) returns, without the sort. Each run
 * is sorted by start and the runs come in shop-id order, so on a tie the
 * earlier run (the smaller shop id) goes first. A handful of shops: the
 * head with the earliest start is found by a scan of the heads.
 */
function mergeByStartThenShop(
  runs: readonly (readonly CartLocatedOption[])[],
): readonly CartLocatedOption[] {
  if (runs.length === 1) return runs[0] as readonly CartLocatedOption[];
  const heads: number[] = [];
  let total = 0;
  for (let r = 0; r < runs.length; r++) {
    heads.push(0);
    total += (runs[r] as readonly CartLocatedOption[]).length;
  }
  const merged: CartLocatedOption[] = [];
  while (merged.length < total) {
    let pick = -1;
    let pickStart = Number.POSITIVE_INFINITY;
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r] as readonly CartLocatedOption[];
      const head = heads[r] as number;
      if (head >= run.length) continue;
      const start = (run[head] as CartLocatedOption).option.startMinutes;
      if (start < pickStart) {
        pick = r;
        pickStart = start;
      }
    }
    const run = runs[pick] as readonly CartLocatedOption[];
    merged.push(run[heads[pick] as number] as CartLocatedOption);
    heads[pick] = (heads[pick] as number) + 1;
  }
  return merged;
}

/**
 * The cart's math beyond the component's own operations (the legacy
 * `booking-cart.ts`, `observe-availability.use-case.ts` and `party-shops.ts`,
 * deleted in Phase 4b — ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1 — and the `booking-flow.store.ts` helpers): the cart as engine lines,
 * the shops a party can be served at, one shop day's options split per shop,
 * the commit request, a bag rebuilt from a visit and a draft brought back to
 * today. Placement runs on one shop day's local minutes (Law 7.3).
 *
 * The cart's own operations (add, remove, re-point a line, drop a seat, the
 * accepted barbers) are the {@link BookingCart} component.
 */
/**
 * The shops a day may offer, each with its hours that day: every LISTED
 * shop — and, for a visit being MOVED at a named shop, that shop too,
 * listed or not, still clamped to its own hours (never offered unbounded),
 * replacing its listed entry and placed last (`day-availability.ts`
 * `offeredShopHours`). The hours are {@link RosterSystem.shopHoursOn}'s.
 */
function offeredShopHours(
  query: DayQuery,
  namedLocation: ShopLocation | null,
): readonly ShopHours[] {
  const listed: ShopLocation[] = [];
  for (let i = 0; i < query.shops.length; i++) {
    const shop = query.shops[i] as ShopLocation;
    if (PartyAdmissionSystem.shopListed(shop)) listed.push(shop);
  }
  const hours = RosterSystem.shopHoursOn(listed, query.localDate);
  if (namedLocation === null) return hours;
  const own = RosterSystem.shopHoursOn(
    [namedLocation],
    query.localDate,
  )[0] as ShopHours;
  // The move's own shop, by its own hours — replacing the listed entry.
  const offered: ShopHours[] = [];
  for (let i = 0; i < hours.length; i++) {
    const entry = hours[i] as ShopHours;
    if (entry.locationId !== own.locationId) offered.push(entry);
  }
  offered.push(own);
  return offered;
}

export const BookingCartSystem = {
  /**
   * A persisted cart read back the forgiving way
   * (`BookingCart.reconstitute`, `booking-cart.ts:144-197`): a corrupt line
   * counter is REFUSED (`SCHEDULING_BOOKING_CART_INVALID_LINE_SEQUENCE` —
   * coercing it would reopen the §7.7 id-resurrection hazard), while a line
   * with a blank id is DROPPED and the rest kept — a draft is a convenience,
   * and losing one line beats discarding a party. A seat left with no line is
   * not listed; a seat key listed twice keeps its first position and its
   * last lines. Every surviving line names its own seat.
   */
  salvage(cart: BookingCart): Result<BookingCart, SchedulingError> {
    if (!Number.isInteger(cart.cartNextSequence) || cart.cartNextSequence < 0) {
      return Result.err(
        SchedulingError.cartInvalidLineSequence(cart.cartNextSequence),
      );
    }
    return Result.ok({
      cartSeats: readableSeats(cart.cartSeats),
      cartNextSequence: cart.cartNextSequence,
    });
  },

  /**
   * Cart → engine lines (`cartToAvailabilityLines`,
   * `observe-availability.use-case.ts:105-148`). One line per cart line, in
   * cart order; `personKey` is the seat key (one person never sits in two
   * chairs at once); the flat terms are the catalogue's before anyone picks
   * a barber; `termsByBarber` is DENSE and parallel to `barberIds` — each
   * barber measured on their own terms (`OfferingPriceSystem.termsFor`). A
   * line whose service the catalogue does not hold is DROPPED: offering a
   * time for a service that no longer exists would only fail at the write.
   */
  toAvailabilityLines(
    cart: BookingCart,
    services: readonly CartService[],
    barberIds: readonly BarberId[],
  ): readonly AvailabilityLine[] {
    const lines: AvailabilityLine[] = [];
    for (let s = 0; s < cart.cartSeats.length; s++) {
      const seat = cart.cartSeats[s] as CartSeatLines;
      for (let k = 0; k < seat.lines.length; k++) {
        const line = seat.lines[k] as CartLine;
        const service = findService(services, line.serviceId);
        if (service === null) continue;
        const defaults = lineTermsOf(
          OfferingPriceSystem.termsFor(service, null, line.variantId),
        );
        const termsByBarber: LineTerms[] = [];
        for (let b = 0; b < barberIds.length; b++) {
          termsByBarber.push(
            lineTermsOf(
              OfferingPriceSystem.termsFor(
                service,
                barberIds[b] as BarberId,
                line.variantId,
              ),
            ),
          );
        }
        lines.push({
          lineId: line.lineId,
          ...BarberPref.fromBarberId(line.barberId),
          durationMinutes: defaults.durationMinutes,
          padBeforeMinutes: defaults.padBeforeMinutes,
          padAfterMinutes: defaults.padAfterMinutes,
          termsByBarber,
          personKey: seat.seatKey,
        });
      }
    }
    return lines;
  },

  /** The services a cart and the seats a move carries ask a shop for (`partyServicesOf`). */
  partyServicesOf(
    cart: BookingCart,
    riders: readonly CartRider[],
  ): CartPartyServices {
    const lineServiceIds: ServiceId[] = [];
    for (let s = 0; s < cart.cartSeats.length; s++) {
      const lines = (cart.cartSeats[s] as CartSeatLines).lines;
      for (let k = 0; k < lines.length; k++) {
        lineServiceIds.push((lines[k] as CartLine).serviceId);
      }
    }
    const riderServiceIds: ServiceId[] = [];
    for (let r = 0; r < riders.length; r++) {
      riderServiceIds.push((riders[r] as CartRider).serviceId);
    }
    return { lineServiceIds, riderServiceIds };
  },

  /**
   * The shops of `locationIds`, in the order given, that can serve the WHOLE
   * party (`shopsServingParty`, `party-shops.ts:94`) — the rule the commit
   * refuses a seat by. A cart line's service must be offered there when the
   * catalogue knows it (one it does not know asks nothing); a carried seat's
   * service must be KNOWN and offered (a retired one is served nowhere).
   */
  shopsServingParty(
    party: CartPartyServices,
    services: readonly CartServiceScope[],
    locationIds: readonly LocationId[],
  ): readonly LocationId[] {
    const serving: LocationId[] = [];
    shops: for (let i = 0; i < locationIds.length; i++) {
      const locationId = locationIds[i] as LocationId;
      for (let k = 0; k < party.lineServiceIds.length; k++) {
        const served = offers(
          services,
          party.lineServiceIds[k] as ServiceId,
          locationId,
        );
        if (served === false) continue shops;
      }
      for (let k = 0; k < party.riderServiceIds.length; k++) {
        const served = offers(
          services,
          party.riderServiceIds[k] as ServiceId,
          locationId,
        );
        if (served !== true) continue shops;
      }
      serving.push(locationId);
    }
    return serving;
  },

  /**
   * A shop day's arrangements, each at ONE shop (`optionsForDay`,
   * `observe-availability.use-case.ts:224-306`). The engine is shop-blind, so
   * the pool is partitioned by the shop on each roster window and the engine
   * runs once per shop, in shop-id order (code units, runtime-locale
   * independent); BUSY is not partitioned — a barber booked at the other shop
   * is not free here either. A shop runs only for a party it can serve whole
   * ({@link shopsServingParty}). Each run gets the grid's ONE arrangement per
   * start (`AvailabilitySystem.availableStarts`), its lines measured against
   * that run's barbers; the options come back sorted by start, then shop.
   * A roster window IS a minute range of the day, so it is handed to the
   * engine as it is.
   */
  optionsForDay(query: CartDayQuery): readonly CartLocatedOption[] {
    // Partition: shop → the barbers rostered there, each with only their
    // windows at that shop, in the order the barbers came. Collected in
    // parallel mutable lists (a window is pushed, never copied in), and each
    // barber's struct built once after the walk.
    const shops: LocationId[] = [];
    const poolIds: BarberId[][] = [];
    const poolBusy: (readonly MinuteRange[])[][] = [];
    const poolWindows: RosterWindow[][][] = [];
    for (let b = 0; b < query.barbers.length; b++) {
      const barber = query.barbers[b] as CartBarberDay;
      for (let w = 0; w < barber.windows.length; w++) {
        const window = barber.windows[w] as RosterWindow;
        let at = shops.indexOf(window.locationId);
        if (at === -1) {
          at = shops.length;
          shops.push(window.locationId);
          poolIds.push([]);
          poolBusy.push([]);
          poolWindows.push([]);
        }
        const ids = poolIds[at] as BarberId[];
        const mine = ids.indexOf(barber.barberId);
        if (mine === -1) {
          ids.push(barber.barberId);
          (poolBusy[at] as (readonly MinuteRange[])[]).push(barber.busy);
          (poolWindows[at] as RosterWindow[][]).push([window]);
        } else {
          ((poolWindows[at] as RosterWindow[][])[mine] as RosterWindow[]).push(
            window,
          );
        }
      }
    }

    const serving = BookingCartSystem.shopsServingParty(
      BookingCartSystem.partyServicesOf(query.cart, query.riders),
      query.services,
      shops,
    );

    const order: number[] = [];
    for (let i = 0; i < shops.length; i++) order.push(i);
    order.sort((a, b) =>
      compareIds(shops[a] as LocationId, shops[b] as LocationId),
    );

    // One run per serving shop, visited in shop-id order; each run is
    // already sorted by start (`compareOptions`).
    const runs: CartLocatedOption[][] = [];
    for (let i = 0; i < order.length; i++) {
      const index = order[i] as number;
      const locationId = shops[index] as LocationId;
      if (!serving.includes(locationId)) continue;
      const ids = poolIds[index] as BarberId[];
      const barbers: BarberDayAvailability[] = [];
      for (let p = 0; p < ids.length; p++) {
        barbers.push({
          barberId: ids[p] as BarberId,
          windows: (poolWindows[index] as RosterWindow[][])[
            p
          ] as RosterWindow[],
          busy: (poolBusy[index] as (readonly MinuteRange[])[])[
            p
          ] as readonly MinuteRange[],
          blocks: [],
        });
      }
      const lines = BookingCartSystem.toAvailabilityLines(
        query.cart,
        query.services,
        ids,
      );
      const result = AvailabilitySystem.availableStarts(
        {
          lines,
          barbers,
          policy: query.policy,
          notBefore: query.notBefore,
          riders: query.riders,
          within: query.within,
        },
        query.budget,
      );
      const run: CartLocatedOption[] = [];
      for (let o = 0; o < result.options.length; o++) {
        run.push({
          locationId,
          option: result.options[o] as AvailabilityOption,
        });
      }
      runs.push(run);
    }
    return mergeByStartThenShop(runs);
  },

  /**
   * Every seat in the party, the booker first, then companions and guests in
   * member order (`partySeats`, `booking-flow.ts:333`) — as cart seat keys.
   */
  partySeats(party: Party): readonly SeatKeyText[] {
    const keys = Party.seatKeys(party);
    const texts: SeatKeyText[] = [];
    for (let i = 0; i < keys.length; i++) {
      texts.push(SeatKey.text(keys[i] as SeatKey));
    }
    return texts;
  },

  /**
   * The first person booking nothing, in party order, or `null` when
   * everyone holds something (`firstSeatWithoutService`,
   * `booking-flow.ts:347`) — ordered because the caller NAMES them.
   */
  firstSeatWithoutService(party: Party, cart: BookingCart): SeatKeyText | null {
    const seats = BookingCartSystem.partySeats(party);
    for (let i = 0; i < seats.length; i++) {
      const seatKey = seats[i] as SeatKeyText;
      if (BookingCart.linesFor(cart, seatKey).length === 0) return seatKey;
    }
    return null;
  },

  /**
   * The selection as the commit request wants it (`toCommitSeats`,
   * `booking-flow.store.ts:777-847`): one entry per assignment, in order,
   * carrying no price and no duration — its start in minutes of the
   * selection's shop day — the ONE seat shape of the booking wire,
   * `BookingCall.Seat` (Phase 4a). A guest travels as their LABEL plus their
   * seat key (`GuestKey`; a key that is not one drops to `null`). `null` when an assignment names a line the cart no longer holds, or
   * a seat that is neither the booker's nor a guest's — the bag changed
   * after the schedule step, and the server would refuse for a reason the
   * user cannot act on.
   */
  toCommitSeats(
    cart: BookingCart,
    party: Party,
    assignments: readonly SeatAssignment[],
  ): readonly BookingCall.Seat[] | null {
    const seats: BookingCall.Seat[] = [];
    for (let a = 0; a < assignments.length; a++) {
      const assignment = assignments[a] as SeatAssignment;
      let found: CartLine | null = null;
      for (let s = 0; s < cart.cartSeats.length && found === null; s++) {
        const lines = (cart.cartSeats[s] as CartSeatLines).lines;
        for (let k = 0; k < lines.length; k++) {
          if ((lines[k] as CartLine).lineId === assignment.lineId) {
            found = lines[k] as CartLine;
            break;
          }
        }
      }
      if (found === null) return null;
      let subject: BookingCall.Subject;
      if (found.seatKey === SELF_KEY) {
        subject = BookingCall.selfSubject();
      } else {
        const guest = guestOf(party, found.seatKey);
        if (guest === null) return null;
        subject = BookingCall.guestSubject(guest.guestLabel, found.seatKey);
      }
      seats.push({
        lineId: assignment.lineId,
        serviceId: found.serviceId,
        variantId: found.variantId,
        barberId: assignment.barberId,
        barberPreference: BarberPref.fromBarberId(found.barberId)
          .barberPreference,
        startMinutes: assignment.startMinutes,
        subject,
      });
    }
    return seats;
  },

  /**
   * `label(n)` for the first `n` from `from` that is not `taken` — the ONE
   * placeholder rule (`firstUnusedLabel`, `booking-flow.store.ts:1477-1500`),
   * trimmed. Never a taken label: the party refuses a second guest under one,
   * and `taken` can block at most `taken.length` ordinals, so one more try
   * always lands — unless `label` ignores its ordinal, when the number is
   * written after it («Гост 2»), which the same pigeonhole bound lands too.
   */
  firstUnusedLabel(
    taken: readonly string[],
    label: (ordinal: number) => string,
    from: number,
  ): string {
    // The rule is `GuestLabelSystem`'s; the cart names it for its prefill.
    return GuestLabelSystem.firstUnusedLabel(taken, label, from);
  },

  /**
   * The account a visit was read FOR (`readerOf`,
   * `booking-flow.store.ts:1026-1034`): the party's claimed owner, or —
   * before any claim — the visit's own `SELF` account seat, which an
   * owner-scoped read can only have been. `null` when neither names anyone.
   */
  readerOf(
    seats: readonly PrefillSeat[],
    partyOwner: UserId | null,
  ): UserId | null {
    if (partyOwner !== null) return partyOwner;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as PrefillSeat;
      if (
        seat.seatSubject === SeatSubject.Account &&
        seat.subjectRelationship === SubjectRelationship.Self
      ) {
        return seat.subjectUserId;
      }
    }
    return null;
  },

  /**
   * The bag of a visit, rebuilt (`prefillFrom`, `booking-flow.store.ts:1070-1180`).
   *
   * ONE KEY PER PERSON, not per seat: the booker's own seats are `self`; an
   * anonymous guest is known by their stored LABEL (the identity the server
   * counts people by) and keeps it; an account the booker cannot name
   * (`Seat.isMovableByBooker`) is a guest seat on a new booking
   * (`AS_GUESTS`) and is left to the server on a move (`CARRIED_BY_SERVER`).
   * Guest seat keys are minted `guest-0…` in visit order; lines are `line-1…`
   * with the visit's barber as a SPECIFIC preference. A guest the visit has no
   * name for gets a placeholder no other guest holds ({@link firstUnusedLabel}
   * from 1). `null` when nothing is left for the cart, or a placeholder is no
   * label at all.
   */
  prefill(
    seats: readonly PrefillSeat[],
    reader: UserId | null,
    partyOwner: UserId | null,
    companions: PrefillCompanions,
    guestLabel: (ordinal: number) => string,
  ): CartPrefill | null {
    const persons: string[] = [];
    const seatKeys: SeatKeyText[] = [];
    const buckets: CartLine[][] = [];
    const storedLabels: (string | null)[] = [];
    let sequence = 1;
    let guestOrdinal = 0;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as PrefillSeat;
      // `isMovableByBooker` reads the seat's occupant only — the one rule
      // the server decides a move by.
      const theBookers = Seat.isMovableByBooker(seat as Seat, reader);
      if (!theBookers && companions === PrefillCompanions.CarriedByServer) {
        continue;
      }
      const isSelf = theBookers && seat.seatSubject === SeatSubject.Account;
      const person = isSelf
        ? SELF_KEY
        : seat.seatSubject === SeatSubject.Anonymous
          ? `label:${seat.guestLabel}`
          : `account:${seat.subjectUserId}`;
      let at = persons.indexOf(person);
      if (at === -1) {
        at = persons.length;
        persons.push(person);
        seatKeys.push(
          isSelf
            ? SELF_KEY
            : SeatKeyText.of(`${GUEST_PREFIX}${guestOrdinal++}`),
        );
        buckets.push([]);
        storedLabels.push(
          !isSelf && seat.seatSubject === SeatSubject.Anonymous
            ? seat.guestLabel
            : null,
        );
      }
      (buckets[at] as CartLine[]).push({
        lineId: CartLineId.forSequence(sequence++),
        seatKey: seatKeys[at] as SeatKeyText,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        locationId: null,
      });
    }
    if (buckets.length === 0) return null;

    const stored: CartSeatLines[] = [];
    for (let i = 0; i < buckets.length; i++) {
      stored.push({
        seatKey: seatKeys[i] as SeatKeyText,
        lines: buckets[i] as CartLine[],
      });
    }
    const cart: BookingCart = {
      cartSeats: readableSeats(stored),
      cartNextSequence: sequence,
    };

    // Stored names first, so a placeholder can step around every one of them.
    const taken: string[] = [];
    for (let i = 0; i < storedLabels.length; i++) {
      const label = storedLabels[i] as string | null;
      if (label !== null && !taken.includes(label)) taken.push(label);
    }
    const members: PartyMember[] = [PartyMember.owner()];
    let guestCount = 0;
    for (let i = 0; i < seatKeys.length; i++) {
      const seatKey = seatKeys[i] as SeatKeyText;
      if (seatKey === SELF_KEY) continue;
      guestCount++;
      let raw = storedLabels[i] as string | null;
      if (raw === null) {
        raw = BookingCartSystem.firstUnusedLabel(taken, guestLabel, 1);
        taken.push(raw);
      }
      const label = SeatLabel.parse(raw);
      if (!label.ok) return null;
      members.push(PartyMember.guest(GuestId.of(seatKey), label.value));
    }
    return {
      party: {
        ownerUserId: partyOwner,
        members,
        nextGuestSequence: guestCount + 1,
      },
      cart,
    };
  },

  /**
   * A party for a bag that outlived its party (`restoreFromWaitlist`,
   * `booking-flow.store.ts:914-958`): a waitlist request froze the BAG, never
   * the guests' labels (a guest is only a label until they have an account),
   * so every non-booker seat of the cart comes back as a guest under its own
   * seat key and a placeholder no other guest holds ({@link firstUnusedLabel}
   * from 1) — the party lands past the rename that would fix a clash. `null`
   * when a placeholder is no label at all.
   */
  partyForCart(
    cart: BookingCart,
    ownerUserId: UserId | null,
    guestLabel: (ordinal: number) => string,
  ): Party | null {
    const members: PartyMember[] = [PartyMember.owner()];
    const taken: string[] = [];
    for (let i = 0; i < cart.cartSeats.length; i++) {
      const seatKey = (cart.cartSeats[i] as CartSeatLines).seatKey;
      if (seatKey === SELF_KEY) continue;
      const raw = BookingCartSystem.firstUnusedLabel(taken, guestLabel, 1);
      taken.push(raw);
      const label = SeatLabel.parse(raw);
      if (!label.ok) return null;
      members.push(PartyMember.guest(GuestId.of(seatKey), label.value));
    }
    return {
      ownerUserId,
      members,
      nextGuestSequence: members.length,
    };
  },

  /**
   * A persisted draft brought back to today (`restore`,
   * `booking-flow.store.ts:1182-1335`):
   *
   * - a LOCATION draft resumes as it was;
   * - a SCHEDULE or REVIEW draft resumes on SCHEDULE — never on review: a
   *   review's offer restored from storage is an offer nobody re-checked —
   *   but only when the bag is non-empty, everyone in the party holds
   *   something and no two guests share a label; otherwise on SERVICES,
   *   where `next` says what is wrong (the one door a state machine cannot
   *   guard on its own);
   * - the flexible declaration loses the days before `today` (a review
   *   carries none), and the picked day is dropped once it has gone by;
   * - anything else resumes on SERVICES. A terminal state is never persisted
   *   and resumes on services too.
   */
  restore(draft: CartDraft, today: LocalDate): CartDraft {
    const state = draft.state;
    if (state.bookingFlowStep === BookingFlowStep.Location) {
      return { state, selectedLocalDate: draft.selectedLocalDate };
    }
    if (
      state.bookingFlowStep === BookingFlowStep.Confirmed ||
      state.bookingFlowStep === BookingFlowStep.Waitlisted
    ) {
      const party =
        state.bookingFlowStep === BookingFlowStep.Confirmed
          ? state.confirmation.party
          : state.summary.party;
      const cart =
        state.bookingFlowStep === BookingFlowStep.Confirmed
          ? state.confirmation.cart
          : state.summary.cart;
      const locationId =
        state.bookingFlowStep === BookingFlowStep.Confirmed
          ? state.confirmation.selection.locationId
          : state.summary.locationId;
      return {
        state: {
          bookingFlowStep: BookingFlowStep.Services,
          party,
          cart,
          locationId,
        },
        selectedLocalDate: draft.selectedLocalDate,
      };
    }
    const locationId =
      state.bookingFlowStep === BookingFlowStep.Review
        ? state.selection.locationId
        : state.locationId;
    const resumable =
      (state.bookingFlowStep === BookingFlowStep.Schedule ||
        state.bookingFlowStep === BookingFlowStep.Review) &&
      !BookingCart.isEmpty(state.cart) &&
      BookingCartSystem.firstSeatWithoutService(state.party, state.cart) ===
        null &&
      Party.sharedLabel(state.party) === null;
    if (!resumable) {
      return {
        state: {
          bookingFlowStep: BookingFlowStep.Services,
          party: state.party,
          cart: state.cart,
          locationId,
        },
        selectedLocalDate: draft.selectedLocalDate,
      };
    }
    const declared =
      state.bookingFlowStep === BookingFlowStep.Schedule
        ? state.when
        : FlexibleWhen.empty();
    const kept: DayWindows[] = [];
    for (let i = 0; i < declared.flexibleDays.length; i++) {
      const day = declared.flexibleDays[i] as DayWindows;
      if (day.localDate >= today) kept.push(day);
    }
    return {
      state: {
        bookingFlowStep: BookingFlowStep.Schedule,
        party: state.party,
        cart: state.cart,
        locationId,
        when:
          kept.length === declared.flexibleDays.length
            ? declared
            : { flexibleDays: kept },
      },
      selectedLocalDate:
        draft.selectedLocalDate !== null && draft.selectedLocalDate < today
          ? null
          : draft.selectedLocalDate,
    };
  },

  /**
   * The seat keys with the booker's pinned to the front and every other key
   * in the order given (`booking-review-step.ts` `groups`: the summary pins
   * the booker first whatever position the cart gave them) — a stable
   * partition, the arguments untouched.
   */
  bookerFirst(seatKeys: readonly SeatKeyText[]): readonly SeatKeyText[] {
    const ordered: SeatKeyText[] = [];
    for (let i = 0; i < seatKeys.length; i++) {
      if (seatKeys[i] === SELF_KEY) ordered.push(seatKeys[i] as SeatKeyText);
    }
    for (let i = 0; i < seatKeys.length; i++) {
      if (seatKeys[i] !== SELF_KEY) ordered.push(seatKeys[i] as SeatKeyText);
    }
    return ordered;
  },

  /**
   * The next person with an empty bag AFTER the active seat `after`, wrapping
   * — or `null` (`booking-services-step.ts` `nextEmptySeat`). The seats are
   * the services step's row: the booker, then the party's guests in roster
   * order (a companion has no seat there). Nobody to hand over to with fewer
   * than two seats. The wrap is INCLUSIVE, so the active seat is the LAST
   * candidate rather than none: the person on screen can be the empty one
   * (the caller branches on that). An `after` that names no seat starts from
   * the booker. No cart holds nothing for anyone.
   */
  nextSeatWithoutService(
    party: Party | null,
    cart: BookingCart | null,
    after: SeatKeyText,
  ): SeatKeyText | null {
    const seats: SeatKeyText[] = [SELF_KEY];
    if (party !== null) {
      const guests = Party.guests(party);
      for (let i = 0; i < guests.length; i++) {
        seats.push(
          SeatKey.text(SeatKey.guest((guests[i] as PartyMember.Guest).guestId)),
        );
      }
    }
    if (seats.length < 2) return null;
    let from = -1;
    for (let i = 0; i < seats.length; i++) {
      if (seats[i] === after) {
        from = i;
        break;
      }
    }
    for (let step = 1; step <= seats.length; step++) {
      const seat = seats[(from + step) % seats.length] as SeatKeyText;
      if (cart === null || BookingCart.linesFor(cart, seat).length === 0) {
        return seat;
      }
    }
    return null;
  },

  /**
   * Can the chosen shop serve this visit, and if not, where can it be
   * (`booking-schedule-step.ts` `shopCoverage`)? `serving` is the shops, in
   * order, that offer every service on the visit
   * ({@link BookingCartSystem.shopsServingParty}; `null` while unknown —
   * served); `chosen` the shop picked (`null` = "any shop");
   * `chosenListed` whether the picked shop is on the active list.
   *
   * - `SERVED`: the grid answers — under "any shop" whenever ONE active shop
   *   can; a chosen shop that is not on the active list is not this
   *   question's to answer (it would read as "does not offer your
   *   services", which is not why), so it counts as served.
   * - `ELSEWHERE`: the chosen shop does not offer something on the visit and
   *   another shop does; `targetId` is that shop when it alone can, else
   *   `null` ("any shop", which runs exactly the ones that can).
   * - `NOWHERE`: no active shop offers everything on the visit together.
   */
  shopCoverage(
    serving: readonly LocationId[] | null,
    chosen: LocationId | null,
    chosenListed: boolean,
  ): ShopCoverageAnswer {
    if (serving === null) {
      return { shopCoverage: ShopCoverage.Served, targetId: null };
    }
    if (chosen === null) {
      return {
        shopCoverage:
          serving.length > 0 ? ShopCoverage.Served : ShopCoverage.Nowhere,
        targetId: null,
      };
    }
    if (!chosenListed || serving.includes(chosen)) {
      return { shopCoverage: ShopCoverage.Served, targetId: null };
    }
    if (serving.length === 0) {
      return { shopCoverage: ShopCoverage.Nowhere, targetId: null };
    }
    return {
      shopCoverage: ShopCoverage.Elsewhere,
      targetId: serving.length === 1 ? (serving[0] as LocationId) : null,
    };
  },

  /**
   * Does an arrangement seat the party all at once, or one after another
   * (`booking-time-sheet.ts` `arrangementKind`)? `PARALLEL` when every
   * assignment starts at the first one's minute — and for fewer than two
   * assignments; `SEQUENTIAL` otherwise.
   */
  arrangementOf(
    assignments: readonly Pick<SeatAssignment, 'startMinutes'>[],
  ): SeatArrangement {
    if (assignments.length < 2) return SeatArrangement.Parallel;
    const first = (assignments[0] as Pick<SeatAssignment, 'startMinutes'>)
      .startMinutes;
    for (let i = 1; i < assignments.length; i++) {
      if (
        (assignments[i] as Pick<SeatAssignment, 'startMinutes'>)
          .startMinutes !== first
      ) {
        return SeatArrangement.Sequential;
      }
    }
    return SeatArrangement.Parallel;
  },

  /**
   * The documents a day query reads (`day-availability.ts` `dayDocsKey`).
   * The barbers are sorted in code-unit order so the engine's barber
   * iteration — and so the order of the options — is stable across reads; a
   * moved visit's own shop is read by id only for a move at a named shop (a
   * release to hand back).
   */
  dayDocsKey(
    query: Pick<DayQuery, 'localDate' | 'barberIds' | 'locationId' | 'release'>,
  ): DayDocsKey {
    return {
      localDate: query.localDate,
      barberIds: [...query.barberIds].sort(compareIds),
      namedLocationId:
        query.locationId !== null && query.release.length > 0
          ? query.locationId
          : null,
    };
  },

  /** Do two keys read the same documents? Structural — a recompute mints fresh keys. */
  sameDayDocsKey(a: DayDocsKey | null, b: DayDocsKey | null): boolean {
    if (a === null || b === null) return a === b;
    if (
      a.localDate !== b.localDate ||
      a.namedLocationId !== b.namedLocationId ||
      a.barberIds.length !== b.barberIds.length
    ) {
      return false;
    }
    for (let i = 0; i < a.barberIds.length; i++) {
      if (a.barberIds[i] !== b.barberIds[i]) return false;
    }
    return true;
  },

  /**
   * Every barber's shop day as the engine reads it (`day-availability.ts`
   * `barberDays`): the roster's windows at the offered shops — every LISTED
   * shop, plus a moved visit's NAMED shop (listed or not, on its own hours,
   * replacing its listed entry) — narrowed to the chosen shop, if any, and
   * the busy minutes, the moved visit's chairs handed back
   * ({@link MoveSystem.releaseOn}) and the rest padded by the barber's
   * turnaround ({@link AvailabilitySystem.paddedBusy}, on the stored
   * slices). Busy is location-AGNOSTIC: a barber booked at the other shop is
   * not free here either. A barber with no roster, or no window left, is not
   * on the day.
   */
  barberDays(query: DayQuery, docs: DayDocs): readonly CartBarberDay[] {
    const shopHours = offeredShopHours(query, docs.namedLocation);
    const release = MoveSystem.releaseOn(
      query.release,
      query.releaseLocalDate,
      query.localDate,
    );
    const days: CartBarberDay[] = [];
    for (let b = 0; b < docs.barbers.length; b++) {
      const barber = docs.barbers[b] as BarberDayDocs;
      if (barber.schedule === null) continue;
      // Only at a shop the day may offer (`RosterSystem.offeredWindows`).
      const all = RosterSystem.offeredWindows({
        barberId: barber.barberId,
        localDate: query.localDate,
        versions: barber.schedule.versions,
        exceptions: barber.exception === null ? [] : [barber.exception],
        shopHours,
      });
      const windows =
        query.locationId === null
          ? all
          : RosterSystem.windowsAt(all, query.locationId);
      if (windows.length === 0) continue;
      days.push({
        barberId: barber.barberId,
        windows,
        busy: AvailabilitySystem.paddedBusy(
          barber.barberId,
          barber.busy,
          barber.schedule,
          release,
        ),
      });
    }
    return days;
  },

  /**
   * One shop day's arrangements, each at ONE shop, sorted by start then shop
   * — the grid's offer (`day-availability.ts` `dayOptions`). The lead time
   * is applied once, as a floor on the starts
   * ({@link AvailabilitySystem.leadFloor}), never by trimming windows.
   */
  dayOptions(query: DayQuery, docs: DayDocs): readonly CartLocatedOption[] {
    return BookingCartSystem.optionsForDay({
      cart: query.cart,
      services: query.services,
      riders: query.riders,
      barbers: BookingCartSystem.barberDays(query, docs),
      localDate: query.localDate,
      policy: query.policy,
      notBefore: AvailabilitySystem.leadFloor(
        query.now,
        query.policy,
        query.localDate,
      ),
      within: null,
      budget: AvailabilitySystem.DEFAULT_BUDGET,
    });
  },
} as const;
