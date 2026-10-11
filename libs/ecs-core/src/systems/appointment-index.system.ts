import type { Placement } from '../components/placement-kind.data';
import {
  Seat,
  type SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from '../components/seat.data';
import type { Appointment } from '../entities/appointment.entity';
import { BusyKey } from '../primitives/busy-key.primitive';
import type { BarberId, UserId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type {
  EndMinute,
  MinuteOfDay,
} from '../primitives/minute-of-day.primitive';

/**
 * The QUERY MIRRORS of an appointment (`appointment-document.ts:94-106`):
 * flat keys beside the seats so the indexed queries find the visit — "my
 * appointments" (`ownerUserId`), a client's whole history (`subjectUserIds`,
 * R33 — `UserId` until the appointment flip (1) adds `subjectCustomerIds`,
 * D29), a barber's book (`barberIds`) and the busy rebuild's reverse index
 * (`busyKeys`). The SEATS are the truth; a corrupt mirror can change which
 * queries find a visit, never what it says.
 */
export type AppointmentQueryKeys = {
  readonly ownerUserId: UserId | null;
  readonly subjectUserIds: readonly UserId[];
  readonly barberIds: readonly BarberId[];
  readonly busyKeys: readonly BusyKey[];
};

/** What the mirrors read of a seat — whose it is and whose chair. */
export type IndexedSeat = Pick<Seat, 'barberId'> & SeatOccupant;

/**
 * The envelope mirror — earliest sold start to latest sold end, both ends
 * branded (a `MinuteRange` once the foundation flips its fields).
 */
export type AppointmentEnvelope = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/** What the mirrors read of an appointment — its shop day and its seats. */
export type IndexedAppointment = {
  readonly localDate: LocalDate;
  readonly seats: readonly IndexedSeat[];
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Earliest sold start and latest sold end of the seats, or `null` for none. */
function spanOf(
  seats: readonly Seat[],
): { readonly start: MinuteOfDay; readonly end: EndMinute } | null {
  const first = seats[0];
  if (first === undefined) return null;
  let start: MinuteOfDay = first.startMinutes;
  let end: EndMinute = Seat.endMinutes(first);
  for (let i = 1; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (seat.startMinutes < start) start = seat.startMinutes;
    const seatEnd = Seat.endMinutes(seat);
    if (seatEnd > end) end = seatEnd;
  }
  return { start, end };
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
   * The four mirrors:
   *
   * - `ownerUserId` — the first `SELF` seat's account (the booker); `null`
   *   for a walk-in the shop entered itself;
   * - `subjectUserIds` — every ACCOUNT on the visit, distinct, sorted (the
   *   `busyKeys` precedent: one array mirror, one `array-contains` index);
   *   guests have no account and no history to find;
   * - `barberIds` — distinct, in seat order;
   * - `busyKeys` — `BusyKey.of(barber, the appointment's shop day)` per
   *   seat, distinct, sorted: two seats with one barber are one projection
   *   document.
   */
  queryKeys(appointment: IndexedAppointment): AppointmentQueryKeys {
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
  },

  /**
   * The envelope mirror — earliest sold start to latest sold end on the
   * shop day's wall clock; `null` for a visit with no seats (which no write
   * plan may produce).
   */
  envelope(
    appointment: Pick<Appointment, 'seats'>,
  ): AppointmentEnvelope | null {
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
      barberIds: keys.barberIds,
      busyKeys: keys.busyKeys,
      startMinutes: span === null ? appointment.startMinutes : span.start,
      endMinutes: span === null ? appointment.endMinutes : span.end,
    };
  },

  /**
   * Who placed the booking, as the COMMIT stamped it — `null` for a row it
   * did not stamp (written before the field), whatever the backfill has
   * since inferred. The evidence that the row's seat preferences were
   * recorded, not defaulted.
   */
  stampedPlacement(
    appointment: Pick<Appointment, 'placement'>,
  ): Placement | null {
    return appointment.placement;
  },

  /**
   * Who most likely placed the booking, as the backfill reconstructed it
   * from the commit's audit row (§12.5.1) — read on its own, NEVER as the
   * stamp and never evidence about the seats (the old commit stored an
   * omitted preference as `SPECIFIC`). `null` when nothing was inferred.
   */
  inferPlacement(
    appointment: Pick<Appointment, 'inferredPlacement'>,
  ): Placement | null {
    return appointment.inferredPlacement;
  },
} as const;
