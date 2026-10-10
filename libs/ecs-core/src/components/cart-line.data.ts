import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';
import type { ServiceVariantId } from './service-terms.data';

/** Which member of the party a cart seat belongs to — the ONLY source of these strings. */
export const SeatKeyKind = {
  /** The booker's own seat — always exists, whoever (if anyone) is signed in. */
  Self: 'self',
  /** An account the booker vouches for (carried by a staff edit or a move). */
  Companion: 'companion',
  /** A guest on the party's roster, by the guest id the party minted. */
  Guest: 'guest',
} as const;
export type SeatKeyKind = (typeof SeatKeyKind)[keyof typeof SeatKeyKind];

const SELF_VALUE = 'self';
const GUEST_PREFIX = 'guest-';
const COMPANION_PREFIX = 'companion-';

/**
 * WHICH member of the party a cart line belongs to (`booking-cart.ts:22`). A
 * union rather than `GuestId | null`, so the booker's seat is a named case.
 * Stored and keyed by its string value ({@link CartLine.seatKeyValue}):
 * `'self'`, the guest's own id (`'guest-3'`, minted from the party's
 * monotonic counter, so a removed guest's key is never reused) or
 * `'companion-<uid>'`.
 */
export type SeatKey = SeatKey.Self | SeatKey.Companion | SeatKey.Guest;

const SELF: SeatKey.Self = { kind: SeatKeyKind.Self };

export const SeatKey = {
  self(): SeatKey.Self {
    return SELF;
  },

  companion(userId: UserId): SeatKey.Companion {
    return { kind: SeatKeyKind.Companion, userId };
  },

  /** `guestId` is the party's minted id (`guest-<n>`). */
  guest(guestId: string): SeatKey.Guest {
    return { kind: SeatKeyKind.Guest, guestId };
  },

  /** A stored seat-key string back to its key, or `null` when it names no seat. */
  parse(raw: string): SeatKey | null {
    if (raw === SELF_VALUE) return SELF;
    if (raw.startsWith(GUEST_PREFIX) && raw.length > GUEST_PREFIX.length) {
      return SeatKey.guest(raw);
    }
    if (
      raw.startsWith(COMPANION_PREFIX) &&
      raw.length > COMPANION_PREFIX.length
    ) {
      return SeatKey.companion(UserId.of(raw.slice(COMPANION_PREFIX.length)));
    }
    return null;
  },

  equals(a: SeatKey, b: SeatKey): boolean {
    return CartLine.seatKeyValue(a) === CartLine.seatKeyValue(b);
  },
} as const;

export namespace SeatKey {
  export type Self = { readonly kind: typeof SeatKeyKind.Self };
  export type Companion = {
    readonly kind: typeof SeatKeyKind.Companion;
    readonly userId: UserId;
  };
  export type Guest = {
    readonly kind: typeof SeatKeyKind.Guest;
    readonly guestId: string;
  };
}

/**
 * One thing one person is booking (`booking-cart.ts:82`): a service, the
 * variant chosen within it (`null` only when the service declares none) and
 * who they would like to perform it — `barberId: null` is "anyone"
 * (`BarberPref.fromBarberId`). `locationId` is the shop the line was picked
 * for, `null` for "any shop" (the flow's and the request's own `locationId`
 * governs where it is searched). Terms are deliberately ABSENT: a price
 * depends on the barber the engine assigns; a snapshot reaches the seat only
 * at commit.
 *
 * `lineId` is minted from the cart's monotonic counter (`line-<n>`) — never
 * from a position, so add → remove → add never resurrects an id (§7.7).
 */
export type CartLine = {
  readonly lineId: string;
  readonly seatKey: string;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId | null;
  readonly locationId: LocationId | null;
};

const LINE_PREFIX = 'line-';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLine(raw: unknown, seatKey: string): raw is CartLine {
  if (raw === null || typeof raw !== 'object') return false;
  const line = raw as Readonly<Record<string, unknown>>;
  const nullableId = (value: unknown): boolean =>
    value === null || isNonEmptyString(value);
  return (
    isNonEmptyString(line['lineId']) &&
    line['seatKey'] === seatKey &&
    isNonEmptyString(line['serviceId']) &&
    nullableId(line['variantId']) &&
    nullableId(line['barberId']) &&
    nullableId(line['locationId'])
  );
}

