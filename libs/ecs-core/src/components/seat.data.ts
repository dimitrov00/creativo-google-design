import {
  defect,
  type DurationMinutes,
  type MinuteCount,
  type BarberId,
  type SeatId,
  type ServiceId,
  type ServiceVariantId,
  type UserId,
  EndMinute,
  MinuteOfDay,
  type PriceCents,
  SchedulingError,
  AttendanceState,
} from '@core/primitives';
import type { BarberPreference } from './barber-pref.data';
import { MinuteRange } from './minute-range.data';
import type { SeatLabel } from './seat-label.data';
import type { SeatOutcome } from './seat-outcome.data';
import { ServiceTerms } from './service-terms.data';

/**
 * What a seat's chair geometry reads — its start and its snapshotted
 * minutes. A whole `Seat` passes straight in; so does any slice that holds
 * these (the staff grid's occupancy rows).
 */
export type ChairGeometry = {
  readonly startMinutes: MinuteOfDay;
  readonly durationMinutes: DurationMinutes;
  readonly setupMinutes: MinuteCount;
  readonly cleanupMinutes: MinuteCount;
};

/**
 * Who a seat's subject is — the field `seatSubject`, the ONLY source of
 * these strings. `ACCOUNT` holds a uid until the appointment flip (1)
 * replaces it with `CUSTOMER` (D29, flatten-spec §5.5).
 */
export const SeatSubject = {
  /** A registered account, referenced by id — never an embedded profile. */
  Account: 'ACCOUNT',
  /** No account, no PII beyond a `SeatLabel` handle. */
  Anonymous: 'ANONYMOUS',
} as const;
export type SeatSubject = (typeof SeatSubject)[keyof typeof SeatSubject];

/** How an account subject relates to the party's owner — the field `subjectRelationship`. */
export const SubjectRelationship = {
  /** The booker's own seat — what authority hangs off; never guessed. */
  Self: 'SELF',
  /** Someone with an account of their own the booker vouches for. */
  Companion: 'COMPANION',
  /** A third party a STAFF member booked for. */
  Client: 'CLIENT',
} as const;
export type SubjectRelationship =
  (typeof SubjectRelationship)[keyof typeof SubjectRelationship];

/**
 * WHO a seat is FOR (`seat.ts:22,40-52`) — a flat variant slice of every
 * `seats[]` element, discriminated by `seatSubject`: an account by its uid
 * (`subjectUserId`, a `UserId` until flip (1), D29) and its relationship to
 * the booker, or an anonymous guest by label.
 */
export type SeatOccupant = SeatOccupant.Account | SeatOccupant.Anonymous;

export const SeatOccupant = {
  account(
    userId: UserId,
    relationship: SubjectRelationship,
  ): SeatOccupant.Account {
    return {
      seatSubject: SeatSubject.Account,
      subjectUserId: userId,
      subjectRelationship: relationship,
    };
  },

  anonymous(label: SeatLabel): SeatOccupant.Anonymous {
    return { seatSubject: SeatSubject.Anonymous, guestLabel: label };
  },

  /** A subject with no identity and no contact channel. */
  isContactless(occupant: SeatOccupant): boolean {
    return occupant.seatSubject === SeatSubject.Anonymous;
  },

  /** The occupant slice of a value that carries one (a whole `Seat`), copied to exactly its variant's fields. */
  of(occupant: SeatOccupant): SeatOccupant {
    return occupant.seatSubject === SeatSubject.Account
      ? SeatOccupant.account(
          occupant.subjectUserId,
          occupant.subjectRelationship,
        )
      : SeatOccupant.anonymous(occupant.guestLabel);
  },
} as const;

export namespace SeatOccupant {
  export type Account = {
    readonly seatSubject: typeof SeatSubject.Account;
    readonly subjectUserId: UserId;
    readonly subjectRelationship: SubjectRelationship;
  };
  export type Anonymous = {
    readonly seatSubject: typeof SeatSubject.Anonymous;
    readonly guestLabel: SeatLabel;
  };
}

/**
 * What the CATALOGUE said when staff overrode a seat's terms
 * (`appointment-document.ts:122-135`). Both figures are `null` together for
 * the ordinary seat whose terms ARE the catalogue's — and for every seat
 * written before provenance existed, which is "we do not know", not a claim.
 */
export type SeatCatalogTerms = {
  readonly catalogPriceCents: PriceCents | null;
  readonly catalogDurationMinutes: DurationMinutes | null;
};

