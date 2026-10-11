/**
 * The appointment group's fixtures (flatten-spec §8.1, split out of
 * `testing.ts` by F0 and re-exported by it): a booked seat and a confirmed
 * one-seat appointment, FLAT (Law 6), every field present, overridable slice
 * by slice. Every literal is a branded primitive built through its companion
 * (no `Date`, L4): the visit is Ivan's classic cut at 10:00 on
 * `FIXTURE_TODAY` in the fixture shop's zone.
 */
import type { TimeCoordinate } from '../components/time-coordinate.data';
import { BookingContact } from '../components/booking-contact.data';
import { BookingLifecycle } from '../components/booking-lifecycle.data';
import { Placement } from '../components/placement-kind.data';
import type { StoodSeatPairs } from '../components/seat-id-pair.data';
import { SeatOutcome } from '../components/seat-outcome.data';
import {
  Seat,
  type SeatCatalogTerms,
  type SeatCore,
  SeatOccupant,
  SubjectRelationship,
} from '../components/seat.data';
import type { ServiceTerms } from '../components/service-terms.data';
import type {
  Appointment,
  AppointmentMeta,
  AppointmentStamps,
} from '../entities/appointment.entity';
import { BusyKey } from '../primitives/busy-key.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { ZonedTimeSystem } from '../systems/zoned-time.system';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  minute,
} from '../testing';
import { FIXTURE_TERMS } from './booking-core.fixtures';

const DAY_MS = 86_400_000;

/** A seat override: any core field, or a whole slice (terms, occupant, outcome). */
export type SeatFixtureOverrides = Partial<SeatCore> & {
  readonly terms?: ServiceTerms & SeatCatalogTerms;
  readonly occupant?: SeatOccupant;
  readonly outcome?: SeatOutcome;
};

/** A booked seat: the client's own classic cut with Ivan at 10:00 today. */
export function seatFixture(overrides: SeatFixtureOverrides = {}): Seat {
  const { terms, occupant, outcome, ...core } = overrides;
  return Seat.compose(
    {
      seatId: FIXTURE_IDS.seat,
      serviceId: FIXTURE_IDS.service,
      variantId: null,
      barberId: FIXTURE_IDS.barber,
      barberPreference: null,
      startMinutes: minute(600),
      tipCents: null,
      ...core,
    },
    terms ?? Seat.termsOf(FIXTURE_TERMS, FIXTURE_TERMS),
    occupant ??
      SeatOccupant.account(FIXTURE_IDS.client, SubjectRelationship.Self),
    outcome ?? SeatOutcome.scheduled(),
  );
}

/** An appointment override: any non-lifecycle field, or a whole lifecycle variant. */
export type AppointmentFixtureOverrides = Partial<
  AppointmentMeta &
    TimeCoordinate &
    BookingContact &
    AppointmentStamps &
    StoodSeatPairs
> & {
  readonly lifecycle?: BookingLifecycle;
};

/**
 * A confirmed one-seat appointment consistent with its seat: the envelope,
 * its instant, the barber list and the busy key are derived from
 * {@link seatFixture}, so override the seats and the derived fields together.
 * Booked and confirmed a day before the pinned now.
 */
export function appointmentFixture(
  overrides: AppointmentFixtureOverrides = {},
): Appointment {
  const seat = seatFixture();
  const instant = ZonedTimeSystem.toUtc(
    FIXTURE_TODAY,
    seat.startMinutes,
    FIXTURE_TIME_ZONE,
  );
  if (!instant.ok) throw new Error('a broken appointment fixture');
  const dayBefore = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -DAY_MS);
  const { lifecycle, ...fields } = overrides;
  const meta: AppointmentMeta = {
    id: FIXTURE_IDS.appointment,
    locationId: FIXTURE_IDS.location,
    ownerUserId: FIXTURE_IDS.client,
    subjectUserIds: [FIXTURE_IDS.client],
    placement: Placement.Self,
    inferredPlacement: null,
    barberIds: [seat.barberId],
    busyKeys: [BusyKey.of(seat.barberId, FIXTURE_TODAY)],
    seats: [seat],
    bookedFromAppointmentId: null,
    discounts: [],
    voucherRedemptions: [],
    revision: 1,
    appliedOperations: [],
  };
  const merged = {
    ...meta,
    localDate: FIXTURE_TODAY,
    startMinutes: seat.startMinutes,
    endMinutes: Seat.endMinutes(seat),
    utcEpochMs: instant.value,
    ...BookingContact.NONE,
    bookedAtUtcMs: dayBefore,
    arrivedAtUtcMs: null,
    stoodSeatPairsRevision: null,
    stoodSeatPairs: [],
    ...fields,
  };
  return {
    ...merged,
    ...BookingLifecycle.sliceOf(
      lifecycle ?? BookingLifecycle.confirm(dayBefore),
    ),
  };
}
