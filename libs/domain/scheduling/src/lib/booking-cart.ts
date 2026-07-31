import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { BarberPref } from './barber-pref';
import {
  CartLineNotFoundError,
  DuplicateServiceForSeatError,
  InvalidCartLineSequenceError,
} from './booking-cart.errors';
import { GuestId } from './ids';

/**
 * WHICH member of the party a cart line belongs to. `self` is the booker's
 * own seat and always exists; guests are the roster `BookingParty` owns.
 *
 * A union rather than `GuestId | null` so the booker's seat is a named case
 * the compiler forces every site to handle, not an absence.
 */
export type SeatKey =
  | { readonly kind: 'self' }
  | { readonly kind: 'guest'; readonly guestId: GuestId };

export const SeatKey = {
  self(): SeatKey {
    return { kind: 'self' };
  },
  guest(guestId: GuestId): SeatKey {
    return { kind: 'guest', guestId };
  },
  equals(a: SeatKey, b: SeatKey): boolean {
    if (a.kind === 'self' || b.kind === 'self') return a.kind === b.kind;
    return a.guestId.equals(b.guestId);
  },
} as const;

/**
 * The cart's map key for a seat — `'self'` or `'guest-3'`. Derived from the
 * `GuestId` (itself monotonic), so it inherits §7.7's no-resurrection
 * guarantee rather than adding a second identity scheme.
 */
export function seatKeyValue(key: SeatKey): string {
  return key.kind === 'self' ? 'self' : key.guestId.value;
}

/**
 * Identifies one line within the cart. Like `GuestId`, deliberately has NO
 * `generate()`: lines are removable, and minting from `array.length` is
 * exactly the §7.7 resurrection bug. `fromSequence` fed by the cart's own
 * never-decremented counter is the only door.
 */
export class CartLineId extends Id<'CartLine'> {
  private constructor(value: string) {
    super(value);
  }

  /** Mint from the cart's monotonic counter — never from a position. */
  static fromSequence(seq: number): CartLineId {
    return new CartLineId(`line-${seq}`);
  }

  /**
   * Rebuild an id the cart itself minted earlier (draft restore, a template
   * round-trip). A trusted assembler, not a validating factory: the caller
   * has already established the string is non-empty, and there is no
   * further shape to check that `fromSequence` guarantees.
   */
  static of(value: string): CartLineId {
    return new CartLineId(value);
  }
}

/**
 * One thing one person is booking: a service, the variant chosen within it
 * (`null` only when the service declares none), and who they'd like to
 * perform it. Terms are deliberately ABSENT — a line's price depends on the
 * barber the availability engine ultimately assigns, so quoting is a
 * separate step and a snapshot only reaches `Seat` at commit time.
 */
export interface CartLine {
  readonly id: CartLineId;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberPref: BarberPref;
}

/** A line before the cart has given it an id. */
export type NewCartLine = Omit<CartLine, 'id'>;

export interface ReconstituteCartLineProps {
  readonly id: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  /** `null` is the `BarberPref.any` arm. */
  readonly barberId: string | null;
}

export interface ReconstituteBookingCartProps {
  readonly seats: readonly {
    readonly seatKey: string;
    readonly lines: readonly ReconstituteCartLineProps[];
  }[];
  readonly nextSequence: number;
}

/**
 * The party's whole selection: per-seat lines, keyed by `seatKeyValue`.
 *
 * A domain object rather than an application-layer bag because it carries
 * real invariants — monotonic line ids that survive removal, and no lines
 * stranded on a seat whose guest has left the party (`dropSeat`, which
 * `BookingFlow` calls on `remove_guest` so the two structures cannot drift).
 *
 * Immutable in the house style: every mutation returns a new cart, and
 * `Map` insertion order gives `entries()` a stable, meaningful sequence (the
 * order seats were first given something to book) without a sort key.
 */
export class BookingCart {
  private constructor(
    private readonly linesBySeat: ReadonlyMap<string, readonly CartLine[]>,
    private readonly nextSequence: number,
  ) {}

  static empty(): BookingCart {
    return new BookingCart(new Map(), 0);
  }

  static reconstitute(
    props: ReconstituteBookingCartProps,
  ): Result<BookingCart, InvalidCartLineSequenceError> {
    if (!Number.isInteger(props.nextSequence) || props.nextSequence < 0) {
      return fail(new InvalidCartLineSequenceError(props.nextSequence));
    }

    const linesBySeat = new Map<string, readonly CartLine[]>();
    for (const seat of props.seats) {
      const lines = seat.lines
        .map((raw) => BookingCart.lineFromPersistence(raw))
        .filter((line): line is CartLine => line !== null);
      if (lines.length > 0) linesBySeat.set(seat.seatKey, lines);
    }

    return ok(new BookingCart(linesBySeat, props.nextSequence));
  }

