import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { BarberPref } from './barber-pref';
import { SeatId } from './ids';
import { Interval } from './interval';
import { SeatLabel } from './seat-label';
import { SEAT_SCHEDULED, SeatOutcome, isSeatResolved } from './seat-outcome';
import { TimeSlot } from './time-slot';
import { defect } from '@creativo/ecs-core';

/**
 * How the seat's subject relates to the booking party's owner.
 *   - `self`      — the booker's own seat (only legal on a `self_serve` party).
 *   - `companion` — a friend/family member the booker vouches for.
 *   - `client`    — an arbitrary third party a STAFF member books for.
 */
export type SeatRelationship = 'self' | 'companion' | 'client';

/**
 * WHO an appointment seat is FOR — the second of the two booking axes (the
 * first is `BookingParty`, WHO BOOKS). Ported from v2's `Subject` union,
 * trimmed to the two tiers this pass actually needs:
 *   - `anonymous` — no account, no PII beyond a `SeatLabel` handle
 *     (`'Walk-in 14:30'`). The minimum-viable subject a barber can commit
 *     one-tap mid-cut.
 *   - `account`   — a registered `User` (`@creativo/domain/accounts`),
 *     referenced by `UserId` only — never an embedded entity.
 *
 * Deviation from v2: v2's middle `provisioned` tier (a phone-only
 * "foothold" account, pre-registration) is dropped — `@creativo/domain/accounts`
 * in this workspace has no such foothold concept yet, so there is nothing
 * to port it onto. Add it back if/when accounts grows one.
 */
export type SeatSubject =
  | { readonly kind: 'anonymous'; readonly label: SeatLabel }
  | {
      readonly kind: 'account';
      readonly userId: UserId;
      readonly relationship: SeatRelationship;
    };

export const SeatSubject = {
  anonymous(label: SeatLabel): SeatSubject {
    return { kind: 'anonymous', label };
  },
  account(userId: UserId, relationship: SeatRelationship): SeatSubject {
    return { kind: 'account', userId, relationship };
  },
  /** A subject with no identity and no contact channel. */
  isContactless(subject: SeatSubject): boolean {
    return subject.kind === 'anonymous';
  },
} as const;

export interface SeatProps {
  readonly id: SeatId;
  readonly subject: SeatSubject;
  readonly serviceId: ServiceId;
  /** The choice made within the service — `null` only when it declares none. */
  readonly variantId: ServiceVariantId | null;
  /** RESOLVED, never a preference: scheduling consumes `BarberPref` and emits this. */
  readonly barberId: BarberId;
  /**
   * The preference this seat was resolved FROM — `any` when the client said
   * anyone would do, `specific` when they asked for this barber by name.
   *
   * ### Why the resolved id is not enough
   * `barberId` is a FACT of the appointment and says nothing about how it got
   * there. "Ivan at 14:00" looks identical whether the client insisted on Ivan
   * or simply took the first free chair — and those two bookings behave
   * completely differently the morning Ivan calls in sick. One can be moved
   * silently; the other needs a phone call. That distinction is the first
   * question asked on any absence, and it is **destroyed at commit** unless
   * recorded here: nothing about a stored seat can reconstruct it.
   *
   * `null` only for seats written before this field existed — which is also
   * the flag for "we do not know", and must never be read as `any`.
   */
  readonly pref?: BarberPref | null;
  /** Price + duration SNAPSHOT taken at commit time. See the class doc. */
  readonly terms: ServiceTerms;
  /**
   * What the CATALOGUE said when this seat was last written, recorded only
   * when `terms` differs from it — an override's provenance.
   *
   * `null` means "the terms are the catalogue's own", which is the ordinary
   * case and the only case a client-committed booking can produce. Staff may
   * discount a price or stretch a duration, and without this the two are
   * indistinguishable on read: a 25 € cut in the history is either a
   * catalogue price or a give-away, and nothing stored can say which. That
   * question is asked of every past visit ("how much did we discount last
   * quarter") and there is no way to answer it retroactively — the catalogue
   * row has moved on.
   */
  readonly catalogTerms?: ServiceTerms | null;
  /**
   * WHEN this seat STARTS. The end is DERIVED from `terms.durationMinutes` —
   * see the class doc on why the seat may not state its length twice.
   */
  readonly startsAt: ZonedDateTime;
  /**
   * What became of this person's seat. Omitted means `scheduled` — both for a
   * brand-new booking and for every appointment written before outcomes
   * existed, which is the same thing as far as a report is concerned.
   */
  readonly outcome?: SeatOutcome;
  /**
   * What this person left for the barber, beyond the price.
   *
   * ### Why it lives on the SEAT and not the appointment
   * A party can be two barbers, and a tip belongs to whoever did the work —
   * so an appointment-level number could not say whose it was the moment
   * Ivan and Stefan share a booking. Every barber's day is then the sum of
   * their OWN seats, which is the question actually asked ("what did I make
   * in tips today"), answerable without a second aggregate to keep in step.
   *
   * ### Why it is not part of `terms`
   * `terms` is a SNAPSHOT of what the shop charges — catalogue-derived,
   * comparable against `catalogTerms`, and known before anyone sits down. A
   * tip is none of those: it is decided by the client after the fact and it
   * is not the shop's money. Folding it into the price would corrupt every
   * figure derived from `terms` — revenue, the discount report, the client's
   * own receipt — with an amount the shop never charged.
   *
   * `null` is "no tip recorded", which is NOT the same as zero: a visit
   * nobody has settled up yet and a visit that genuinely tipped nothing are
   * different facts, and a day's report has to be able to tell them apart.
   */
  readonly tip?: Money | null;
}

