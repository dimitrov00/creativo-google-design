import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { GuestId } from './ids';
import {
  BookingPartyError,
  type BookingPartyLabelError,
  BookingPartyRemoveGuestError,
  DuplicateGuestLabelError,
  GuestNotFoundError,
  InvalidGuestSequenceError,
} from './booking-party.errors';
import { SeatLabel } from './seat-label';
import { Party, SeatLabel as EcsSeatLabel } from '@creativo/ecs-core';

export interface BookingPartyGuest {
  readonly id: GuestId;
  readonly label: SeatLabel;
}

/**
 * ONE LABEL, ONE GUEST, detected: a label two DIFFERENT guests answer to,
 * or `null`.
 *
 * `key` is whatever tells the guests apart where the caller stands, opaque
 * here: the party's own `GuestId` in the flow (`BookingParty.sharedLabel`),
 * the cart's seat key on the wire (the server's `decideBooking`). Two
 * entries under one label and one key are ONE guest with two services, not
 * a clash. Labels compare as they are stored (`SeatLabel`, trimmed): the
 * same comparison the server counts people by, so this finds precisely what
 * would be merged.
 *
 * The rule's ONE implementation — the flow keeps such a party on the
 * services step and the server refuses such a cart by the same function, so
 * the two can never disagree about what "shared" means.
 */
export function labelSharedByTwoGuests(
  guests: Iterable<{ readonly key: string; readonly label: SeatLabel }>,
): SeatLabel | null {
  const listed = [...guests];
  const shared = Party.labelSharedByTwoGuests(listed.map(labelledGuestOf));
  return shared === null ? null : legacyLabelOf(listed, shared);
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
   * A DIFFERENT id re-binds the party to that account, roster and counter
   * intact — the party belongs to whoever is signed in now (a restored tab
   * whose session changed hands; see `BookingFlowStore.claim`).
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

  /**
   * Add a guest — mints a fresh `GuestId` from the monotonic counter, which
   * always advances. Refuses a label another guest already answers to
   * (`DuplicateGuestLabelError`): see {@link labelFor}.
   */
  addGuest(labelRaw: string): Result<BookingParty, BookingPartyLabelError[]> {
    const labelResult = this.labelFor(labelRaw, null);
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
   *
   * Refuses the label another guest holds (`DuplicateGuestLabelError`) —
   * never their own current one, which is a rename to where they already are.
   */
  renameGuest(
    guestId: GuestId,
    labelRaw: string,
  ): Result<
    BookingParty,
    BookingPartyLabelError[] | BookingPartyRemoveGuestError
  > {
    const existing = this.guestsById.get(guestId.toString());
    if (!existing) {
      return fail(new GuestNotFoundError(guestId.toString()));
    }
    const labelResult = this.labelFor(labelRaw, existing.id);
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

  /**
   * A label two guests of this party answer to, or `null` — the party's
   * own report on "one label, one guest".
   *
   * `null` for every party the commands built, because `addGuest` and
   * `renameGuest` refuse to make one. Only `reconstitute` can hold a
   * duplicate: a draft saved before the rule. The flow reads this to keep
   * such a party on the services step, where one rename fixes it, and never
   * sends it on to the grid or the server.
   */
  sharedLabel(): SeatLabel | null {
    return labelSharedByTwoGuests(
      [...this.guestsById.values()].map((guest) => ({
        key: guest.id.toString(),
        label: guest.label,
      })),
    );
  }

  /**
   * `labelRaw` as a label a guest of THIS party may take: a real label, and
   * not the one any OTHER guest answers to (`except` is the guest being
   * renamed, whose own label is theirs to keep).
   *
   * ONE LABEL, ONE GUEST, enforced by the commands that could break it. A
   * guest's label is their identity on the wire (the server counts people
   * by it), so two guests under one would be merged into one person.
   * `reconstitute` does NOT refuse a party that already holds a duplicate:
   * it rebuilds what was persisted, and a draft from before this rule is a
   * party the booker can still fix with one rename. Until they do, the flow
   * will not leave the services step with it (`sharedLabel`). The server
   * refuses it as well (`booking.commit.invalid_input`, field
   * `guest_label`), but only when the request carries the guests' keys.
   */
  private labelFor(
    labelRaw: string,
    except: GuestId | null,
  ): Result<SeatLabel, BookingPartyLabelError> {
    const labelResult = SeatLabel.create(labelRaw);
    if (labelResult.isFailure()) return fail(labelResult.error);
    const label = labelResult.value;
    const taken = [...this.guestsById.values()].some(
      (guest) =>
        (except === null || !guest.id.equals(except)) &&
        guest.label.equals(label),
    );
    return taken ? fail(new DuplicateGuestLabelError(label.value)) : ok(label);
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

// ── The bridge: legacy label → ecs-core struct (Phase 4 deletes it) ──────

/** A guest as `Party.labelSharedByTwoGuests` reads it: its key and its stored label. */
function labelledGuestOf(guest: {
  readonly key: string;
  readonly label: SeatLabel;
}): Party.LabelledGuest {
  return { key: guest.key, label: EcsSeatLabel.of(guest.label.value) };
}

/**
 * The caller's own label object for the shared label the rule named (every
 * guest under it carries an equal one); `null` only if no guest does, which
 * the rule never answers.
 */
function legacyLabelOf(
  guests: readonly { readonly key: string; readonly label: SeatLabel }[],
  shared: EcsSeatLabel,
): SeatLabel | null {
  const match = guests.find((guest) => guest.label.value === shared);
  return match === undefined ? null : match.label;
}
