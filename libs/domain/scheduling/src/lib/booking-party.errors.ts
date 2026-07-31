import { DomainError } from '@creativo/domain/kernel';
import type { EmptyIdError as AccountsEmptyIdError } from '@creativo/domain/accounts';
import type { EmptyIdError } from './ids.errors';
import type { SeatLabelError } from './seat-label.errors';

export class GuestNotFoundError extends DomainError {
  override readonly code = 'scheduling.booking_party.guest_not_found' as const;
  constructor(public readonly guestId: string) {
    super(`No guest with id "${guestId}" on this booking party`, { guestId });
  }
}

/**
 * Reconstitution-only guard: the persisted monotonic guest-sequence counter
 * must be a sane non-negative integer. A corrupt/negative value here would
 * risk exactly the id-resurrection hazard §7.7 exists to prevent, so it is
 * rejected rather than silently coerced.
 */
export class InvalidGuestSequenceError extends DomainError {
  override readonly code =
    'scheduling.booking_party.invalid_guest_sequence' as const;
  constructor(public readonly value: number) {
    super(
      `Guest sequence counter must be a non-negative integer, got ${value}`,
      { value },
    );
  }
}

/**
 * A party assembled anonymously reached the one operation that needs a real
 * owner: committing the booking. Raised by `CreateBookingUseCase`, never by
 * the party itself — being unclaimed is a legitimate state everywhere else
 * in the flow (see `BookingParty.claim`).
 */
export class BookingPartyUnclaimedError extends DomainError {
  override readonly code = 'scheduling.booking_party.unclaimed' as const;
  constructor() {
    super('This booking party has no owner yet — sign in to confirm');
  }
}

/** Errors `BookingParty.create`/`reconstitute` can produce. */
export type BookingPartyError =
  | AccountsEmptyIdError
  | EmptyIdError
  | SeatLabelError
  | InvalidGuestSequenceError;

/** Errors `BookingParty.removeGuest` can produce. */
export type BookingPartyRemoveGuestError = GuestNotFoundError;
