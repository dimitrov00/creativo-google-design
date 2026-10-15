/**
 * THE DEV SEED'S APPOINTMENT DOCUMENTS (flip 1): `appointments/{id}` as
 * the flat `Appointment` minus its `id` (Laws 5–7) — the seats, the shop
 * wall clock (`localDate`, `startMinutes`, `endMinutes`) and the one
 * instant `utcEpochMs` computed from the shop's zone at ingestion, the
 * lifecycle variant at the root, the contact snapshot, the stamps, and the
 * query mirrors recomputed from the seats by `AppointmentIndexSystem`
 * exactly as every write plan recomputes them — the account keys
 * (`ownerUserId`, `subjectUserIds`) BESIDE the client-record keys
 * (`ownerCustomerId`, `subjectCustomerIds`, D29 / F1-4).
 *
 * The plan logic (`tools/seed/appointments.mjs`) resolves a symbolic
 * fixture — «worked», «cancelled 3 h before», a day offset and a clock time
 * — against the shop's calendar and hands this builder an
 * {@link AppointmentPlan}: plain numbers and the entity's own SCREAMING
 * tags. Every instant there is derived from the calendar, never from the
 * clock, so a second run on the same day builds the same bytes.
 *
 * The seed has no lifecycle stamps to copy — they are the visit's own
 * facts, derived here the way the callables stamp them: a confirmed visit
 * was confirmed when it was booked, a settled one when its last seat was
 * resolved (the chair freed, the shop gave up waiting, the call came).
 */
import {
  BookingContact,
  BookingLifecycle,
  type BarberPreference,
  PhotoOrigin,
  type CancellationReason,
  CancellationReasonSet,
  type CancelledBy,
  type Placement,
  Seat,
  SeatLabel,
  SeatOccupant,
  SeatOutcome,
  ServiceTerms,
  StoodSeatPairs,
  type SubjectRelationship,
} from '@core/components';
import type { Appointment, AppointmentPhoto } from '@core/entities';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  Currency,
  defect,
  LocationId,
  SeatId,
  ServiceId,
  ServiceVariantId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  AppointmentIndexSystem,
  PhoneSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type Body,
  cents,
  day,
  minuteCount,
  minutesLong,
  SHOP_TIME_ZONE,
  startAt,
  sure,
} from './catalog.fixtures';
import { customerIdOf } from './customers.fixtures';

/** Who a seat is for: an account (by uid) and its relationship, or a guest by label. */
export type SeatSubjectPlan =
  | {
      readonly userId: string;
      readonly relationship: SubjectRelationship;
    }
  | { readonly guestLabel: string };

/** What became of a seat, its instant from the calendar. */
export type SeatOutcomePlan =
  | { readonly attendanceState: 'SCHEDULED' }
  | { readonly attendanceState: 'WORKED'; readonly atUtcMs: number }
  | { readonly attendanceState: 'NO_SHOW'; readonly atUtcMs: number }
  | {
      readonly attendanceState: 'CANCELLED';
      readonly atUtcMs: number;
      readonly cancelledBy: CancelledBy;
      readonly cancellationReason: CancellationReason;
      /** The free-cancellation window in force when it was called off. */
      readonly windowHours: number | null;
    };

/** One seat, resolved: its chair, its sold terms beside the catalogue's, its subject, its outcome. */
export type SeatPlan = {
  readonly seatId: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  readonly barberPreference: BarberPreference;
  /** On the appointment's `localDate`, minutes past midnight. */
  readonly startMinutes: number;
  /** The chair's catalogue price — what the seat is sold at. */
  readonly priceCents: number;
  /** The minutes the seat is sold for — the catalogue's, or a staff re-timing. */
  readonly durationMinutes: number;
  /** The catalogue's own minutes for this chair, service and variant. */
  readonly catalogDurationMinutes: number;
  readonly subject: SeatSubjectPlan;
  readonly outcome: SeatOutcomePlan;
  /** `null` is "not recorded", which is not zero. */
  readonly tipCents: number | null;
};

