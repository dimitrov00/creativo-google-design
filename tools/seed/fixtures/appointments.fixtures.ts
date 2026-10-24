/**
 * THE DEV SEED'S APPOINTMENT DOCUMENTS (flip 1): `appointments/{id}` as
 * the flat `Appointment` minus its `id` (Laws 5–7) — the seats, the shop
 * wall clock (`localDate`, `startMinutes`, `endMinutes`) and the one
 * instant `utcEpochMs` computed from the zone of the visit's own shop at
 * ingestion, the lifecycle variant at the root, the contact snapshot, the
 * stamps, and the query mirrors recomputed from the seats by
 * `AppointmentIndexSystem` exactly as every write plan recomputes them —
 * the account keys (`ownerUserId`, `subjectUserIds`) BESIDE the
 * client-record keys (`ownerCustomerId`, `subjectCustomerIds`, D29 / F1-4).
 *
 * A visit is AUTHORED in the entity's own vocabulary — a
 * {@link VisitIntent} (the hand-written ones and the history plans in
 * `book.fixtures.ts`, the generated history in `tools/seed/history.mjs`):
 * each seat its stored fields, its occupant the `SeatOccupant` slice the
 * seat stores ({@link accountSeat}, {@link guestSeat}), its outcome an
 * `attendanceState` from the dictionary ({@link WORKED_SEAT},
 * {@link calledOffBefore}, …), the placement and preference tags from
 * theirs — on a day offset from the shop's today, at minutes of that day.
 * There is no symbolic code, and no table that turns one into a stored tag.
 *
 * The plan logic (`tools/seed/appointments.mjs`) places an intent on the
 * shop's calendar and the catalogue and hands this builder an
 * {@link AppointmentPlan}: the intent, its shop day, the terms each seat
 * was sold at and the instant each outcome was stamped. Every instant there
 * is derived from the calendar, never from the clock, so a second run on
 * the same day builds the same bytes.
 *
 * The root lifecycle is never authored: it is the SUMMARY of the seats
 * (`SeatOutcome.summarize`), as every write plan derives it. A visit with a
 * seat still scheduled was confirmed when it was booked (auto-confirm; a
 * visit nobody booked ahead was confirmed as it began); one whose seats are
 * all resolved settled when its last seat was (the chair freed, the shop
 * gave up waiting, the call came).
 */
import {
  BookingContact,
  BookingLifecycle,
  type BarberPreference,
  type CancellationReason,
  type CancelledBy,
  PhotoOrigin,
  type Placement,
  Seat,
  SeatLabel,
  SeatOccupant,
  SeatOutcome,
  ServiceTerms,
  StoodSeatPairs,
  SubjectRelationship,
} from '@core/components';
import type { Appointment, AppointmentPhoto } from '@core/entities';
import {
  AppointmentId,
  AttendanceState,
  BarberId,
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
  startAt,
  sure,
  timeZoneOf,
} from './catalog.fixtures';
import { customerIdOf } from './customers.fixtures';
import { CANCELLATION_WINDOW_HOURS } from './settings.fixtures';

// ── What a fixture authors ─────────────────────────────────────────────────

/**
 * A reading of the shop's clock relative to its today: a day offset, and
 * minutes past that day's midnight — running past it into the next day,
 * or back before it into the one before.
 */
export type ShopMoment = {
  readonly dayOffset: number;
  readonly minutes: number;
};

/**
 * A called-off seat as authored: who called it off and why, from the
 * dictionaries, and when — so many hours before its slot
 * (`cancelledHoursBefore`), or at a moment of its own (`cancelledOn`,
 * «called off last night»), which holds wherever its slot is placed.
 */
export type SeatCancellationIntent = {
  readonly attendanceState: typeof AttendanceState.Cancelled;
  readonly cancelledBy: CancelledBy;
  readonly cancellationReason: CancellationReason;
  readonly cancelledHoursBefore: number | null;
  readonly cancelledOn: ShopMoment | null;
};

/** What became of a seat, as authored — its instant is the calendar's, stamped as it is placed. */
export type SeatOutcomeIntent =
  | { readonly attendanceState: typeof AttendanceState.Scheduled }
  | { readonly attendanceState: typeof AttendanceState.Worked }
  | { readonly attendanceState: typeof AttendanceState.NoShow }
  | SeatCancellationIntent;

/** Still to come. */
export const SCHEDULED_SEAT = {
  attendanceState: AttendanceState.Scheduled,
} as const satisfies SeatOutcomeIntent;

