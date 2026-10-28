import {
  defect,
  BarberId,
  type UserId,
  EndMinute,
  MinuteOfDay,
  PriceCents,
  AttendanceState,
  SeatId,
  ServiceId,
  ServiceVariantId,
  type StoredFields,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import type { AccountOccupant } from './account-occupant.data';
import type { AccountSeat } from './account-seat.data';
import type { ChairGeometry } from './chair-geometry.data';
import { MinuteRange } from './minute-range.data';
import type { SeatCatalogTerms } from './seat-catalog-terms.data';
import type { SeatCore } from './seat-core.data';
import {
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from './seat-occupant.data';
import { SeatOutcome } from './seat-outcome.data';
import { ServiceTerms } from './service-terms.data';

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

/**
 * A projection: the outcome slice of anything that carries one (a whole
 * seat), copied to exactly its variant's fields.
 */
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

/** When the sold service ends — start plus the snapshotted duration (was `endMs`). */
function endMinutes(seat: ChairGeometry): EndMinute {
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

  /**
   * The read-time check of a stored seat (edge hardening D-1): the NAME of
   * the first field that is not well-formed, or `null` — the seat's own
   * fields first (`seatId`, `serviceId`, `variantId` an id or `null`,
   * `barberId`, `startMinutes` a `MinuteOfDay`, `tipCents` a price or
   * `null`), then its slices through their companions: the charged terms
   * (`ServiceTerms.fieldFault`), who it is for (`SeatOccupant.fieldFault`)
   * and what became of it (`SeatOutcome.fieldFault`). Never a second copy
   * of a slice's check (Law 1). One invariant spans two slices and is the
   * seat's own: the sold service ends by the closing midnight (F-6 —
   * `startMinutes + durationMinutes ≤ 1440`, what {@link endMinutes}
   * otherwise refuses as a defect), reported as `durationMinutes`. The
   * catalogue provenance and the barber preference are display-only and
   * not checked. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    if (!SeatId.is(raw['seatId'])) return 'seatId';
    if (!ServiceId.is(raw['serviceId'])) return 'serviceId';
    const variant = raw['variantId'];
    if (variant !== null && !ServiceVariantId.is(variant)) return 'variantId';
    if (!BarberId.is(raw['barberId'])) return 'barberId';
    const start = raw['startMinutes'];
    if (!MinuteOfDay.is(start)) return 'startMinutes';
    const tip = raw['tipCents'];
    if (tip !== null && !PriceCents.is(tip)) return 'tipCents';
    const terms = ServiceTerms.fieldFault(raw);
    if (terms !== null) return terms;
    // `durationMinutes` passed the terms' check; `typeof` only narrows it.
    const duration = raw['durationMinutes'];
    if (typeof duration === 'number' && !EndMinute.is(start + duration)) {
      return 'durationMinutes';
    }
    return SeatOccupant.fieldFault(raw) ?? SeatOutcome.fieldFault(raw);
  },

  endMinutes,

  /**
   * What the CLIENT is sold (was `interval`): the minutes the person sits in
   * this chair, without the barber's setup and cleanup — what "one person,
   * one chair at a time" is judged on.
   */
  range(seat: ChairGeometry): MinuteRange {
    return MinuteRange.of(seat.startMinutes, endMinutes(seat));
  },

  /**
   * What the barber's chair is held for: setup, the service, cleanup —
   * clipped to the shop day `[0, 1440]` (T7). A placement is checked against
   * this, and it is what the seat writes into the busy projection.
   */
  chairTime(seat: ChairGeometry): MinuteRange {
    return MinuteRange.of(
      MinuteOfDay.minusClamped(seat.startMinutes, seat.setupMinutes),
      EndMinute.plusClamped(endMinutes(seat), seat.cleanupMinutes),
    );
  },

  /** Would these two seats need the same barber in two chairs at once? */
  collidesWith(
    a: Pick<Seat, 'barberId'> & ChairGeometry,
    b: Pick<Seat, 'barberId'> & ChairGeometry,
  ): boolean {
    return (
      a.barberId === b.barberId &&
      a.startMinutes < endMinutes(b) &&
      b.startMinutes < endMinutes(a)
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

  /**
   * Is this seat one the BOOKER's own cart can name — and so move? A guest
   * (an anonymous one, or a walk-in the shop keeps a record for — OR-26:
   * the cart names them by label, as it names every guest), or the
   * booker's own `SELF` seat bound to the booker's account. A `SELF` seat
   * naming another account is the shop's, like a companion; `null` names
   * nobody, so only the guests remain.
   */
  isMovableByBooker(
    seat: AccountOccupant,
    ownerUserId: UserId | null,
  ): boolean {
    if (seat.seatSubject !== SeatSubject.Account) return true;
    return (
      seat.subjectRelationship === SubjectRelationship.Self &&
      ownerUserId !== null &&
      seat.subjectUserId === ownerUserId
    );
  },

  /**
   * Is this an own-account seat — an ACCOUNT subject seated as the booker's
   * `SELF`? Whose account it is is not asked (a `SELF` seat naming another
   * account still counts; {@link isMovableByBooker} is the rule that checks
   * the owner). A companion, a staff `CLIENT` and a guest are not.
   */
  isOwnAccount(seat: AccountOccupant): boolean {
    return (
      seat.seatSubject === SeatSubject.Account &&
      seat.subjectRelationship === SubjectRelationship.Self
    );
  },

  /**
   * The same seat, resolved — its core, terms and occupant untouched; the
   * old outcome's variant fields are gone, the new outcome's present.
   */
  withOutcome(seat: Seat, outcome: SeatOutcome): Seat {
    return Seat.compose(seat, seat, seat, outcome);
  },

  outcomeOf,

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
  violations(seats: readonly AccountSeat[]): readonly SchedulingError[] {
    const errors: SchedulingError[] = [];
    if (seats.length === 0) {
      errors.push(SchedulingError.appointmentEmptySeats());
      return errors;
    }
    let selfOverlap = false;
    const doubleBooked: BarberId[] = [];
    for (let i = 0; i < seats.length; i++) {
      const a = seats[i] as AccountSeat;
      for (let j = i + 1; j < seats.length; j++) {
        const b = seats[j] as AccountSeat;
        if (
          !selfOverlap &&
          a.seatSubject === SeatSubject.Account &&
          b.seatSubject === SeatSubject.Account &&
          a.subjectRelationship === SubjectRelationship.Self &&
          b.subjectRelationship === SubjectRelationship.Self &&
          a.subjectUserId === b.subjectUserId &&
          a.startMinutes < endMinutes(b) &&
          b.startMinutes < endMinutes(a)
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
    const expected = (seats[0] as AccountSeat).currency;
    for (let i = 0; i < seats.length; i++) {
      const found = (seats[i] as AccountSeat).currency;
      if (found !== expected) {
        errors.push(SchedulingError.appointmentMixedCurrency(expected, found));
        break;
      }
    }
    return errors;
  },
} as const;