/** One visit, resolved against the shop's calendar. */
export type AppointmentPlan = {
  readonly locationId: string;
  /** The shop day every seat of the visit sits on (T7). */
  readonly localDate: string;
  readonly placement: Placement;
  readonly bookingStatus:
    | typeof BookingStatus.Confirmed
    | typeof BookingStatus.Completed
    | typeof BookingStatus.NoShow
    | typeof BookingStatus.Cancelled;
  /** The root cancellation's reasons — a cancelled visit's only. */
  readonly cancellationReasons: readonly CancellationReason[];
  readonly bookedAtUtcMs: number | null;
  readonly arrivedAtUtcMs: number | null;
  readonly bookedFromAppointmentId: string | null;
  /** The booking's contact snapshot, as the booking flow copies it from the profile. */
  readonly contact: {
    readonly name: string;
    readonly phone: string;
    readonly email: string | null;
    readonly note: string | null;
  } | null;
  readonly seats: readonly SeatPlan[];
};

const instant = (raw: number): UtcEpochMs =>
  sure(UtcEpochMs.of(raw), `instant ${raw}`);

function occupantOf(subject: SeatSubjectPlan): SeatOccupant {
  return 'guestLabel' in subject
    ? SeatOccupant.anonymous(
        sure(
          SeatLabel.parse(subject.guestLabel),
          `label ${subject.guestLabel}`,
        ),
      )
    : SeatOccupant.account(
        UserId.of(subject.userId),
        customerIdOf(subject.userId),
        subject.relationship,
      );
}

function outcomeOf(outcome: SeatOutcomePlan): SeatOutcome {
  switch (outcome.attendanceState) {
    case 'SCHEDULED':
      return SeatOutcome.scheduled();
    case 'WORKED':
      return SeatOutcome.worked(instant(outcome.atUtcMs));
    case 'NO_SHOW':
      return SeatOutcome.noShow(instant(outcome.atUtcMs));
    case 'CANCELLED':
      return SeatOutcome.cancelled(
        instant(outcome.atUtcMs),
        outcome.cancelledBy,
        outcome.cancellationReason,
        outcome.windowHours,
      );
    default:
      return defect('seed fixture: an unknown seat outcome');
  }
}

/** A seat from its plan: the terms snapshot keeps the catalogue's minutes beside a re-timing. */
function seatOf(plan: SeatPlan): Seat {
  const catalog = ServiceTerms.of(
    cents(plan.priceCents),
    Currency.EUR,
    minutesLong(plan.catalogDurationMinutes),
    minuteCount(0),
    minuteCount(0),
  );
  const charged = ServiceTerms.of(
    cents(plan.priceCents),
    Currency.EUR,
    minutesLong(plan.durationMinutes),
    minuteCount(0),
    minuteCount(0),
  );
  return Seat.compose(
    {
      seatId: SeatId.of(plan.seatId),
      serviceId: ServiceId.of(plan.serviceId),
      variantId:
        plan.variantId === null ? null : ServiceVariantId.of(plan.variantId),
      barberId: BarberId.of(plan.barberId),
      barberPreference: plan.barberPreference,
      startMinutes: startAt(plan.startMinutes),
      tipCents: plan.tipCents === null ? null : cents(plan.tipCents),
    },
    Seat.termsOf(charged, catalog),
    occupantOf(plan.subject),
    outcomeOf(plan.outcome),
  );
}

/** The latest instant among the seats resolved as `state` — when the visit settled so. */
function settledAt(
  plan: AppointmentPlan,
  state: SeatOutcomePlan['attendanceState'],
): UtcEpochMs {
  let latest: number | null = null;
  for (const seat of plan.seats) {
    const outcome = seat.outcome;
    if (outcome.attendanceState === state && 'atUtcMs' in outcome) {
      latest =
        latest === null ? outcome.atUtcMs : Math.max(latest, outcome.atUtcMs);
    }
  }
  return latest === null
    ? defect(
        `seed fixture: a ${plan.bookingStatus} visit with no ${state} seat`,
      )
    : instant(latest);
}

/** The root lifecycle a visit's status and its seats stamp. */
function lifecycleOf(
  plan: AppointmentPlan,
  startUtcMs: UtcEpochMs,
): BookingLifecycle {
  switch (plan.bookingStatus) {
    case BookingStatus.Confirmed:
      // Confirmed as it was booked (auto-confirm); a visit nobody booked
      // ahead was confirmed as it began.
      return BookingLifecycle.confirm(
        plan.bookedAtUtcMs === null ? startUtcMs : instant(plan.bookedAtUtcMs),
      );
    case BookingStatus.Completed:
      return BookingLifecycle.complete(settledAt(plan, 'WORKED'));
    case BookingStatus.NoShow:
      return BookingLifecycle.noShow(settledAt(plan, 'NO_SHOW'));
    case BookingStatus.Cancelled:
      return BookingLifecycle.cancel(
        settledAt(plan, 'CANCELLED'),
        CancellationReasonSet.of(plan.cancellationReasons),
      );
    default:
      return defect('seed fixture: an unknown booking status');
  }
}