/** Worked — stamped as the chair frees up. */
export const WORKED_SEAT = {
  attendanceState: AttendanceState.Worked,
} as const satisfies SeatOutcomeIntent;

/** Nobody came — stamped a quarter of an hour in, when the shop gives up waiting. */
export const NO_SHOW_SEAT = {
  attendanceState: AttendanceState.NoShow,
} as const satisfies SeatOutcomeIntent;

/** Called off `hoursBefore` hours before its slot. */
export function calledOffBefore(
  cancelledBy: CancelledBy,
  cancellationReason: CancellationReason,
  hoursBefore: number,
): SeatCancellationIntent {
  return {
    attendanceState: AttendanceState.Cancelled,
    cancelledBy,
    cancellationReason,
    cancelledHoursBefore: hoursBefore,
    cancelledOn: null,
  };
}

/** Called off at a moment of its own. */
export function calledOffAt(
  cancelledBy: CancelledBy,
  cancellationReason: CancellationReason,
  at: ShopMoment,
): SeatCancellationIntent {
  return {
    attendanceState: AttendanceState.Cancelled,
    cancelledBy,
    cancellationReason,
    cancelledHoursBefore: null,
    cancelledOn: at,
  };
}

/**
 * An account's seat: the occupant slice the seat stores — the account, its
 * client RECORD (`customerIdOf`, D29) and how it relates to the booker
 * (`SELF` is the booker; `COMPANION` rides on their booking).
 */
export function accountSeat(
  uid: string,
  relationship: SubjectRelationship = SubjectRelationship.Self,
): SeatOccupant.Account {
  return SeatOccupant.account(UserId.of(uid), customerIdOf(uid), relationship);
}

/** An anonymous seat: no account, no PII beyond the handle staff typed. */
export function guestSeat(label: string): SeatOccupant.Anonymous {
  return SeatOccupant.anonymous(sure(SeatLabel.parse(label), `label ${label}`));
}

/**
 * One seat as authored: the stored seat's own fields, its occupant slice
 * and its outcome. The minutes are the catalogue's unless the seat names
 * its own (a visit booked shorter or longer).
 */
export type SeatIntent = SeatOccupant &
  SeatOutcomeIntent & {
    readonly seatId: string;
    readonly serviceId: string;
    readonly variantId: string | null;
    readonly barberId: string;
    /** What the client ASKED for, beside the chair they got. */
    readonly barberPreference: BarberPreference;
    /** On the visit's shop day, minutes past midnight. */
    readonly startMinutes: number;
    /** The seat's own minutes, or `null` for the catalogue's. */
    readonly durationMinutes: number | null;
    /** `null` is "not recorded", which is not zero. */
    readonly tipCents: number | null;
  };

/** The booking's contact snapshot, as the booking flow copies it from the profile. */
export type VisitContact = {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly note: string | null;
};

/** One visit as authored, on a day offset from the shop's today. */
export type VisitIntent = {
  readonly id: string;
  readonly dayOffset: number;
  /** Its one shop — `null` until placement finds the shop its barbers work at that day. */
  readonly locationId: string | null;
  readonly placement: Placement;
  /** When it was put in the book; `null` for a visit nobody booked ahead. */
  readonly bookedOn: ShopMoment | null;
  /** When the client walked in, minutes past the visit day's midnight; `null` for nobody yet. */
  readonly arrivedMinutes: number | null;
  readonly bookedFromAppointmentId: string | null;
  readonly contact: VisitContact | null;
  readonly seats: readonly SeatIntent[];
};

// ── What the plan logic resolves ───────────────────────────────────────────

/** One seat placed on the catalogue and the calendar. */
export type SeatPlan = {
  readonly seat: SeatIntent;
  /** The chair's catalogue price — what the seat is sold at. */
  readonly priceCents: number;
  /** The minutes the seat is sold for — its own, or the catalogue's. */
  readonly durationMinutes: number;
  /** The catalogue's own minutes for this chair, service and variant. */
  readonly catalogDurationMinutes: number;
  /** The instant its outcome was stamped; `null` while it is scheduled. */
  readonly resolvedAtUtcMs: number | null;
};

/** One visit, placed on the shop's calendar. */
export type AppointmentPlan = {
  readonly visit: VisitIntent;
  readonly locationId: string;
  /** The shop day every seat of the visit sits on (T7). */
  readonly localDate: string;
  readonly bookedAtUtcMs: number | null;
  readonly arrivedAtUtcMs: number | null;
  readonly seats: readonly SeatPlan[];
};

const instant = (raw: number): UtcEpochMs =>
  sure(UtcEpochMs.of(raw), `instant ${raw}`);

