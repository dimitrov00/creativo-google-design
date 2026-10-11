import {
  type BarberId,
  CartLineId,
  GuestId,
  type LocationId,
  SeatKeyText,
  type ServiceId,
  type ServiceVariantId,
  UserId,
  Result,
  SchedulingError,
} from '@core/primitives';

/**
 * Which member of the party a cart seat belongs to — the ONLY source of
 * these strings, named after the field it types (`seatKeyRole`, N15).
 */
export const SeatKeyRole = {
  /** The booker's own seat — always exists, whoever (if anyone) is signed in. */
  Self: 'SELF',
  /** An account the booker vouches for (carried by a staff edit or a move). */
  Companion: 'COMPANION',
  /** A guest on the party's roster, by the guest id the party minted. */
  Guest: 'GUEST',
} as const;
export type SeatKeyRole = (typeof SeatKeyRole)[keyof typeof SeatKeyRole];

const SELF_TEXT = 'self';
const GUEST_PREFIX = 'guest-';
const COMPANION_PREFIX = 'companion-';

/**
 * WHICH member of the party a cart line belongs to (`booking-cart.ts:22`). A
 * union rather than `GuestId | null`, so the booker's seat is a named case.
 * Stored and keyed by its text form ({@link SeatKey.text}, a `SeatKeyText`):
 * `'self'`, the guest's own id (`'guest-3'`, minted from the party's
 * monotonic counter, so a removed guest's key is never reused) or
 * `'companion-<uid>'` — the text is unchanged by the flatten pass.
 */
export type SeatKey = SeatKey.Self | SeatKey.Companion | SeatKey.Guest;

const SELF: SeatKey.Self = { seatKeyRole: SeatKeyRole.Self };

export const SeatKey = {
  self(): SeatKey.Self {
    return SELF;
  },

  companion(companionUserId: UserId): SeatKey.Companion {
    return { seatKeyRole: SeatKeyRole.Companion, companionUserId };
  },

  /** `guestId` is the party's minted id (`guest-<n>`). */
  guest(guestId: GuestId): SeatKey.Guest {
    return { seatKeyRole: SeatKeyRole.Guest, guestId };
  },

  /** The cart's key for a seat — `'self'`, `'guest-3'` or `'companion-<uid>'`. */
  text(key: SeatKey): SeatKeyText {
    switch (key.seatKeyRole) {
      case SeatKeyRole.Self:
        return SeatKeyText.of(SELF_TEXT);
      case SeatKeyRole.Guest:
        return SeatKeyText.of(key.guestId);
      case SeatKeyRole.Companion:
        return SeatKeyText.of(`${COMPANION_PREFIX}${key.companionUserId}`);
    }
  },

  /** A stored seat-key text back to its key, or `null` when it names no seat. */
  parse(raw: string): SeatKey | null {
    if (raw === SELF_TEXT) return SELF;
    if (raw.startsWith(GUEST_PREFIX) && raw.length > GUEST_PREFIX.length) {
      return SeatKey.guest(GuestId.of(raw));
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
    return SeatKey.text(a) === SeatKey.text(b);
  },
} as const;

export namespace SeatKey {
  export type Self = { readonly seatKeyRole: typeof SeatKeyRole.Self };
  export type Companion = {
    readonly seatKeyRole: typeof SeatKeyRole.Companion;
    readonly companionUserId: UserId;
  };
  export type Guest = {
    readonly seatKeyRole: typeof SeatKeyRole.Guest;
    readonly guestId: GuestId;
  };
}

/**
 * One thing one person is booking (`booking-cart.ts:82`) — an element of a
 * {@link CartSeatLines}: a service, the variant chosen within it (`null`
 * only when the service declares none) and who they would like to perform it
 * — `barberId: null` is "anyone" (`BarberPref.fromBarberId`). `locationId` is
 * the shop the line was picked for, `null` for "any shop" (the flow's and the
 * request's own `locationId` governs where it is searched). Terms are
 * deliberately ABSENT: a price depends on the barber the engine assigns; a
 * snapshot reaches the seat only at commit.
 *
 * `lineId` is minted from the cart's monotonic counter
 * (`CartLineId.forSequence`, `line-<n>`) — never from a position, so
 * add → remove → add never resurrects an id (§7.7).
 */
export type CartLine = {
  readonly lineId: CartLineId;
  readonly seatKey: SeatKeyText;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId | null;
  readonly locationId: LocationId | null;
};

/** One seat's lines, in the order they were added — an element of `cartSeats`. */
export type CartSeatLines = {
  readonly seatKey: SeatKeyText;
  readonly lines: readonly CartLine[];
};

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

/**
 * The party's whole selection: per-seat lines and the line counter — THE one
 * cart serialisation (`booking-cart.ts:100-106`), stored verbatim on a
 * waitlist request and persisted in the booking draft. A flat slice (Law 6):
 * `WaitlistRequest` intersects it, so its fields are named for their domain
 * (`cartSeats`, `cartNextSequence`). Seats appear in the order they were
 * first given something to book; a seat with no line is not listed.
 * `cartNextSequence` never decreases: removing a line or dropping a seat
 * leaves it alone, so a reload cannot reuse an id either.
 */
export type BookingCart = {
  readonly cartSeats: readonly CartSeatLines[];
  readonly cartNextSequence: number;
};

const EMPTY_CART: BookingCart = { cartSeats: [], cartNextSequence: 0 };

function seatIndex(cart: BookingCart, seatKey: SeatKeyText): number {
  for (let i = 0; i < cart.cartSeats.length; i++) {
    if ((cart.cartSeats[i] as CartSeatLines).seatKey === seatKey) return i;
  }
  return -1;
}

/** `cart` with seat `at` holding `lines` — or dropped when `lines` is empty. */
function withSeatLines(
  cart: BookingCart,
  at: number,
  lines: readonly CartLine[],
  cartNextSequence: number,
): BookingCart {
  const cartSeats: CartSeatLines[] = [];
  for (let i = 0; i < cart.cartSeats.length; i++) {
    if (i !== at) cartSeats.push(cart.cartSeats[i] as CartSeatLines);
    else if (lines.length > 0) {
      cartSeats.push({
        seatKey: (cart.cartSeats[i] as CartSeatLines).seatKey,
        lines,
      });
    }
  }
  return { cartSeats, cartNextSequence };
}

/**
 * Replace (or, with `null`, remove) the line `lineId` of seat `seatKey`;
 * refused when the seat does not hold it — never a silent success.
 */
function replaceLine(
  cart: BookingCart,
  seatKey: SeatKeyText,
  lineId: CartLineId,
  update: (line: CartLine) => CartLine | null,
): Result<BookingCart, SchedulingError> {
  const at = seatIndex(cart, seatKey);
  const seat = at === -1 ? null : (cart.cartSeats[at] as CartSeatLines);
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
      return Result.ok(withSeatLines(cart, at, lines, cart.cartNextSequence));
    }
  }
  return Result.err(SchedulingError.cartLineNotFound(seatKey, lineId));
}

