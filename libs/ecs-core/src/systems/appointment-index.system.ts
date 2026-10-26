import {
  type ChairGeometry,
  Seat,
  type SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  BusyKey,
  type BarberId,
  type CustomerId,
  type UserId,
  type LocalDate,
  type EndMinute,
  type MinuteOfDay,
} from '@core/primitives';

/**
 * The ACCOUNT mirrors of an appointment (`appointment-document.ts:94-106`):
 * flat keys beside the seats so the indexed queries find the visit — "my
 * appointments" (`ownerUserId`), the accounts on it (`subjectUserIds`, kept
 * beside the client records, D29), a barber's book (`barberIds`) and the
 * busy rebuild's reverse index (`busyKeys`). The SEATS are the truth; a
 * corrupt mirror can change which queries find a visit, never what it says.
 */
export type AppointmentAccountKeys = {
  readonly ownerUserId: UserId | null;
  readonly subjectUserIds: readonly UserId[];
  readonly barberIds: readonly BarberId[];
  readonly busyKeys: readonly BusyKey[];
};

/**
 * Every query mirror — the account keys and, beside them, the CLIENT-RECORD
 * keys (D29, F1-4): the `SELF` seat's record (`ownerCustomerId`) and every
 * record on the visit (`subjectCustomerIds` — a client's whole history, R33,
 * index #19, and the stats projection's read set).
 */
export type AppointmentQueryKeys = AppointmentAccountKeys & {
  readonly ownerCustomerId: CustomerId | null;
  readonly subjectCustomerIds: readonly CustomerId[];
};

/** What every mirror reads of a seat — whose account and record it is, and whose chair. */
export type IndexedSeat = Pick<Seat, 'barberId'> & SeatOccupant;

/**
 * The envelope mirror — earliest sold start to latest sold end, both ends
 * branded (a `MinuteRange` once the foundation flips its fields).
 */
export type AppointmentEnvelope = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/** What every mirror reads of an appointment — its shop day and its seats. */
export type IndexedAppointment = {
  readonly localDate: LocalDate;
  readonly seats: readonly IndexedSeat[];
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Earliest sold start and latest sold end of the seats, or `null` for none. */
function spanOf(
  seats: readonly ChairGeometry[],
): { readonly start: MinuteOfDay; readonly end: EndMinute } | null {
  const first = seats[0];
  if (first === undefined) return null;
  let start: MinuteOfDay = first.startMinutes;
  let end: EndMinute = Seat.endMinutes(first);
  for (let i = 1; i < seats.length; i++) {
    const seat = seats[i] as ChairGeometry;
    if (seat.startMinutes < start) start = seat.startMinutes;
    const seatEnd = Seat.endMinutes(seat);
    if (seatEnd > end) end = seatEnd;
  }
  return { start, end };
}

/**
 * The four ACCOUNT mirrors, read off the seats' accounts alone:
 *
 * - `ownerUserId` — the first `SELF` seat's account (the booker); `null`
 *   for a walk-in the shop entered itself;
 * - `subjectUserIds` — every ACCOUNT on the visit, distinct, sorted (the
 *   `busyKeys` precedent: one array mirror); guests have no account;
 * - `barberIds` — distinct, in seat order;
 * - `busyKeys` — `BusyKey.of(barber, the appointment's shop day)` per
 *   seat, distinct, sorted: two seats with one barber are one projection
 *   document.
 */
function accountKeysOf(
  appointment: IndexedAppointment,
): AppointmentAccountKeys {
  let ownerUserId: UserId | null = null;
  const subjects: UserId[] = [];
  const barberIds: BarberId[] = [];
  const busyKeys: BusyKey[] = [];
  const seats = appointment.seats;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as IndexedSeat;
    if (seat.seatSubject === SeatSubject.Account) {
      if (
        ownerUserId === null &&
        seat.subjectRelationship === SubjectRelationship.Self
      ) {
        ownerUserId = seat.subjectUserId;
      }
      if (!subjects.includes(seat.subjectUserId)) {
        subjects.push(seat.subjectUserId);
      }
    }
    if (!barberIds.includes(seat.barberId)) barberIds.push(seat.barberId);
    const key = BusyKey.of(seat.barberId, appointment.localDate);
    if (!busyKeys.includes(key)) busyKeys.push(key);
  }
  subjects.sort(compareStrings);
  busyKeys.sort(compareStrings);
  return { ownerUserId, subjectUserIds: subjects, barberIds, busyKeys };
}