/** The seat's outcome slice, stamped at the instant the plan resolved it. */
function outcomeOf(plan: SeatPlan): SeatOutcome {
  const { seat } = plan;
  if (seat.attendanceState === AttendanceState.Scheduled) {
    return SeatOutcome.scheduled();
  }
  const at = instant(
    plan.resolvedAtUtcMs ??
      defect(`seed fixture: seat ${seat.seatId} was resolved at no instant`),
  );
  switch (seat.attendanceState) {
    case AttendanceState.Worked:
      return SeatOutcome.worked(at);
    case AttendanceState.NoShow:
      return SeatOutcome.noShow(at);
    case AttendanceState.Cancelled:
      return SeatOutcome.cancelled(
        at,
        seat.cancelledBy,
        seat.cancellationReason,
        CANCELLATION_WINDOW_HOURS,
      );
    default:
      return defect('seed fixture: an unknown seat outcome');
  }
}

/** A seat from its plan: the terms snapshot keeps the catalogue's minutes beside a re-timing. */
function seatOf(plan: SeatPlan): Seat {
  const { seat } = plan;
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
      seatId: SeatId.of(seat.seatId),
      serviceId: ServiceId.of(seat.serviceId),
      variantId:
        seat.variantId === null ? null : ServiceVariantId.of(seat.variantId),
      barberId: BarberId.of(seat.barberId),
      barberPreference: seat.barberPreference,
      startMinutes: startAt(seat.startMinutes),
      tipCents: seat.tipCents === null ? null : cents(seat.tipCents),
    },
    Seat.termsOf(charged, catalog),
    SeatOccupant.of(seat),
    outcomeOf(plan),
  );
}

/** The edge's phone parser for the contact snapshot. */
const parsePhone = (raw: string) => {
  const parsed = PhoneSystem.parse(raw, null);
  return parsed.ok ? parsed.value.e164 : null;
};

/**
 * `appointments/{id}` from its plan — the flat body, every mirror
 * recomputed from the seats, the root lifecycle summarised from them.
 * Refuses (throws) a plan the archetype cannot hold: a seat sold past
 * midnight, a contact the booking flow would not take, a wall-clock start
 * inside a DST gap.
 */
export function appointmentBody(plan: AppointmentPlan): Body<Appointment> {
  const { visit } = plan;
  const localDate = day(plan.localDate);
  const seats = plan.seats.map(seatOf);
  const envelope =
    AppointmentIndexSystem.envelope({ seats }) ??
    defect('seed fixture: an appointment without seats');
  const utcEpochMs = sure(
    ZonedTimeSystem.toUtc(
      localDate,
      envelope.startMinutes,
      timeZoneOf(plan.locationId),
    ),
    `the start of a visit on ${plan.localDate}`,
  );
  const keys = AppointmentIndexSystem.queryKeys({ localDate, seats });
  const contact =
    visit.contact === null
      ? BookingContact.NONE
      : sure(
          BookingContact.create(visit.contact, parsePhone),
          `contact ${visit.contact.name}`,
        );
  const resolved = plan.seats.flatMap(({ resolvedAtUtcMs }) =>
    resolvedAtUtcMs === null ? [] : [resolvedAtUtcMs],
  );
  const lifecycle = SeatOutcome.summarize(
    seats,
    BookingLifecycle.confirm(
      plan.bookedAtUtcMs === null ? utcEpochMs : instant(plan.bookedAtUtcMs),
    ),
    resolved.length === 0 ? utcEpochMs : instant(Math.max(...resolved)),
  );
  return {
    locationId: LocationId.of(plan.locationId),
    ownerUserId: keys.ownerUserId,
    subjectUserIds: keys.subjectUserIds,
    ownerCustomerId: keys.ownerCustomerId,
    subjectCustomerIds: keys.subjectCustomerIds,
    placement: visit.placement,
    inferredPlacement: null,
    barberIds: keys.barberIds,
    busyKeys: keys.busyKeys,
    seats,
    bookedFromAppointmentId:
      visit.bookedFromAppointmentId === null
        ? null
        : AppointmentId.of(visit.bookedFromAppointmentId),
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
    ...BookingLifecycle.sliceOf(lifecycle),
  } satisfies Omit<Appointment, 'id'>;
}

/** What the seed knows about a past cut it pictures: the visit, the chair, the client, when. */
export type PhotoPlan = {
  readonly appointmentId: string;
  readonly barberId: string;
  /** The account in the chair — its client record is the photo's (D29). */
  readonly clientAccountUid: string;
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
    clientCustomerId: customerIdOf(plan.clientAccountUid),
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