export const CartLine = {
  /** The cart's key for a seat — `'self'`, `'guest-3'` or `'companion-<uid>'`. */
  seatKeyValue(key: SeatKey): string {
    switch (key.kind) {
      case SeatKeyKind.Self:
        return SELF_VALUE;
      case SeatKeyKind.Guest:
        return key.guestId;
      case SeatKeyKind.Companion:
        return `${COMPANION_PREFIX}${key.userId}`;
    }
  },

  /** The line id the counter value `sequence` mints — the only door. */
  lineIdOf(sequence: number): string {
    return `${LINE_PREFIX}${sequence}`;
  },
} as const;

/**
 * The party's whole selection: per-seat lines and the line counter — THE one
 * cart serialisation (`booking-cart.ts:100-106`), stored verbatim on a
 * waitlist request and persisted in the booking draft. Seats appear in the
 * order they were first given something to book; a seat with no line is not
 * listed. `nextSequence` never decreases: removing a line or dropping a seat
 * leaves it alone, so a reload cannot reuse an id either.
 */
export type BookingCart = {
  readonly seats: readonly BookingCart.SeatLines[];
  readonly nextSequence: number;
};

const EMPTY_CART: BookingCart = { seats: [], nextSequence: 0 };

function seatIndex(cart: BookingCart, seatKey: string): number {
  for (let i = 0; i < cart.seats.length; i++) {
    if ((cart.seats[i] as BookingCart.SeatLines).seatKey === seatKey) return i;
  }
  return -1;
}

/** `cart` with seat `at` holding `lines` — or dropped when `lines` is empty. */
function withSeatLines(
  cart: BookingCart,
  at: number,
  lines: readonly CartLine[],
  nextSequence: number,
): BookingCart {
  const seats: BookingCart.SeatLines[] = [];
  for (let i = 0; i < cart.seats.length; i++) {
    if (i !== at) seats.push(cart.seats[i] as BookingCart.SeatLines);
    else if (lines.length > 0) {
      seats.push({
        seatKey: (cart.seats[i] as BookingCart.SeatLines).seatKey,
        lines,
      });
    }
  }
  return { seats, nextSequence };
}

/**
 * Replace (or, with `null`, remove) the line `lineId` of seat `seatKey`;
 * refused when the seat does not hold it — never a silent success.
 */
function replaceLine(
  cart: BookingCart,
  seatKey: string,
  lineId: string,
  update: (line: CartLine) => CartLine | null,
): Result<BookingCart, SchedulingError> {
  const at = seatIndex(cart, seatKey);
  const seat = at === -1 ? null : (cart.seats[at] as BookingCart.SeatLines);
  if (seat !== null) {
    for (let i = 0; i < seat.lines.length; i++) {
      const line = seat.lines[i] as CartLine;
      if (line.lineId !== lineId) continue;
      const replacement = update(line);
      const lines: CartLine[] = [];
      for (let k = 0; k < seat.lines.length; k++) {
        if (k !== i) lines.push(seat.lines[k] as CartLine);
        else if (replacement !== null) lines.push(replacement);
      }
      return Result.ok(withSeatLines(cart, at, lines, cart.nextSequence));
    }
  }
  return Result.err(SchedulingError.cartLineNotFound(seatKey, lineId));
}

