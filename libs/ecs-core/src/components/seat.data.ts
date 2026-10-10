import type { BarberId } from '../entities/barber.entity';
import type { ServiceId } from '../entities/service.entity';
import type { UserId } from '../entities/user.entity';
import type { BarberPrefKind } from './barber-pref.data';
import type { Money } from './money.data';
import { SchedulingError } from './scheduling-errors.data';
import type { SeatLabel } from './seat-label.data';
import type { SeatOutcome } from './seat-outcome.data';
import { ServiceTerms, type ServiceVariantId } from './service-terms.data';
import { TimeInterval } from './time-interval.data';

const MS_PER_MINUTE = 60_000;

/**
 * What a seat's chair geometry reads — its start and its snapshotted
 * minutes. A whole `Seat` passes straight in; so does any slice that holds
 * these (the staff grid's occupancy rows).
 */
type ChairGeometry = {
  readonly startMs: number;
  readonly terms: {
    readonly durationMinutes: number;
    readonly setupMinutes: number;
    readonly cleanupMinutes: number;
  };
};

/**
 * A seat's id within its appointment — the stored `seats[].id`, the identity
 * a staff edit and the stood-seat-pair memory track a seat by. A brand over
 * the plain stored string.
 */
export type SeatId = string & { readonly __brand: unique symbol };

export const SeatId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): SeatId => raw as SeatId,
} as const;

/** Who a seat's subject is — the ONLY source of these strings. */
export const SeatSubjectKind = {
  /** A registered user, referenced by id — never an embedded profile. */
  Account: 'account',
  /** No account, no PII beyond a `SeatLabel` handle. */
  Anonymous: 'anonymous',
} as const;
export type SeatSubjectKind =
  (typeof SeatSubjectKind)[keyof typeof SeatSubjectKind];

/** How an account subject relates to the party's owner. */
export const SeatRelationship = {
  /** The booker's own seat — what authority hangs off; never guessed. */
  Self: 'self',
  /** Someone with an account of their own the booker vouches for. */
  Companion: 'companion',
  /** A third party a STAFF member booked for. */
  Client: 'client',
} as const;
export type SeatRelationship =
  (typeof SeatRelationship)[keyof typeof SeatRelationship];

/**
 * WHO a seat is FOR (`seat.ts:22,40-52`, `appointment-document.ts:142-149`).
 */
export type SeatSubject = SeatSubject.Account | SeatSubject.Anonymous;

export const SeatSubject = {
  account(userId: UserId, relationship: SeatRelationship): SeatSubject.Account {
    return { kind: SeatSubjectKind.Account, userId, relationship };
  },

  anonymous(label: SeatLabel): SeatSubject.Anonymous {
    return { kind: SeatSubjectKind.Anonymous, label };
  },

  /** A subject with no identity and no contact channel. */
  isContactless(subject: SeatSubject): boolean {
    return subject.kind === SeatSubjectKind.Anonymous;
  },
} as const;

export namespace SeatSubject {
  export type Account = {
    readonly kind: typeof SeatSubjectKind.Account;
    readonly userId: UserId;
    readonly relationship: SeatRelationship;
  };
  export type Anonymous = {
    readonly kind: typeof SeatSubjectKind.Anonymous;
    readonly label: SeatLabel;
  };
}

/**
 * The terms SNAPSHOT a seat was charged at, plus what the CATALOGUE said when
 * staff overrode it (`appointment-document.ts:122-135`, flat inside `terms`
 * as stored). Both catalogue figures are `null` together for the ordinary
 * seat whose terms ARE the catalogue's — and for every seat written before
 * provenance existed, which is "we do not know", not a claim.
 */
export type SeatTerms = ServiceTerms & {
  readonly catalogPriceMinorUnits: number | null;
  readonly catalogDurationMinutes: number | null;
};

/**
 * One person being served within an appointment — a party of N is one
 * appointment with N seats (`seat.ts:22-134`). Each seat carries its own
 * barber and its own START: the end is DERIVED from the sold duration, so a
 * seat can never claim 10:00–10:45 while being a 30-minute service.
 *
 * `barberPref` is the stored TAG of the preference the seat was resolved
 * from (the specific barber is the seat's own `barberId`); `null` is "we do
 * not know" and never reads as `any`. `tip` has one home, the seat — a party
 * can be two barbers and a tip belongs to whoever did the work; `null` is
 * "not recorded", which is not zero.
 */
export type Seat = {
  readonly id: SeatId;
  readonly serviceId: ServiceId;
  /** The choice made within the service — `null` only when it declares none. */
  readonly variantId: ServiceVariantId | null;
  /** RESOLVED, never a preference. */
  readonly barberId: BarberId;
  readonly barberPref: BarberPrefKind | null;
  readonly terms: SeatTerms;
  readonly startMs: number;
  readonly subject: SeatSubject;
  readonly outcome: SeatOutcome;
  readonly tip: Money | null;
};

