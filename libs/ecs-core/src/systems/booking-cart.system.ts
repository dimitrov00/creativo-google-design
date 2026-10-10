import { BarberOffering } from '../components/barber-offering.data';
import {
  BarberPref,
  type BarberPrefKind,
} from '../components/barber-pref.data';
import type { BookingPolicy } from '../components/booking-policy.data';
import {
  BookingFlowStep,
  BookingFlowState,
  type SeatAssignment,
} from '../components/booking-flow.data';
import { BookingCart, CartLine, SeatKey } from '../components/cart-line.data';
import type { DayKey } from '../components/day-key.data';
import type { DayOffset } from '../components/day-offset.data';
import { DayWindows } from '../components/day-windows.data';
import { FlexibleWhen } from '../components/flexible-when.data';
import { Party, PartyMember, PartyMemberKind } from '../components/party.data';
import { Result } from '../components/result.data';
import type { RosterWindow } from '../components/roster-window.data';
import { SchedulingError } from '../components/scheduling-errors.data';
import { SeatLabel } from '../components/seat-label.data';
import {
  Seat,
  SeatRelationship,
  SeatSubjectKind,
} from '../components/seat.data';
import type {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import type { TimeInterval } from '../components/time-interval.data';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ServiceEntity, ServiceId } from '../entities/service.entity';
import type { UserId } from '../entities/user.entity';
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
import { RosterSystem } from './roster.system';

/**
 * What the cart math reads off a catalogue service — the terms matrix and the
 * shop scope. A whole `ServiceEntity` passes straight in.
 */
export type CartService = Pick<
  ServiceEntity,
  'id' | 'baseTerms' | 'offerings' | 'locationIds'
>;

/** What the shop rule reads off a catalogue service — its id and its shop scope. */
export type CartServiceScope = Pick<ServiceEntity, 'id' | 'locationIds'>;

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
 * One barber's day as the booking grid reads it before it is split per shop:
 * the rostered windows at EVERY shop (`RosterSystem.buildDayWindows`, each
 * window naming its shop) and the busy time already padded by the barber's
 * turnaround (`AvailabilitySystem.paddedBusy`).
 */
export type CartBarberDay = {
  readonly barberId: BarberId;
  readonly windows: readonly RosterWindow[];
  readonly busy: readonly TimeInterval[];
};

/**
 * One day's question (`observe-availability.use-case.ts:255-306`): the bag,
 * the catalogue it resolves against, a move's riders (`[]` on every ordinary
 * booking), every barber's day, the day's row of the zone table, the policy,
 * the lead-time floor (`AvailabilitySystem.leadFloorMs`), the client's
 * declared windows (`null` unconstrained, `[]` nothing qualifies) and the
 * search budget.
 */
