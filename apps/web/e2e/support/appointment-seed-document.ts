/**
 * The `appointments/{id}` bodies the e2e suite seeds — an upcoming visit
 * and a worked one, one builder for both — as pure values (flip 1: the
 * flat `Appointment` minus its `id`, Law 5; no mapper reads it).
 *
 * Every body is `satisfies Omit<Appointment, 'id'>`, and built by the
 * entity's own companions — the seat by `Seat.compose`, the lifecycle by
 * `BookingLifecycle`, the query mirrors by `AppointmentIndexSystem`, the
 * one instant by `ZonedTimeSystem` from the shop's zone — exactly as every
 * write plan builds them. `apps/web/src/testing/e2e-appointment-seed.spec.ts`
 * is the guard: it holds both visits to those mirrors, to the shop's wall
 * clock and to the stored tags the screens read. `tools/seed` is
 * `scope:tooling`, which `scope:web` may not import, so the e2e keeps its
 * own two builders.
 *
 * Firebase-free and Node-free on purpose: the web unit-test build compiles
 * it too. The client RECORD a seat names (`CustomerId`, D29) is handed in —
 * derived by the caller (`seed-firestore.ts`, `CustomerId.forUser` with the
 * production hash), never cast here.
 */
import {
  BarberPreference,
  BookingContact,
  BookingLifecycle,
  Placement,
  Seat,
  SeatOccupant,
  SeatOutcome,
  ServiceTerms,
  StoodSeatPairs,
  SubjectRelationship,
  WriteProvenance,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  BarberId,
  Currency,
  type CustomerId,
  DurationMinutes,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { AppointmentIndexSystem, ZonedTimeSystem } from '@core/systems';
import { SHOP_TIME_ZONE, shopInstant, sure } from './shop-clock';

/** The dev catalogue's chair every seeded visit books: Ivan's beard trim at
 *  the Center, at the price and length the catalogue sells it for. */
export const DEV_CHAIR = {
  locationId: 'loc-center',
  barberId: 'ivan',
  serviceId: 'svc-beard',
  priceCents: 1000,
  currency: 'EUR',
  durationMinutes: 30,
} as const;

/**
 * The service a seeded visit's one seat sells in the dev chair, at the
 * terms Ivan sells it for (the catalogue's `offerings`). The dev chair's
 * own beard trim is the default.
 */
export type ChairService = {
  readonly serviceId: string;
  readonly priceCents: number;
  readonly durationMinutes: number;
};

/**
 * Ivan's classic cut at the Center, no length chosen — his offering's
 * terms (14,50 €, 35 minutes): a past visit's service that today's beard
 * trim in the chair does not hold.
 */
export const DEV_CLASSIC_CUT = {
  serviceId: 'svc-classic-cut',
  priceCents: 1450,
  durationMinutes: 35,
} as const satisfies ChairService;

/** A fixed instant, so a seeded row is the same bytes on every run. */
const BOOKED_AT_UTC_MS = shopInstant('2026-09-01', 12);

/**
 * A stored body: the entity minus its `id`, variant by variant (a plain
 * `Omit` over the lifecycle union would merge its variants into one).
 */
export type AppointmentBody = Appointment extends infer A
  ? A extends unknown
    ? Omit<A, 'id'>
    : never
  : never;

/** What became of a seeded visit: still ahead, or worked at the chair. */
type VisitFate = 'upcoming' | 'worked';

/**
 * A visit `ownerUserId` (client record `ownerCustomerId`) booked for
 * themselves in the dev catalogue's chair, starting at the naive shop-time
 * `startsAt` (`YYYY-MM-DDTHH:mm:ss`, a wall clock of the shop — read in its
 * zone at this boundary, ZonedTimeSystem.parseIsoIn).
 *
 * Every field of the archetype, the query mirrors (`ownerUserId`,
 * `subjectUserIds`, `ownerCustomerId`, `subjectCustomerIds`, `barberIds`,
 * `busyKeys`) recomputed from the seat and the `placement` stamp included —
 * the bytes a real booking would have stored. A worked visit was worked as
 * its chair freed and booked a week before at noon; an upcoming one was
 * booked at a fixed instant (the same bytes on every run).
 */
function chairVisitBody(
  id: string,
  ownerUserId: string,
  ownerCustomerId: CustomerId,
  startsAt: string,
  fate: VisitFate,
  service: ChairService,
): AppointmentBody {
  const startUtcMs = sure(
    ZonedTimeSystem.parseIsoIn(startsAt, SHOP_TIME_ZONE),
    `start ${startsAt}`,
  );
  const { localDate, minute } = ZonedTimeSystem.toLocal(
    startUtcMs,
    SHOP_TIME_ZONE,
  );
  const terms = ServiceTerms.of(
    sure(PriceCents.of(service.priceCents), 'price'),
    Currency.EUR,
    sure(DurationMinutes.of(service.durationMinutes), 'duration'),
    sure(MinuteCount.of(0), 'setup'),
    sure(MinuteCount.of(0), 'cleanup'),
  );
  const worked = fate === 'worked';
  // Worked as the chair freed, as the dev seed stamps its past visits.
  const workedAtUtcMs = ZonedTimeSystem.toUtc(
    localDate,
    sure(MinuteOfDay.of(minute + service.durationMinutes), 'end'),
    SHOP_TIME_ZONE,
  );
  const seat = Seat.compose(
    {
      seatId: SeatId.of(`${id}-seat`),
      serviceId: ServiceId.of(service.serviceId),
      variantId: null,
      barberId: BarberId.of(DEV_CHAIR.barberId),
      barberPreference: BarberPreference.Specific,
      startMinutes: minute,
      tipCents: null,
    },
    Seat.termsOf(terms, null),
    SeatOccupant.account(
      UserId.of(ownerUserId),
      ownerCustomerId,
      SubjectRelationship.Self,
    ),
    worked
      ? SeatOutcome.worked(sure(workedAtUtcMs, 'worked at'))
      : SeatOutcome.scheduled(),
  );
  const seats = [seat];
  const envelope = AppointmentIndexSystem.envelope({ seats });
  if (envelope === null) throw new Error('e2e seed: a visit without seats');
  const keys = AppointmentIndexSystem.queryKeys({ localDate, seats });
  const bookedAtUtcMs = worked
    ? shopInstant(LocalDate.addDays(localDate, -7), 12)
    : BOOKED_AT_UTC_MS;
  return {
    locationId: LocationId.of(DEV_CHAIR.locationId),
    ownerUserId: keys.ownerUserId,
    subjectUserIds: keys.subjectUserIds,
    ownerCustomerId: keys.ownerCustomerId,
    subjectCustomerIds: keys.subjectCustomerIds,
    // The client booked it themselves.
    placement: Placement.Self,
    inferredPlacement: null,
    barberIds: keys.barberIds,
    busyKeys: keys.busyKeys,
    seats,
    bookedFromAppointmentId: null,
    discounts: [],
    voucherRedemptions: [],
    revision: 0,
    appliedOperations: [],
    localDate,
    startMinutes: envelope.startMinutes,
    endMinutes: envelope.endMinutes,
    utcEpochMs: startUtcMs,
    ...BookingContact.of(BookingContact.NONE),
    bookedAtUtcMs,
    arrivedAtUtcMs: null,
    ...StoodSeatPairs.NONE,
    ...WriteProvenance.NONE,
    ...BookingLifecycle.sliceOf(
      worked
        ? BookingLifecycle.complete(sure(workedAtUtcMs, 'completed at'))
        : BookingLifecycle.confirm(bookedAtUtcMs),
    ),
  } satisfies Omit<Appointment, 'id'>;
}

/**
 * A confirmed visit `ownerUserId` booked for themselves in the dev
 * catalogue's chair, starting at `startsAt` — see {@link chairVisitBody}.
 * The fixed booking instant is in 2026, so pick a start after it.
 */
export function upcomingAppointmentBody(
  id: string,
  ownerUserId: string,
  ownerCustomerId: CustomerId,
  startsAt: string,
): AppointmentBody {
  return chairVisitBody(
    id,
    ownerUserId,
    ownerCustomerId,
    startsAt,
    'upcoming',
    DEV_CHAIR,
  );
}

/**
 * A finished visit: the same chair, `COMPLETED`, its one seat `WORKED` as
 * the chair freed and booked a week before — the visit a client repeats with
 * `/book?repeat=` (see {@link chairVisitBody}). Pick a start in the past.
 * The seat sells the chair's beard trim unless `service` names another of
 * Ivan's services.
 */
export function workedAppointmentBody(
  id: string,
  ownerUserId: string,
  ownerCustomerId: CustomerId,
  startsAt: string,
  service: ChairService = DEV_CHAIR,
): AppointmentBody {
  return chairVisitBody(
    id,
    ownerUserId,
    ownerCustomerId,
    startsAt,
    'worked',
    service,
  );
}
