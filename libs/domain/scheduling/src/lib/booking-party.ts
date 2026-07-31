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
  /** `null` for a party assembled before sign-in — see `createAnonymous`. */
  ownerId: string | null;
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
 *
 * `ownerId` is NULLABLE because `/book` is deliberately unguarded (owner
 * ruling 2026-07-29): a visitor assembles a whole party and cart before
 * ever seeing an auth prompt, which HIG asks us to pair with its benefit
 * rather than put in front of window-shopping. An unclaimed party is a
 * legitimate, fully-functional state — it simply cannot be committed. The
 * one-way `claim()` transition is how it graduates once the booker signs
 * in, and `CreateBookingUseCase` refuses an unclaimed party outright
 * (`BookingPartyUnclaimedError`) rather than inventing an owner.
 */
export class BookingParty {
  private constructor(
    readonly ownerId: UserId | null,
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

  /**
   * A party with no owner yet — the state `/book` opens in. Total, not a
   * `Result`: there is no raw input to reject.
   */
  static createAnonymous(): BookingParty {
    return new BookingParty(null, new Map(), 0);
  }

  static reconstitute(
    props: ReconstituteBookingPartyProps,
  ): Result<BookingParty, BookingPartyError[]> {
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

    let ownerId: UserId | null = null;
    if (props.ownerId !== null) {
      const ownerIdResult = UserId.create(props.ownerId);
      if (ownerIdResult.isFailure()) {
        errors.push(ownerIdResult.error);
      } else {
        ownerId = ownerIdResult.value;
      }
    }

    if (sequenceResult.isFailure() || errors.length > 0) {
      if (sequenceResult.isFailure()) errors.push(sequenceResult.error);
      return fail(errors);
    }

    const guestsById = new Map(
      guests.map((g) => [g.id.toString(), g] as const),
    );
    return ok(new BookingParty(ownerId, guestsById, sequenceResult.value));
  }

  get guests(): readonly BookingPartyGuest[] {
    return [...this.guestsById.values()];
  }

  /**
   * The counter's next value. Exposed for ONE reason: a draft that persists
   * the roster without it would restart minting at zero on reload and hand
   * a fresh guest the id of one already removed — §7.7's bug, reintroduced
   * through the storage layer. `reconstitute` takes it straight back.
   */
  get nextGuestSequence(): number {
    return this.nextSequence;
  }

  isClaimed(): boolean {
    return this.ownerId !== null;
  }

  /**
   * Attach the signed-in booker to a party assembled anonymously. The
   * roster and the monotonic counter carry over untouched — signing in
   * mid-flow must not cost the user the party they just built, and must
   * not reset the counter §7.7 depends on.
   *
   * Re-claiming an already-claimed party is a no-op rather than an error:
   * the auth round-trip can legitimately replay (a restored draft, a
   * double-resolved redirect), and the second call carries the same id.
   */
  claim(rawOwnerId: string): Result<BookingParty, BookingPartyError[]> {
    const ownerIdResult = UserId.create(rawOwnerId);
    if (ownerIdResult.isFailure()) {
      return fail([ownerIdResult.error]);
    }
    return ok(
      new BookingParty(ownerIdResult.value, this.guestsById, this.nextSequence),
    );
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

  /**
   * Relabel a guest in place. The party step adds a guest immediately with a
   * generated placeholder and lets the booker type over it, so renaming is a
   * first-class edit rather than a correction — but it keeps the guest's
   * IDENTITY, so anything already keyed to that `GuestId` (their cart lines)
   * survives the rename untouched.
   */
  renameGuest(
    guestId: GuestId,
    labelRaw: string,
  ): Result<BookingParty, BookingPartyError[] | BookingPartyRemoveGuestError> {
    const existing = this.guestsById.get(guestId.toString());
    if (!existing) {
      return fail(new GuestNotFoundError(guestId.toString()));
    }
    const labelResult = SeatLabel.create(labelRaw);
    if (labelResult.isFailure()) {
      return fail([labelResult.error]);
    }
    const guestsById = new Map(this.guestsById);
    guestsById.set(guestId.toString(), {
      id: existing.id,
      label: labelResult.value,
    });
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
