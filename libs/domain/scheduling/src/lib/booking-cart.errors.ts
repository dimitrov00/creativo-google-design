import { DomainError } from '@creativo/domain/kernel';

export class CartLineNotFoundError extends DomainError {
  override readonly code = 'scheduling.booking_cart.line_not_found' as const;
  constructor(
    public readonly seatKey: string,
    public readonly lineId: string,
  ) {
    super(`No cart line "${lineId}" for seat "${seatKey}"`, {
      seatKey,
      lineId,
    });
  }
}

/**
 * The same service, twice, for one person.
 *
 * Nobody has two haircuts in one visit. The party is what makes a second
 * haircut expressible — it belongs to a different SEAT — so a duplicate on one
 * seat is always either a double tap or a misunderstanding of the model, and
 * silently allowing it would double the price and the chair time.
 */
export class DuplicateServiceForSeatError extends DomainError {
  override readonly code = 'scheduling.booking_cart.duplicate_service' as const;
  constructor(
    public readonly seatKey: string,
    public readonly serviceId: string,
  ) {
    super(`Seat "${seatKey}" already has service "${serviceId}"`, {
      seatKey,
      serviceId,
    });
  }
}

/**
 * Reconstitution-only guard, the `InvalidGuestSequenceError` twin: a corrupt
 * persisted line counter would reopen the §7.7 id-resurrection hazard this
 * cart mints ids to avoid, so it is rejected rather than coerced.
 */
export class InvalidCartLineSequenceError extends DomainError {
  override readonly code =
    'scheduling.booking_cart.invalid_line_sequence' as const;
  constructor(public readonly value: number) {
    super(
      `Cart line sequence counter must be a non-negative integer, got ${value}`,
      {
        value,
      },
    );
  }
}

export type BookingCartError =
  | CartLineNotFoundError
  | DuplicateServiceForSeatError
  | InvalidCartLineSequenceError;