  /**
   * One persisted line, or `null` when any of its ids is malformed.
   *
   * A bad line is DROPPED rather than failing the whole restore: a draft is
   * a convenience, and losing one line beats discarding a party the user
   * spent minutes assembling. Everything is re-validated at commit anyway.
   * The persisted `id` is preserved verbatim — re-minting would break the
   * "add, remove, add ⇒ fresh id" guarantee across a reload.
   */
  private static lineFromPersistence(
    raw: ReconstituteCartLineProps,
  ): CartLine | null {
    if (raw.id.trim().length === 0) return null;

    const serviceIdResult = ServiceId.create(raw.serviceId);
    if (serviceIdResult.isFailure()) return null;

    let variantId: ServiceVariantId | null = null;
    if (raw.variantId !== null) {
      const variantIdResult = ServiceVariantId.create(raw.variantId);
      if (variantIdResult.isFailure()) return null;
      variantId = variantIdResult.value;
    }

    let barberPref = BarberPref.any();
    if (raw.barberId !== null) {
      const barberIdResult = BarberId.create(raw.barberId);
      if (barberIdResult.isFailure()) return null;
      barberPref = BarberPref.specific(barberIdResult.value);
    }

    return {
      id: CartLineId.of(raw.id),
      serviceId: serviceIdResult.value,
      variantId,
      barberPref,
    };
  }

  /** The counter's next value — persisted so a reload cannot reuse an id. */
  get nextLineSequence(): number {
    return this.nextSequence;
  }

  linesFor(key: SeatKey): readonly CartLine[] {
    return this.linesBySeat.get(seatKeyValue(key)) ?? [];
  }

  /** Seats that actually hold something, in the order they first did. */
  entries(): readonly (readonly [string, readonly CartLine[]])[] {
    return [...this.linesBySeat.entries()];
  }

  isEmpty(): boolean {
    return this.lineCount() === 0;
  }

  lineCount(): number {
    let total = 0;
    for (const lines of this.linesBySeat.values()) total += lines.length;
    return total;
  }

  lineCountFor(key: SeatKey): number {
    return this.linesFor(key).length;
  }

  /** Add a line — mints a fresh `CartLineId` from the counter, which only grows. */
  /**
   * Add a line to one seat.
   *
   * REFUSES a service that seat already has: nobody has two haircuts in one
   * visit, and the party is precisely what makes a second haircut expressible
   * — it belongs to a different seat. Allowing the duplicate would double both
   * the price and the chair time for what is almost always a double tap.
   *
   * Deliberately a `Result` rather than a silent no-op, so the UI can say
   * "already in the bag" instead of appearing to ignore the press.
   */
  addLine(
    key: SeatKey,
    line: NewCartLine,
  ): Result<BookingCart, DuplicateServiceForSeatError> {
    const seatKey = seatKeyValue(key);
    const existing = this.linesBySeat.get(seatKey) ?? [];
    if (existing.some((held) => held.serviceId.equals(line.serviceId))) {
      return fail(
        new DuplicateServiceForSeatError(seatKey, line.serviceId.value),
      );
    }

    const next = new Map(this.linesBySeat);
    next.set(seatKey, [
      ...existing,
      { ...line, id: CartLineId.fromSequence(this.nextSequence) },
    ]);
    return ok(new BookingCart(next, this.nextSequence + 1));
  }

  /** Does this seat already hold `serviceId`? What the catalog card reads. */
  hasService(key: SeatKey, serviceId: ServiceId): boolean {
    return (this.linesBySeat.get(seatKeyValue(key)) ?? []).some((line) =>
      line.serviceId.equals(serviceId),
    );
  }

  removeLine(
    key: SeatKey,
    lineId: CartLineId,
  ): Result<BookingCart, CartLineNotFoundError> {
    return this.replaceLine(key, lineId, () => null);
  }

  setVariant(
    key: SeatKey,
    lineId: CartLineId,
    variantId: ServiceVariantId | null,
  ): Result<BookingCart, CartLineNotFoundError> {
    return this.replaceLine(key, lineId, (line) => ({ ...line, variantId }));
  }

  setBarberPref(
    key: SeatKey,
    lineId: CartLineId,
    barberPref: BarberPref,
  ): Result<BookingCart, CartLineNotFoundError> {
    return this.replaceLine(key, lineId, (line) => ({ ...line, barberPref }));
  }

  /**
   * Forget everything a seat holds — called when its guest leaves the party.
   * Never touches `nextSequence`: the counter only grows (§7.7).
   */
  dropSeat(key: SeatKey): BookingCart {
    const seatKey = seatKeyValue(key);
    if (!this.linesBySeat.has(seatKey)) return this;
    const next = new Map(this.linesBySeat);
    next.delete(seatKey);
    return new BookingCart(next, this.nextSequence);
  }

  /** `null` from `update` removes the line; anything else replaces it. */
  private replaceLine(
    key: SeatKey,
    lineId: CartLineId,
    update: (line: CartLine) => CartLine | null,
  ): Result<BookingCart, CartLineNotFoundError> {
    const seatKey = seatKeyValue(key);
    const lines = this.linesBySeat.get(seatKey);
    const existing = lines?.find((line) => line.id.equals(lineId));
    if (!lines || !existing) {
      return fail(new CartLineNotFoundError(seatKey, lineId.value));
    }

    const replacement = update(existing);
    const nextLines = replacement
      ? lines.map((line) => (line.id.equals(lineId) ? replacement : line))
      : lines.filter((line) => !line.id.equals(lineId));

    const next = new Map(this.linesBySeat);
    if (nextLines.length > 0) {
      next.set(seatKey, nextLines);
    } else {
      next.delete(seatKey);
    }
    return ok(new BookingCart(next, this.nextSequence));
  }
}