export type CartDayQuery = {
  readonly cart: BookingCart;
  readonly services: readonly CartService[];
  readonly riders: readonly CartRider[];
  readonly barbers: readonly CartBarberDay[];
  readonly day: DayOffset;
  readonly policy: BookingPolicy;
  readonly notBeforeMs: number;
  readonly withinMs: readonly TimeInterval[] | null;
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

/** Who a committed seat is for, as the commit request names them — the ONLY source of these strings. */
export const CommitSubjectKind = {
  /** The booker's own seat. */
  Self: 'self',
  /** A guest, known by the label the party gave them. */
  Guest: 'guest',
} as const;
export type CommitSubjectKind =
  (typeof CommitSubjectKind)[keyof typeof CommitSubjectKind];

/**
 * A seat's subject on the wire (`booking-flow.store.ts:833-844`): the booker,
 * or a guest by LABEL — all a party member is until they have an account —
 * plus `guestKey`, the seat key that tells two guests sharing a label apart
 * from one guest with two services.
 */
export type CommitSubject =
  | { readonly kind: typeof CommitSubjectKind.Self }
  | {
      readonly kind: typeof CommitSubjectKind.Guest;
      readonly label: SeatLabel;
      readonly guestKey: string;
    };

/**
 * One seat of a commit request: WHAT and from WHOM, never a price or a
 * duration — the server resolves both. The line's barber PREFERENCE rides
 * along: «Ivan, by name» and «whoever is free» are different bookings the
 * morning Ivan calls in sick.
 */
export type CommitSeatRequest = {
  readonly lineId: string;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly barberPref: BarberPrefKind;
  readonly startMs: number;
  readonly subject: CommitSubject;
};

/** What becomes of a seat the booker cannot name — the ONLY source of these strings. */
export const PrefillCompanions = {
  /** A new booking: a companion account comes back as a guest seat. */
  AsGuests: 'as_guests',
  /** A move: the server carries them, so they stay out of the cart. */
  CarriedByServer: 'carried_by_server',
} as const;
export type PrefillCompanions =
  (typeof PrefillCompanions)[keyof typeof PrefillCompanions];

/** What a prefill reads off a stored seat. A whole `Seat` passes straight in. */
export type PrefillSeat = Pick<
  Seat,
  'serviceId' | 'variantId' | 'barberId' | 'subject'
>;

/** A bag rebuilt from a visit: the party and the cart. */
export type CartPrefill = {
  readonly party: Party;
  readonly cart: BookingCart;
};

/**
 * A persisted booking draft, as {@link BookingCartSystem.restore} reads it:
 * the flow state and the day the schedule step had picked (`null` when none).
 */
export type CartDraft = {
  readonly state: BookingFlowState;
  readonly selectedDayKey: DayKey | null;
};

const SELF_KEY = 'self';
const GUEST_PREFIX = 'guest-';
const LINE_PREFIX = 'line-';

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
  stored: readonly BookingCart.SeatLines[],
): readonly BookingCart.SeatLines[] {
  const seats: BookingCart.SeatLines[] = [];
  for (let i = 0; i < stored.length; i++) {
    const seat = stored[i] as BookingCart.SeatLines;
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
      if ((seats[s] as BookingCart.SeatLines).seatKey === seat.seatKey) {
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

/**
 * `Service.termsFor(barber, variant)` (`service.ts:375-381`): the catalogue
 * terms before anyone picks a barber, else the barber's offering for the
 * variant (falling back to its base), else the catalogue terms.
 */
function termsOf(
  service: CartService,
  barberId: BarberId | null,
  variantId: ServiceVariantId | null,
): ServiceTerms {
  if (barberId === null) return service.baseTerms;
  for (let i = 0; i < service.offerings.length; i++) {
    const offering = service.offerings[i] as BarberOffering;
    if (offering.barberId === barberId) {
      return BarberOffering.termsFor(offering, variantId);
    }
  }
  return service.baseTerms;
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

/** The guest member answering to `guestId`, or `null`. */
function guestOf(party: Party, guestId: string): PartyMember.Guest | null {
  for (let i = 0; i < party.members.length; i++) {
    const member = party.members[i] as PartyMember;
    if (member.kind === PartyMemberKind.Guest && member.guestId === guestId) {
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
      const start = (run[head] as CartLocatedOption).option.envelope.startMs;
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
 * The cart's math beyond the component's own operations
 * (`booking-cart.ts`, `application/booking/src/lib/use-cases/{observe-availability.use-case,party-shops}.ts`,
 * `booking-flow.store.ts` helpers): the cart as engine lines, the shops a
 * party can be served at, one day's options split per shop, the commit
 * request, a bag rebuilt from a visit and a draft brought back to today.
 *
 * The cart's own operations (add, remove, re-point a line, drop a seat, the
 * accepted barbers) are the {@link BookingCart} component.
 */
export const BookingCartSystem = {
  /**
   * A persisted cart read back the forgiving way
   * (`BookingCart.reconstitute`, `booking-cart.ts:144-197`): a corrupt line
   * counter is REFUSED (`scheduling.booking_cart.invalid_line_sequence` —
   * coercing it would reopen the §7.7 id-resurrection hazard), while a line
   * with a blank id is DROPPED and the rest kept — a draft is a convenience,
   * and losing one line beats discarding a party. A seat left with no line is
   * not listed; a seat key listed twice keeps its first position and its
   * last lines. Every surviving line names its own seat.
   */
  salvage(cart: BookingCart): Result<BookingCart, SchedulingError> {
    if (!Number.isInteger(cart.nextSequence) || cart.nextSequence < 0) {
      return Result.err(
        SchedulingError.cartInvalidLineSequence(cart.nextSequence),
      );
    }
    return Result.ok({
      seats: readableSeats(cart.seats),
      nextSequence: cart.nextSequence,
    });
  },

  /**
   * Cart → engine lines (`cartToAvailabilityLines`,
   * `observe-availability.use-case.ts:105-148`). One line per cart line, in
   * cart order; `personKey` is the seat key (one person never sits in two
   * chairs at once); the flat terms are the catalogue's before anyone picks
   * a barber; `termsByBarber` is DENSE and parallel to `barberIds` — each
   * barber measured on their own terms. A line whose service the catalogue
   * does not hold is DROPPED: offering a time for a service that no longer
   * exists would only fail at the write.
   */
  toAvailabilityLines(
    cart: BookingCart,
    services: readonly CartService[],
    barberIds: readonly BarberId[],
  ): readonly AvailabilityLine[] {
    const lines: AvailabilityLine[] = [];
    for (let s = 0; s < cart.seats.length; s++) {
      const seat = cart.seats[s] as BookingCart.SeatLines;
      for (let k = 0; k < seat.lines.length; k++) {
        const line = seat.lines[k] as CartLine;
        const service = findService(services, line.serviceId);
        if (service === null) continue;
        const defaults = lineTermsOf(termsOf(service, null, line.variantId));
        const termsByBarber: LineTerms[] = [];
        for (let b = 0; b < barberIds.length; b++) {
          termsByBarber.push(
            lineTermsOf(
              termsOf(service, barberIds[b] as BarberId, line.variantId),
            ),
          );
        }
        lines.push({
          lineId: line.lineId,
          barberPref: BarberPref.fromBarberId(line.barberId),
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
    for (let s = 0; s < cart.seats.length; s++) {
      const lines = (cart.seats[s] as BookingCart.SeatLines).lines;
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
   * A day's arrangements, each at ONE shop (`optionsForDay`,
   * `observe-availability.use-case.ts:224-306`). The engine is shop-blind, so
   * the pool is partitioned by the shop on each roster window and the engine
   * runs once per shop, in shop-id order (code units, runtime-locale
   * independent); BUSY is not partitioned — a barber booked at the other shop
   * is not free here either. A shop runs only for a party it can serve whole
   * ({@link shopsServingParty}). Each run gets the grid's ONE arrangement per
   * start (`AvailabilitySystem.availableStarts`), its lines measured against
   * that run's barbers; the options come back sorted by start, then shop.
   */
  optionsForDay(query: CartDayQuery): readonly CartLocatedOption[] {
    // Partition: shop → the barbers rostered there, each with only their
    // windows at that shop, in the order the barbers came. Collected in
    // parallel mutable lists (a window is pushed, never copied in), and each
    // barber's struct built once after the walk.
    const shops: LocationId[] = [];
    const poolIds: BarberId[][] = [];
    const poolBusy: (readonly TimeInterval[])[][] = [];
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
          (poolBusy[at] as (readonly TimeInterval[])[]).push(barber.busy);
          (poolWindows[at] as RosterWindow[][]).push([window]);
        } else {
          ((poolWindows[at] as RosterWindow[][])[mine] as RosterWindow[]).push(
            window,
          );
        }
      }
    }
    const pools: CartBarberDay[][] = [];
    for (let at = 0; at < shops.length; at++) {
      const ids = poolIds[at] as BarberId[];
      const pool: CartBarberDay[] = [];
      for (let p = 0; p < ids.length; p++) {
        pool.push({
          barberId: ids[p] as BarberId,
          windows: (poolWindows[at] as RosterWindow[][])[p] as RosterWindow[],
          busy: (poolBusy[at] as (readonly TimeInterval[])[])[
            p
          ] as readonly TimeInterval[],
        });
      }
      pools.push(pool);
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

    const riders: AvailabilityRider[] = [];
    for (let r = 0; r < query.riders.length; r++) {
      const rider = query.riders[r] as CartRider;
      riders.push({
        barberId: rider.barberId,
        offsetMinutes: rider.offsetMinutes,
        terms: rider.terms,
      });
    }

    // One run per serving shop, visited in shop-id order; each run is
    // already sorted by start (`compareOptions`).
    const runs: CartLocatedOption[][] = [];
    for (let i = 0; i < order.length; i++) {
      const index = order[i] as number;
      const locationId = shops[index] as LocationId;
      if (!serving.includes(locationId)) continue;
      const pool = pools[index] as CartBarberDay[];
      const barbers: BarberDayAvailability[] = [];
      const barberIds: BarberId[] = [];
      for (let b = 0; b < pool.length; b++) {
        const barber = pool[b] as CartBarberDay;
        barberIds.push(barber.barberId);
        barbers.push({
          barberId: barber.barberId,
          windows: RosterSystem.intervalsOf(barber.windows, query.day),
          busy: barber.busy,
          blocks: [],
        });
      }
      const lines = BookingCartSystem.toAvailabilityLines(
        query.cart,
        query.services,
        barberIds,
      );
      const result = AvailabilitySystem.availableStarts(
        {
          lines,
          barbers,
          policy: query.policy,
          notBeforeMs: query.notBeforeMs,
          riders,
          withinMs: query.withinMs,
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
  partySeats(party: Party): readonly string[] {
    const keys = Party.seatKeys(party);
    const values: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      values.push(CartLine.seatKeyValue(keys[i] as SeatKey));
    }
    return values;
  },

  /**
   * The first person booking nothing, in party order, or `null` when
   * everyone holds something (`firstSeatWithoutService`,
   * `booking-flow.ts:347`) — ordered because the caller NAMES them.
   */
  firstSeatWithoutService(party: Party, cart: BookingCart): string | null {
    const seats = BookingCartSystem.partySeats(party);
    for (let i = 0; i < seats.length; i++) {
      const seatKey = seats[i] as string;
      if (BookingCart.linesFor(cart, seatKey).length === 0) return seatKey;
    }
    return null;
  },

  /**
   * The selection as the commit request wants it (`toCommitSeats`,
   * `booking-flow.store.ts:777-847`): one entry per assignment, in order,
   * carrying no price and no duration. A guest travels as their LABEL plus
   * their seat key. `null` when an assignment names a line the cart no longer
   * holds, or a seat that is neither the booker's nor a guest's — the bag
   * changed after the schedule step, and the server would refuse for a
   * reason the user cannot act on.
   */
  toCommitSeats(
    cart: BookingCart,
    party: Party,
    assignments: readonly SeatAssignment[],
  ): readonly CommitSeatRequest[] | null {
    const seats: CommitSeatRequest[] = [];
    for (let a = 0; a < assignments.length; a++) {
      const assignment = assignments[a] as SeatAssignment;
      let found: CartLine | null = null;
      for (let s = 0; s < cart.seats.length && found === null; s++) {
        const lines = (cart.seats[s] as BookingCart.SeatLines).lines;
        for (let k = 0; k < lines.length; k++) {
          if ((lines[k] as CartLine).lineId === assignment.lineId) {
            found = lines[k] as CartLine;
            break;
          }
        }
      }
      if (found === null) return null;
      let subject: CommitSubject;
      if (found.seatKey === SELF_KEY) {
        subject = { kind: CommitSubjectKind.Self };
      } else {
        const guest = guestOf(party, found.seatKey);
        if (guest === null) return null;
        subject = {
          kind: CommitSubjectKind.Guest,
          label: guest.label,
          guestKey: found.seatKey,
        };
      }
      seats.push({
        lineId: assignment.lineId,
        serviceId: found.serviceId,
        variantId: found.variantId,
        barberId: assignment.barberId,
        barberPref: BarberPref.fromBarberId(found.barberId).kind,
        startMs: assignment.timeInterval.startMs,
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
   * before any claim — the visit's own `self` account seat, which an
   * owner-scoped read can only have been. `null` when neither names anyone.
   */
  readerOf(
    seats: readonly PrefillSeat[],
    partyOwner: UserId | null,
  ): UserId | null {
    if (partyOwner !== null) return partyOwner;
    for (let i = 0; i < seats.length; i++) {
      const subject = (seats[i] as PrefillSeat).subject;
      if (
        subject.kind === SeatSubjectKind.Account &&
        subject.relationship === SeatRelationship.Self
      ) {
        return subject.userId;
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
   * (`as_guests`) and is left to the server on a move (`carried_by_server`).
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
    const seatKeys: string[] = [];
    const buckets: CartLine[][] = [];
    const storedLabels: (string | null)[] = [];
    let sequence = 1;
    let guestOrdinal = 0;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as PrefillSeat;
      const subject = seat.subject;
      // `isMovableByBooker` reads the seat's subject only — the one rule the
      // server decides a move by.
      const theBookers = Seat.isMovableByBooker(seat as Seat, reader);
      if (!theBookers && companions === PrefillCompanions.CarriedByServer) {
        continue;
      }
      const isSelf = theBookers && subject.kind === SeatSubjectKind.Account;
      const person = isSelf
        ? SELF_KEY
        : subject.kind === SeatSubjectKind.Anonymous
          ? `label:${subject.label}`
          : `account:${subject.userId}`;
      let at = persons.indexOf(person);
      if (at === -1) {
        at = persons.length;
        persons.push(person);
        seatKeys.push(isSelf ? SELF_KEY : `${GUEST_PREFIX}${guestOrdinal++}`);
        buckets.push([]);
        storedLabels.push(
          !isSelf && subject.kind === SeatSubjectKind.Anonymous
            ? subject.label
            : null,
        );
      }
      (buckets[at] as CartLine[]).push({
        lineId: `${LINE_PREFIX}${sequence++}`,
        seatKey: seatKeys[at] as string,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        locationId: null,
      });
    }
    if (buckets.length === 0) return null;

    const cart: BookingCart = {
      seats: readableSeats(
        buckets.map((lines, index) => ({
          seatKey: seatKeys[index] as string,
          lines,
        })),
      ),
      nextSequence: sequence,
    };

    // Stored names first, so a placeholder can step around every one of them.
    const taken: string[] = [];
    for (let i = 0; i < storedLabels.length; i++) {
      const stored = storedLabels[i] as string | null;
      if (stored !== null && !taken.includes(stored)) taken.push(stored);
    }
    const members: PartyMember[] = [PartyMember.owner()];
    let guestCount = 0;
    for (let i = 0; i < seatKeys.length; i++) {
      const seatKey = seatKeys[i] as string;
      if (seatKey === SELF_KEY) continue;
      guestCount++;
      let raw = storedLabels[i] as string | null;
      if (raw === null) {
        raw = BookingCartSystem.firstUnusedLabel(taken, guestLabel, 1);
        taken.push(raw);
      }
      const label = SeatLabel.parse(raw);
      if (!label.ok) return null;
      members.push(PartyMember.guest(seatKey, label.value));
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
    for (let i = 0; i < cart.seats.length; i++) {
      const seatKey = (cart.seats[i] as BookingCart.SeatLines).seatKey;
      if (seatKey === SELF_KEY) continue;
      const raw = BookingCartSystem.firstUnusedLabel(taken, guestLabel, 1);
      taken.push(raw);
      const label = SeatLabel.parse(raw);
      if (!label.ok) return null;
      members.push(PartyMember.guest(seatKey, label.value));
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
   * - the flexible declaration loses the days before `todayDayKey` (a review
   *   carries none), and the picked day is dropped once it has gone by;
   * - anything else resumes on SERVICES. A terminal state is never persisted
   *   and resumes on services too.
   */
  restore(draft: CartDraft, todayDayKey: DayKey): CartDraft {
    const state = draft.state;
    if (state.kind === BookingFlowStep.Location) {
      return { state, selectedDayKey: draft.selectedDayKey };
    }
    if (
      state.kind === BookingFlowStep.Confirmed ||
      state.kind === BookingFlowStep.Waitlisted
    ) {
      const party =
        state.kind === BookingFlowStep.Confirmed
          ? state.confirmation.party
          : state.summary.party;
      const cart =
        state.kind === BookingFlowStep.Confirmed
          ? state.confirmation.cart
          : state.summary.cart;
      const locationId =
        state.kind === BookingFlowStep.Confirmed
          ? state.confirmation.selection.locationId
          : state.summary.locationId;
      return {
        state: { kind: BookingFlowStep.Services, party, cart, locationId },
        selectedDayKey: draft.selectedDayKey,
      };
    }
    const locationId =
      state.kind === BookingFlowStep.Review
        ? state.selection.locationId
        : state.locationId;
    const resumable =
      (state.kind === BookingFlowStep.Schedule ||
        state.kind === BookingFlowStep.Review) &&
      !BookingCart.isEmpty(state.cart) &&
      BookingCartSystem.firstSeatWithoutService(state.party, state.cart) ===
        null &&
      Party.sharedLabel(state.party) === null;
    if (!resumable) {
      return {
        state: {
          kind: BookingFlowStep.Services,
          party: state.party,
          cart: state.cart,
          locationId,
        },
        selectedDayKey: draft.selectedDayKey,
      };
    }
    const declared =
      state.kind === BookingFlowStep.Schedule
        ? state.when
        : FlexibleWhen.empty();
    const kept: DayWindows[] = [];
    for (let i = 0; i < declared.days.length; i++) {
      const day = declared.days[i] as DayWindows;
      if (day.dayKey >= todayDayKey) kept.push(day);
    }
    return {
      state: {
        kind: BookingFlowStep.Schedule,
        party: state.party,
        cart: state.cart,
        locationId,
        when: kept.length === declared.days.length ? declared : { days: kept },
      },
      selectedDayKey:
        draft.selectedDayKey !== null && draft.selectedDayKey < todayDayKey
          ? null
          : draft.selectedDayKey,
    };
  },
} as const;