/**
 * AppointmentIndexSystem — the mirrors every write plan recomputes, and the
 * placement rule that rides beside them (R33). Used by every write plan and
 * by the seed. Zone-blind (Law 7.3): a busy key names the appointment's own
 * shop day (`localDate`, one shop day per appointment — T7), so
 * `BusySystem.contributionsOf` and the mirror name the same documents.
 */
export const AppointmentIndexSystem = {
  /**
   * Every mirror: the account keys (`ownerUserId`, `subjectUserIds`,
   * `barberIds`, `busyKeys`) and, derived beside them from the
   * same seats (D29, F1-4),
   *
   * - `ownerCustomerId` — the first `SELF` seat's client record; `null`
   *   exactly when `ownerUserId` is;
   * - `subjectCustomerIds` — every client record on the visit, distinct,
   *   sorted (one `array-contains` index, #19): an account's, and a
   *   walk-in's (OR-26 — so the walk-in's history and card find the
   *   visit); an anonymous guest has none.
   */
  queryKeys(appointment: IndexedAppointment): AppointmentQueryKeys {
    let ownerCustomerId: CustomerId | null = null;
    const customers: CustomerId[] = [];
    const seats = appointment.seats;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as IndexedSeat;
      if (seat.seatSubject === SeatSubject.Anonymous) continue;
      if (
        seat.seatSubject === SeatSubject.Account &&
        ownerCustomerId === null &&
        seat.subjectRelationship === SubjectRelationship.Self
      ) {
        ownerCustomerId = seat.subjectCustomerId;
      }
      if (!customers.includes(seat.subjectCustomerId)) {
        customers.push(seat.subjectCustomerId);
      }
    }
    customers.sort(compareStrings);
    return {
      ...accountKeysOf(appointment),
      ownerCustomerId,
      subjectCustomerIds: customers,
    };
  },

  /**
   * The envelope mirror — earliest sold start to latest sold end on the
   * shop day's wall clock; `null` for a visit with no seats (which no write
   * plan may produce).
   */
  envelope(appointment: {
    readonly seats: readonly ChairGeometry[];
  }): AppointmentEnvelope | null {
    const span = spanOf(appointment.seats);
    return span === null
      ? null
      : { startMinutes: span.start, endMinutes: span.end };
  },

  /**
   * The entity with every mirror recomputed from its seats — what a write
   * plan stores. `placement` (the COMMIT's own stamp) and `inferredPlacement`
   * (the backfill's reconstruction) ride through VERBATIM: no rewrite can
   * erase the inference, and none can promote it to a stamp. A visit with
   * no seats keeps its stored envelope. The envelope's `utcEpochMs` is the
   * ingestion boundary's (it needs the location's zone) and rides through
   * as given.
   */
  withQueryKeys(appointment: Appointment): Appointment {
    const keys = AppointmentIndexSystem.queryKeys(appointment);
    const span = spanOf(appointment.seats);
    return {
      ...appointment,
      ownerUserId: keys.ownerUserId,
      subjectUserIds: keys.subjectUserIds,
      ownerCustomerId: keys.ownerCustomerId,
      subjectCustomerIds: keys.subjectCustomerIds,
      barberIds: keys.barberIds,
      busyKeys: keys.busyKeys,
      startMinutes: span === null ? appointment.startMinutes : span.start,
      endMinutes: span === null ? appointment.endMinutes : span.end,
    };
  },
} as const;