export const BookingCart = {
  empty(): BookingCart {
    return EMPTY_CART;
  },

  linesFor(cart: BookingCart, seatKey: string): readonly CartLine[] {
    const at = seatIndex(cart, seatKey);
    return at === -1 ? [] : (cart.seats[at] as BookingCart.SeatLines).lines;
  },

  lineCount(cart: BookingCart): number {
    let total = 0;
    for (let i = 0; i < cart.seats.length; i++) {
      total += (cart.seats[i] as BookingCart.SeatLines).lines.length;
    }
    return total;
  },

  isEmpty(cart: BookingCart): boolean {
    return BookingCart.lineCount(cart) === 0;
  },

  /** Does this seat already hold `serviceId`? What the catalogue card reads. */
  hasService(
    cart: BookingCart,
    seatKey: string,
    serviceId: ServiceId,
  ): boolean {
    const lines = BookingCart.linesFor(cart, seatKey);
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] as CartLine).serviceId === serviceId) return true;
    }
    return false;
  },

  /**
   * Add a line to one seat, minting its id from the counter (which always
   * advances). REFUSES a service the seat already has
   * (`scheduling.booking_cart.duplicate_service`): nobody has two haircuts in
   * one visit, and a second one belongs to another seat — so the UI can say
   * "already in the bag" instead of appearing to ignore the press.
   */
  addLine(
    cart: BookingCart,
    seatKey: string,
    line: BookingCart.NewLine,
  ): Result<BookingCart, SchedulingError> {
    if (BookingCart.hasService(cart, seatKey, line.serviceId)) {
      return Result.err(
        SchedulingError.cartDuplicateService(seatKey, line.serviceId),
      );
    }
    const added: CartLine = {
      lineId: CartLine.lineIdOf(cart.nextSequence),
      seatKey,
      serviceId: line.serviceId,
      variantId: line.variantId,
      barberId: line.barberId,
      locationId: line.locationId,
    };
    const at = seatIndex(cart, seatKey);
    const nextSequence = cart.nextSequence + 1;
    if (at === -1) {
      return Result.ok({
        seats: [...cart.seats, { seatKey, lines: [added] }],
        nextSequence,
      });
    }
    const lines = [...(cart.seats[at] as BookingCart.SeatLines).lines, added];
    return Result.ok(withSeatLines(cart, at, lines, nextSequence));
  },

  removeLine(
    cart: BookingCart,
    seatKey: string,
    lineId: string,
  ): Result<BookingCart, SchedulingError> {
    return replaceLine(cart, seatKey, lineId, () => null);
  },

  setVariant(
    cart: BookingCart,
    seatKey: string,
    lineId: string,
    variantId: ServiceVariantId | null,
  ): Result<BookingCart, SchedulingError> {
    return replaceLine(cart, seatKey, lineId, (line) => ({
      ...line,
      variantId,
    }));
  },

  /** Re-point a line to a barber, or back to anyone (`null`). */
  setBarber(
    cart: BookingCart,
    seatKey: string,
    lineId: string,
    barberId: BarberId | null,
  ): Result<BookingCart, SchedulingError> {
    return replaceLine(cart, seatKey, lineId, (line) => ({
      ...line,
      barberId,
    }));
  },

  /**
   * Forget everything a seat holds — called when its guest leaves the party.
   * Never touches `nextSequence`: the counter only grows (§7.7).
   */
  dropSeat(cart: BookingCart, seatKey: string): BookingCart {
    const at = seatIndex(cart, seatKey);
    return at === -1 ? cart : withSeatLines(cart, at, [], cart.nextSequence);
  },

  /**
   * The barbers of `pool`, in `pool`'s order, that some line would accept: a
   * line pinned to Ivan is served by nobody else, one "anyone" line accepts
   * the whole pool, an empty cart accepts nobody.
   */
  acceptedBarbers(
    cart: BookingCart,
    pool: readonly BarberId[],
  ): readonly BarberId[] {
    let anyone = false;
    const pinned: BarberId[] = [];
    for (let i = 0; i < cart.seats.length; i++) {
      const lines = (cart.seats[i] as BookingCart.SeatLines).lines;
      for (let k = 0; k < lines.length; k++) {
        const barberId = (lines[k] as CartLine).barberId;
        if (barberId === null) anyone = true;
        else if (!pinned.includes(barberId)) pinned.push(barberId);
      }
    }
    const accepted: BarberId[] = [];
    for (let i = 0; i < pool.length; i++) {
      const barberId = pool[i] as BarberId;
      if (anyone || pinned.includes(barberId)) accepted.push(barberId);
    }
    return accepted;
  },

  /**
   * The edge guard for a stored or persisted cart: a non-negative integer
   * counter, each seat listed once with at least one well-formed line, and
   * every line's `seatKey` its seat's own. A stale draft fails it and is
   * cleared rather than half-restored.
   */
  is(raw: unknown): raw is BookingCart {
    if (raw === null || typeof raw !== 'object') return false;
    const cart = raw as Readonly<Record<string, unknown>>;
    const sequence = cart['nextSequence'];
    if (
      typeof sequence !== 'number' ||
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      return false;
    }
    const seats = cart['seats'];
    if (!Array.isArray(seats)) return false;
    const keys: string[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat: unknown = seats[i];
      if (seat === null || typeof seat !== 'object') return false;
      const fields = seat as Readonly<Record<string, unknown>>;
      const seatKey = fields['seatKey'];
      const lines = fields['lines'];
      if (!isNonEmptyString(seatKey) || keys.includes(seatKey)) return false;
      if (!Array.isArray(lines) || lines.length === 0) return false;
      for (let k = 0; k < lines.length; k++) {
        if (!isLine(lines[k], seatKey)) return false;
      }
      keys.push(seatKey);
    }
    return true;
  },
} as const;

export namespace BookingCart {
  /** One seat's lines, in the order they were added. */
  export type SeatLines = {
    readonly seatKey: string;
    readonly lines: readonly CartLine[];
  };
  /** A line before the cart has given it an id and a seat. */
  export type NewLine = {
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly barberId: BarberId | null;
    readonly locationId: LocationId | null;
  };
}