/** The edge's phone parser for the contact snapshot. */
const parsePhone = (raw: string) => {
  const parsed = PhoneSystem.parse(raw, null);
  return parsed.ok ? parsed.value.e164 : null;
};

/**
 * `appointments/{id}` from its plan — the flat body, every mirror
 * recomputed from the seats. Refuses (throws) a plan the archetype cannot
 * hold: a seat sold past midnight, a contact the booking flow would not
 * take, a wall-clock start inside a DST gap.
 */
export function appointmentBody(plan: AppointmentPlan): Body<Appointment> {
  const localDate = day(plan.localDate);
  const seats = plan.seats.map(seatOf);
  const envelope =
    AppointmentIndexSystem.envelope({ seats }) ??
    defect('seed fixture: an appointment without seats');
  const utcEpochMs = sure(
    ZonedTimeSystem.toUtc(localDate, envelope.startMinutes, SHOP_TIME_ZONE),
    `the start of a visit on ${plan.localDate}`,
  );
  const keys = AppointmentIndexSystem.queryKeys({ localDate, seats });
  const contact =
    plan.contact === null
      ? BookingContact.NONE
      : sure(
          BookingContact.create(plan.contact, parsePhone),
          `contact ${plan.contact.name}`,
        );
  return {
    locationId: LocationId.of(plan.locationId),
    ownerUserId: keys.ownerUserId,
    subjectUserIds: keys.subjectUserIds,
    ownerCustomerId: keys.ownerCustomerId,
    subjectCustomerIds: keys.subjectCustomerIds,
    placement: plan.placement,
    inferredPlacement: null,
    barberIds: keys.barberIds,
    busyKeys: keys.busyKeys,
    seats,
    bookedFromAppointmentId:
      plan.bookedFromAppointmentId === null
        ? null
        : AppointmentId.of(plan.bookedFromAppointmentId),
    discounts: [],
    voucherRedemptions: [],
    revision: 0,
    appliedOperations: [],
    localDate,
    startMinutes: envelope.startMinutes,
    endMinutes: envelope.endMinutes,
    utcEpochMs,
    ...BookingContact.of(contact),
    bookedAtUtcMs:
      plan.bookedAtUtcMs === null ? null : instant(plan.bookedAtUtcMs),
    arrivedAtUtcMs:
      plan.arrivedAtUtcMs === null ? null : instant(plan.arrivedAtUtcMs),
    ...StoodSeatPairs.NONE,
    ...BookingLifecycle.sliceOf(lifecycleOf(plan, utcEpochMs)),
  } satisfies Omit<Appointment, 'id'>;
}

/** What the seed knows about a past cut it pictures: the visit, the chair, the client, when. */
export type PhotoPlan = {
  readonly appointmentId: string;
  readonly barberId: string;
  /** The account in the chair — its client record is the photo's (D29). */
  readonly clientUserId: string;
  readonly clientLabel: string;
  readonly takenByUserId: string;
  readonly takenAtUtcMs: number;
  /** The Storage key, `appointmentPhotos/{appointmentId}/{photoId}`. */
  readonly path: string;
  /** The tokened download URL the object answers to. */
  readonly url: string;
  readonly width: number;
  readonly height: number;
};

/**
 * `appointmentPhotos/{photoId}` as the visit sheet's shutter writes one
 * (`APPOINTMENT_PHOTO_PORTS.saveAppointmentPhoto` after `uploadPhotoBytes`):
 * a picture SHOT for the visit (so deleting it removes the object), of the
 * client RECORD in the chair, taken by a staff account at an instant.
 */
export function appointmentPhotoBody(plan: PhotoPlan): Body<AppointmentPhoto> {
  return {
    appointmentId: AppointmentId.of(plan.appointmentId),
    barberId: BarberId.of(plan.barberId),
    clientCustomerId: customerIdOf(plan.clientUserId),
    clientLabel: plan.clientLabel,
    takenByUserId: UserId.of(plan.takenByUserId),
    takenAtUtcMs: instant(plan.takenAtUtcMs),
    path: plan.path,
    url: plan.url,
    width: plan.width,
    height: plan.height,
    photoOrigin: PhotoOrigin.Shot,
    label: null,
  } satisfies Omit<AppointmentPhoto, 'id'>;
}