/**
 * One person being served within an `Appointment` — a party of N people is
 * one `Appointment` with N seats (the appointment is the consistency
 * boundary; cancelling the whole party is one write).
 *
 * ### Why a seat carries its own barber AND its own slot
 * The product allows a party to be served in whatever arrangement the shop
 * can actually offer (owner ruling 2026-07-29): two guests with different
 * barbers go in PARALLEL, two guests who both want Ivan go SEQUENTIALLY.
 * Neither is a mode the user picks — both are simply options the
 * availability engine returns. That is unrepresentable while the appointment
 * holds one barber and one time for everyone, which is the shape this
 * replaces. `Appointment.timeSlot` becomes the ENVELOPE derived from these
 * slots, so the two can never disagree.
 *
 * ### Why terms are snapshotted here
 * Prices and durations are catalog data that changes; an appointment is a
 * commitment, and a seat is a line on its invoice. Snapshotting at write
 * time means the review screen and the persisted appointment can never
 * disagree, `Appointment.subtotal()` needs no catalog round-trip, and the
 * duration the schedule was computed from is the duration that was booked.
 *
 * ### Why the seat stores a START, not a slot
 * It used to carry both a `slot` and a `terms.durationMinutes`, with nothing
 * reconciling them — so a seat could say it ran 10:00–10:45 while claiming to
 * be a 30-minute service, and conflict detection and utilisation would then
 * disagree forever with no error anywhere. Storing only the start and
 * DERIVING `slot` makes that disagreement unrepresentable: there is one
 * answer to "how long is this seat", and it is the one that was sold.
 *
 * `Seat.of` stays a trusted assembler, not a validating `create()`: every
 * argument is already a validated domain value by the time a `Seat` is
 * built, so there is nothing left for a seat itself to validate. Invariants
 * spanning the whole party (at most one `self` seat, no barber double-booked
 * across overlapping seats) belong to `Appointment` — the only thing that
 * can see every seat at once.
 */
export class Seat {
  private constructor(
    readonly id: SeatId,
    readonly subject: SeatSubject,
    readonly serviceId: ServiceId,
    readonly variantId: ServiceVariantId | null,
    readonly barberId: BarberId,
    readonly terms: ServiceTerms,
    readonly startsAt: ZonedDateTime,
    readonly outcome: SeatOutcome = SEAT_SCHEDULED,
    readonly pref: BarberPref | null = null,
    readonly catalogTerms: ServiceTerms | null = null,
    readonly tip: Money | null = null,
  ) {}

  static of(props: SeatProps): Seat {
    return new Seat(
      props.id,
      props.subject,
      props.serviceId,
      props.variantId,
      props.barberId,
      props.terms,
      props.startsAt,
      props.outcome ?? SEAT_SCHEDULED,
      props.pref ?? null,
      // Normalised at the boundary: terms that EQUAL the catalogue are not an
      // override, however they were passed, so `overridden()` can never be
      // true for a seat nobody actually changed.
      props.catalogTerms && !props.catalogTerms.equals(props.terms)
        ? props.catalogTerms
        : null,
      props.tip ?? null,
    );
  }

  /**
   * The same seat, tipped. `null` clears it back to "nothing recorded".
   *
   * Immutable like every other transition here, and deliberately independent
   * of `outcome`: a tip is usually entered when the visit is settled, but
   * nothing about the money depends on the lifecycle and a barber correcting
   * yesterday's figure must not have to reopen a completed visit.
   */
  withTip(tip: Money | null): Seat {
    return this.copy({ tip });
  }

  /**
   * The same seat, resolved. Immutable like the rest of the domain — a signal
   * holding a seat cannot have it mutated out from under a template.
   *
   * Placement is untouched on purpose: a no-show still occupied the chair,
   * and its slot is what makes `noShowMinutes` separable from idle time. So
   * is everything else — the preference, the tip and the override provenance
   * are all facts the shop saying what happened does not change.
   */
  withOutcome(outcome: SeatOutcome): Seat {
    return this.copy({ outcome });
  }

