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

/**
 * Another guest of the party already answers to this label.
 *
 * A guest is nothing but their label until they have an account — to the
 * shop, and to the server, which counts people by it (`personKey`). Two
 * guests under one label would travel as ONE person: counted once, their
 * services judged together, one of them in two chairs. So a label another
 * guest holds is refused at the source, when it is typed or added, rather
 * than discovered when the booking is sent.
 *
 * Exact, as the label is stored (`SeatLabel`, trimmed): the same comparison
 * the server makes, so the party refuses precisely what would be merged.
 */
export class DuplicateGuestLabelError extends DomainError {
  override readonly code = 'scheduling.booking_party.duplicate_label' as const;
  constructor(public readonly label: string) {
    super(`Another guest is already called "${label}"`, { label });
  }
}

/** Why a label cannot be a guest's: not a label at all, or someone else's. */
export type BookingPartyLabelError = SeatLabelError | DuplicateGuestLabelError;

/** Errors `BookingParty.create`/`reconstitute` can produce. */
export type BookingPartyError =
  | AccountsEmptyIdError
  | EmptyIdError
  | SeatLabelError
  | InvalidGuestSequenceError;

/** Errors `BookingParty.removeGuest` can produce. */
export type BookingPartyRemoveGuestError = GuestNotFoundError;
