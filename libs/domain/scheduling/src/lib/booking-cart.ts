import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import {
  BarberId as BarberKey,
  BookingCart as CartData,
  BookingCartSystem,
  type CartLine as LineData,
  CartLineId as LineKey,
  SchedulingErrorCode,
  type SchedulingError,
  SeatKeyText,
  ServiceId as ServiceKey,
  ServiceVariantId as VariantKey,
  defect,
} from '@creativo/ecs-core';
import { BarberPref } from './barber-pref';
import {
  CartLineNotFoundError,
  DuplicateServiceForSeatError,
  InvalidCartLineSequenceError,
} from './booking-cart.errors';
import { GuestId } from './ids';

/*
 * THIN SHIM (ECS migration Phase 2). The cart's operations are the
 * `BookingCart` component of `@creativo/ecs-core`; the forgiving restore is
 * `BookingCartSystem.salvage`. This file keeps the legacy class API (class
 * ids, `Result` classes) for its callers and only converts.
 */

/**
 * WHICH member of the party a cart line belongs to. `self` is the booker's
 * own seat and always exists; guests are the roster `BookingParty` owns.
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
    return seatKeyValue(a) === seatKeyValue(b);
  },
} as const;

/** The cart's map key for a seat — `'self'` or `'guest-3'`. */
export function seatKeyValue(key: SeatKey): string {
  return key.kind === 'self' ? 'self' : key.guestId.value;
}

/**
 * Identifies one line within the cart — minted from the cart's monotonic
 * counter (`line-<n>`), never from a position.
 */
export class CartLineId extends Id<'CartLine'> {
  private constructor(value: string) {
    super(value);
  }

  /** Mint from the cart's monotonic counter — never from a position. */
  static fromSequence(seq: number): CartLineId {
    return new CartLineId(`line-${seq}`);
  }

  /** Rebuild an id the cart itself minted earlier (draft restore). */
  static of(value: string): CartLineId {
    return new CartLineId(value);
  }
}

/** One thing one person is booking: a service, its variant, who should do it. */
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

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** The legacy line each ECS line struct stands for — identity kept across carts. */
const LEGACY_LINES = new WeakMap<LineData, CartLine>();

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    defect('unreachable: a cart line id the cart itself checked');
  }
  return result.value;
}

function toLegacyLine(line: LineData): CartLine {
  const known = LEGACY_LINES.get(line);
  if (known !== undefined) return known;
  const made: CartLine = {
    id: CartLineId.of(line.lineId),
    serviceId: must(ServiceId.create(line.serviceId)),
    variantId:
      line.variantId === null
        ? null
        : must(ServiceVariantId.create(line.variantId)),
    barberPref:
      line.barberId === null
        ? BarberPref.any()
        : BarberPref.specific(must(BarberId.create(line.barberId))),
  };
  LEGACY_LINES.set(line, made);
  return made;
}

function toNewLine(line: NewCartLine): CartData.NewLine {
  return {
    serviceId: ServiceKey.of(line.serviceId.value),
    variantId:
      line.variantId === null ? null : VariantKey.of(line.variantId.value),
    barberId:
      line.barberPref.kind === 'specific'
        ? BarberKey.of(line.barberPref.barberId.value)
        : null,
    locationId: null,
  };
}

function toData(props: ReconstituteBookingCartProps): CartData {
  return {
    cartSeats: props.seats.map((seat) => {
      const seatKey = SeatKeyText.of(seat.seatKey);
      return {
        seatKey,
        lines: seat.lines.map((raw): LineData => ({
          lineId: LineKey.of(raw.id),
          seatKey,
          serviceId: ServiceKey.of(raw.serviceId),
          variantId:
            raw.variantId === null ? null : VariantKey.of(raw.variantId),
          barberId: raw.barberId === null ? null : BarberKey.of(raw.barberId),
          locationId: null,
        })),
      };
    }),
    cartNextSequence: props.nextSequence,
  };
}

/** The cart's text key for a legacy seat key. */
function seatTextOf(key: SeatKey): SeatKeyText {
  return SeatKeyText.of(seatKeyValue(key));
}

function lineIn(
  data: CartData,
  seatKey: SeatKeyText,
  lineId: string,
): LineData | null {
  return (
    CartData.linesFor(data, seatKey).find((line) => line.lineId === lineId) ??
    null
  );
}

function toLegacyNotFound(error: SchedulingError): CartLineNotFoundError {
  return error.errorCode === SchedulingErrorCode.CartLineNotFound
    ? new CartLineNotFoundError(error.seatKey, error.lineId)
    : new CartLineNotFoundError('', '');
}

/**
 * The party's whole selection: per-seat lines, keyed by `seatKeyValue`.
 * Immutable: every operation returns a new cart. Delegates to the ECS
 * `BookingCart` component.
 */
export class BookingCart {
  /** The legacy view of the seats, built once per cart on first read. */
  private legacy: ReadonlyMap<string, readonly CartLine[]> | null = null;

  private constructor(private readonly data: CartData) {}

  static empty(): BookingCart {
    return new BookingCart(CartData.empty());
  }