export const Seat = {
  /**
   * The stored terms from what was charged and what the catalogue said —
   * normalised: catalogue terms EQUAL to the charged ones are no override,
   * however they were passed, so {@link overridden} is never true for a
   * seat nobody changed.
   */
  termsOf(charged: ServiceTerms, catalog: ServiceTerms | null): SeatTerms {
    const override = catalog !== null && !ServiceTerms.equals(catalog, charged);
    return {
      priceMinorUnits: charged.priceMinorUnits,
      currencyCode: charged.currencyCode,
      durationMinutes: charged.durationMinutes,
      setupMinutes: charged.setupMinutes,
      cleanupMinutes: charged.cleanupMinutes,
      catalogPriceMinorUnits: override ? catalog.priceMinorUnits : null,
      catalogDurationMinutes: override ? catalog.durationMinutes : null,
    };
  },

  /** When the sold service ends — start plus the snapshotted duration. */
  endMs(seat: ChairGeometry): number {
    return seat.startMs + seat.terms.durationMinutes * MS_PER_MINUTE;
  },

  /**
   * What the CLIENT is sold: the minutes the person sits in this chair,
   * without the barber's setup and cleanup — what "one person, one chair at
   * a time" is judged on.
   */
  interval(seat: Seat): TimeInterval {
    return TimeInterval.of(seat.startMs, Seat.endMs(seat));
  },

  /**
   * What the barber's chair is held for: setup, the service, cleanup. A
   * placement is checked against this, and it is what the seat writes into
   * the busy projection.
   */
  chairTime(seat: ChairGeometry): TimeInterval {
    return TimeInterval.of(
      seat.startMs - seat.terms.setupMinutes * MS_PER_MINUTE,
      Seat.endMs(seat) + seat.terms.cleanupMinutes * MS_PER_MINUTE,
    );
  },

  /** Would these two seats need the same barber in two chairs at once? */
  collidesWith(a: Seat, b: Seat): boolean {
    return (
      a.barberId === b.barberId &&
      a.startMs < Seat.endMs(b) &&
      b.startMs < Seat.endMs(a)
    );
  },

  /**
   * Did somebody change what the catalogue said? `false` for every seat
   * written before provenance — absence of evidence, like `barberPref: null`.
   */
  overridden(seat: Seat): boolean {
    return (
      seat.terms.catalogPriceMinorUnits !== null &&
      seat.terms.catalogDurationMinutes !== null
    );
  },

  isContactless(seat: Seat): boolean {
    return SeatSubject.isContactless(seat.subject);
  },

  /**
   * Is this seat one the BOOKER's own cart can name — and so move? An
   * anonymous guest, or the booker's own `self` seat bound to the booker's
   * account. A `self` seat naming another account is the shop's, like a
   * companion; `null` names nobody, so only the anonymous guests remain.
   */
  isMovableByBooker(seat: Seat, ownerUserId: UserId | null): boolean {
    const subject = seat.subject;
    if (subject.kind === SeatSubjectKind.Anonymous) return true;
    return (
      subject.relationship === SeatRelationship.Self &&
      ownerUserId !== null &&
      subject.userId === ownerUserId
    );
  },

  /** The same seat, resolved — placement, preference, tip and provenance untouched. */
  withOutcome(seat: Seat, outcome: SeatOutcome): Seat {
    return { ...seat, outcome };
  },

  /** The same seat, tipped; `null` clears it back to "nothing recorded". */
  withTip(seat: Seat, tip: Money | null): Seat {
    return { ...seat, tip };
  },

  /**
   * What is wrong with a set of seats, every violation at once — the
   * aggregate's own invariants (`appointment.ts:421-485`, `validateSeats`):
   * none at all (reported alone); ONE PERSON IN TWO CHAIRS (overlapping
   * `self` seats of one ACCOUNT — sequential self seats are one visit with
   * two services, and a `self` seat bound to another account is somebody
   * else), reported once; a barber in two chairs at once on the SOLD slots,
   * named once per barber in discovery order; seats priced in two
   * currencies (the first mismatch). The one check `BookingDecisionSystem`
   * and `AppointmentLifecycleSystem` share.
   */
  violations(seats: readonly Seat[]): readonly SchedulingError[] {
    const errors: SchedulingError[] = [];
    if (seats.length === 0) {
      errors.push(SchedulingError.appointmentEmptySeats());
      return errors;
    }
    let selfOverlap = false;
    const doubleBooked: string[] = [];
    for (let i = 0; i < seats.length; i++) {
      const a = seats[i] as Seat;
      for (let j = i + 1; j < seats.length; j++) {
        const b = seats[j] as Seat;
        if (
          !selfOverlap &&
          a.subject.kind === SeatSubjectKind.Account &&
          b.subject.kind === SeatSubjectKind.Account &&
          a.subject.relationship === SeatRelationship.Self &&
          b.subject.relationship === SeatRelationship.Self &&
          a.subject.userId === b.subject.userId &&
          a.startMs < Seat.endMs(b) &&
          b.startMs < Seat.endMs(a)
        ) {
          selfOverlap = true;
        }
        if (Seat.collidesWith(a, b) && !doubleBooked.includes(a.barberId)) {
          doubleBooked.push(a.barberId);
        }
      }
    }
    if (selfOverlap) {
      errors.push(SchedulingError.appointmentMultipleSelfSeats());
    }
    for (let i = 0; i < doubleBooked.length; i++) {
      errors.push(
        SchedulingError.appointmentBarberDoubleBooked(
          doubleBooked[i] as string,
        ),
      );
    }
    const expected = (seats[0] as Seat).terms.currencyCode;
    for (let i = 0; i < seats.length; i++) {
      const found = (seats[i] as Seat).terms.currencyCode;
      if (found !== expected) {
        errors.push(SchedulingError.appointmentMixedCurrency(expected, found));
        break;
      }
    }
    return errors;
  },
} as const;