  /**
   * Every field, spelled out — the one place a seat is read back into props.
   *
   * `Required` on purpose: the optional fields are exactly the ones a
   * hand-listed copy forgets (`withOutcome` once dropped the tip and the
   * override provenance), and a field added to `SeatProps` now fails to
   * compile here until it is carried.
   */
  toProps(): Required<SeatProps> {
    return {
      id: this.id,
      subject: this.subject,
      serviceId: this.serviceId,
      variantId: this.variantId,
      barberId: this.barberId,
      pref: this.pref,
      terms: this.terms,
      catalogTerms: this.catalogTerms,
      startsAt: this.startsAt,
      outcome: this.outcome,
      tip: this.tip,
    };
  }

  /** Every transition goes through here, so none can drop a field it does not touch. */
  private copy(patch: Partial<SeatProps>): Seat {
    return Seat.of({ ...this.toProps(), ...patch });
  }

  /** Has the shop said what happened to this seat yet? */
  isResolved(): boolean {
    return isSeatResolved(this.outcome);
  }

  /**
   * When this seat runs — DERIVED from the start plus the snapshotted
   * duration, never stored alongside it.
   *
   * `plusMinutes` is exact elapsed time, so a seat straddling a DST
   * transition still lasts the minutes it was sold for.
   */
  get slot(): TimeSlot {
    const result = TimeSlot.fromDuration(
      this.startsAt,
      this.terms.durationMinutes,
    );
    // Unreachable: `ServiceTerms` rejects a non-positive duration at
    // construction, so the end is always strictly after the start.
    if (result.isFailure()) defect('unreachable: non-positive duration');
    return result.value;
  }

  isContactless(): boolean {
    return SeatSubject.isContactless(this.subject);
  }

  /**
   * Is this seat one the BOOKER's own cart can name — and so move?
   *
   * The client's cart says exactly two things: "me" and "a guest with this
   * label". So a seat is the booker's to move when it is an anonymous guest,
   * or when it is the booker's own seat — `self`, AND bound to the booker's
   * account. The binding is not a formality: `self` is a relationship to the
   * party, and a stored `self` seat naming some OTHER account is somebody
   * the cart cannot speak for, exactly like a companion the shop seated.
   * Every other seat is the shop's to move (a client move carries it along
   * unchanged — `RescheduleBookingUseCase`).
   *
   * ONE rule, read by the web flow (what the bag rebuilds, what the
   * appointments page offers) and by the server (what the cart replaces,
   * what it carries) — two copies of it once disagreed about exactly that
   * foreign `self` seat.
   *
   * `ownerUserId` is the booking's owner: the verified token on the server,
   * the signed-in reader on the client. `null` names nobody, so no account
   * seat is anybody's own and only the anonymous guests remain the cart's.
   */
  isMovableByBooker(ownerUserId: UserId | null): boolean {
    const subject = this.subject;
    if (subject.kind === 'anonymous') return true;
    return (
      subject.relationship === 'self' &&
      ownerUserId !== null &&
      subject.userId.equals(ownerUserId)
    );
  }

  /**
   * Did somebody change what the catalogue said — a discount, a stretched
   * duration, or both?
   *
   * `false` for every seat written before provenance was recorded, which is
   * "we do not know" and NOT a claim that the terms are the catalogue's. Read
   * it the way `pref === null` is read: absence of evidence.
   */
  overridden(): boolean {
    return this.catalogTerms !== null;
  }

  durationMinutes(): number {
    return this.terms.durationMinutes;
  }

  endsAt(): ZonedDateTime {
    return this.startsAt.plusMinutes(this.terms.durationMinutes);
  }

  /**
   * What the barber's chair is held for: setup, the service, cleanup, as
   * instants. The client is sold `slot` alone, but a placement is checked
   * against this, and it is what the seat writes into the busy projection.
   */
  chairTime(): Interval {
    return Interval.of(
      this.startsAt.toMillis() - this.terms.setupMinutes * 60_000,
      this.endsAt().toMillis() + this.terms.cleanupMinutes * 60_000,
    );
  }

  /**
   * What the CLIENT is sold — `slot`, as instants: the minutes the person
   * sits in this chair, without the barber's setup and cleanup around them.
   * It is what "one person, one chair at a time" is judged on
   * (`PersonSlot`), the same span the availability engine seats a line by.
   * Read off `slot`, so the sold span has one definition.
   */
  soldTime(): Interval {
    const { startMs, endMs } = this.slot;
    return Interval.of(startMs, endMs);
  }

  /** Would these two seats need the same barber in two chairs at once? */
  collidesWith(other: Seat): boolean {
    return (
      this.barberId.equals(other.barberId) && this.slot.overlaps(other.slot)
    );
  }
}
