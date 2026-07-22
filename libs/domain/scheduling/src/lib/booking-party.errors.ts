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

/** Errors `BookingParty.create`/`reconstitute` can produce. */
export type BookingPartyError =
  | AccountsEmptyIdError
  | EmptyIdError
  | SeatLabelError
  | InvalidGuestSequenceError;

/** Errors `BookingParty.removeGuest` can produce. */
export type BookingPartyRemoveGuestError = GuestNotFoundError;