/**
 * A seat's own 1-to-1 fields — its identity, what it is for, where it sits
 * and its tip. `barberPreference` is the stored TAG of the preference the
 * seat was resolved from (the specific barber is the seat's own `barberId`);
 * `null` is "we do not know" and never reads as `ANY`. `startMinutes` is on
 * the appointment's `localDate` (T7). `tipCents` has one home, the seat — a
 * party can be two barbers and a tip belongs to whoever did the work; it is
 * in the seat's `currency`, and `null` is "not recorded", which is not zero.
 */
export type SeatCore = {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  /** The choice made within the service — `null` only when it declares none. */
  readonly variantId: ServiceVariantId | null;
  /** RESOLVED, never a preference. */
  readonly barberId: BarberId;
  readonly barberPreference: BarberPreference | null;
  readonly startMinutes: MinuteOfDay;
  readonly tipCents: PriceCents | null;
};

/**
 * One person being served within an appointment — a party of N is one
 * appointment with N seats (`seat.ts:22-134`), each an element of the
 * 1-to-N `seats[]` array, itself FLAT (Law 6, F-21): its core, the terms
 * SNAPSHOT it was charged at (`ServiceTerms` — price, currency and minutes
 * at the element's root), the catalogue provenance, who it is for and what
 * became of it. Each seat carries its own barber and its own START: the end
 * is DERIVED from the sold duration, so a seat can never claim 10:00–10:45
 * while being a 30-minute service.
 */
export type Seat = SeatCore &
  ServiceTerms &
  SeatCatalogTerms &
  SeatOccupant &
  SeatOutcome;

function outcomeOf(outcome: SeatOutcome): SeatOutcome {
  switch (outcome.attendanceState) {
    case AttendanceState.Scheduled:
      return { attendanceState: AttendanceState.Scheduled };
    case AttendanceState.Worked:
      return {
        attendanceState: AttendanceState.Worked,
        workedAtUtcMs: outcome.workedAtUtcMs,
      };
    case AttendanceState.NoShow:
      return {
        attendanceState: AttendanceState.NoShow,
        noShowAtUtcMs: outcome.noShowAtUtcMs,
      };
    default:
      return {
        attendanceState: AttendanceState.Cancelled,
        cancelledAtUtcMs: outcome.cancelledAtUtcMs,
        cancelledBy: outcome.cancelledBy,
        cancellationReason: outcome.cancellationReason,
        cancellationWindowHours: outcome.cancellationWindowHours,
      };
  }
}

function endOf(seat: ChairGeometry): EndMinute {
  const end = EndMinute.after(seat.startMinutes, seat.durationMinutes);
  // One shop day per appointment (F-6): no seat ends past midnight.
  return end.ok ? end.value : defect('a seat ends past its shop day (F-6)');
}