  static reconstitute(
    props: ReconstituteBookingCartProps,
  ): Result<BookingCart, InvalidCartLineSequenceError> {
    const salvaged = BookingCartSystem.salvage(toData(props));
    if (!salvaged.ok) {
      return fail(new InvalidCartLineSequenceError(props.nextSequence));
    }
    return ok(new BookingCart(salvaged.value));
  }

  private seats(): ReadonlyMap<string, readonly CartLine[]> {
    if (this.legacy === null) {
      this.legacy = new Map(
        this.data.cartSeats.map((seat) => [
          seat.seatKey,
          seat.lines.map(toLegacyLine),
        ]),
      );
    }
    return this.legacy;
  }

  /** The counter's next value — persisted so a reload cannot reuse an id. */
  get nextLineSequence(): number {
    return this.data.cartNextSequence;
  }

  linesFor(key: SeatKey): readonly CartLine[] {
    return this.seats().get(seatKeyValue(key)) ?? [];
  }

  /** Seats that actually hold something, in the order they first did. */
  entries(): readonly (readonly [string, readonly CartLine[]])[] {
    return [...this.seats().entries()];
  }

  /** The barbers of `pool`, in `pool`'s order, that some line would accept. */
  acceptedBarbers(pool: readonly BarberId[]): readonly BarberId[] {
    const accepted = CartData.acceptedBarbers(
      this.data,
      pool.map((barberId) => BarberKey.of(barberId.value)),
    );
    return pool.filter((barberId) =>
      accepted.includes(BarberKey.of(barberId.value)),
    );
  }

  isEmpty(): boolean {
    return CartData.isEmpty(this.data);
  }

  lineCount(): number {
    return CartData.lineCount(this.data);
  }

  lineCountFor(key: SeatKey): number {
    return CartData.linesFor(this.data, seatTextOf(key)).length;
  }

  /** Add a line to one seat; REFUSES a service that seat already has. */
  addLine(
    key: SeatKey,
    line: NewCartLine,
  ): Result<BookingCart, DuplicateServiceForSeatError> {
    const seatKey = seatTextOf(key);
    const added = CartData.addLine(this.data, seatKey, toNewLine(line));
    if (!added.ok) {
      return fail(
        new DuplicateServiceForSeatError(seatKey, line.serviceId.value),
      );
    }
    const fresh = CartData.linesFor(added.value, seatKey).at(-1);
    if (fresh !== undefined) {
      LEGACY_LINES.set(fresh, {
        ...line,
        id: CartLineId.fromSequence(this.data.cartNextSequence),
      });
    }
    return ok(new BookingCart(added.value));
  }

  /** Does this seat already hold `serviceId`? What the catalog card reads. */
  hasService(key: SeatKey, serviceId: ServiceId): boolean {
    return CartData.hasService(
      this.data,
      seatTextOf(key),
      ServiceKey.of(serviceId.value),
    );
  }

  removeLine(
    key: SeatKey,
    lineId: CartLineId,
  ): Result<BookingCart, CartLineNotFoundError> {
    const removed = CartData.removeLine(
      this.data,
      seatTextOf(key),
      LineKey.of(lineId.value),
    );
    return removed.ok
      ? ok(new BookingCart(removed.value))
      : fail(toLegacyNotFound(removed.error));
  }

  setVariant(
    key: SeatKey,
    lineId: CartLineId,
    variantId: ServiceVariantId | null,
  ): Result<BookingCart, CartLineNotFoundError> {
    return this.replaced(
      key,
      lineId,
      (data, seatKey) =>
        CartData.setVariant(
          data,
          seatKey,
          LineKey.of(lineId.value),
          variantId === null ? null : VariantKey.of(variantId.value),
        ),
      (line) => ({ ...line, variantId }),
    );
  }

  setBarberPref(
    key: SeatKey,
    lineId: CartLineId,
    barberPref: BarberPref,
  ): Result<BookingCart, CartLineNotFoundError> {
    return this.replaced(
      key,
      lineId,
      (data, seatKey) =>
        CartData.setBarber(
          data,
          seatKey,
          LineKey.of(lineId.value),
          barberPref.kind === 'specific'
            ? BarberKey.of(barberPref.barberId.value)
            : null,
        ),
      (line) => ({ ...line, barberPref }),
    );
  }

  /** Forget everything a seat holds — the counter is never touched. */
  dropSeat(key: SeatKey): BookingCart {
    const dropped = CartData.dropSeat(this.data, seatTextOf(key));
    return dropped === this.data ? this : new BookingCart(dropped);
  }

  /** Run one ECS replace and keep the legacy line's other parts, as the class did. */
  private replaced(
    key: SeatKey,
    lineId: CartLineId,
    run: (
      data: CartData,
      seatKey: SeatKeyText,
    ) => ReturnType<typeof CartData.setVariant>,
    patch: (line: CartLine) => CartLine,
  ): Result<BookingCart, CartLineNotFoundError> {
    const seatKey = seatTextOf(key);
    const before = lineIn(this.data, seatKey, lineId.value);
    const result = run(this.data, seatKey);
    if (!result.ok) return fail(toLegacyNotFound(result.error));
    const after = lineIn(result.value, seatKey, lineId.value);
    if (before !== null && after !== null) {
      LEGACY_LINES.set(after, patch(toLegacyLine(before)));
    }
    return ok(new BookingCart(result.value));
  }
}
