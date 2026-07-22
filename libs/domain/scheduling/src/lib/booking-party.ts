import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { GuestId } from './ids';
import {
  BookingPartyError,
  BookingPartyRemoveGuestError,
  GuestNotFoundError,
  InvalidGuestSequenceError,
} from './booking-party.errors';
import { SeatLabel } from './seat-label';

export interface BookingPartyGuest {
  readonly id: GuestId;
  readonly label: SeatLabel;
}

export interface CreateBookingPartyProps {
  ownerId: string;
}

export interface ReconstituteBookingPartyGuestProps {
  id: string;
  label: string;
}

export interface ReconstituteBookingPartyProps {
  ownerId: string;
  guests: ReconstituteBookingPartyGuestProps[];
  /** The monotonic counter's next value — must be >= the highest guest sequence already in `guests`. */
  nextSequence: number;
}

/**
 * WHO is booking — the party assembling a booking before it becomes an
 * `Appointment`'s seats (the second booking axis is `Seat`/`SeatSubject`,
 * WHO an individual seat is FOR). Ports v2's guest-list half of
 * `BookingParty.ts`.
 *
 * Fixes legacy bug 7.7: v2's `booking.machine.ts` assigned a removed
 * guest's array *index* to the next-added guest, resurrecting a stale id.
 * Here, `GuestId`s mint exclusively from a monotonic sequence counter
 * (`nextSequence`) that only ever increments on `addGuest` — `removeGuest`
 * deletes the guest from the roster but never touches (let alone
 * decrements) the counter, so a freshly minted id can never collide with
 * one that existed before, regardless of how many guests were removed.
 */
export class BookingParty {
  private constructor(
    readonly ownerId: UserId,
    private readonly guestsById: ReadonlyMap<string, BookingPartyGuest>,
    private readonly nextSequence: number,
  ) {}

  static create(
    props: CreateBookingPartyProps,
  ): Result<BookingParty, BookingPartyError[]> {
    const ownerIdResult = UserId.create(props.ownerId);
    if (ownerIdResult.isFailure()) {
      return fail([ownerIdResult.error]);
    }
    return ok(new BookingParty(ownerIdResult.value, new Map(), 0));
  }

  static reconstitute(
    props: ReconstituteBookingPartyProps,
  ): Result<BookingParty, BookingPartyError[]> {
    const ownerIdResult = UserId.create(props.ownerId);
    const sequenceResult = BookingParty.validateSequence(props.nextSequence);
    const guestResults = props.guests.map((g) =>
      combineAll([GuestId.create(g.id), SeatLabel.create(g.label)] as const),
    );

    const errors: BookingPartyError[] = [];
    const guests: BookingPartyGuest[] = [];
    for (const guestResult of guestResults) {
      if (guestResult.isFailure()) {
        errors.push(...guestResult.error);
      } else {
        const [id, label] = guestResult.value;
        guests.push({ id, label });
      }
    }
    if (
      ownerIdResult.isFailure() ||
      sequenceResult.isFailure() ||
      errors.length > 0
    ) {
      if (ownerIdResult.isFailure()) errors.push(ownerIdResult.error);
      if (sequenceResult.isFailure()) errors.push(sequenceResult.error);
      return fail(errors);
    }

    const guestsById = new Map(
      guests.map((g) => [g.id.toString(), g] as const),
    );
    return ok(
      new BookingParty(ownerIdResult.value, guestsById, sequenceResult.value),
    );
  }

  get guests(): readonly BookingPartyGuest[] {
    return [...this.guestsById.values()];
  }

  /** Add a guest — mints a fresh `GuestId` from the monotonic counter, which always advances. */
  addGuest(labelRaw: string): Result<BookingParty, BookingPartyError[]> {
    const labelResult = SeatLabel.create(labelRaw);
    if (labelResult.isFailure()) {
      return fail([labelResult.error]);
    }
    const id = GuestId.fromSequence(this.nextSequence);
    const guest: BookingPartyGuest = { id, label: labelResult.value };
    const guestsById = new Map(this.guestsById);
    guestsById.set(id.toString(), guest);
    return ok(
      new BookingParty(this.ownerId, guestsById, this.nextSequence + 1),
    );
  }

  /** Remove a guest — never touches `nextSequence` (§7.7: the counter only ever grows). */
  removeGuest(
    guestId: GuestId,
  ): Result<BookingParty, BookingPartyRemoveGuestError> {
    if (!this.guestsById.has(guestId.toString())) {
      return fail(new GuestNotFoundError(guestId.toString()));
    }
    const guestsById = new Map(this.guestsById);
    guestsById.delete(guestId.toString());
    return ok(new BookingParty(this.ownerId, guestsById, this.nextSequence));
  }

  private static validateSequence(
    raw: number,
  ): Result<number, InvalidGuestSequenceError> {
    if (!Number.isInteger(raw) || raw < 0) {
      return fail(new InvalidGuestSequenceError(raw));
    }
    return ok(raw);
  }
}