export const Seat = {
  /**
   * A seat from its slices — the one way a whole seat is built, so every
   * element shares one field order (one hidden class per variant).
   */
  compose(
    core: SeatCore,
    terms: ServiceTerms & SeatCatalogTerms,
    occupant: SeatOccupant,
    outcome: SeatOutcome,
  ): Seat {
    return {
      seatId: core.seatId,
      serviceId: core.serviceId,
      variantId: core.variantId,
      barberId: core.barberId,
      barberPreference: core.barberPreference,
      startMinutes: core.startMinutes,
      tipCents: core.tipCents,
      priceCents: terms.priceCents,
      currency: terms.currency,
      durationMinutes: terms.durationMinutes,
      setupMinutes: terms.setupMinutes,
      cleanupMinutes: terms.cleanupMinutes,
      catalogPriceCents: terms.catalogPriceCents,
      catalogDurationMinutes: terms.catalogDurationMinutes,
      ...SeatOccupant.of(occupant),
      ...outcomeOf(outcome),
    };
  },

  /**
   * The charged terms and the catalogue's — normalised: catalogue terms
   * EQUAL to the charged ones are no override, however they were passed, so
   * {@link overridden} is never true for a seat nobody changed.
   */
  termsOf(
    charged: ServiceTerms,
    catalog: ServiceTerms | null,
  ): ServiceTerms & SeatCatalogTerms {
    const override = catalog !== null && !ServiceTerms.equals(catalog, charged);
    return {
      priceCents: charged.priceCents,
      currency: charged.currency,
      durationMinutes: charged.durationMinutes,
      setupMinutes: charged.setupMinutes,
      cleanupMinutes: charged.cleanupMinutes,
      catalogPriceCents: override ? catalog.priceCents : null,
      catalogDurationMinutes: override ? catalog.durationMinutes : null,
    };
  },

  /** When the sold service ends — start plus the snapshotted duration (was `endMs`). */
  endMinutes(seat: ChairGeometry): EndMinute {
    return endOf(seat);
  },

  /**
   * What the CLIENT is sold (was `interval`): the minutes the person sits in
   * this chair, without the barber's setup and cleanup — what "one person,
   * one chair at a time" is judged on.
   */
  range(seat: ChairGeometry): MinuteRange {
    return MinuteRange.of(seat.startMinutes, endOf(seat));
  },

  /**
   * What the barber's chair is held for: setup, the service, cleanup —
   * clipped to the shop day `[0, 1440]` (T7). A placement is checked against
   * this, and it is what the seat writes into the busy projection.
   */
  chairTime(seat: ChairGeometry): MinuteRange {
    return MinuteRange.of(
      MinuteOfDay.minusClamped(seat.startMinutes, seat.setupMinutes),
      EndMinute.plusClamped(endOf(seat), seat.cleanupMinutes),
    );
  },

  /** Would these two seats need the same barber in two chairs at once? */
  collidesWith(a: Seat, b: Seat): boolean {
    return (
      a.barberId === b.barberId &&
      a.startMinutes < endOf(b) &&
      b.startMinutes < endOf(a)
    );
  },

  /**
   * Did somebody change what the catalogue said? `false` for every seat
   * written before provenance — absence of evidence, like
   * `barberPreference: null`.
   */
  overridden(seat: SeatCatalogTerms): boolean {
    return (
      seat.catalogPriceCents !== null && seat.catalogDurationMinutes !== null
    );
  },

  isContactless(seat: Seat): boolean {
    return SeatOccupant.isContactless(seat);
  },

  /**
   * Is this seat one the BOOKER's own cart can name — and so move? An
   * anonymous guest, or the booker's own `SELF` seat bound to the booker's
   * account. A `SELF` seat naming another account is the shop's, like a
   * companion; `null` names nobody, so only the anonymous guests remain.
   */
  isMovableByBooker(seat: Seat, ownerUserId: UserId | null): boolean {
    if (seat.seatSubject === SeatSubject.Anonymous) return true;
    return (
      seat.subjectRelationship === SubjectRelationship.Self &&
      ownerUserId !== null &&
      seat.subjectUserId === ownerUserId
    );
  },

  /**
   * The same seat, resolved — its core, terms and occupant untouched; the
   * old outcome's variant fields are gone, the new outcome's present.
   */
  withOutcome(seat: Seat, outcome: SeatOutcome): Seat {
    return Seat.compose(seat, seat, seat, outcome);
  },

  /** The seat's outcome slice, copied to exactly its variant's fields. */
  outcomeOf(seat: SeatOutcome): SeatOutcome {
    return outcomeOf(seat);
  },

  /** The same seat, tipped; `null` clears it back to "nothing recorded". */
  withTip(seat: Seat, tipCents: PriceCents | null): Seat {
    return { ...seat, tipCents };
  },

  /**
   * What is wrong with a set of seats, every violation at once — the
   * aggregate's own invariants (`appointment.ts:421-485`, `validateSeats`):
   * none at all (reported alone); ONE PERSON IN TWO CHAIRS (overlapping
   * `SELF` seats of one ACCOUNT — sequential self seats are one visit with
   * two services, and a `SELF` seat bound to another account is somebody
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
    const doubleBooked: BarberId[] = [];
    for (let i = 0; i < seats.length; i++) {
      const a = seats[i] as Seat;
      for (let j = i + 1; j < seats.length; j++) {
        const b = seats[j] as Seat;
        if (
          !selfOverlap &&
          a.seatSubject === SeatSubject.Account &&
          b.seatSubject === SeatSubject.Account &&
          a.subjectRelationship === SubjectRelationship.Self &&
          b.subjectRelationship === SubjectRelationship.Self &&
          a.subjectUserId === b.subjectUserId &&
          a.startMinutes < endOf(b) &&
          b.startMinutes < endOf(a)
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
          doubleBooked[i] as BarberId,
        ),
      );
    }
    const expected = (seats[0] as Seat).currency;
    for (let i = 0; i < seats.length; i++) {
      const found = (seats[i] as Seat).currency;
      if (found !== expected) {
        errors.push(SchedulingError.appointmentMixedCurrency(expected, found));
        break;
      }
    }
    return errors;
  },
} as const;