export const BookingCart = {
  empty(): BookingCart {
    return EMPTY_CART;
  },

  linesFor(cart: BookingCart, seatKey: SeatKeyText): readonly CartLine[] {
    const at = seatIndex(cart, seatKey);
    return at === -1 ? [] : (cart.cartSeats[at] as CartSeatLines).lines;
  },

  lineCount(cart: BookingCart): number {
    let total = 0;
    for (let i = 0; i < cart.cartSeats.length; i++) {
      total += (cart.cartSeats[i] as CartSeatLines).lines.length;
    }
    return total;
  },

  isEmpty(cart: BookingCart): boolean {
    return BookingCart.lineCount(cart) === 0;
  },

  /** Does this seat already hold `serviceId`? What the catalogue card reads. */
  hasService(
    cart: BookingCart,
    seatKey: SeatKeyText,
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
   * (`SCHEDULING_BOOKING_CART_DUPLICATE_SERVICE`): nobody has two haircuts in
   * one visit, and a second one belongs to another seat — so the UI can say
   * "already in the bag" instead of appearing to ignore the press.
   */
  addLine(
    cart: BookingCart,
    seatKey: SeatKeyText,
    line: BookingCart.NewLine,
  ): Result<BookingCart, SchedulingError> {
    if (BookingCart.hasService(cart, seatKey, line.serviceId)) {
      return Result.err(
        SchedulingError.cartDuplicateService(seatKey, line.serviceId),
      );
    }
    const added: CartLine = {
      lineId: CartLineId.forSequence(cart.cartNextSequence),
      seatKey,
      serviceId: line.serviceId,
      variantId: line.variantId,
      barberId: line.barberId,
      locationId: line.locationId,
    };
    const at = seatIndex(cart, seatKey);
    const cartNextSequence = cart.cartNextSequence + 1;
    if (at === -1) {
      return Result.ok({
        cartSeats: [...cart.cartSeats, { seatKey, lines: [added] }],
        cartNextSequence,
      });
    }
    const lines = [...(cart.cartSeats[at] as CartSeatLines).lines, added];
    return Result.ok(withSeatLines(cart, at, lines, cartNextSequence));
  },

  removeLine(
    cart: BookingCart,
    seatKey: SeatKeyText,
    lineId: CartLineId,
  ): Result<BookingCart, SchedulingError> {
    return replaceLine(cart, seatKey, lineId, () => null);
  },

  setVariant(
    cart: BookingCart,
    seatKey: SeatKeyText,
    lineId: CartLineId,
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
    seatKey: SeatKeyText,
    lineId: CartLineId,
    barberId: BarberId | null,
  ): Result<BookingCart, SchedulingError> {
    return replaceLine(cart, seatKey, lineId, (line) => ({
      ...line,
      barberId,
    }));
  },

  /**
   * Forget everything a seat holds — called when its guest leaves the party.
   * Never touches `cartNextSequence`: the counter only grows (§7.7).
   */
  dropSeat(cart: BookingCart, seatKey: SeatKeyText): BookingCart {
    const at = seatIndex(cart, seatKey);
    return at === -1
      ? cart
      : withSeatLines(cart, at, [], cart.cartNextSequence);
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
    for (let i = 0; i < cart.cartSeats.length; i++) {
      const lines = (cart.cartSeats[i] as CartSeatLines).lines;
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
    const sequence = cart['cartNextSequence'];
    if (
      typeof sequence !== 'number' ||
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      return false;
    }
    const seats = cart['cartSeats'];
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
  /** A line before the cart has given it an id and a seat. */
  export type NewLine = {
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly barberId: BarberId | null;
    readonly locationId: LocationId | null;
  };
}
